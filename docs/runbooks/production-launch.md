# Production launch runbook (hosting prerequisites, configuration, migrations, backup and recovery, monitoring, rollback, release checklist, gate status)

This is the **executable** form of `docs/deployment-readiness-gate.md`: every step names the command that does it and the output that counts as a pass. The commands exist and have
been exercised against disposable local databases (see section 10 for exactly what, and what was not). Nothing here has been run against production, and nothing in this repository can
do so by accident: each operator script takes its target from an explicit variable, refuses to guess, never prints a connection string or a webhook URL, and the one irreversible step
(`migrate apply`) refuses unless its guards pass.

**Roles.** A person with the production database's direct URL runs sections 3 to 5. The owner decides about restore-point rollbacks (section 8). Nothing is run by a scheduler or by
the deployment itself, except the scheduled-maintenance call in section 0.

## 0. What the host must provide (hosting prerequisites)

The repository contains **no host-specific configuration** (no `vercel.json`, no CI file): the hosting provider has not been chosen or provisioned (register O-03), and committing a
provider's file before that decision would pretend otherwise. ADR-0001 plans Vercel + Neon; the table says what any host needs, and what to add once it is chosen.

| Need | What the repository requires | Verified here | Who acts |
|---|---|---|---|
| **Runtime** | Node 24.x (`engines`, `.nvmrc`); a long-running or serverless Node runtime (the app uses `runtime = "nodejs"`; no Edge code touches the database). | Production builds and `next start` on Node 24 (Windows). `argon2` ships a `linux-x64` prebuilt and is in Next's default server-external list; Prisma 7 runs through a `pg` driver adapter, so no query-engine binary is needed at runtime. **Not built or run on Linux.** | Owner, when the host exists: read the first install and build log |
| **Install and build** | Install with the lockfile (`npm ci`; `--strict-allow-scripts` makes a script missing from the `allowScripts` policy fail loudly, and needs npm 11, which a host may not provide: check, and fall back to reading the install log). Build command `npm run build` (= `prisma generate && next build`). The build needs `DIRECT_URL` present (`prisma.config.ts` reads it) but does not connect to a database. | Verified locally on a pristine copy (R-24). | Owner: set the commands in the host project |
| **Domain and DNS** | One public https origin, used for both `PUBLIC_SITE_URL` and `AUTH_URL` (a different `AUTH_URL` is accepted only with a warning). The app refuses to start in production with a non-https or localhost value. HSTS is sent for one year, without `includeSubDomains`. **Settled: the canonical origin is `https://www.musicmadras.com`** (set both variables to exactly that; the app does not check that the value is `www`), and `https://musicmadras.com` must redirect permanently to it. Links and the sitemap use the configured origin only. The redirect is **not in the repository**: it is done by hand in the Vercel dashboard (add both domains to the project with `www` primary; Project Settings → Domains → the apex → redirect to `www`), plus the DNS records the dashboard shows, and verified with `curl -I` on a nested path with a query string (expect a 301 or 308 to the same path and query, no loop; the status code and query preservation are not stated in Vercel's docs). | Start-up refusal and smoke check `/` and `/sitemap.xml` name only the configured origin: verified. | **Owner, in Vercel and at the DNS provider, with explicit authorisation** (DNS records, domain redirect, TLS is automatic at the host) |
| **Environment variables and secrets** | See the table below. Validate with `npm run ops:check-config -- --env-file <file outside the repo>`; the output names variables and reasons only. | Verified on good and bad files, no value in any output. | Owner: create the values in the host's secret store |
| **Database** | Neon, production on the root branch. `DATABASE_URL` is the **pooled** host (the running app); `DIRECT_URL` is the **direct** host of the same database (build, migrations, the YouTube-sync lock). Row-level locking in the app uses transaction-scoped advisory locks, which a transaction-mode pooler supports. Retention and the restore point are decision O-01. | Both URLs, the "same database" rule and the test-database refusal: verified in `ops:check-config`. Real Neon not touched. | Owner: provision, choose the retention plan (O-01) |
| **Authentication and origins** | Studio sign-in uses a server session cookie (`__Secure-` prefix, HttpOnly, SameSite=Lax, set when the origin is https). Server Actions accept only same-origin calls (no `allowedOrigins` is configured). Google sign-in is optional and needs its redirect URI registered in Google's console. | Cookie flags and sign-out: verified on a production build over http://localhost (secure cookies are accepted there). | Owner: Google console only if Google sign-in is wanted |
| **Email** | `EMAIL_PROVIDER=smtp`, `SMTP_URL` (`smtp://` or `smtps://`), `EMAIL_FROM`. The sending domain's SPF, DKIM and DMARC records are DNS at the provider. Without email, Studio invitations and password reset cannot work. | Delivery code, claims, retries and statuses: tested with a fake transport. **No real message was ever sent.** | Owner: provider account and DNS; then section 9 item 5 |
| **Scheduler** | `vercel.json` holds the one cron entry: `GET /api/cron/stewardship` **once a day at 03:30 UTC (09:00 IST)**, which is all the free Hobby plan accepts (a more frequent expression fails the deployment; Hobby may also fire anywhere within the scheduled hour). Vercel sends the `CRON_SECRET` variable as `Authorization: Bearer <CRON_SECRET>`, so set it (at least 32 characters) in the Production environment. The route declares `maxDuration = 60`. A host or plan that allows more frequent calls can change the one schedule line, and the runbook's 5-to-15-minute advice then applies again. Consequences of daily: queued notification emails go out once a day, and Studio → Health says "the schedule has probably stopped" only after **26 hours** without a run (24 h, the Hobby hour of timing latitude, and a margin; `modules/jobs/stewardshipSchedule.ts`), so a healthy day is never flagged and a missed day is. **Redirects:** per Vercel's docs the cron is a GET to the project's **production deployment URL** (`https://<project>.vercel.app/api/cron/stewardship`), not the custom domain, and it does **not follow redirects** (a 3xx ends the call silently). Nothing in the repository redirects that path (pinned by `tests/unit/vercelCron.test.ts`); the apex-to-`www` redirect is a dashboard setting for the custom domain. **Never add a redirect or rewrite rule, a trailing-slash setting or a middleware that can match `/api/cron/*`** (for example a redirect of the `*.vercel.app` hostname to `www`) without excluding that path. | Authorisation (503 unset, 401 wrong), job, lease and idempotency: verified over HTTP on a production build and in tests; the schedule, the absence of redirects and the 26-hour Health threshold are pinned by tests. **No Vercel project exists yet, so no scheduled call has ever run.** | Owner: create the Vercel project, set `CRON_SECRET`, then after the first 03:30 UTC run open Project Settings → Cron Jobs → View Logs and confirm the call returned **200** (not a 3xx, 401 or 404) and that Studio → Health shows the run. If it returned 401, check Deployment Protection (Standard Protection restricts the production deployment URL; whether Vercel's cron request is exempt is not stated in the docs I read) |
| **Operator alerts** | `ALERT_WEBHOOK_URL`: an https incoming-webhook URL (Slack, Teams, Discord or a paging service). See section 12. | Message, limits, failure handling and secrecy: tested; against a real destination: **not done**. | **Owner: choose the destination and create the webhook**; then `ops:test-alert -- --send` |
| **Uptime monitor and log alerts** | Probe both `/api/health` and `/api/ready`; alert on the two JSON log events in section 12. | Not applicable offline. | Owner: host or monitoring provider |

