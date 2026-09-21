# Phase 6B — YouTube Sync Foundation (Database/Domain Only)

Companion to [`docs/architecture/ADR-0001-production-platform.md`](architecture/ADR-0001-production-platform.md) §12, §13, §15, §16. Phase 6A was a read-only pre-flight inspection (delivered as a report, not a committed document) that identified the six tables added here as missing. This phase adds the persistence foundation the approved YouTube synchronization architecture depends on. **It does not implement synchronization.** No YouTube API adapter, no HTTP calls, no credentials, no scheduler, no Studio UI, and no deletion-detection logic exist after this phase — only the database tables and small pure helpers that logic will be built on, in a later phase, without a further schema change.

## 1. New tables

All six tables Phase 6A's pre-flight identified as missing now exist, added in one migration (`add_youtube_sync_foundation`) alongside two new enums shared across them (`SyncProvider`, currently just `YOUTUBE`; `SyncResourceType`: `RECORDING | YOUTUBE_VIDEO | YOUTUBE_PLAYLIST | YOUTUBE_PLAYLIST_ITEM`). None of the existing YouTube tables (`YouTubeVideo`, `YouTubePlaylist`, `YouTubePlaylistItem`), `MediaResource`, `Collection`, `Recording`, or `RecordingRevision` were modified — every new table references the resource it's about generically, via a `(resourceType, resourceId)` string pair, the same pattern already used by `EntitySource`/`EntityRights`/`EntityEducationalContent`.

- **`FieldOwnership`** (ADR §16.1) — one row per `(provider, resourceType, resourceId, fieldName)`, tracking which side currently controls a field's value. `ownership` is one of three persisted states: `YOUTUBE_CONTROLLED`, `MUSIC_MADRAS_CONTROLLED`, `SHARED_REQUIRES_REVIEW`. (The ADR's own §16.2 also names a fourth conceptual state, `MUSIC_MADRAS_EDITORIAL`, for fields with no YouTube-sourced counterpart at all — but the ADR itself says such fields never need a `FieldOwnership` row, so it was never a value this enum has to store.)
- **`SyncConflict`** (ADR §16.3) — records a detected disagreement between the current Music Madras value and a new external value, with a three-state lifecycle: `OPEN → RESOLVED | IGNORED`. Both terminal states are final — a resolved or ignored conflict is historical record, never reopened.
- **`ObservabilityTransition`** (ADR §15) — the evidence record behind an availability-state change (reusing the existing `ObservabilityState` enum unchanged — it already covers every state §15 specifies).
- **`SyncPolicy`** (ADR §15) — holds `deletionEvidenceRequiredPasses` (default `3`) as configuration, one typed row per `(provider, resourceType)`, not a literal constant in application code.
- **`SyncCheckpoint`** (ADR §13.2) — one row per `(provider, resourceType, scopeKey)`, where `scopeKey` is the generic analogue of the ADR's "(resourceType, parentId)" (e.g. a specific playlist's id, or a fixed sentinel like `"channel-uploads"`). A small `providerCursor` JSON column exists as an escape hatch for genuinely provider-specific paging detail that doesn't fit the normalized columns — never catalogue data, only resumption bookkeeping.
- **`SyncJobRun`** (ADR §12-13) — one row per synchronization attempt, with `status` (`RUNNING | SUCCEEDED | PARTIAL | FAILED`) and `completeness` (`FULL | PARTIAL`) tracked as two separate concepts: a run can succeed with only partial coverage, or fail outright. `recordsFlagged` mirrors ADR §13.4's own wording ("counts of created/updated/flagged/failed resources") — one collective counter for anything landing on `PRIVATE`/`UNLISTED`/`UNAVAILABLE`/`DELETED`; the per-resource detail lives in `ObservabilityTransition`, not duplicated here.

`StudioUser` gained two new reverse-relation fields (`fieldOwnershipChanges`, `syncConflictsResolved`) — a structural requirement of the two new foreign keys, not a change to authentication behavior.

## 2. Relationships added

- `FieldOwnership.changedById → StudioUser` (nullable, `SetNull`) — who took editorial control of a field, if anyone (null means the row is still in its initial system-set state).
- `SyncConflict.resolvedById → StudioUser` (nullable, `SetNull`) and `SyncConflict.syncJobRunId → SyncJobRun` (nullable, `SetNull`) — which run detected the conflict, and who resolved it.
- `ObservabilityTransition.syncJobRunId → SyncJobRun` and `.syncCheckpointId → SyncCheckpoint` (both nullable, `SetNull`) — the evidence trail linking a state change back to the run/checkpoint that produced it.
- `SyncCheckpoint.syncJobRunId → SyncJobRun` (nullable, `SetNull`).

All are real, enforced foreign keys (verified in testing — see §6) — not the "loose forward-reference" pattern `YouTubeAnalyticsObservation.syncJobRunId` used in Phase 3, which existed only because `SyncJobRun` didn't exist yet at that time. That column is unchanged in this phase (the brief explicitly excluded modifying the existing Analytics architecture); converting it to a real FK is a reasonable future cleanup, not done here.

## 3. New repositories and domain types

Following the existing "one repository per aggregate" convention (`modules/db/repositories/`):

