# Phase 4 — Music Madras Studio Foundation

This document explains what Phase 4 built: authentication, RBAC, and the Studio content-management application itself. It is a companion to [`docs/architecture/ADR-0001-production-platform.md`](architecture/ADR-0001-production-platform.md) and the earlier phase documents — read those for the domain model and analytics foundation this phase builds on top of.

## 1. Authentication — Auth.js version decision

**Auth.js version used: `next-auth@5.0.0-beta.32`, pinned to the exact version (not `@beta`).**

- **Why the exact beta is pinned**: `next-auth`'s `latest` npm dist-tag resolves to `4.24.15` — the pre-App-Router API (`getServerSession`, page-router-shaped config). The approved Music Madras architecture (ADR §3, §7) is built on the Next.js App Router throughout (Server Components, Server Actions, route groups). Auth.js v5 is the version that actually supports that model (`auth()`, middleware-free session reads in Server Components, the `NextAuthConfig` shape used in `modules/auth/authConfig.ts`). Pinning the exact `5.0.0-beta.32` build (rather than a floating `@beta` tag) means every install gets the identical version this code was written and validated against — a floating pre-release tag could silently change API shape between installs.
- **Why v4 was deliberately not selected**: v4 is stable, but adopting it would have meant building Studio's authentication on a fundamentally different architecture (Pages Router session patterns) than the rest of the approved design — not a smaller or safer choice, just a different one that contradicts the ADR. The instruction to build on Auth.js v5 was explicit and is followed here.
- **Auth.js v5 must be reassessed before production launch** — beta software should not be the final dependency version an production deployment ships with. Before launch, re-check whether v5 has reached a stable release (or whether a newer beta fixes issues this one has); the isolation described below is exactly what makes that reassessment cheap.
- **Isolation**: every Auth.js-specific detail is confined to `modules/auth/`:
  - `modules/auth/authConfig.ts` — the actual `NextAuthConfig` (providers, adapter wiring, the `next-auth` module type-augmentation).
  - `modules/auth/studioAuthAdapter.ts` — the custom `Adapter` implementation (see below).
  - `auth.ts` (repository root) and `app/api/auth/[...nextauth]/route.ts` — the two files Auth.js itself requires to exist at fixed locations.
  - `modules/auth/authService.ts` — **the only file the rest of the application is allowed to import auth from.** `getCurrentStudioSession()`, `signInWithCredentials()`, `signOutCurrentUser()` return/accept Music-Madras-shaped types (`modules/auth/types.ts`), never `next-auth`'s own `Session`/`User` types. Every Studio page and Server Action in this phase imports from `authService`/`policy`/`types` — grep for `from "next-auth"` outside `modules/auth/` and `auth.ts` to confirm this holds.

  Swapping or upgrading the provider later means changing `authConfig.ts` and `studioAuthAdapter.ts` (and possibly `authService.ts`'s implementation, not its signatures) — not Studio, MMKE, the repositories, or the editorial workflow.

### Why a custom Adapter instead of `@auth/prisma-adapter`

`@auth/prisma-adapter` hardcodes calls against Prisma Client models literally named `user`/`session`/`account`/`verificationToken`. Its documented `@map()` support only renames the underlying SQL table/columns, not the Prisma Client model property the adapter calls. Adopting it as-is would have required either renaming the established `StudioUser` model to `User` (a disruptive rename touching three already-completed phases) or maintaining a second, duplicate user-identity table — this project has consistently avoided duplicate representations of the same entity elsewhere (e.g. the Venue/Organisation decision in `docs/phase-2-mmke-domain.md`).

Instead, `modules/auth/studioAuthAdapter.ts` implements Auth.js's `Adapter` interface — an officially-supported extension point, not a workaround — against two new tables, `StudioSession` and `StudioAccount` (`prisma/schema.prisma`), both pointing at the existing, unmodified `StudioUser`. `createUser()` always throws: Studio is invite-only, so there is no path through Auth.js that can create an account (there is also no `/studio/register` route anywhere in `app/(studio)`).

Session strategy is `"database"` (not JWT), so disabling a user or changing their password immediately invalidates every session for them (`deleteAllSessionsForUser` in `studioAuthRepository.ts`) rather than waiting for a signed token to expire.

### Phase 5C update — Credentials sign-in does not use Auth.js's Credentials provider

Auth.js's Credentials provider is not used for the Studio password sign-in path, because the pinned Auth.js version (`next-auth@5.0.0-beta.32`) does not support Credentials authentication together with a database session strategy — its Credentials sign-in handler always issues a JWT for the session cookie regardless of the configured strategy, so with `session.strategy: "database"` Auth.js refuses to start at all ("`UnsupportedStrategy: Signing in with credentials only supported if JWT strategy is enabled`"). This is a deliberate, long-standing Auth.js design decision (not a bug or something a version change would fix), confirmed by reading the installed `@auth/core` source directly.

Music Madras therefore performs credential verification in its own application service (`modules/auth/credentialsSignIn.ts`) — the same `findStudioUserByEmail` + `verifyPassword` + `StudioUser` status checks the provider's `authorize()` used to run — creates the existing database-backed `StudioSession` row directly (via `studioAuthRepository.createStudioSession`, the same function the adapter's own `createSession` calls), and sets the session cookie itself using the exact name and attributes defined once in `modules/auth/sessionCookie.ts`. Auth.js's own database-session infrastructure continues to handle everything else unchanged: reading the session (`auth()`, the `session` callback in `authConfig.ts`), signing out (`signOut()` deletes whatever row the cookie points to, regardless of how it was created), and the optional Google OAuth path (which still goes through Auth.js's own adapter-backed sign-in flow normally). No schema change, no new session table, and no JWT was introduced.

