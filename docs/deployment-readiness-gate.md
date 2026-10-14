# Deployment readiness gate (hosting-independent)

**Status: DEFINED, NOT OPERATIONAL.** This is the procedure a production deployment must pass. No hosting provider has been selected, so none of it has been implemented or tested on a real host. Each step below is a requirement; how it is performed (preview environments, traffic routing, instant rollback, monitors) is provider-specific and **remains pending the choice of provider**. Do not describe this gate as in force until it has been implemented and exercised on the chosen host and a rehearsal has been recorded.

Why it exists (verified in Phase 6J-9A with `next start`):

- With an invalid production configuration the application logs the problem (variable names only) and answers **every** request with HTTP 500, including prerendered pages and `/api/health` — but the **process stays running**. A process supervisor alone cannot tell the deployment is broken; the platform must check responses before sending traffic.
- `/api/health` is **liveness-only**. With a valid configuration and an unreachable database it still returns 200, while database-backed routes (`/`, `/sitemap.xml`) return 500. A green `/api/health` therefore does **not** prove the database works.
- The start-up guard (`instrumentation.ts`, `modules/config/productionConfig.ts`) checks only that required variables are present and well-formed. It cannot know that credentials are valid, the database is reachable, the domain is right, or email is deliverable.

## 1. Preconditions (before any deployment)

- [ ] Release commit chosen; CI (once it exists) green on that exact commit: install, typecheck, lint, unit tests, integration tests against an isolated test database, production build. Until CI exists, the same checks are run and recorded manually.
- [ ] `npm audit --omit=dev` reviewed; any remaining advisory is listed in `docs/content-intelligence-architecture.md` section 124 with its decision.
- [ ] A **restore point** of the production database exists and is recorded (for Neon: a branch from the current head, named with the date and release; confirm it opens and holds the expected state). Retention of point-in-time restore on the current plan is confirmed.
- [ ] Production environment variable **names** are complete (values are never written in this record): `DATABASE_URL`, `DIRECT_URL`, `PUBLIC_SITE_URL` (https), `AUTH_URL` (https), `AUTH_SECRET`, email (`EMAIL_PROVIDER=smtp`, `SMTP_URL`, `EMAIL_FROM`); optional: AI, Google, GA4. `TEST_DATABASE_URL`, `TEST_DIRECT_URL` and `AI_PROVIDER=fake` are **not** set.
- [ ] Runtime is Node 24 (`engines.node` is `24.x`, `.nvmrc` is `24`).
- [ ] Install-script check on the host: install log shows no script failure; `argon2` loads and hashes; the build's `prisma generate` succeeds; `prisma --version` runs.
- [ ] If the release contains database migrations: rehearsed on a **non-production** branch cloned from the restore point; migrations are forward-only, so the plan for a bad migration is **restore from the restore point**, not a down-migration; the migration is applied with the direct (non-pooled) URL, by a person, before traffic is cut over.

## 2. Stage the release on a production-equivalent environment

Deploy the release candidate to a **staging or preview** environment that is **production-equivalent in configuration**: same Node version, same build command, an https origin with the same kind of values for every required variable, the production start-up guard active (`NODE_ENV=production`), and a **non-production database branch** cloned from the restore point (never the production database for rehearsal).

## 3. Validate the staged deployment (all must pass)

- [ ] `GET /api/health` returns 200 with `{"status":"ok"}`. (Proves the start-up guard accepted the configuration and the process serves requests — nothing more.)
- [ ] A **database-backed route** returns 200: `GET /sitemap.xml` (and `GET /`). This is the readiness check for the database connection and schema.
- [ ] `GET /robots.txt` is 200 and names the staging/production sitemap origin; `/sitemap.xml` contains only that origin (no localhost).
- [ ] `GET /studio/signin` is 200; `GET` of an unknown URL returns 404 (not 200).
- [ ] Response headers present: HSTS, `X-Content-Type-Options`, frame protections, `Permissions-Policy`.
- [ ] Studio sign-in works with a staging user (exercises `argon2`), the session cookie is `__Secure-`, HttpOnly, SameSite=Lax, and sign-out works.
- [ ] An invite and a password-reset email are delivered to an external mailbox (inbox, not spam) and their links use the correct origin.
- [ ] Negative check (once, on staging only): with one required variable deliberately removed, `/api/health` returns 500, proving the guard and the check can detect a bad configuration.
- [ ] Publish and unpublish one test Recording on staging: it appears on `/recordings/<slug>`, in search and in the sitemap, then disappears everywhere. An unlisted YouTube video is not public without explicit approval.
- [ ] Error reporting receives a deliberately triggered test error, and the uptime monitor sees `/api/health` (once monitoring exists).
- [ ] **No YouTube sync is scheduled or triggered by the deployment.**

Record the evidence (command or request, status, timestamp, who) for each item. **An explicit written smoke-test pass is required before production promotion.** Any failure stops the release.

## 4. Promote to production without losing the previous version

- The **previous production deployment must remain available and serving** until the new deployment has passed the same checks (section 3, minus the staging-only items) **against the new production deployment before it receives public traffic** — for example on a non-public URL or a held/pre-promotion state offered by the host — and then through the cut-over itself.
- If the platform cuts over immediately and offers no pre-promotion check, the staged pass in section 3 is the gate, and a post-cut-over smoke test (below) is run at once with the rollback ready.
- Traffic moves only after the checks pass. The platform's own health/readiness probe must probe **both** `/api/health` (configuration/liveness) **and** a database-backed route; liveness alone is insufficient.

### Post-cut-over smoke test (within minutes)

- [ ] `/api/health`, `/sitemap.xml`, `/`, `/robots.txt`, `/studio/signin` return 200 on the production domain; an unknown URL returns 404.
- [ ] Production Studio sign-in (a real account) works; response headers and cookie flags are correct on the live domain.
- [ ] Page source of `/` shows the production origin in canonical and `og:url`; nothing refers to localhost.
- [ ] No Studio URL is indexable; the sitemap lists only intended public content.

## 5. Rollback requirement

- Rollback must be possible **at any time before and after cut-over** by returning traffic to the previous deployment, without a rebuild. This capability must exist and be tested on the chosen host before launch; if it does not, launch is blocked.
- **Triggers** (any one): a failed check in sections 3 or 4; a 5xx rate above the agreed threshold; sign-in or email failing; a data-integrity concern.
- **Procedure:** (1) return traffic to the previous deployment; (2) confirm `/api/health` and `/sitemap.xml` on it; (3) if a migration was applied, decide with the owner whether the schema is backward-compatible with the previous version (design migrations as expand-then-contract so it is); if it is not, restore from the restore point instead; (4) record what happened and open a follow-up.
- The restore point is kept until the release has been stable for the agreed period.
- Data restored from a restore point loses changes made after it was taken; that cost must be accepted explicitly by the owner.

## 6. What is still pending

- Selection of the hosting provider, and the provider-specific implementation of sections 2 and 4 (preview/staging environments, pre-promotion checks, traffic routing, instant rollback, readiness probes).
- CI automation, error reporting, uptime monitoring and alerting.
- Optionally a dedicated readiness route that checks the database, so a probe needs only one URL (a code change, not part of this document).
- A rehearsal of the whole gate on the chosen host, recorded as evidence. **Until that rehearsal passes, this gate is not operational.**
</content>