**Environment variables** (names only; never write a value into a ticket or this file):

| Variable | Needed | Notes |
|---|---|---|
| `DATABASE_URL` | required | pooled, `postgresql://`, not test-named |
| `DIRECT_URL` | required | direct host of the same database |
| `PUBLIC_SITE_URL`, `AUTH_URL` | required | https, not localhost |
| `AUTH_SECRET` | required | at least 32 random characters, not the placeholder |
| `EMAIL_PROVIDER` (`smtp`), `SMTP_URL`, `EMAIL_FROM` | required for a launch | all three together |
| `CRON_SECRET` | required for a launch | at least 32 random characters; unset disables the endpoint |
| `ALERT_WEBHOOK_URL` | recommended | https, no credentials in the URL, not local; it is itself a secret |
| `FOUNDER_EMAIL`, `FOUNDER_NAME` | once | only for `scripts/seedFounder.ts`, run by an operator against the real database to create the first account (it prints a temporary password once) |
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | optional | together or neither |
| `YOUTUBE_API_KEY`, `YOUTUBE_CHANNEL_ID` | for the YouTube sync | the sync is never started by a deployment |
| `AI_PROVIDER` (`anthropic`), `ANTHROPIC_API_KEY`, `AI_MODEL` | optional | `fake` is refused in production |
| `GA4_MEASUREMENT_ID`, `GA4_API_SECRET` | optional | |
| `TEST_DATABASE_URL`, `TEST_DIRECT_URL` | **never** | refused at start-up and by `ops:check-config` |

