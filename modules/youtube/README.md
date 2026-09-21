# modules/youtube — Phase 6B scope

Planned subdirectories, per ADR-0001 §11–16:

- `adapter/` — typed wrapper over the official YouTube Data API v3. **Not built yet** (Phase 6B is schema/domain foundation only — no HTTP calls, no credentials, no `googleapis` dependency).
- `sync-engine/` — reconciliation logic (ADR §13). **Not built yet.** Has no knowledge of Cron, HTTP, or "jobs."
- `ownership/` — **partially real as of Phase 6B**: `fieldOwnershipTransitions.ts` and `syncConflictTransitions.ts` are pure, tested state-machine legality checks for `FieldOwnership.ownership` and `SyncConflict.status` (ADR §16), mirroring `modules/publishing/revisionTransitions.ts`'s pattern. The persistence side lives in `modules/db/repositories/{fieldOwnershipRepository,syncConflictRepository}.ts`. Neither this module nor the repositories decide *when* a transition should happen — that's the sync engine's job, not built yet.
- `availability/` — **not built yet**. The `ObservabilityState` escalation rules (counting consecutive `FULL` passes against `SyncPolicy`) are explicitly deferred; only the persistence these rules will write to (`ObservabilityTransition`, `SyncPolicy`) exists so far, via `modules/db/repositories/{observabilityTransitionRepository,syncPolicyRepository}.ts`.

The `YouTubeVideo`, `YouTubePlaylist`, and `YouTubePlaylistItem` **tables** already exist in `prisma/schema.prisma` (Phase 1), because `MediaResource` and `Collection` reference them. Phase 6B added the six supporting tables ADR §12/§13/§15/§16 depend on (`FieldOwnership`, `SyncConflict`, `ObservabilityTransition`, `SyncPolicy`, `SyncCheckpoint`, `SyncJobRun`) — see `docs/phase-6b-youtube-sync-foundation.md`. The sync engine's actual *behavior* (API calls, reconciliation, deletion-evidence escalation, scheduling, Studio UI) remains deferred to a later phase.
