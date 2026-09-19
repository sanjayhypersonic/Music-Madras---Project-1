# modules/youtube — Phase 4 scope

This directory is a structural placeholder only. Phase 1 explicitly does not implement YouTube integration, per the Phase 1 brief's guardrails.

Planned subdirectories, per ADR-0001 §11–16:

- `adapter/` — typed wrapper over the official YouTube Data API v3. No scraping, no unofficial proxies.
- `sync-engine/` — reconciliation logic (ADR §13). Has no knowledge of Cron, HTTP, or "jobs."
- `ownership/` — the generic `FieldOwnership`/`SyncConflict` model (ADR §16).
- `availability/` — the `ObservabilityState` escalation rules and `SyncPolicy`/`ObservabilityTransition` handling (ADR §15).

The `YouTubeVideo`, `YouTubePlaylist`, and `YouTubePlaylistItem` **tables** already exist in `prisma/schema.prisma` (Phase 1), because `MediaResource` and `Collection` reference them. Only their *behavior* is deferred.