## 1. Before anything: configuration and release checks

1. **Environment, names only.** Put the production variables in a file kept *outside* the repository (or export them in the shell) and run:

   ```bash
   npm run ops:check-config -- --env-file /secure/path/production.env
   ```

   Pass = `RESULT: no problems`. It applies the start-up rules plus: the direct connection string is present, neither database is test-named, pooled and direct name the same database,
   origins agree, the SMTP URL is valid, the alert webhook is usable. Warnings (no scheduler secret, no email provider, no alert destination, identical pooled/direct strings) must each be read
   and either fixed or accepted by the owner. It prints variable *names and reasons only*; the output can be pasted into a ticket.
2. **Migration manifest is current** (the readiness probe compares the database with it):

   ```bash
   npx tsx scripts/writeMigrationManifest.ts --check
   ```

3. **Checks on the release commit**: `npx next typegen` first on a pristine checkout (the generated route types are not committed, and `tsc` fails with `Cannot find name 'LayoutProps'` without them; a build also generates them), then `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:integration` (against the isolated test database), and the production build on the host. Install with `npm ci --strict-allow-scripts` where the host's npm supports it, so any install script missing from the `allowScripts` policy in `package.json` fails loudly instead of being a notice.
4. **Runtime and dependencies**: Node 24 (`.nvmrc`, `engines`). Run `npm audit --omit=dev` on the **release commit** and review every finding (the gate in §1 of `docs/deployment-readiness-gate.md`). On 2026-10-24 it reported 0 after the Next.js 16.4.3 / Prisma 7.10.1 / nodemailer 10.2.1 remediation (register R-24); a clean result only covers advisories already published for those exact versions, so re-run it, and check the host's install log: npm 11 warns that six packages' install scripts are not covered by `allowScripts` (`argon2` must load and hash on the host).

## 2. Restore point and its fingerprint (before any change to the database)

1. Create the restore point in the provider (Neon: a branch from the current head, named with the date and release). Retention on the current plan is a decision (O-01).
2. **Fingerprint the source and save it** (counts and migration names only; no row data). This works on a database that has not yet received the release's newest migrations: an integrity check
   that reads something a pending migration creates is reported as *not applicable* (it was a failure before 2026-10-25, which would have made this step fail on the very database the release is
   about to change):

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

`status` lists what is pending and classifies each migration: **ADDITIVE** (the previous code keeps working on the new schema) or **BLOCKING** (it cannot be undone by redeploying the previous
code; the rollback is the restore point and the owner must accept that). `to review` counts statements that can reject writes or fail on existing data (unique indexes and checks on existing
tables, data rewrites): those are what the rehearsal on real data is for.

```bash
MIGRATE_DATABASE_URL=<CLONE url> npm run migrate -- apply --confirm-host <host:port/database as printed above> --restore-point "<label of the clone's source>"
```

Pass = `After: ... pending 0, failed 0`. Then verify the data survived and the schema is exactly the code's schema:

```bash
VERIFY_DATABASE_URL=<CLONE url> npm run ops:verify-database -- --compare restore-point-<release>.json --after-migration
DIRECT_URL=<CLONE url> npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code      # 0 = identical
```

`--after-migration` accepts more migrations (and the tables they add) than the pre-change fingerprint, never fewer, and requires every row count the old fingerprint held to be unchanged and the
integrity checks clean. Then deploy the release candidate against the clone and run section 6 against it.

## 4. Apply to production (the one irreversible step)

```bash
MIGRATE_DATABASE_URL=<direct url of PRODUCTION> npm run migrate -- status                       # read-only: confirm what will run
MIGRATE_DATABASE_URL=<direct url of PRODUCTION> npm run migrate -- apply \
    --confirm-host <host:port/database exactly as status printed it> \
    --restore-point "<label of the verified restore point from section 2>"
```

