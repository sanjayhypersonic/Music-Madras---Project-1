# Music Madras Analytics Event Taxonomy

This is the authoritative event taxonomy (Phase 3). It is enforced in code by `modules/analytics/events/eventTypes.ts` and `modules/analytics/events/eventParamSchemas.ts` — those files and this document must never drift apart; `tests/unit/validateAnalyticsEvent.test.ts` exercises the enforcement.

No event name or parameter outside this table is ever accepted by `AnalyticsService.track()` — `validateAnalyticsEvent` rejects anything else before it reaches a provider adapter.

## How to read this table

- **Internal event** — the name used everywhere inside Music Madras application code.
- **GA4 event** — the name sent to Google Analytics 4 by the GA4 adapter (`modules/analytics/providers/ga4/mapToGa4Event.ts`). Music Madras reuses its internal names unchanged as GA4 custom events, **except** `page_view`, which intentionally maps to GA4's own built-in pageview event. No other internal event is reshaped into one of GA4's "recommended events" (e.g. `search`, `select_content`) — those carry specific expected parameters (like `search_term`) that this taxonomy deliberately never sends. See §Privacy below.
- **Allowed parameters** — the complete, closed set for that event. Anything else is rejected.
- **Entity context** — whether the event is expected to carry `EntityContext` (canonical MMKE `entityType`/`entityId`, brief §4).

| Internal event | GA4 event | Allowed parameters | Entity context | Purpose |
|---|---|---|---|---|
| `page_view` | `page_view` (GA4 built-in) | `path` (string, ≤300), `title` (string, ≤120) | No | A page was viewed. |
| `entity_view` | `entity_view` | — | Yes | Generic fallback for viewing an entity type with no dedicated `*_view` event below (e.g. Venue, Performance, Organisation, Choir, Conductor). |
| `catalogue_search` | `catalogue_search` | `resultCount` (number), `entityType` (string, ≤60, optional), `page` (number, optional) | No | A catalogue search or category filter was performed on `/archive`. Deliberately carries no query text — see §Privacy. `entityType`/`page` (Phase 6G-18) double this as the "filtered by category" signal, so no separate `archive_filter` event was added. |
| `search_result_select` | `search_result_select` | `resultPosition` (number), `selectedEntityType` (string, ≤60) | Yes | A user selected a specific search result. |
| `recording_view` | `recording_view` | — | Yes (`Recording`) | A Recording's public page was viewed. |
| `programme_view` | `programme_view` | — | Yes (`Programme`) | A Programme's public page was viewed. |
| `musical_work_view` | `musical_work_view` | — | Yes (`MusicalWork`) | A Musical Work's public page was viewed. |
| `composer_view` | `composer_view` | — | Yes (`Composer`) | A Composer's public page was viewed. |
| `artist_view` | `artist_view` | — | Yes (`Artist`) | An Artist's public page was viewed. |
| `collection_view` | `collection_view` | — | Yes (`Collection`) | A Collection's public page was viewed. |
| `educational_content_view` | `educational_content_view` | — | Yes (`EducationalContent`) | An educational content block was viewed. |
| `learning_guide_view` | `learning_guide_view` | — | Yes (`LearningGuide`) | A Learning Guide's public page was viewed. |
| `video_view` | `video_view` | — | Yes (`YouTubeVideo`) | A `/videos/[slug]` page was viewed (Phase 6G-18). |
| `youtube_click` | `youtube_click` | — | Yes (`youtubeVideoId`) | A user clicked through to a YouTube video/link (Phase 6G-18: this is the outbound-click event — no separate `outbound_video_click` name was added, same purpose). |
| `youtube_play_intent` | `youtube_play_intent` | — | Yes (`youtubeVideoId`) | A user initiated in-page video playback. |
| `playlist_view` | `playlist_view` | — | Yes (`YouTubePlaylist`) | A playlist/Collection backed by YouTube was viewed. |
| `playlist_item_select` | `playlist_item_select` | `position` (number) | Yes | A specific item within a playlist was selected. |
| `sheet_music_request_started` | `sheet_music_request_started` | `hasRecordingContext` (boolean), `hasMusicalWorkContext` (boolean) | Yes | A visitor opened the sheet music request form. No requester details. |
| `sheet_music_request_submitted` | `sheet_music_request_submitted` | `hasRecordingContext` (boolean), `hasMusicalWorkContext` (boolean) | Yes | A sheet music request was submitted. The actual request (name/email/message) lives only in the `SheetMusicRequest` table — never in analytics. |
| `outbound_link` | `outbound_link` | `destinationHost` (string, ≤120) | No | A user followed a link off the Music Madras site. Only the destination **host** is recorded, never the full URL (which could carry query parameters). |
| `media_interaction` | `media_interaction` | `mediaType` (string, ≤60), `action` (string, ≤60) | Yes | A non-YouTube media interaction (e.g. an embedded audio player). |

## Entity context fields (brief §4)

When present, `EntityContext` may carry: `entityType`, `entityId`, and any of `recordingId`, `programmeId`, `musicalWorkId`, `composerId`, `collectionId`, `educationalContentId`, `youtubeVideoId` — whichever are relevant to the event. These are always references to a canonical MMKE row (an ID), never a copy of the entity's data (title, description, etc.). The GA4 adapter flattens these into snake_case parameters (e.g. `entity_type`, `recording_id`).

## Canonical entity types (Phase 6G-18 addition)

`CanonicalEntityType` now also includes `Performance` and `Organisation` — both gained real public pages (`/performances/[slug]`, `/organisations/[slug]`) after Phase 3 wrote this taxonomy, and neither had a dedicated `*_view` event added; like Venue/Choir/Conductor, they use the generic `entity_view` fallback.

## Privacy (brief §5, §16, §17)

- No event, ever, carries: a password, an authentication token, an API key, a private/editorial note, a requester's name/email/message, or raw free-text search query input. This is enforced structurally — the parameter allowlist above is the *complete* set of accepted parameters per event, and `validateAnalyticsEvent` additionally runs a denylist safety check against key names that look sensitive (`password`, `token`, `email`, `message`, etc.) as defense-in-depth.
- `sessionId` is an anonymous, session-scoped identifier. Nothing in this taxonomy is designed to track a persistent individual identity across sessions. **Phase 6G-18**: since no consent/cookie-banner mechanism exists anywhere in this codebase, no analytics cookie is ever set on a visitor's browser and no identifier is ever persisted or reused across a navigation — `createEphemeralSessionId()` generates one random, throwaway id per server-rendered page load (shared only by the handful of events that one page load fires), then discards it. This is a deliberate trade-off (see `docs/analytics-architecture.md` §15): GA4 cannot stitch a visitor's journey into one "session," but nothing requiring consent is ever introduced. Real GA4 session/user analytics would require a client-side tag and a genuine consent decision — a separate future phase.
- `catalogue_search` intentionally does not carry the search text itself.
- `outbound_link` carries only the destination hostname, not the full URL.

## GA4 mapping constraints enforced

`mapToGa4Event.ts` enforces GA4's documented Measurement Protocol limits: event names ≤40 characters, ≤25 parameters per event, parameter names ≤40 characters, string parameter values truncated to ≤100 characters, booleans converted to `1`/`0` (GA4 has no native boolean parameter type).

## Wiring status (Phase 6G-18)

As of Phase 6G-18, every public Museum page (`app/(museum)/**/page.tsx`) calls `trackPublicPageView` (via Next's `after()`, so analytics never delays a response) — see `docs/analytics-architecture.md` §15 for the full wiring architecture, configuration requirements, and what remains deliberately unconfigured.
