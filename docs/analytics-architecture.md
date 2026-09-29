# Phase 3 — Analytics & Integration Architecture

Companion to [`docs/architecture/ADR-0001-production-platform.md`](architecture/ADR-0001-production-platform.md), [`docs/phase-2-mmke-domain.md`](phase-2-mmke-domain.md), and [`docs/analytics-event-taxonomy.md`](analytics-event-taxonomy.md) (the authoritative event vocabulary — this document explains the architecture around it).

## 1. What GAIS had (inspection finding, brief §20)

The legacy prototype (`legacy-prototype/`) has **zero** analytics implementation of any kind — no `gtag`, no Google Analytics script, no YouTube Analytics API usage, no internal event tracking. The only analytics-adjacent things in GAIS were:

- Hardcoded display strings (`views: '22,774'`, `subscribers: '12.4K'` in `src/data.ts`) — static text, not measured data.
- `legacy-prototype/src/mmke/types/recommendations.ts` — a `confidenceScore`/`matchingSignals` shape for an unimplemented recommendation engine, not analytics.

There is nothing to preserve or migrate here — Phase 3 is new capability, not a rebuild of something GAIS had. This document records that finding so it isn't mistaken for a gap later.

## 2. Layered architecture (brief §2)

```
Music Madras Application (Museum/Studio — later phases)
        ↓
modules/analytics/events        (taxonomy + validation — pure, no I/O)
        ↓
modules/analytics/service       (AnalyticsService — validates, fans out)
        ↓
Provider adapters (implement AnalyticsProviderAdapter)
        ├── modules/analytics/providers/ga4    (GA4 Measurement Protocol)
        ├── (YouTube: a separate, batch-sync capability — see §5, not an event-adapter)
        └── future providers
```

The application never imports a provider SDK or constructs a GA4-shaped payload directly. It constructs a plain `AnalyticsEvent` (optionally via the factories in `modules/analytics/events/factories.ts`) and calls `AnalyticsService.track(event)`. Swapping, adding, or removing a provider only touches `modules/analytics/providers/*` and the `AnalyticsService` construction site — never the call sites throughout the app.

**Not wired into any UI yet.** No Museum/Studio component calls `AnalyticsService.track()` in Phase 3 — those don't exist yet (later phases). Phase 3 is the contract and its enforcement, tested in isolation.

## 3. Event taxonomy & entity-aware design (brief §3-4)

See `docs/analytics-event-taxonomy.md` for the full table. Architecturally, the important properties are:

- **Controlled vocabulary, not arbitrary strings.** `AnalyticsEventName` is a closed TypeScript union backed by a runtime array (`ANALYTICS_EVENT_NAMES`), and `validateAnalyticsEvent` rejects anything outside it.
- **Entity-aware, not URL-dependent.** `EntityContext` carries canonical MMKE IDs (`entityType`/`entityId` plus specific FKs like `recordingId`). A page's URL can change; the Recording's ID does not. This is what makes "which recordings get the most interest" (brief §12) answerable later without depending on URL history.
- **No duplication of catalogue data into events.** An event carries an ID, never a title/description/biography — MMKE remains the one place that data lives (brief §4, and consistent with every prior phase's insistence on one source of truth).

## 4. GA4 boundary (brief §6-7)

`modules/analytics/providers/ga4/mapToGa4Event.ts` is the **only** place that knows what a GA4 event looks like. It:

- Enforces GA4's documented Measurement Protocol limits (name/parameter length, parameter count).
- Flattens `EntityContext`/`PageContext`/`params` into snake_case GA4 parameters.
- Converts booleans to `1`/`0` (GA4 has no boolean parameter type).
- Deliberately does **not** attempt to reshape events into GA4's own "recommended events" (e.g. `search`) where doing so would require sending data this taxonomy withholds for privacy reasons (e.g. `search_term`) — see `docs/analytics-event-taxonomy.md`.

`modules/analytics/providers/ga4/ga4Adapter.ts` implements `AnalyticsProviderAdapter`. **It is unconfigured everywhere in this codebase** — no real measurement ID or API secret exists (`.env.example` only documents the variable names, per the Phase 1/2 pattern). Its `send()` method checks for configuration first and returns `{ delivered: false, reason: "not_configured" }` without making any network call when it isn't configured, which is always, in Phase 3. The Measurement Protocol `fetch()` call is written (so the adapter boundary is real, not a stub comment) but is unreachable code until real credentials are provided in a later phase — writing an adapter is not the same as connecting an account.

## 5. YouTube: two different capabilities (brief §8)

| | YouTube Data API | YouTube Analytics API |
|---|---|---|
| Answers | "What exists?" | "How is it performing?" |
| Already modeled | `YouTubeVideo`/`YouTubePlaylist`/`YouTubePlaylistItem` (Phase 1) | `YouTubeAnalyticsObservation` (Phase 3, new) |
| Sync engine | Designed in ADR §11-13, not yet built | Designed in this document + `modules/analytics/youtube/`, not yet built |
| Live calls in this codebase | None | None |

These were kept as clearly separate concerns from the start — the existing `YouTubeVideo` table (identity/metadata) is not extended with performance columns; a new, purpose-built observation table exists instead (§6).

## 6. YouTube Analytics domain model (brief §9)

`YouTubeAnalyticsObservation` (see `prisma/schema.prisma`) stores **one row per (scope, target, metric, period, dimension breakdown)** rather than one wide table with a nullable column per possible metric:

- `scope`: `CHANNEL` or `VIDEO`.
- `youtubeVideoId` / `channelId`: which target the row is about. No dedicated `YouTubeChannel` entity was introduced — Music Madras has exactly one channel today, and a full entity for a single row would be premature (add one if/when a second channel or richer channel metadata is genuinely needed).
- `metric` (a controlled enum: views, watch time, average view duration, average view percentage, likes, comments, shares, subscribers gained/lost — brief §8's own example list, not YouTube Analytics' entire catalog).
- `periodStart`/`periodEnd`: the reporting window.
- `value`: the measurement.
- `dimensions`: an optional small JSON breakdown (e.g. `{"trafficSource":"YT_SEARCH"}` or `{"country":"IN","device":"MOBILE"}`), because YouTube Analytics reports can be sliced by an open-ended combination of dimensions and a dozen nullable dimension columns would be worse, not better. **This is not the "JSON shadow state" this project avoids elsewhere** — that concern is specifically about a JSON blob competing with MMKE as a second source of truth for *catalogue* content; this JSON only ever holds a reporting breakdown, and nothing about Recording/Composer/MusicalWork identity lives in it.
- `dimensionsHash`: a deterministic hash (`modules/analytics/youtube/computeDimensionsHash.ts`) of the canonicalized `dimensions`, used as part of the row's unique constraint — Postgres/Prisma unique constraints are far more reliable on a plain scalar than directly on a JSON column, and this is what makes re-running a sync idempotent.
- `syncJobRunId`: a loose forward-reference (no FK yet) to the `SyncJobRun` table the ADR §12-13 YouTube Data sync engine will introduce in a later phase. Deliberately not a new, analytics-specific job-run table — that would duplicate a mechanism the ADR already designed once.

## 7. Synchronization architecture (brief §10)

```
Scheduler / Trigger (future — mirrors ADR §12's existing pattern)
        ↓
Job (future — run-level locking, bookkeeping)
        ↓
runYouTubeAnalyticsSync (modules/analytics/youtube/runYouTubeAnalyticsSync.ts)
        ↓
YouTubeAnalyticsAdapter (interface only — no implementation, no credentials)
        ↓
YouTubeAnalyticsSyncRepositoryPort → youtubeAnalyticsRepository (modules/db)
```

- **Planning** (`planYouTubeAnalyticsSync.ts`, pure): given the last successfully-synced period (or none, for a first-ever sync), computes the list of calendar-day periods still needed, excluding a configurable reporting-lag window (YouTube Analytics data isn't final for the most recent day or two).
- **Incremental + backfill**: a first sync backfills a configurable window (default 30 days); subsequent syncs only fetch what's new since the last checkpoint.
- **Idempotency**: every observation upsert is keyed by the full unique constraint (scope/target/metric/period/dimensions-hash), so re-running a sync for an already-synced period is a safe no-op.
- **Partial failure handling**: `runYouTubeAnalyticsSync` stops advancing its checkpoint at the first period that fails (after its retry attempts), so a later run resumes exactly there rather than silently skipping a gap.
- **Retries**: each period is retried up to a configurable attempt count before being recorded as failed. Real backoff *timing* is the live adapter's HTTP client's responsibility, not this orchestration logic — no fake delays are hardcoded into the sync loop.
- **Quota awareness**: `maxPeriodsPerRun` caps how many periods a single run attempts; anything left over is simply picked up by the next run, since the checkpoint only advances as far as what actually succeeded.
- **Manual vs. scheduled**: exactly one function (`runYouTubeAnalyticsSync`) exists to call — a future manual "Sync Now" action and a future scheduled job both call it, exactly matching the "no second implementation" principle ADR §12 already established for YouTube Data sync.

**Nothing here makes a real API call.** `YouTubeAnalyticsAdapter` is an interface; tests exercise the orchestration against a fake implementation.

## 8. Cross-platform identity (brief §11-12)

`getCrossPlatformContextForVideo(youtubeVideoId)` in `modules/db/repositories/youtubeAnalyticsRepository.ts` resolves the real chain:

```
YouTubeVideo → MediaResource → RecordingRevision → { works → MusicalWork → Composer, performance → Programme/Venue } → Recording
```

alongside that video's synchronized `YouTubeAnalyticsObservation` rows — without copying any catalogue data into the analytics tables, and without making the YouTube video ID the identity of the Recording (the Recording's own `id`/`slug` remain its identity; the video is just something it's linked to via `MediaResource`). This is exactly the query shape a future cross-platform report ("which recordings get the most YouTube engagement," brief §12) would build on — not built now, but made possible without a schema change later.

## 9. Internal vs. external data (brief §13)

| | Authoritative for | Where it lives |
|---|---|---|
| MMKE (Composer/Work/Recording/...) | Music Madras catalogue identity | `prisma/schema.prisma`, Phases 1-2 |
| Music Madras application events | Nothing on its own — it's the measurement layer | Transient (`AnalyticsEvent` objects), not persisted by MMKE (see §10) |
| GA4 | GA4-specific web analytics (sessions, users, GA4's own reports) | Google's systems |
| YouTube Analytics | YouTube performance analytics | Google's systems; synchronized observations in `YouTubeAnalyticsObservation` |

The internal analytics layer *connects* these; it does not attempt to replace or duplicate any of them as a source of truth.

## 10. What is and isn't persisted (brief §14)

- **`AnalyticsEvent` objects are transient.** They are validated and dispatched to provider adapters; MMKE does not store a copy of every raw event. This is a deliberate choice, not an oversight — storing every GA4-bound event permanently in Postgres "because it's technically possible" is exactly what brief §14 warns against.
- **`YouTubeAnalyticsObservation` rows are synchronized performance observations** — a deliberately normalized, bounded table (one row per metric/period/dimension-slice), not a warehouse.
- **No GA4-side observation/aggregate table exists yet.** Sections 8-11 of the Phase 3 brief specifically asked for a *YouTube* Analytics domain model; there was no equivalent explicit ask for a GA4 reporting-sync table, and building one now — before GA4's Reporting API is ever actually connected — would be exactly the kind of premature, unrequested persistence layer this project has consistently avoided. **The extension point is real, though:** once a future phase connects GA4's Reporting API, an analogous normalized observation table (mirroring `YouTubeAnalyticsObservation`'s shape) is the natural next step, introduced then, not guessed at now.
- **A future data warehouse remains possible without rewriting MMKE**, because nothing about MMKE's schema depends on analytics, and the analytics module's provider-adapter boundary means a warehouse would be one more consumer of `YouTubeAnalyticsObservation`/future GA4 observations, not a replacement for them.

## 11. Studio analytics direction (brief §15)

Not built in Phase 3 (no dashboard UI). The foundation this phase lays for it:

- **Website side**: once GA4's Reporting API is connected (future), it is queried directly for sessions/users/page engagement (GA4 remains authoritative for these); Music Madras's own `catalogue_search`/`search_result_select`/entity-view events (already GA4-bound via the adapter) provide the "popular recordings/composers/works," "collection engagement," and "sheet-music request activity" views once that data is queryable back out of GA4 or, if ever needed, via a future GA4 observation table (§10).
- **YouTube side**: `YouTubeAnalyticsObservation`, once actually populated by a live sync (a later phase), directly supports "top videos," "views/watch time/engagement," and "subscriber changes" queries — the repository layer (`listObservationsForVideo`) already provides the basic read path.
- **Cross-platform side**: `getCrossPlatformContextForVideo` (§8) is the query primitive a future "Music Madras → YouTube" or "YouTube → Music Madras" report builds on.

## 12. Search analytics (brief §16)

The Phase 2 search foundation (`modules/mmke/search/`, `modules/db/search/postgresSearchProvider.ts`) is now analytics-aware via two events: `catalogue_search` (fired once a search completes, carrying only `resultCount`) and `search_result_select` (fired when a result is chosen, carrying `resultPosition` and `selectedEntityType` plus the selected entity's `EntityContext`). **Raw query text is never sent to any analytics provider** — see `docs/analytics-event-taxonomy.md`'s Privacy section. If Music Madras ever wants to analyze query text itself, that would mean storing it in Music Madras's own database with its own explicit retention/privacy handling — a deliberate future decision, not something this architecture does by default.

## 13. Sheet Music analytics (brief §17)

`sheet_music_request_started` and `sheet_music_request_submitted` are measurable as business events, carrying only boolean context flags (`hasRecordingContext`, `hasMusicalWorkContext`) and the relevant `EntityContext`. The requester's name, email, message, and any other form content are never included — they live only in the `SheetMusicRequest` table (Phase 1), which remains the sole record of the actual request.

## 14. Testing approach (brief §19)

All Phase 3 tests are DB-free and network-free: pure-function tests for validation, GA4 mapping, dimensions hashing, and sync planning; orchestration tests for `runYouTubeAnalyticsSync` against an in-memory fake adapter and fake repository (verifying idempotent/duplicate-safe behavior and partial-failure checkpoint behavior without a real database). See `tests/unit/`.

## 15. Phase 6G-18 — wiring the public Museum

Phase 3 (above) built the contract and left it entirely unwired ("Not wired into any UI yet" — §2, §4). Phase 6G-18 is that wiring, reusing every piece of Phase 3's architecture unchanged: no second event abstraction, no second GA4 client, no new analytics SDK.

### What was added

- **`modules/analytics/service/getAnalyticsService.ts`** — the one place `AnalyticsService` is constructed, wired to `Ga4Adapter` reading `GA4_MEASUREMENT_ID`/`GA4_API_SECRET` from the environment (documented in `.env.example`, values intentionally blank — see below). A lazily-built module singleton.
- **`modules/analytics/trackEvent.ts`** — wraps `AnalyticsService.track()` in a try/catch that swallows every failure (an invalid event, a misconfigured/unreachable provider). This is the only place an analytics failure is ever allowed to stop propagating — a public page must render identically whether GA4 is configured, reachable, or absent (brief §22/§23).
- **`modules/analytics/createEphemeralSessionId.ts`** — see the taxonomy doc's Privacy section for the full privacy rationale: a fresh random id per server-rendered page load, never a cookie, never persisted, never reused across navigations.
- **`modules/analytics/trackPublicPageView.ts`** — the one call every public page makes: always fires `page_view`, and (when the page has a canonical entity) the appropriate dedicated/generic view event from `factories.ts`, sharing one ephemeral session id.
- **Taxonomy extensions** (`modules/analytics/events/*`): `Performance`/`Organisation` added to `CanonicalEntityType` (their public pages postdate Phase 3); a new `video_view` event dedicated to `YouTubeVideo` (previously falling through to generic `entity_view`); `catalogue_search`'s schema gained optional `entityType`/`page` params so it also covers "filtered by category" without a second `archive_filter` event.
- **`components/museum/OutboundYouTubeLink.tsx`** + **`app/(museum)/videos/[slug]/actions.ts`** — the one Client Component boundary this phase introduces, for the one outbound YouTube link in the entire public Museum. Fires the existing `youtube_click` event via a fire-and-forget Server Action on click; never calls `preventDefault`, never delays the outbound navigation.

### Instrumentation pattern

Every `app/(museum)/**/page.tsx` calls, right after resolving its own data (and its own `notFound()` check, where applicable):

```ts
after(() => trackPublicPageView({ path: `/composers/${composer.slug}` }, createEntityViewEvent({ entityType: "Composer", entityId: composer.id, composerId: composer.id })));
```

`after()` (`next/server`, stable since Next 15.1) schedules the callback to run *after* the response has already been sent — analytics can never delay or fail a page render. This is done at the **page** level, never the shared `(museum)/layout.tsx`: a layout is not guaranteed to re-execute on every navigation between sibling routes the way a page's own function body is (the same reason `generateMetadata` is a per-page export, not a layout one) — putting tracking here is what actually guarantees one `page_view` per real navigation, with no risk of double-counting from re-renders (Server Components render once per request; there is no client-side effect to double-fire in development/StrictMode).

Studio (`app/(studio)/**`) is a structurally separate route group with its own layouts — this phase does not touch a single file under it, which is the entire isolation guarantee for "Studio must never emit public Museum events" (brief §8/§19).

`/archive`'s `catalogue_search` is fired once per rendered result set (in `SingleTypeResults`/`AllTypesResults`), directly via `trackEvent` (not `trackPublicPageView`, which would double-fire `page_view` for the same request) — only when a type filter or a text query is actually present, never on the bare landing view (which already gets its `page_view` from the top-level page component).

### Configuration requirement (STOP condition, per brief §4)

**No real GA4 Measurement ID or Measurement Protocol API secret exists anywhere in this repository or environment.** `GA4_MEASUREMENT_ID`/`GA4_API_SECRET` are now documented in `.env.example` with blank values, following the exact established convention (`YOUTUBE_API_KEY`, `GOOGLE_CLIENT_ID`, etc.) — this phase does not invent, guess, or placeholder a value as if it were real. Without both set, `Ga4Adapter.send()` remains the safe no-op Phase 3 already built (`{ delivered: false, reason: "not_configured" }`, no network call) — every code path above is fully wired and exercised by tests, but delivers nothing until a real GA4 property's credentials are supplied via the deployment's own environment configuration.

### Privacy/consent (STOP condition avoided, per brief §5)

No consent or cookie-banner mechanism exists anywhere in this codebase, and this phase does not add one. It avoids needing to by construction: `createEphemeralSessionId()` never sets a cookie and never persists an identifier anywhere — see the taxonomy doc's Privacy section for the accepted trade-off (no GA4 session/user stitching across page loads) this buys. A real client-side GA4 tag (reading/writing the `_ga` cookie for true session continuity) would need a genuine consent decision first — that remains a deliberately separate, larger future phase.