`apply` **refuses** (exit 4, nothing changed) unless: the typed host matches the target in use; a restore point is named; no earlier migration is failed or half-applied; the database is not
*ahead* of this code (wrong code, or a newer release already ran); and no pending migration is BLOCKING unless `--acknowledge-blocking` is added by someone who has the owner's acceptance.
It runs `prisma migrate deploy` with an empty dotenv, so the CLI cannot read the repository's `.env`. Run it **before** traffic moves, by a person, never from a deployment hook. A repeat with
nothing pending is a no-op.

Afterwards: `GET /api/ready` on the new deployment must answer `200 {"status":"ready"}` before it receives traffic, and the same `--compare ... --after-migration` check as in section 3 should pass.

## 5. First production data

On an empty production database, after `migrate apply`: create the first account with `scripts/seedFounder.ts` (needs `FOUNDER_EMAIL` and `FOUNDER_NAME`; it prints a temporary password once, which must be changed at first sign-in). Nothing else is seeded. **Do not start a YouTube sync** until the owner decides to.

## 6. Validate a staged or pre-promotion deployment

```bash
npm run ops:smoke -- --base-url https://<staging or pre-promotion url> --expected-origin https://<public origin>
```

Pass = `RESULT: all N checks passed`. It checks, with GET requests and no credentials: `/api/health` ok; `/api/ready` ready (database answers and every migration this release needs is applied);
`/` names only the configured origin (no localhost in canonical or og:url); `/sitemap.xml` lists only that origin; `/robots.txt` names this sitemap and keeps `/studio` and `/api` out;
`/studio/signin` is 200; an unknown URL is 404; security headers (nosniff, framing denied, permissions policy, HSTS on https); and pages are not cacheable by a shared cache
(`Cache-Control` private/no-store, no `s-maxage`). Keep the output as the gate's evidence. The full checklist, including the manual items, is section 9.

## 7. Promote, then smoke-test the live domain at once

Keep the previous production deployment available until the new one has passed section 6 against its own URL. After cut-over, immediately:

```bash
npm run ops:smoke -- --base-url https://<production domain>
```

plus a real production Studio sign-in. Anything failing means roll back (section 8) first, investigate second.

## 8. Rollback, and what it actually means

**Migrations are forward-only. There is no down-migration, and nothing in this repository can undo one.** There are exactly two ways back, and they are different things:

1. **Return traffic to the previous release (the database keeps the newer schema).** Only valid when the previous release can run on the new schema *and* does not stop protecting data.
   `rollback-check` answers both, from facts:

   ```bash
   MIGRATE_DATABASE_URL=<direct url of PRODUCTION> npm run migrate -- rollback-check --previous-ref <previous release tag>
   ```

   - `RESULT: ... safe for the schema and for the data it would stop protecting`: **return traffic to the previous deployment** (no rebuild), confirm `/api/health`, `/api/ready` and `/sitemap.xml`
     on it, run `ops:smoke` against it, record what happened. This is a compatibility check, **not** a rollback of the database.
   - `RESULT: NOT safe` because a migration is not additive or the database is missing something the previous release needs: returning traffic is **not** enough (below).
   - `RESULT: NOT safe` because of **data**: since 2026-10-25 the check also counts what the previous release would stop protecting. A release that predates Recording holds does not know them, and
     would **show every held Recording on the public Museum again**; the same for video holds. Held rows block the rollback. (Revision-scoped relationships are a warning: the older release reads the frozen
     legacy rows, so those links would be missing or stale until the current release returns.) Lift or resolve the holds first, or restore (below).
2. **Restore from the restore point.** It **loses every change made after it was taken** (edits, publications, holds, audit entries) and returns the database to the *old* schema, on which
   the *current* release answers `/api/ready` with 503 `MIGRATIONS_PENDING` (correct: the previous release must serve, or the migrations must be applied again). The owner must accept the loss
   explicitly (O-01, O-06). Restore, then verify strictly against the fingerprint taken at restore-point time:

   ```bash
   VERIFY_DATABASE_URL=<url of the RESTORED database> npm run ops:verify-database -- --compare restore-point-<release>.json
   ```

   Pass = `RESULT: verified`. Only then return traffic to the previous deployment. Rehearsed in section 10.

Triggers for rolling back: a failed section 6 or 7 check; a 5xx rate above the agreed threshold; sign-in or email failing; any data-integrity concern (an `ops:verify-database` integrity
violation, or `/api/ready` stuck on 503).

