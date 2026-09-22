# modules/youtube — Phase 6C scope

Per ADR-0001 §11–16:

- `adapter/` — **implemented as of Phase 6C (read-only only)**. See "IMPLEMENTED" below.
- `sync-engine/` — reconciliation logic (ADR §13). **Not built yet.** Has no knowledge of Cron, HTTP, or "jobs." Will be the only consumer of `adapter/`.
- `ownership/` — pure, tested state-machine legality checks for `FieldOwnership.ownership` and `SyncConflict.status` (ADR §16), added in Phase 6B, mirroring `modules/publishing/revisionTransitions.ts`'s pattern. The persistence side lives in `modules/db/repositories/{fieldOwnershipRepository,syncConflictRepository}.ts`. Neither this module nor the repositories decide *when* a transition should happen — that's the sync engine's job, not built yet.
- `availability/` — **not built yet**. The `ObservabilityState` escalation rules (counting consecutive `FULL` passes against `SyncPolicy`) are explicitly deferred; only the persistence these rules will write to (`ObservabilityTransition`, `SyncPolicy`) exists so far, via `modules/db/repositories/{observabilityTransitionRepository,syncPolicyRepository}.ts`.

The `YouTubeVideo`, `YouTubePlaylist`, and `YouTubePlaylistItem` **tables** already exist in `prisma/schema.prisma` (Phase 1). Phase 6B added the six supporting tables ADR §12/§13/§15/§16 depend on — see `docs/phase-6b-youtube-sync-foundation.md`.

## IMPLEMENTED (Phase 6C): the YouTube Data API adapter

`modules/youtube/adapter/` is a self-contained, read-only wrapper over YouTube Data API v3. It has no dependency on `@prisma/client`, `modules/db`, `app/**`, Studio, authentication, publishing, or analytics — it can be imported and tested in complete isolation. It makes **no live API calls anywhere in this codebase**: nothing instantiates it yet, and `YOUTUBE_API_KEY`/`YOUTUBE_CHANNEL_ID` remain empty placeholders in `.env.example`.

**Supported read operations** (`YouTubeDataApiAdapter`, exported from `modules/youtube/adapter/index.ts`):

- `getChannel(channelId)` — `channels.list`, resolving the channel's uploads playlist ID (ADR §13.1, step 1).
- `listPlaylists(channelId, pageToken?)` — `playlists.list`, one page at a time (ADR §13.1, step 3).
- `listPlaylistItems(playlistId, pageToken?)` — `playlistItems.list`, one page at a time; works identically for the uploads playlist or any other playlist (ADR §13.1, steps 1 and 4).
- `listVideos(videoIds)` — `videos.list`, internally batched into groups of 50 (YouTube's documented limit, matching ADR §13.1 step 2) — the caller passes any number of IDs. As of Phase 6E, also requests `part=statistics` and returns current `viewCount`/`likeCount`/`commentCount` (as the raw strings the API returns) and `status.embeddable` — needed for the Phase 6E archive inventory. These are current public video statistics from the Data API, not YouTube Analytics (watch time, traffic sources, etc.), which remains a separate, later concern (`docs/analytics-architecture.md` §5).

**Pagination**: every list method returns `{ items, nextPageToken }` for a single page. The adapter never auto-fetches subsequent pages — that decision (how many pages to walk, when to stop) belongs to the future sync engine, not this layer. Pagination is not connected to `SyncCheckpoint` here, by design — the sync engine will read/write checkpoints itself, passing the resulting `pageToken` back into these same methods.

**Batching**: `chunkArray()` (exported, independently unit-tested) splits any number of video IDs into ≤50-ID groups; `listVideos` de-duplicates the input first, then issues one `videos.list` call per batch and concatenates the results.

**Retry/backoff**: `modules/youtube/adapter/retryPolicy.ts`'s `withRetry` — bounded attempts (default 3), exponential backoff (default 250ms, doubling, capped at 4s), fully injectable `sleep` for deterministic tests. Only errors classified `TRANSIENT` (network failures, client-side timeouts, HTTP 5xx) are ever retried. Configuration, authentication, quota/rate-limit, invalid-request, and not-found errors are never retried — they're permanent outcomes for that request.

**Error model** (`modules/youtube/adapter/errors.ts`): `YouTubeProviderError` with a `kind` of `CONFIGURATION | AUTHENTICATION | QUOTA_EXCEEDED | TRANSIENT | INVALID_REQUEST | NOT_FOUND | UNEXPECTED_RESPONSE`, classified from the HTTP status and (for a 403) the API's own `error.errors[].reason` field (distinguishing `quotaExceeded`/`dailyLimitExceeded`/`rateLimitExceeded` from a plain permission denial). **Not** mapped onto Music Madras's `ObservabilityState` here — that mapping is the availability layer's job (ADR §15), a later phase.

**Quota visibility**: an optional `onApiCall({ operation, status })` hook fires once per HTTP response actually received, so a future caller can track real request volume per operation. No specific quota-unit costs are invented or hardcoded here — the adapter doesn't claim to know YouTube's exact unit pricing, only how many calls of which kind were made.

**ETag / conditional requests**: every DTO carries the API's `etag` for that resource. `YouTubeHttpClient.get()` accepts an optional `ifNoneMatch` parameter and correctly resolves an HTTP 304 to `{ notModified: true }` rather than throwing. **Not yet wired into the high-level adapter methods** (`getChannel`/`listPlaylists`/etc. don't take a previous ETag parameter) — there's no sync engine yet with a previous ETag to compare against. This is the natural next enhancement once one exists, not a missing capability at the HTTP layer.

**Security**: the API key is received via constructor configuration only (`YouTubeAdapterConfig`/`YouTubeHttpClientOptions.apiKey`) — nothing in `modules/youtube/adapter/` reads `process.env` directly; that stays at whatever composition boundary eventually instantiates this adapter (not built yet). As of Phase 6D, the key is sent only via the `x-goog-api-key` request header — never as a `key` query parameter, so it cannot appear in a request URL, server access log, or intermediary cache at all. `redactUrl()` remains as a defense-in-depth backstop on any URL that ends up in a thrown error's message. Dedicated tests assert the key is present in the request header, absent from the request URL, and never appears in a thrown error's message.

**Testing**: `tests/unit/{chunkArray,retryPolicy,youtubeHttpClient,youtubeDataAdapter}.test.ts`, all network-free — a fake `fetch` implementation (`tests/unit/helpers/fakeYouTubeFetch.ts`) is injected via `fetchImpl`/`sleep` constructor options, exactly the extension points production code would use for a real deployment. No real YouTube API call is made anywhere in the test suite.

**NOT IMPLEMENTED** (explicitly deferred, per this phase's brief): the sync engine's reconciliation orchestration, any write to `YouTubeVideo`/`YouTubePlaylist`/`YouTubePlaylistItem`/`MediaResource`/`Recording`, ownership/conflict decision logic (only the pure legality checks from Phase 6B exist), availability/deletion-evidence escalation, `SyncJobRun`/`SyncCheckpoint` orchestration (only their persistence exists, from Phase 6B), Vercel Cron or any scheduler, the Studio YouTube Sync UI, live credentials/configuration, OAuth, YouTube Analytics, and any write operation to YouTube itself. This adapter only ever answers "here is what YouTube returned" — deciding what that means for Music Madras is the next phase's job.
