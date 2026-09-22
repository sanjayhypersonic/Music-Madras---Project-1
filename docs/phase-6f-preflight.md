# Phase 6F Pre-Flight — Database Hygiene & Production Data Source Guardrails

Read-only verification and one small, focused fix, performed before Phase 6F (initial YouTube → MMKE synchronization) begins. No synchronization was implemented here.

## 1. GAIS production-data-path verification

Confirmed clean. Searched the entire repository (excluding `legacy-prototype/` itself) for:

- Any `import`/`require` of a `legacy-prototype/*` path — **zero matches**.
- Any reference to the legacy data module's exports (`VIDEOS_DATA`, `CHANNEL_INFO`, `PLAYLISTS_DATA`, `COMMUNITY_POSTS`) — matches only in `docs/phase-2-gais-functionality-map.md` and the ADR, both citations, not code.
- Any hardcoded YouTube video/playlist ID literal in `modules/` or `app/` — zero matches.
- Prisma migrations for seeded/hardcoded data — all three existing migrations are pure schema DDL (`CREATE TYPE`/`TABLE`/`INDEX`/`FOREIGN KEY`), zero `INSERT` statements.
- `scripts/` — only `scripts/seedFounder.ts` exists, and it creates exactly one `StudioUser` row from environment variables; no catalogue data whatsoever.

`tsconfig.json` and `eslint.config.mjs` both explicitly exclude `legacy-prototype/**` (Phase 1 decision) — it is compiled and linted by nothing in this project. `legacy-prototype/src/data.ts` (`VIDEOS_DATA`, `CHANNEL_INFO`) exists exactly as GAIS left it and was not modified — it remains reference-only material, per its own `LEGACY_NOTICE.md`.

## 2. AuditLogEntry investigation and fix

**Finding**: `AuditLogEntry` grew from 27→39 across Phase 6D/6E's sessions — entirely from re-running `npm run test:integration`, never from anything Phase 6D/6E's own code touched.

**Root cause, precisely identified** (queried the actual rows, not inferred): five repository functions exercised by `tests/integration/{credentialsSignIn,youtubeSyncFoundation}.test.ts` audit-log by design — `setFieldOwnership`, `resolveSyncConflict`, `upsertSyncPolicy` (×2 per test run), `recordObservabilityTransition`, and `updateStudioUserPassword`. This is **correct, intentional production behavior** (ADR §16.3: "resolutions are never silent"; ADR §20) — the tests are right to exercise it. The gap: `AuditLogEntry` has no FK/cascade on `entityId` (a deliberate design choice — it's an intentionally generic, append-only polymorphic log, not tied to any one entity table), so when a test's `afterEach` deleted the `StudioUser`/`SyncPolicy`/etc. row a test created, the `AuditLogEntry` row referencing it was never deleted alongside it, and accumulated a little further every time the suite ran.

**Is this intentional?** The audit-logging itself, yes. The accumulation as dev-database noise, no — nobody decided that; it's an unaddressed side effect of testing real repository functions without a matching cleanup step for the one table those functions also write to.

**Fix applied** (small, focused, exactly as scoped): both test files' `afterEach` now also deletes the `AuditLogEntry` rows that test run caused, matched by the exact `entityId`(s) it created — never touching a real StudioUser's or SyncPolicy's audit history. See `tests/integration/README.md` for the convention this establishes for future integration tests.

**Verified fixed, not just theorized**: ran `test:integration` twice in a row after the fix — `AuditLogEntry` went from 39 → 21 (the fix also retroactively cleaned historical orphans sharing the same fixed test-resource-id) → **21 → 21** on the second run, confirming no further growth.

**A dedicated test database/schema** would be the more complete architectural isolation (a separate Neon branch, its own connection string) — not implemented here, since the brief explicitly asked for the smallest safe fix first and this fully solves the actual problem (noise accumulation) without it. Worth considering later if integration tests grow significantly in number or write volume.

## 3. Remaining legacy residue

21 `AuditLogEntry` rows predate this fix (12 `SYNC_POLICY_CHANGED` + 9 `STUDIO_USER_PASSWORD_CHANGED`, from `SyncPolicy`/`StudioUser` ids that no longer exist) — every one traceable to a past test run, none reachable from any real Studio account or policy. They are harmless (no FK violation, nothing reads or aggregates them in a way that would be misleading) but are exactly the kind of thing worth a one-time manual purge before treating the current `AuditLogEntry` count as "clean production history." Not deleted automatically as part of this pre-flight — flagged for an explicit decision instead.

## 4. Test database safety

Both integration test files are **intentionally** written against the real configured Neon development database (there is no fake/in-memory Postgres in this stack) — confirmed by design, not an oversight (`tests/integration/README.md`, unchanged principle). Every fixture row uses a clearly test-scoped identifier (`phase5c-integration-test@musicmadras.test`, `phase6b-test-video-id`, `phase6b-test-*` job types/scope keys) that cannot collide with real Studio accounts or real YouTube resource IDs — confirmed no overlap is possible with Phase 6F's real data (real YouTube video IDs are 11-character opaque strings, real playlist IDs start `PL`/`UU`/`PU` etc.; none can equal the literal string `phase6b-test-video-id`). Cleanup order respects every foreign-key constraint. No collision risk with the upcoming synchronization was found.

## 5. Confirmations for Phase 6F

- YouTube-derived data (title, description, thumbnails, duration, visibility, embeddable status, current view/like/comment counts, playlist metadata, playlist membership, playlist position, availability state) must remain **dynamically, frequently, incrementally synchronized** from the live channel — never a one-time import, never GAIS data. Deeper YouTube Analytics (watch time, traffic sources, audience metrics) remains a separate, later integration respecting YouTube's own reporting latency; this is not "real-time" and is never described as such.
- Phase 6F's data path is exclusively `Live YouTube API → modules/youtube/adapter → (future) sync engine → MMKE` — confirmed nothing in the current adapter, repositories, or schema has any dependency on `legacy-prototype`.
- The initial synchronization must distinguish "a YouTube object exists" from "Music Madras has fully catalogued this object" — nothing in the current schema or adapter forces or assumes the two are the same; `YouTubeVideo` remains a distinct table from `Recording`, joined only through `MediaResource`, exactly per the ADR.