## 9. Real-host release checklist (run in order; record who, when, and the output)

Nothing below has been run on a real host. Each line states the command or the manual action and what counts as a pass. Use a **test** Recording and **test** users.

1. **Build and order.** Release commit chosen, section 1 passed. Restore point created, fingerprinted and compared (section 2). Migrations rehearsed on a clone and applied to production by a person (sections 3 and 4). Only then deploy the build, **without** traffic.
2. **Probes on the new deployment's own URL.** `npm run ops:smoke -- --base-url <deployment url> --expected-origin <public origin>`: all checks pass (health, ready, origin, sitemap, robots, sign-in, 404, headers, cache headers).
3. **Authentication and permissions (manual).** Sign in as each of: Contributor, Editor, Administrator (cookie is `__Secure-`, HttpOnly, SameSite=Lax; sign-out redirects and a protected URL then redirects to sign-in). A Contributor sees no Archive/Unpublish/hold controls and a Venue/Programme step that says it is view-only. Only the Administrator can see a hold's note (put a note on the test hold in item 5 and read the Review page as each role).
4. **Public search and sitemap.** `/archive?q=<test title>` finds only published Recordings; `/sitemap.xml` lists only published, un-held content.
5. **Lifecycle transitions with the visibility probe.** For the test Recording, make each change in Studio, then run the probe and record the time it reports:

   ```bash
   npm run ops:probe-visibility -- --base-url https://<deployment or domain> --slug <slug> --title "<title>" --expect present|absent --within 60
   ```

   publish (present), unpublish (absent), publish again (present), archive (absent), restore then publish (present), **hold** (absent), **lift** (present). Pass = every probe ends `all three surfaces ... (agreed after N s)` with N within the owner's tolerance, and no `concern:` line about a shared cache. Any `Age:` header, `HIT`, or `s-maxage` is a failure of the "nothing is cached" assumption (register R-22): stop and treat it as a cache-invalidation project, do not launch.
6. **Recording and Video restriction independence.** Hold the test Recording: its video's own page stays public and the video page no longer links the Recording. Hold the video instead: the Recording stays public and its page no longer shows the video. An unlisted video without approval is not public.
7. **Email.** An invitation and a password-reset email reach a real inbox with the right origin in the link; Studio → Notifications shows delivery state. Check the message is not in spam (SPF/DKIM/DMARC).
8. **Scheduler.** Call once by hand: `curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/stewardship` returns 200 `ran: true` with every step `SUCCEEDED`; Studio → Health shows that run; the host's scheduler's first scheduled call appears there too (on the Hobby schedule that is the next 03:30 UTC; in the Vercel dashboard, Project Settings → Cron Jobs lists the entry, and **View Logs** shows the invocation; Vercel does not retry a failed call and does not follow redirects).
9. **Error reporting and alert delivery.** `npm run ops:test-alert -- --env-file <file>` (dry run: shows the destination host and the message), then `npm run ops:test-alert -- --send --env-file <file>`: a person on the on-call list reads the message. Then deliberately trigger one server error on staging only and confirm the log line `"event":"unhandled_server_error"`, the Studio → Health incident, **and** the alert message. Remove one required variable once on staging only and confirm `/api/health` goes 500 and the uptime monitor alerts.
10. **Backup restoration and recovery decision.** Restore the restore point into a *new* Neon branch and run `ops:verify-database --compare` against it (section 2, step 3). Record the decision rule for section 8 (who may approve a restore, what loss is acceptable).
11. **Promote and smoke the live domain** (section 7). Confirm **no YouTube sync was triggered**.

## 10. Release gate status

Classification: **Verified locally** = exercised in this repository against disposable local databases and local production builds; **Verified on the real host** = nothing yet; **Needs provisioning or credentials** = an external account, resource or secret must exist; **Needs the owner's decision or authorisation**.

