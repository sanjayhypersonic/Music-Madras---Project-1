# Phase 1 — Production Application Foundation

This document explains what Phase 1 of the Music Madras rebuild actually built, how to work with it locally, and exactly where its boundaries are. It is a companion to [`docs/architecture/ADR-0001-production-platform.md`](architecture/ADR-0001-production-platform.md), which this document does not repeat or restate — read the ADR for *why*; this document is about *how to run what exists so far*.

## 1. Install dependencies

```bash
npm install
```

Node.js and npm versions used to build Phase 1: Node **v24.19.0**, npm **11.17.0**. Next.js resolved to the current stable release at implementation time: **16.3.5** (not pinned to any earlier version, per the ADR).

## 2. Configure environment variables

```bash
cp .env.example .env.local
```

`.env.example` documents every variable the full ADR architecture eventually needs. **None of them require real values for Phase 1** — no external database, YouTube credentials, auth secrets, or storage tokens have been created. `.env.local` (or `.env`) is git-ignored; never commit real secrets.

Two variables matter for the commands below even before a real database exists:

- `DATABASE_URL` — pooled connection string, used by the application runtime (via the driver adapter in `modules/db/client.ts`).
- `DIRECT_URL` — direct (non-pooled) connection string, used by the Prisma CLI for schema/migration operations (configured in `prisma.config.ts`).

Both must simply be *present* (any syntactically valid placeholder) for `prisma validate`/`prisma generate` to run — they do not need to point at a real, reachable database for those two commands.

## 3. Generate the Prisma Client

```bash
npm run prisma:generate
```

Regenerate this after any change to `prisma/schema.prisma`.

## 4. Validate the Prisma schema

```bash
npm run prisma:validate
```

## 5. Create the first migration (not yet done — requires a real database)

`npm run prisma:migrate:dev` needs a **reachable** Postgres database (local or a Neon dev branch) to compute and apply a migration — Prisma Migrate diffs against a live database, it cannot generate a migration from the schema file alone. Phase 1 deliberately did not provision one (guardrail: no external databases). `prisma/migrations/` is currently empty; running the first `prisma migrate dev --name init` is the first thing to do once a real `DATABASE_URL`/`DIRECT_URL` exists.

## 6. Run tests

```bash
npm test
```

Runs the Phase 1 unit test suite (Vitest) — pure-function tests for the completeness rule engine and the revision state machine, plus a schema-shape sanity check on the generated Prisma enums. None of these require a database. See `tests/integration/README.md` and `tests/e2e/README.md` for why those two suites are empty for now.

## 7. Type-check and lint

```bash
npm run typecheck
npm run lint
```

## 8. Run the production build

```bash
npm run build
```

## 9. Run the dev server

```bash
npm run dev
```

Visits `http://localhost:3000` and shows a plain "Phase 1 Foundation" placeholder page — **not** the Museum homepage (see §10 below for why).

## 10. What Phase 1 actually contains

### Repository layout change

The pre-existing Google AI Studio prototype (Vite/React app) previously occupied the repository root. Per ADR-0001 §3, the new Next.js app is designed to live at the repository root, so the prototype was moved — via `git mv`, full history preserved, nothing deleted — into [`legacy-prototype/`](../legacy-prototype/LEGACY_NOTICE.md). It still runs standalone (`cd legacy-prototype && npm install && npm run dev`) as a reference; it is not part of this application going forward.

### Database foundation

`prisma/schema.prisma` is the **one canonical persistent source of truth** for the MMKE domain model (ADR §4). It includes:

- The core catalogue: `Composer`, `MusicalWork`, `Programme`, `ProgrammeItem`, `Performance`, `Artist`, `Choir`, `Conductor`, `Organisation`, `Venue` (covers Church via a `type` enum), `Instrument`, `Collection` (+ its join tables), `LearningGuide`, `EducationalContent`, `EditorialContent`.
- The **Recording / RecordingRevision draft-and-publish model** (ADR §5) — `Recording` holds only identity and two pointers (`currentDraftRevisionId`, `currentPublishedRevisionId`); `RecordingRevision` is the one normalized representation of content, at every stage. There is no JSON shadow state anywhere in this schema.
- `MediaResource`, with explicit nullable foreign keys per attachable parent type (real referential integrity, not an unconstrained polymorphic pair).
- `YouTubeVideo`, `YouTubePlaylist`, `YouTubePlaylistItem` — schema only, including the `ObservabilityState` enum column (ADR §15). No sync engine, adapter, or ownership/conflict logic reads or writes these yet.
- `SheetMusicRequest`, `Source`, `Citation`, `RightsInformation`, `EntitySource` (generic provenance join), `AuditLogEntry`.
- A **minimal** `StudioUser` model (id, email, name, role, status, timestamps only) — added solely because the ADR's entity pattern requires a real foreign-key target for every `createdById`/`updatedById` column. It has no password, session, or invitation fields; the full account lifecycle (ADR §7) is not implemented. This was a scope decision made during Phase 1, not something the ADR explicitly listed — see §11 below.

