# Production launch runbook (configuration, migrations, backup and recovery, monitoring, rollback)

This is the **executable** form of `docs/deployment-readiness-gate.md`: every step names the command that does it and the output that counts as a pass. The commands exist and have
been exercised against the isolated test database (see "What has and has not been exercised"). Nothing here has been run against production, and nothing in this repository can
do so by accident: each operator script takes its target from an explicit variable, refuses to guess, never prints a connection string, and the one irreversible step
(`migrate apply`) refuses unless its guards pass.

**Roles.** A person with the production database's direct URL runs sections 2 to 4. The owner decides about restore-point rollbacks (section 7). Nothing is run by a scheduler or by
the deployment itself.

## 1. Before anything: configuration and release checks

1. **Environment, names only.** Put the production variables in a file kept *outside* the repository (or export them in the shell) and run:

   ```bash
   npm run ops:check-config -- --env-file /secure/path/production.env
   ```

   Pass = `RESULT: no problems`. It applies the start-up rules plus: the direct connection string is present, neither database is test-named, pooled and direct name the same database,
   origins agree, the SMTP URL is valid. Warnings (no scheduler secret, no email provider, identical pooled/direct strings) must each be read and either fixed or accepted by the owner.
   It prints variable *names and reasons only*; the output can be pasted into a ticket.
2. **Migration manifest is current** (the readiness probe compares the database with it):

   ```bash
   npx tsx scripts/writeMigrationManifest.ts --check
   ```

3. **Checks on the release commit**: `npx next typegen` first on a pristine checkout (the generated route types are not committed, and `tsc` fails with `Cannot find name 'LayoutProps'` without them; a build also generates them), then `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:integration` (against the isolated test database), and the production build on the host. Install with `npm ci --strict-allow-scripts` so any install script missing from the `allowScripts` policy in `package.json` fails loudly instead of being a notice.
4. **Runtime and dependencies**: Node 24 (`.nvmrc`, `engines`). Run `npm audit --omit=dev` on the **release commit** and review every finding (the gate in §1 of `docs/deployment-readiness-gate.md`). On 2026-10-24 it reported 0 after the Next.js 16.4.3 / Prisma 7.10.1 / nodemailer 10.2.1 remediation (register R-24); a clean result only covers advisories already published for those exact versions, so re-run it, and check the host's install log: npm 11 warns that six packages' install scripts are not covered by `allowScripts` (`argon2` must load and hash on the host).

## 2. Restore point and its fingerprint (before any change to the database)

1. Create the restore point in the provider (Neon: a branch from the current head, named with the date and release). Retention on the current plan is a decision (O-01).
2. **Fingerprint the source and save it** (counts and migration names only; no row data):

   ```bash
   VERIFY_DATABASE_URL=<direct url of the SOURCE> npm run ops:verify-database -- --out restore-point-<release>.json
   ```

3. **Prove the restore point holds the same state**: point the same command at the restore-point branch and compare:

   ```bash
   VERIFY_DATABASE_URL=<url of the RESTORE-POINT branch> npm run ops:verify-database -- --compare restore-point-<release>.json
   ```

   Pass = `RESULT: verified` (identical migrations and row counts, no failed migration, no lifecycle-integrity violation). A restore point that does not verify is not a restore point: stop.

## 3. Rehearse the migrations on a clone

On a **non-production** branch cloned from the restore point (never on production):

```bash
MIGRATE_DATABASE_URL=<direct url of the CLONE> npm run migrate -- status
```

`status` lists what is pending and classifies each migration: **ADDITIVE** (the previous code keeps working on the new schema, so the rollback is "return traffic") or **BLOCKING** (it cannot be
undone by redeploying the previous code; the rollback is the restore point and the owner must accept that). `to review` counts statements that can reject writes or fail on existing data
(unique indexes and checks on existing tables, data rewrites): those are what the rehearsal on real data is for.

```bash
MIGRATE_DATABASE_URL=<CLONE url> npm run migrate -- apply --confirm-host <host:port/database as printed above> --restore-point "<label of the clone's source>"
```

Pass = `After: ... pending 0, failed 0`. Then deploy the release candidate against the clone and run section 5 against it.

## 4. Apply to production (the one irreversible step)

```bash
MIGRATE_DATABASE_URL=<direct url of PRODUCTION> npm run migrate -- status                       # read-only: confirm what will run
MIGRATE_DATABASE_URL=<direct url of PRODUCTION> npm run migrate -- apply \
    --confirm-host <host:port/database exactly as status printed it> \
    --restore-point "<label of the verified restore point from section 2>"
```

`apply` **refuses** (exit 4, nothing changed) unless: the typed host matches the target in use; a restore point is named; no earlier migration is failed or half-applied; the database is not
*ahead* of this code (wrong code, or a newer release already ran); and no pending migration is BLOCKING unless `--acknowledge-blocking` is added by someone who has the owner's acceptance.
It runs `prisma migrate deploy` with an empty dotenv, so the CLI cannot read the repository's `.env`. Run it **before** traffic moves, by a person, never from a deployment hook.

Afterwards: `GET /api/ready` on the new deployment must answer `200 {"status":"ready"}` before it receives traffic.

## 5. Validate a staged or pre-promotion deployment

```bash
npm run ops:smoke -- --base-url https://<staging or pre-promotion url> --expected-origin https://<public origin>
```