- `fieldOwnershipRepository.ts` — `recordExternalFieldValue` (routine sync touch, never audit-logged, never changes `ownership`) and `setFieldOwnership` (explicit ownership change, always audit-logged — ADR §16.3: "resolutions are never silent"), plus `findFieldOwnership`/`listFieldOwnershipsForResource`.
- `syncConflictRepository.ts` — `createSyncConflict` (system-detected, not audited), `resolveSyncConflict`/`ignoreSyncConflict` (human decisions, always audited), `findSyncConflictById`/`listOpenSyncConflicts`.
- `observabilityTransitionRepository.ts` — `recordObservabilityTransition` (always audit-logged — the ADR calls reaching `DELETED`/`UNAVAILABLE` "a consequential system decision"), `listObservabilityTransitionsForResource`.
- `syncPolicyRepository.ts` — `upsertSyncPolicy` (a Studio Settings action, always audited), `findSyncPolicy`/`listSyncPolicies`, and the `DEFAULT_DELETION_EVIDENCE_REQUIRED_PASSES = 3` seed constant (only used when first creating a policy row — never a runtime fallback the future escalation logic substitutes for a missing one).
- `syncCheckpointRepository.ts` — `upsertSyncCheckpoint` (routine bookkeeping, not audited), `findSyncCheckpoint`/`listSyncCheckpoints`.
- `syncJobRunRepository.ts` — `startSyncJobRun`/`completeSyncJobRun` (routine bookkeeping, not audited — mirrors how `YouTubeAnalyticsObservation` upserts aren't audited either), `findSyncJobRunById`/`listRecentSyncJobRuns`, and `listFullSyncJobRunsSince` — the query the future escalation logic will use so it never has to hand-roll the "`completeness: FULL` only" filter itself.

Two small, pure, tested domain modules under `modules/youtube/ownership/` (mirroring `modules/publishing/revisionTransitions.ts` exactly): `fieldOwnershipTransitions.ts` (`canTransitionFieldOwnership`) and `syncConflictTransitions.ts` (`canTransitionSyncConflictStatus`) — state-machine legality checks only. Neither decides *when* a transition should happen; that judgment belongs to the sync engine and Studio actions layer, not built in this phase.

No `modules/youtube/adapter/`, `sync-engine/`, or `availability/` code was written — see `modules/youtube/README.md` for exactly what's real versus still deferred.

## 4. What was deliberately not built

Per the phase brief's explicit non-goals: the YouTube Data API client, `googleapis`/`google-auth-library`, any Google Cloud setup or credentials, channel/video/playlist/playlist-membership synchronization, deletion-detection escalation logic, the conflict-resolution UI, the Studio YouTube Sync dashboard, "Sync Now," Vercel Cron or a cron route, and any locking/concurrency mechanism. On locking specifically (brief §7): no schema change was needed or added — a Postgres advisory lock (session-scoped, keyed by job name) requires no schema at all and will be wired into `modules/jobs/youtubeSyncJob.ts` when the job runner itself is built, per ADR §12.

## 5. Architectural notes / decisions

- **Ownership state naming**: the phase brief specified three states (`YOUTUBE_CONTROLLED`, `MUSIC_MADRAS_CONTROLLED`, `SHARED_REQUIRES_REVIEW`), while ADR §16.2 names four (`YOUTUBE_SOURCE`, `MUSIC_MADRAS_EDITORIAL`, `EDITORIAL_OVERRIDE`, `SHARED_REQUIRES_REVIEW`). These are not in conflict: the ADR's `MUSIC_MADRAS_EDITORIAL` is explicitly a "never gets a `FieldOwnership` row" case, not a fourth persisted value, so the ADR's actual *persisted* vocabulary is also three states — just under different names. The brief's names were used as given (`YOUTUBE_CONTROLLED` = ADR's `YOUTUBE_SOURCE`; `MUSIC_MADRAS_CONTROLLED` = ADR's `EDITORIAL_OVERRIDE`).
- **`SyncPolicy` shape**: the ADR's own §15 sketch showed a generic key/value row (`{ key: 'deletionEvidenceRequiredPasses', value: 3 }`); this phase's brief instead asked for a typed table with a named column, which is what was built (`deletionEvidenceRequiredPasses Int`, one row per provider+resourceType) — more concrete and less speculative than a generic settings store, per the brief's own "do not add speculative configuration" instruction.
- **`ObservabilityTransition` evidence linkage**: the ADR's §15 sketch described `contributingSyncJobRunIds` as a list (every one of the N consecutive passes that satisfied the threshold). This phase's brief listed the field as singular ("successful sync run/checkpoint that produced the evidence"), so a single nullable `syncJobRunId` + `syncCheckpointId` pair was built instead of an array. Recording the *full* evidence list remains a straightforward additive change later, not a breaking one.

## 6. Validation

```bash
npm run prisma:validate
npm run prisma:generate
npm run typecheck
npm run lint
npm test                 # 108 tests, 18 files — unchanged DB-free suite plus 2 new pure test files
npm run test:integration # 17 tests, 2 files — unchanged Phase 5C suite plus 8 new tests against the real Neon dev database
npm run build
```

All passed. The integration tests exercise real uniqueness constraints (e.g. a duplicate `FieldOwnership` key rejected, a `SyncPolicy` upsert never producing a second row for the same provider+resourceType) and real foreign-key enforcement (an invalid `syncJobRunId` rejected on `SyncConflict`/`ObservabilityTransition` creation) against Postgres directly, not a fake — each test creates its own disposable fixtures and deletes them in `afterEach`, verified empty afterward.