## 2. RBAC

Six roles, seven actions, one explicit lookup table — `modules/auth/policy.ts`:

| Role | Actions |
| --- | --- |
| CONTRIBUTOR | RECORDING_WRITE |
| EDITOR, REVIEWER | + CATALOGUE_WRITE, EDITORIAL_REVIEW |
| ADMINISTRATOR | + RECORDING_PUBLISH, AUDIT_VIEW |
| SUPER_ADMINISTRATOR, FOUNDER | + USER_MANAGE, SETTINGS_MANAGE |

`can(role, action)` is called at the top of every Server Action that mutates data, in addition to hiding the corresponding button/form in the UI when the current user lacks the permission — the UI hint is a courtesy, the server check is the actual gate (verify by reading any `actions.ts` file under `app/(studio)/studio/(protected)/`).

## 3. Studio route map

```
app/(studio)/studio/
  layout.tsx                    shared shell (no auth gate — wraps signin too)
  signin/ accept-invite/ reset-password/ reset-password/confirm/   unauthenticated
  (protected)/layout.tsx        auth + ACTIVE-status gate, full nav
  (protected)/dashboard/
  (protected)/recordings/                     list + create draft
  (protected)/recordings/[id]/layout.tsx      step nav + editorial phase badge
  (protected)/recordings/[id]/{source,programme,works,performance,venue,
                                participants,educational,media,seo,
                                relationships,review}/               the 11-step workflow
  (protected)/recordings/[id]/preview/        read-only Studio preview
  (protected)/catalogue/{composers,works,artists,choirs,conductors,
                          venues,organisations,collections}/
  (protected)/editorial/        recordings grouped by editorial phase
  (protected)/sheet-music/      review queue
  (protected)/users/            invite, disable/reactivate, change role
  (protected)/settings/         profile, change password, API-connection status
  (protected)/audit/            recent audit log entries
```

## 4. The 11-step recording workflow