| # | Item | Status | Smallest action that moves it |
|---|---|---|---|
| 1 | Application code, security, dependencies (`npm audit` 0), editorial workflow, public visibility, holds | Verified locally (R-21 to R-27) | none; re-run `npm audit` on the release commit |
| 2 | Configuration preflight (`ops:check-config`), start-up refusal, no secret in output | Verified locally | run it on the real values |
| 3 | Migration tooling: status, classification, refusals (no host typed, wrong host, no restore point, blocking, failed, ahead), apply, idempotent re-apply | Verified locally (section 11): full 29-migration chain on an empty database and the last three on a database with data | rehearse on a Neon clone of the real data (the data-rewriting migrations 6G-8, 6G-9, 6G-14, 6K, which only real data can test) |
| 4 | Schema identical to the code after migrating | Verified locally (`prisma migrate diff`: no difference) | repeat on the clone |
| 5 | Fingerprint before and after (`--compare`, `--after-migration`) | Verified locally; a defect found and fixed (R-28) | run on the real restore point |
| 6 | Rollback: what it means; `rollback-check` incl. data risks | Verified locally; a gap found and fixed (R-28) | none until a previous release exists to name |
| 7 | Backup and restore drill | Verified locally with a database-copy restore point (section 11); **not** with `pg_dump` (not available here) and **not** with a Neon branch | owner: create a Neon branch, run section 2 steps 2 and 3 |
| 8 | Readiness probe and smoke script | Verified locally on production builds | run on the host |
| 9 | Operator alert (message, limits, failure back-off, secrecy, config validation, wiring on errors, recurring incidents, readiness, maintenance) | Verified locally with a fake destination and against an unresolvable host; **no real message sent** | owner: create the webhook (needs provisioning), then `ops:test-alert -- --send` |
| 10 | Scheduler endpoint: authorisation, lease, idempotency, safe failure, `maxDuration` | Verified locally over HTTP and in tests | owner: choose the scheduler; configure; item 9.8 |
| 11 | Email: delivery, claims, retries, statuses | Verified locally with a fake transport; **real delivery not tested** | owner: provider account and DNS (needs provisioning); item 9.7 |
| 12 | Public cache behaviour: nothing cached by the app; CDN/host/browser behaviour | App verified locally (R-22); **host unverified**; a repeatable probe exists | item 9.5 on the real host |
| 13 | Hosting project, domain, DNS, TLS, secrets store, Neon production, retention (O-01), uptime monitor, log alerts | **Not provisioned** | **owner decision (O-03, O-01) and provisioning** |
| 14 | Production migrations applied (O-02), first Founder account, first deployment, go-live | **Not authorised and not done** | **owner's explicit authorisation, after items 3, 7, 13** |

**The application is not live and is not launch-ready**: items 7 (provider restore), 9 (real alert), 10 to 14 need an account, a decision or an authorisation that only the owner can give.

## 11. What has and has not been exercised

**Exercised on 2026-10-25, against disposable local PostgreSQL databases (`mm_rehearsal_*` on the loopback test server, all dropped afterwards; the test database and every real one untouched):**