**Deliberately not in this schema yet** (added alongside the phase that implements the corresponding behavior): `FieldOwnership`, `SyncConflict`, `ObservabilityTransition`, `SyncPolicy`, `SyncCheckpoint`, `SyncJobRun` (YouTube sync engine internals, ADR §11-16), and `Session`/`Account`/`Invitation`/`PasswordResetToken` (auth, ADR §7).

### Module boundaries (ADR §3)

- `modules/db/client.ts` is the **only** file that imports `@prisma/client` or `@prisma/adapter-pg`.
- `modules/db/repositories/` contains two example repositories: `composerRepository.ts` (simple CRUD, demonstrating the pattern for the ~14 "simple direct-edit" entities) and `recordingRepository.ts` (the full Draft & Revision mechanics: `createDraftRecording`, `updateDraftRevisionContent` with optimistic-concurrency guarding, `forkDraftFromPublished`, `publishCurrentDraft`, `findPublishedRecordingBySlug`). Neither implements Studio UI, completeness gating as a workflow, or Next.js revalidation — those are later-phase responsibilities that will call into this layer.
- `modules/mmke/completeness/checkRecordingRevisionCompleteness.ts` and `modules/publishing/revisionTransitions.ts` are pure functions with no Prisma import, tested directly (see `tests/unit/`).
- `modules/audit/writeAuditLog.ts` is the one place `AuditLogEntry` rows are written, usable inside a Prisma transaction.
- `modules/youtube/`, `modules/media/`, `modules/sheet-music/`, `modules/seo/`, `modules/auth/`, `modules/jobs/`, `modules/mmke/entities/`, `modules/mmke/relationships/`, `modules/mmke/duplicate-detection/`, `components/museum/`, `components/studio/`, `components/shared/`, `app/(museum)/`, `app/(studio)/` are all present as directories with a `README.md` explaining their scope and which phase implements them — deliberately no functional code, per the Phase 1 guardrails.

### App Router foundation

- `app/layout.tsx` and `app/page.tsx` exist as a minimal, clearly-labeled Phase 1 placeholder — not the Museum homepage. The real homepage will be `app/(museum)/page.tsx` in the Museum phase.
- TypeScript strict mode, ESLint (`eslint-config-next`), and the App Router are configured exactly as `create-next-app` sets them up for the current stable Next.js release.

## 11. Scope decisions made during Phase 1 (flagged, not silent)

Two implementation details required a judgment call the ADR didn't spell out to the letter. Both are documented here rather than silently decided:

1. **Repository root conflict.** The ADR's module tree (§3) assumes the Next.js app owns the repository root, but the prototype already did. Resolved by moving the prototype to `legacy-prototype/` (see §10 above) rather than deleting it or nesting the new app in a subdirectory — this was explicitly anticipated by the Phase 1 brief's "if coexistence requires a temporary structure, preserve the existing prototype safely and document the transition."
2. **Minimal `StudioUser` table.** The ADR's entity pattern ("each gets... createdById/updatedById") implies a real user table to reference, but the ADR's own §7 (full account lifecycle) and the Phase 1 guardrails ("do NOT implement authentication screens") are in obvious tension for Phase 1. Resolved by adding only the minimal identity shape (no password/session/invitation fields, no login code, no NextAuth dependency) needed to give `createdById`/`updatedById` genuine foreign-key integrity, deferring everything else in ADR §7 to the phase that actually builds authentication.

## 12. Prisma tooling note

`npm install prisma` (unpinned) currently resolves to **`prisma@8.0.0-rc.15`** — a release candidate with a completely different, Prisma-Platform-account-based CLI (`project`, `deploy`, `auth login`) in place of the traditional `generate`/`validate`/`migrate` commands the ADR assumes. This repository pins **`prisma@7.10.0`** and **`@prisma/client@7.10.0`** (the last stable release) explicitly in `package.json` for this reason — applying the same "current stable, not canary/RC" rule the ADR states for Next.js. Do not run `npm update prisma` without checking whether `latest` has moved to a stable 8.x release by then.

Prisma 7 also moved datasource connection configuration out of `schema.prisma` into `prisma.config.ts` (a stable, documented change in that release, unrelated to the RC issue above) — see `prisma.config.ts` and `modules/db/client.ts` for how the pooled/direct URL split (ADR §6.3) is implemented under this newer configuration API.