Every step reads and writes through the Phase 1/2 `Recording`/`RecordingRevision` model and its existing repositories (`modules/db/repositories/recordingRepository.ts`, `performanceRepository.ts`, `programmeRepository.ts`, `mediaResourceRepository.ts`, `collectionRepository.ts`) — there is no second, Studio-only draft object and no `draftPayload` JSON blob. A handful of narrowly-scoped functions were added to those repositories where Phase 2 had only laid the read/create foundation (`attachWorkToRevision`/`detachWorkFromRevision` for the Composer/Works step, `listProgrammes`/`listCollections` for picking an existing one, `submitRecordingForReview`/`archiveRecording` for the editorial actions, `getRecordingRevisionCompletenessReport` to reuse Phase 2's completeness engine against a loaded revision).

- **Source, Educational Content, SEO** — the three free-text content steps — use a shared debounced-autosave client component (`app/(studio)/studio/_components/AutosaveStepForm.tsx`). Each step batches its own fields into one save call per debounce window (rather than one call per field per keystroke) specifically so `updateDraftRevisionContent`'s optimistic-concurrency check (`expectedRevisionUpdatedAt`) never races against a sibling field's independent save. The visible status line reads `Unsaved changes… / Saving… / Saved / Not saved: <reason>`.
- **Programme, Composer/Works, Performance, Venue, Participants, Media, Relationships** are structural steps: pick-or-create forms backed by ordinary Server Actions (progressive-enhancement friendly, no client JS required). Programme and Venue create freestanding, reusable catalogue rows; Performance is where a Programme and a Venue are actually connected to the recording (setting `RecordingRevision.performanceId`); Participants only becomes available once a Performance exists.
- **Media** is explicit that there is no file-upload infrastructure in this environment — the form takes a hosted URL, not a file, and says so.
- **Review & Publish** reuses `checkRecordingRevisionCompleteness`/`computeRecordingReadiness`/`isReadyToPublish` from `modules/mmke/completeness` (Phase 2) unchanged. Publishing re-runs the completeness check server-side inside the Server Action itself (`review/actions.ts`) — the button being visible is not the enforcement point.
- **Preview** is an additional, unlabelled-as-a-step page: a plain reading layout of the same canonical data the public Museum will eventually read (`getCanonicalContextForRevision`), clearly marked "Studio preview — not the live public site" rather than attempting to reproduce a Museum design that does not exist yet (ADR §3, §9 — the Museum is a later phase).

## 5. Editorial workflow phases

The brief's seven-phase editorial workflow (DRAFT → ENRICHMENT → EDITORIAL_REVIEW → APPROVED → PUBLISHED → UPDATED → ARCHIVED) is implemented as **a pure, computed categorization** (`modules/publishing/editorialPhase.ts`), not a new stored column. `RecordingAggregateStatus` (DRAFT / IN_REVIEW / PUBLISHED / ARCHIVED, Phase 1) already carries everything a database needs to enforce transitions safely; every one of the seven phases is fully determined by that status plus whether a published revision exists plus the open draft's own completeness readiness — see the module's header comment and `tests/unit/editorialPhase.test.ts` for the exact mapping. This mirrors the same pattern Phase 2 already used for `computeRecordingReadiness`, and avoids introducing a second status enum that could drift out of sync with the one the database actually enforces.

`submitRecordingForReview` (DRAFT → IN_REVIEW, never-published) and `forkDraftFromPublished` (PUBLISHED recording gains a new draft, also IN_REVIEW) both land on the same stored status for different reasons — `computeEditorialPhase` tells them apart using `hasPublishedRevision`, surfacing them as EDITORIAL_REVIEW/APPROVED versus UPDATED respectively.

## 6. What this phase intentionally did not build

- **File uploads** — Media Assets accepts a URL, not a file, because no blob-storage credentials exist in this environment (guardrail: no external infrastructure).
- **Fuzzy/similarity duplicate detection** — Phase 2's exact-normalized-match check is reused as-is; trigram-based similarity matching remains deferred (`modules/mmke/duplicate-detection/README.md`), unchanged by this phase.
- **Edit/archive for every catalogue entity type** — the catalogue foundation covers list + create for all eight entity types (matching what Phase 2's repositories expose); adding update/archive endpoints for every one of them was judged beyond "foundation" scope and is not required by anything the recording workflow depends on today.
- **LearningGuide management UI** — the table exists (Phase 2); no Studio screen manages it yet, since it was not part of the eight catalogue entity types this phase's brief listed.
- **Real email delivery** — `ConsoleEmailProvider` logs invitation/reset links to the server console; no email provider credentials exist anywhere in this codebase.
- **YouTube sync and GA4** — the dashboard and Settings pages say so explicitly rather than showing invented numbers or a fake "connected" status.

## 7. Validation

Run from the repository root:

```bash
npm run prisma:validate
npm run prisma:generate
npm run typecheck
npm run lint
npm test
npm run build
```

All six passed at the end of this phase. `npm run build` cannot exercise any database-touching Server Component/Action at build time (there is no reachable `DATABASE_URL` in this environment) — Next.js correctly marks every authenticated route `ƒ` (server-rendered on demand) rather than attempting to prerender it, which is why the build succeeds without a database. Nothing in this phase has been exercised against a real Postgres database or in a browser; that remains true until a real `DATABASE_URL`/`DIRECT_URL` is configured.

## 8. Seeding the first account

```bash
npm run seed:founder
```

Requires `FOUNDER_EMAIL` and `FOUNDER_NAME` environment variables (and a reachable database). Prints a one-time temporary password to the console — there is no other way to obtain Studio's first account, by design (invite-only, no `/studio/register`).