- *Whole chain on an empty database:* `status` (29 pending, blocking ones identified), `apply` refused with no flags, with a wrong host, with no restore point, and with blocking migrations not acknowledged (nothing created each time); then `apply --acknowledge-blocking` applied all 29 in 17 seconds; `prisma migrate diff` against `schema.prisma`: no difference.
- *Database with data, last three migrations pending* (a copy of the migrated database seeded through the application's repositories with published, pending-draft, draft and archived Recordings, a collection, an occasion; the state before the last three migrations rebuilt by reversing their SQL, a rehearsal construct): pre-change fingerprint verified; a copy taken as the restore point and verified against it; applied to a clone, then compared with `--after-migration` (verified, with the three migrations and the new table counted as expected differences) and the strict comparison correctly differing; readiness 503 `MIGRATIONS_PENDING` before and 200 after; the current application read the published page, imposed and lifted a hold (page hidden then visible) and recorded an incident on the migrated clone; applied to the stand-in itself with the real guards; `apply` refused with a half-applied migration present and with a database ahead of the code; a repeat apply was a no-op.
- *Rollback:* `rollback-check` against the commit before the last three migrations (safe), against an older commit (safe, with a warning that 5 revision-scoped links would not be read), with a hold present (NOT safe, for data), and against a release that already knows holds (safe).
- *Restore:* damage (a cleared published pointer and deleted revision rows) was detected by the fingerprint (one count and one integrity difference); the database was replaced by a copy of the restore point and verified strictly against the pre-change fingerprint (`verified`), with the lifecycle rows and pointers intact; the current release correctly reported not-ready on the restored old schema; re-applying brought it back (`verified` after migration).
- *Production builds* (`next build --webpack` of an isolated copy; `next start`, Node 24): `/api/health` 200; `/api/ready` 503 against a database with a failed migration or pending ones (and the readiness log line, plus one failed alert attempt to an unresolvable host: no secret and no host in any log line) and 200 after migration; `ops:smoke` 9 of 9; the scheduler endpoint 401 without or with wrong credentials, 200 `SUCCEEDED` with the secret, twice in a row; `ops:probe-visibility` through a hold and a lift (present, absent, present; a wrong expectation fails with exit 1).
- *Tests:* unit and integration suites for all of the above (register R-28).

**Not exercised, because it needs something only a human, an account or the chosen host can supply:** anything on a real host or CDN (including whether its edge honours `Cache-Control`); a real Neon branch or `pg_dump` restore (neither exists here); the data-rewriting migrations on real data; real email delivery; a real scheduler; a real alert destination and a person receiving it; the uptime monitor; Linux builds and installs; the first production deployment.

## 12. Monitoring and alerting: what exists, and what the host must be given

**Exists in the application (verified in tests, and on production builds where stated):**

| Signal | Where | Meaning |
|---|---|---|
| `GET /api/health` | liveness | the process is up and the production configuration was accepted. It does **not** prove the database works. |
| `GET /api/ready` | readiness | `200 {"status":"ready"}` only when the database answers **and** every migration this release needs is applied; otherwise `503 {"status":"not-ready"}`. The reason is a code written to the server log, never returned. |
| log line `{"event":"readiness","ready":false,"code":...}` | stderr | one JSON line whenever readiness fails: `DATABASE_UNREACHABLE`, `MIGRATIONS_UNREADABLE`, `MIGRATION_FAILED`, `MIGRATIONS_PENDING` (with migration names). |
| log line `{"event":"unhandled_server_error",...}` | stderr | one JSON line for every unhandled server error: error class, route **pattern**, kind of context and the framework's digest. Never the message, stack, URL or request data. |
| operational incident `UNHANDLED_SERVER_ERROR` | Studio → Health | the same failure, deduplicated and counted per route and error class (a storm is capped at 30 writes a minute per instance); an administrator is notified in Studio when one recurs. |
| **operator alert** to `ALERT_WEBHOOK_URL` | an https incoming webhook | one small JSON message (`text` and `content` for Slack/Teams/Discord, plus `kind`, `code`, `route`, `site`, `occurredAt`), sent when: an unhandled server error appears for the **first** time on a route (or the incident cannot be recorded, which is when the database itself is the problem); an operational incident **recurs**; readiness fails (`NOT_READY`, the code only); a scheduled-maintenance run does not fully succeed. Per instance a repeat of the same alert waits 10 minutes, and after a **failed** send it retries after one minute (so a dead destination slows a polled probe about once a minute, never on every poll). The message contains only bounded codes: never an error message, URL, person, title or value; the webhook URL is a secret and appears in no log, response or message (a failed send logs `{"event":"operator_alert_failed","kind":...,"httpClass"|"errorName":...}`). Nothing is sent when the variable is unset or invalid. |
| other incidents, maintenance run history, stewardship job | Studio → Health | `docs/runbooks/scheduled-maintenance.md`. |

**What it cannot do:** it cannot tell anyone the process is dead, the host is down, DNS is wrong, or the database is unreachable from a process that never starts: only an external uptime monitor sees that. It is also not a paging system (no acknowledgement, escalation or on-call rota): the destination is.

**What the host and the owner must provide:**

1. An **uptime monitor** probing **both** `/api/health` and `/api/ready`, alerting a person on any non-200.
2. A **log-drain alert rule** on the two JSON events above (`"event":"unhandled_server_error"` rate; `"event":"readiness"` with `"ready":false`), routed to a person who is awake.
3. The **scheduler** calling `/api/cron/stewardship` with `CRON_SECRET`, so notification emails are sent (`docs/runbooks/scheduled-maintenance.md`).
4. An **alert destination** (`ALERT_WEBHOOK_URL`) that a named person actually reads, tested end to end: `npm run ops:test-alert -- --env-file <file>` (dry run: prints the destination host and the message, sends nothing), then `-- --send` (sends one clearly labelled test message; **needs the owner's go-ahead because it sends a real message**), then a person confirms receipt. Until item 4 and the real-host trigger in section 9 item 9 are done, monitoring is *recorded* but not *proven to alert* (register R-15).