Pass = `RESULT: all N checks passed`. It checks, with GET requests and no credentials: `/api/health` ok; `/api/ready` ready (database answers and every migration this release needs is applied);
`/` names only the configured origin (no localhost in canonical or og:url); `/sitemap.xml` lists only that origin; `/robots.txt` names this sitemap and keeps `/studio` and `/api` out;
`/studio/signin` is 200; an unknown URL is 404; security headers (nosniff, framing denied, permissions policy, HSTS on https); and pages are not cacheable by a shared cache
(`Cache-Control` private/no-store, no `s-maxage`). Keep the output as the gate's evidence.

**Manual items the script cannot do** (record who, when, what): Studio sign-in with a staging user (cookie is `__Secure-`, HttpOnly, SameSite=Lax; sign-out works); an invitation and a
password-reset email arrive in a real inbox with the right origin in the link; publish then unpublish one test Recording and see it appear and disappear on its page, in search and in the
sitemap; hold and lift a test Recording the same way; an unlisted video is not public without approval; deliberately trigger one error and see the log line and incident (section 8); remove one
required variable once, on staging only, and confirm `/api/health` goes 500; confirm **no YouTube sync was triggered**.

## 6. Promote, then smoke-test the live domain at once

Keep the previous production deployment available until the new one has passed section 5 against its own URL. After cut-over, immediately:

```bash
npm run ops:smoke -- --base-url https://<production domain>
```

plus a real production Studio sign-in. Anything failing means roll back (section 7) first, investigate second.

## 7. Rollback

**Decide from facts, not memory.** With the previous release's git tag or commit:

```bash
MIGRATE_DATABASE_URL=<direct url of PRODUCTION> npm run migrate -- rollback-check --previous-ref <previous release tag>
```

- `RESULT: returning traffic to the previous release is safe for the schema` (every migration the previous release does not know is additive): **return traffic to the previous deployment**
  (no rebuild), confirm `/api/health`, `/api/ready` and `/sitemap.xml` on it, run `ops:smoke` against it, record what happened. The database keeps the newer, harmless additions.
- `RESULT: NOT safe` (a blocking migration, or the database is missing something the previous release needs): returning traffic is **not** enough. The rollback is the restore point, and it
  **loses every change made after it was taken**; the owner must accept that explicitly (O-01, O-06). Restore, then verify:

  ```bash
  VERIFY_DATABASE_URL=<url of the RESTORED database> npm run ops:verify-database -- --compare restore-point-<release>.json
  ```

  Pass = `RESULT: verified`. Only then return traffic to the previous deployment.

Triggers for rolling back: a failed section 5/6 check; a 5xx rate above the agreed threshold; sign-in or email failing; any data-integrity concern (an `ops:verify-database` integrity
violation, or `/api/ready` stuck on 503).

## 8. Monitoring: what exists, and what the host must be given

**Exists in the application (verified in tests):**

| Signal | Where | Meaning |
|---|---|---|
| `GET /api/health` | liveness | the process is up and the production configuration was accepted. It does **not** prove the database works. |
| `GET /api/ready` | readiness | `200 {"status":"ready"}` only when the database answers **and** every migration this release needs is applied; otherwise `503 {"status":"not-ready"}`. The reason is a code written to the server log, never returned. |
| log line `{"event":"readiness","ready":false,"code":...}` | stderr | one JSON line whenever readiness fails: `DATABASE_UNREACHABLE`, `MIGRATIONS_UNREADABLE`, `MIGRATION_FAILED`, `MIGRATIONS_PENDING` (with migration names). |
| log line `{"event":"unhandled_server_error",...}` | stderr | one JSON line for every unhandled server error: error class, route **pattern**, kind of context and the framework's digest. Never the message, stack, URL or request data. |
| operational incident `UNHANDLED_SERVER_ERROR` | Studio → Health | the same failure, deduplicated and counted per route and error class (a storm is capped at 30 writes a minute per instance); an administrator is notified when one recurs. |
| other incidents, maintenance run history, stewardship job | Studio → Health | `docs/runbooks/scheduled-maintenance.md`. |

**What the host must be given (requires the hosting decision, O-03):**

1. An **uptime monitor** probing **both** `/api/health` and `/api/ready`, alerting a person on any non-200.
2. A **log-drain alert rule** on the two JSON events above (`"event":"unhandled_server_error"` rate; `"event":"readiness"` with `"ready":false`), routed to a person who is awake.
3. The **scheduler** calling `/api/cron/stewardship` with `CRON_SECRET`, so notification emails are sent (`docs/runbooks/scheduled-maintenance.md`).
4. A **test alert** end to end: trigger the error in section 5 and confirm a human receives it. Until this is done, monitoring is *recorded* but not *alerting* (register R-15).

## What has and has not been exercised

Exercised against the isolated test database and in tests: `ops:check-config` on good and deliberately bad environments; `migrate status`, `rollback-check` (against the commit before the last two
migrations: safe), a refused `apply` (no guards; wrong host), a guarded `apply` with nothing pending; `ops:verify-database` save and compare; `/api/ready` ready and not-ready; the error hook writing one
safe line and one deduplicated incident; every smoke check against a fake site, including each failure mode.

**Not exercised, because it needs something only a human or the chosen host can supply:** a real `migrate apply` of pending migrations (rehearse it on the clone, section 3), anything on a real host or
CDN (including whether its edge honours `Cache-Control`; register R-22), email delivery, the scheduler, the uptime monitor and alert delivery, and a restore from a real provider restore point.
