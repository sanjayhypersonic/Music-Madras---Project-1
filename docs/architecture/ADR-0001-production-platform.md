# ADR-0001: Music Madras Production Platform Architecture

- **Status:** Proposed — awaiting sign-off before large-scale implementation begins.
- **Branch:** `music-madras-production-rebuild` (created off `main`; `main` is untouched and remains the rollback point).
- **Supersedes:** The AI-Studio-era prototype audited separately (two competing MMKE models, in-memory Studio, no YouTube integration, no per-entity public pages — see prior audit report).
- **Input:** Approved decisions from the Master Engineering Brief (Next.js/App Router, PostgreSQL, Vercel, modular monolith, YouTube-as-adapter, field-ownership conflict model, Sheet Music Requests as MVP).

This document is deliberately concrete about *shape* (module boundaries, schema, request/response flow) and deliberately silent about code that hasn't been written yet. Nothing in this ADR should be read as "already built."

---

## 1. Context & Goals

Music Madras has three conceptual layers — **Museum** (public), **Studio** (editorial), **MMKE** (knowledge engine) — that must share one canonical data model so that:

1. A YouTube upload can flow, without a developer, into a public page.
2. Editors can create/edit/publish/unpublish every entity type through Studio alone.
3. Public pages are crawlable by search and AI answer engines without executing JavaScript.
4. YouTube-sourced fields and editorially-overridden fields can coexist without one silently clobbering the other.
5. The system stays a single deployable modular monolith, not a distributed system, while keeping clean seams for future providers (Vimeo, Spotify, Internet Archive) and a future AI layer.

---

## 2. Decision Summary

| Decision | Choice | Why |
|---|---|---|
| Framework | **Next.js 15, App Router** | One codebase serves both a crawlable, SSR/SSG/ISR public Museum and a dynamic, authenticated Studio via Route Handlers/Server Actions. First-party Vercel deployment. Server Components let domain/data-access code run server-side by default, which directly enforces "no DB calls in UI components" without extra tooling. |
| Language | **TypeScript, strict mode** | Required by brief §9; also the only realistic way to keep a ~25-entity relational domain model coherent across Museum, Studio, and sync engine. |
| Database | **PostgreSQL** | Composer↔Work↔Performance↔Recording↔Venue is a genuinely relational graph with integrity rules ("no orphan performances," referential composer/work links) that Firestore's flat-document model fights. Postgres gives real foreign keys, transactions, and migrations. |
| ORM / data access | **Prisma** | Type-safe queries matching strict TS, first-class migrations, works well with connection pooling on serverless (via Prisma Accelerate or the provider's own pooler — see §5.3), and keeps all DB access inside one `packages/db` layer rather than scattered through routes. |
| Hosting | **Vercel** | Continuity with current DNS/deployment, native Next.js support, cron/Route-Handler-based background jobs (§17), ISR/on-demand revalidation for the publish pipeline (§9). |
| Managed Postgres | **Neon (via the Vercel-Neon native integration)** — see §5.4 for the full evaluation | Serverless Postgres with connection pooling built in (critical for Vercel's ephemeral functions), branch-per-environment (a genuine Postgres branch per dev/staging/prod, not just separate databases), generous free tier, automatic backups on paid tiers, first-party Vercel env-var wiring. **No account will be created and no paid tier will be provisioned by me — this is a recommendation for you to action.** |
| Architecture style | **Modular monolith** | One Next.js app, one Postgres database, strict internal module boundaries (§3). No microservices, no message bus, no separate services unless a concrete need appears (e.g., a genuinely long-running video-processing job that outlives a serverless function's timeout). |
| YouTube integration | **Adapter + Synchronization Engine**, not a core domain type | `Recording` never *is* a `YouTubeVideo`; it *has* a `MediaResource` that may reference one. Swapping/adding a provider (Vimeo, Spotify) later touches the adapter layer only. |
| Auth | **Auth.js (NextAuth) v5 with a Credentials + Google provider, backed by Postgres via the Prisma adapter** | Keeps auth data in the same relational database as everything else (so RBAC joins cleanly against `StudioUser`/`Role`), avoids a second identity system (Firebase Auth) running alongside Postgres, still allows Google sign-in for editors who prefer it. |

---

## 3. Repository & Module Structure

```
/ (Next.js app root)
  app/
    (museum)/                      # public route group — SSR/SSG/ISR
      page.tsx                     # home
      composers/[slug]/page.tsx
      works/[slug]/page.tsx
      artists/[slug]/page.tsx
      programmes/[slug]/page.tsx
      performances/[slug]/page.tsx
      recordings/[slug]/page.tsx
      venues/[slug]/page.tsx
      collections/[slug]/page.tsx
      learning/[slug]/page.tsx
      articles/[slug]/page.tsx
      sitemap.xml/route.ts
      robots.txt/route.ts
    (studio)/                      # authenticated route group — dynamic
      studio/dashboard/page.tsx
      studio/recordings/[id]/page.tsx     # 11-step editorial wizard
      studio/catalogue/[entity]/page.tsx
      studio/youtube-sync/page.tsx
      studio/sheet-music-requests/page.tsx
      studio/users/page.tsx
      studio/settings/page.tsx
      studio/audit-log/page.tsx
    api/
      webhooks/youtube/route.ts     # optional push notifications
      sheet-music-requests/route.ts # public POST endpoint
      revalidate/route.ts           # on-demand ISR trigger, called by publishing layer
      cron/youtube-sync/route.ts    # Vercel Cron target
  modules/                          # the actual domain code — framework-agnostic where possible
    mmke/                           # canonical domain model + business rules
      entities/                    # Composer, MusicalWork, Programme, Performance, Recording, ...
      relationships/
      completeness/                # catalogue-completeness rule engine (§ brief 13)
      duplicate-detection/
    db/                             # Prisma client, schema.prisma, migrations, repositories
      repositories/                # one repository per aggregate (ComposerRepository, RecordingRepository, ...)
    publishing/                     # draft → review → publish → revalidate lifecycle
    youtube/
      adapter/                     # thin wrapper over YouTube Data API v3 (typed DTOs in, DTOs out)
      sync-engine/                 # polling/webhook orchestration, checkpoints, idempotency
      field-ownership/             # YOUTUBE_SOURCE / MUSIC_MADRAS_EDITORIAL / SHARED / EDITORIAL_OVERRIDE resolution
    media/                         # MediaResource abstraction over YouTube/Vimeo/Spotify/uploaded files
    sheet-music/                   # SheetMusicRequest domain + aggregation
    seo/                           # metadata + JSON-LD generators, consuming publishing data (not UI state)
    auth/                          # RBAC policy definitions, session helpers
    audit/                         # audit-log writer, used by every mutating repository call
    jobs/                          # background job definitions (sync, revalidation, sitemap)
  components/
    museum/                        # public-site presentational components
    studio/                        # admin presentational components (the 11-step wizard UI, etc.)
    shared/
  prisma/
    schema.prisma
    migrations/
  tests/
    unit/
    integration/
    e2e/
  docs/
    architecture/                  # this ADR and future ones
```

**Boundary rule:** `app/**` (routes/pages) may import from `modules/**` and `components/**`, but `modules/**` may never import from `app/**` or `components/**`. `modules/db` is the *only* place `prisma` is imported. This is what makes "no DB calls scattered through UI components" and "no business logic buried in UI components" enforceable rather than aspirational.

---

## 4. MMKE Domain Model

Reconciling the two incompatible models found in the audit (`src/mmke/types/entities.ts`'s normalized graph vs. `studio/types.ts`'s flat `RecordingDraft`) into **one** canonical model:

**Core entities** (each gets: `id` (UUID), `slug` where public, `status` lifecycle, `createdAt`/`updatedAt`, `createdById`/`updatedById`, soft-delete via `archivedAt`):

- `Composer` — name, dates, era, biography, external references.
- `MusicalWork` — title, catalogue number, key, `composerId` (FK).
- `Programme` — title, notes, ordered `ProgrammeItem[]` (each item points to a `MusicalWork`, carries movement/encore/order) — **this is what makes Programme genuinely first-class**: a real table with real rows, not a nested JSON blob.
- `Performance` — `programmeId` (FK), `venueId` (FK), date, participants (via join tables below).
- `Recording` — `performanceId` (FK, nullable — a recording can exist before a performance is fully catalogued), status, `mediaResources: MediaResource[]`.
- `Artist`, `Choir`, `Conductor`, `Organisation` — participant entities, linked to `Performance` via join tables (`PerformancePerformer`, `PerformanceChoir`, `PerformanceConductor`) rather than free-text strings.
- `Instrument` — linked to `Venue` (e.g., a pipe organ installation) and optionally to a `Performance`.
- `Venue` / `Church` — modeled as one `Venue` table with a `type` enum (`CHURCH | CATHEDRAL | CONCERT_HALL | STUDIO | OUTDOOR`), matching the existing prototype's approach, which was already sound.
- `Collection` — curated groupings of Recordings/Works (replaces the ad-hoc `Playlist` type; a `Collection` can optionally be *backed by* a `YouTubePlaylist` via the media layer).
- `EducationalContent` / `LearningGuide` — structured guide content with `associatedWorkIds`/`associatedRecordingIds`.
- `EditorialContent` — general articles/pages (the `/articles/[slug]` route type), for content that isn't tied to a specific catalogue entity.
- `MediaResource` — polymorphic: `provider` (`YOUTUBE | UPLOAD | ...`), `providerResourceId`, `role` (`PRIMARY_VIDEO | THUMBNAIL | POSTER | PROGRAMME_PDF | SHEET_MUSIC | AUDIO_MASTER`), FK to whichever entity it belongs to.
- `YouTubeVideo`, `YouTubePlaylist`, `YouTubePlaylistItem` — first-class tables (not embedded arrays), each with sync metadata (`etag`, `lastSyncedAt`, `contentHash`).
- `SheetMusicRequest` — see §14.
- `Source`, `Citation`, `RightsInformation` — attachable to any entity needing provenance (via a generic `provenance` join, e.g. `EntitySource(entityType, entityId, sourceId)`).
- `AuditLogEntry` — append-only, written by the audit module (§18), never edited/deleted (mirrors the existing Firestore rule's intent, now enforced by a DB trigger/repository guard instead of security rules).

**Relationship rule carried over from the prototype's own `EDITORIAL.md`** (it was correct, just unenforced): store the *forward* FK (e.g., `MusicalWork.composerId`) and derive reverse lists (`Composer.works`) via query, never by duplicating ID arrays — Postgres/Prisma relations do this natively, which is strictly better than the prototype's manual `worksIds: string[]` arrays.

**Field ownership** (§13) is modeled per-field on the entities that receive YouTube data: `Recording.titleSource`, `Recording.descriptionSource` etc., each an enum `YOUTUBE_SOURCE | MUSIC_MADRAS_EDITORIAL | SHARED | EDITORIAL_OVERRIDE`, checked by the sync engine before any write (§13 detail below).

**Catalogue completeness** (brief §13) is implemented as a pure function in `modules/mmke/completeness/` that takes a `Recording` (with its relations loaded) and returns a structured report (`{ category: 'Sources', level: 'REQUIRED', status: 'MISSING' }[]`) — not a stored percentage. Studio renders this; the Publish action refuses to proceed while any `REQUIRED` category is `MISSING`.

---

## 5. Database Architecture

### 5.1 Schema strategy
One Prisma schema, one Postgres database, environment-separated by **branch** (§5.4), not by separate hand-maintained databases. Migrations are Prisma Migrate files, committed to `prisma/migrations/`, applied via `prisma migrate deploy` in CI/CD before each deploy — never by hand-editing a live database.

### 5.2 Integrity
Every relationship above is a real foreign key with an explicit `onDelete` policy (`RESTRICT` for things like Composer→Work to prevent orphaning, `SET NULL` where a soft-optional link like Recording→Performance makes sense). Unique constraints on `slug` per entity type. Composite uniqueness on join tables (e.g., `(performanceId, artistId)` on `PerformancePerformer`) to make duplicate-membership structurally impossible, not just editorially discouraged.

### 5.3 Serverless connection handling
Vercel functions are ephemeral — naive Postgres connections exhaust the connection limit fast. Mitigation: use the managed provider's pooled connection string (PgBouncer-compatible) for the app's runtime `DATABASE_URL`, and a separate *direct* connection string (`DIRECT_URL`) for migrations, which Prisma supports natively (`datasource db { url = env("DATABASE_URL") directUrl = env("DIRECT_URL") }`).

### 5.4 Managed Postgres provider evaluation

| Provider | Reliability | Cost | Vercel integration | Backups | Dev/staging/prod separation | Notes |
|---|---|---|---|---|---|---|
| **Neon** (recommended) | Strong; used widely in production, backed by AWS | Generous free tier (0.5 GB, scales to zero when idle), pay-as-you-grow | **Native** Vercel integration — one click wires `DATABASE_URL`/`DIRECT_URL` into every Vercel environment | Point-in-time restore on paid plans | **Best-in-class**: true copy-on-write database *branches* — a "staging" branch is a real Postgres branch of production data/schema, not a separate empty DB | Recommended primary choice |
| Supabase | Strong | Similar free tier, adds bundled Auth/Storage you won't use (we're using Auth.js + the media adapter layer instead) | Good, non-native (manual env vars) | Yes, on paid plans | Manual (separate projects per environment) | Fine alternative if you'd rather have one vendor dashboard for DB+storage later |
| Vercel Postgres (native product) | Now Neon-backed under the hood | Similar to Neon direct | Most seamless (it's a first-party Vercel product) | Yes | Good | Essentially "Neon, wrapped by Vercel" — reasonable if you want a single Vercel bill |
| Railway | Good | Simple flat pricing, no free tier for Postgres anymore | Not native to Vercel (manual env vars) | Yes | Manual | Better fit if hosting were also on Railway |

**Recommendation:** Neon via the Vercel integration (or Vercel's own Postgres product, which is Neon underneath — pick whichever billing relationship you prefer). **I have not created an account or provisioned any database** — this requires your action (account creation + payment method are both things I'm not able to do on your behalf). Once you've created the project and shared the connection strings as environment variables, I can wire up the schema and migrations.

---

## 6. Authentication & RBAC

- **Auth.js v5**, Credentials provider (email+password, hashed with argon2) plus optional Google OAuth provider for editors who prefer SSO — both backed by the same Postgres `User`/`Session`/`Account` tables via the Prisma adapter.
- Roles carried over from the prototype's own model (`Founder | Super Administrator | Administrator | Editor | Reviewer | Contributor`), stored as a real column with a Postgres enum, not inferred from an email string.
- **Server-side authorization, not UI-hiding**: every Server Action / Route Handler that mutates data calls a `can(user, action, resource)` check from `modules/auth/policy.ts` before touching the repository layer. Hiding a button in Studio is a UX nicety, never the actual gate.
- Session-aware Server Components read the role from the session to decide what to render, but the repository layer re-checks permissions independently — defense in depth, matching brief §39 ("Do NOT rely solely on hiding UI elements").

---

## 7. Studio (Admin) Architecture

- Fully server-rendered where possible (Server Components for read views), Server Actions for mutations (create/update/publish/archive), avoiding a large client-side API surface.
- The 11-step editorial wizard's *intent* is preserved (Recording → Programme → Works → Venue → Participants → Educational → Media → SEO → Relationships → Review → Publish) but rebuilt so each step writes through a real repository, with autosave persisting to the `Recording` row (as a `draftPayload` JSON scratch column reconciled into normalized tables on "Review") rather than only to `localStorage`. This preserves the good UX (fast, non-blocking autosave) while fixing the "nothing survives a refresh" defect.
- Entity pickers (Composer/Work/Venue/Choir/Conductor) become real typeahead search against the Postgres tables (`ILIKE`/trigram search, or `pg_trgm`), with an explicit "create new" affordance that runs the duplicate-detection module first (brief §42) rather than the prototype's free-text-plus-`localStorage`-"recents" pattern.
- Global search (brief §41) is a Postgres full-text/trigram query across the canonical tables — no separate search infrastructure needed at this scale; the code is structured so a future semantic/vector search layer can be added behind the same search-service interface without touching callers.

---

## 8. Museum (Public) Architecture

| Route type | Strategy | Why |
|---|---|---|
| Home, category indexes | **ISR** (revalidate on a short interval + on-demand) | Changes moderately often, benefits from being served instantly from cache |
| `/composers/[slug]`, `/works/[slug]`, `/venues/[slug]`, `/artists/[slug]` | **SSG at build + on-demand ISR revalidation** triggered by publish/unpublish | These change only when an editor publishes something — no reason to re-render on every request |
| `/recordings/[slug]`, `/performances/[slug]`, `/programmes/[slug]` | **SSG + on-demand ISR**, same trigger | Same reasoning; this is also where Sheet Music Request UI and structured data live |
| `/collections/[slug]`, `/learning/[slug]`, `/articles/[slug]` | **SSG + on-demand ISR** | Same pattern |
| Sitemap / robots | **Route Handlers regenerated on publish/unpublish**, not static files | Must reflect only published, non-private content (brief §35) |

Every public page is server-rendered HTML on first response — no per-tab client-side SPA state, no query-string-addressed "pages" like the prototype's `?tab=Concert`. This directly fixes the audit's core SEO/AEO finding (all content was JS-injected after hydration on one URL).

---

## 9. Publishing Architecture

Lifecycle (brief §14): `DRAFT → ENRICHMENT → EDITORIAL_REVIEW → APPROVED → PUBLISHED → (UPDATED) → ARCHIVED`.

- Publishing is a single `modules/publishing` service function: validates completeness (§4), writes the status transition + audit entry inside one DB transaction, then calls Next.js's `revalidatePath`/`revalidateTag` for every public route the entity affects (its own page, its composer's page, its venue's page, relevant collection pages) via `api/revalidate`.
- YouTube-ingested drafts are **never** auto-published (brief §14) — ingestion only ever creates/updates a `DRAFT`-status `Recording`; a human must move it through review.
- AI-generated content (future, §65) is written with a `contentOrigin: AI_GENERATED` flag and is also excluded from auto-publish by the same rule.

---

## 10. YouTube Integration Architecture

```
YouTube Data API v3
      ↓
modules/youtube/adapter        (typed fetch wrappers: videos.list, playlists.list, playlistItems.list — all going through
                                 quota-aware, retrying HTTP client; returns DTOs, never raw API JSON, to the rest of the app)
      ↓
modules/youtube/sync-engine    (orchestration: what changed since last checkpoint, idempotent upsert)
      ↓
modules/youtube/field-ownership (per-field merge decision before any write to Recording/YouTubeVideo)
      ↓
modules/mmke repositories       (the only place that actually writes Postgres rows)
      ↓
modules/publishing               (only touched if an already-published record's public-facing field changed)
```

The adapter is the **only** place `googleapis`/YouTube Data API v3 calls are made — this is what the audit flagged as entirely absent from the prototype (the "YouTube API Connector" toggle was decorative, and `test_invidious.ts`/`test_results.ts` were abandoned unofficial scraping experiments that this ADR explicitly rejects per brief §16 "Do NOT scrape YouTube").

---

## 11. Synchronization Engine Architecture

- **Trigger:** Vercel Cron (`api/cron/youtube-sync`) on a schedule (e.g., every 30–60 minutes, tuned to quota budget) *plus* a manual "Sync Now" Studio action that calls the exact same engine function (brief §23 — no second implementation).
- **Checkpointing:** a `SyncCheckpoint` table stores `resourceType`, `lastSyncedAt`, `pageToken`/cursor, so a run can resume rather than re-scan everything.
- **Change detection:** `YouTubeVideo`/`YouTubePlaylist` rows store the API's `etag` and a computed `contentHash` of the fields we care about; the sync engine compares hashes before writing, so unchanged resources are cheap no-ops (brief §22, "do not repeatedly rewrite unchanged data").
- **Idempotency:** every upsert is keyed by the stable `youtubeVideoId`/`youtubePlaylistId` (unique constraint), so re-running a sync is always safe (brief §22).
- **Quota management:** the adapter tracks estimated quota units spent per run and backs off before exceeding a configurable daily budget; failures use exponential backoff with a capped retry count, logged to `SyncJobRun`.
- **Sync history/dashboard (brief §23–24):** every run writes a `SyncJobRun` row (started/finished timestamps, counts of created/updated/conflicted/failed resources, error details) that the Studio "YouTube Sync" page renders directly — this *is* the dashboard, not a separate analytics system.
- **Deletion/unavailability:** a video missing from a subsequent `videos.list` call (or returned with a "private"/"deleted" status) flips `YouTubeVideo.availability`, which the field-ownership layer uses to decide whether to unpublish or flag the associated `Recording` for review — never a silent hard-delete.

---

## 12. Playlist Synchronization Architecture

`YouTubePlaylist` and `YouTubePlaylistItem` are independent tables, not an array on a video (this directly reverses the prototype's `Playlist.videoIds: string[]` pattern). Playlist item **position** is a real column, so reordering is detected as an update to existing rows rather than a diff of an opaque array. A `Collection` can optionally declare `backingPlaylistId`, letting the sync engine keep a public Collection's membership derived from a YouTube playlist while still allowing editorial Collections with no YouTube backing at all.

---

## 13. Field Ownership / Conflict Model

Each syncable field on `Recording` (title, description; extendable to more later) carries a `*Source` enum column:

- `YOUTUBE_SOURCE` (default for a freshly ingested field) — sync engine may overwrite freely.
- `EDITORIAL_OVERRIDE` — set automatically the moment an editor changes that field in Studio; sync engine **never** overwrites it. Instead it writes a `SyncConflict` row (`fieldName`, `youtubeValue`, `currentEditorialValue`, `detectedAt`, `resolvedAt`, `resolution`) and surfaces it in the Studio sync dashboard for a human decision (keep editorial / accept YouTube / merge manually).
- `SHARED` — reserved for fields both sides may legitimately want to influence, resolved by a simple last-write-wins-with-audit rule (documented per field if/when one is added).

This is a small, generic mechanism (one enum + one conflict table) rather than a bespoke rule per field, so extending it to thumbnails/visibility later is additive, not a rewrite.

---

## 14. Sheet Music Requests

- `SheetMusicRequest`: `id`, `requesterName`, `requesterEmail`, `musicalWorkId` (nullable FK), `recordingId` (nullable FK), `instrumentOrVoice`, `intendedUse`, `message`, `status` (`NEW | IN_REVIEW | FULFILLED | DECLINED`), `consentGivenAt`, timestamps.
- Public entry point: a "Request Sheet Music" action on any published Recording page, pre-filled with that page's Recording/Work/Composer context (brief §28) — a Server Action that validates and inserts, no client-exposed DB credentials.
- Studio queue: filterable list, and an **aggregation view** grouping open requests by `musicalWorkId` ("5 requests for this work" — brief §29/64) via a simple `GROUP BY` query, not a denormalized counter that can drift.
- Rights-aware by construction: fulfillment is a manual Studio action (attaching a `MediaResource` of role `SHEET_MUSIC` with its own `RightsInformation`); the system never auto-distributes anything.

---

## 15. Media & Storage

`MediaResource` is the one abstraction every entity attaches media through. For genuinely uploaded files (posters, programme PDFs, sheet-music scans) use **Vercel Blob** storage (native Vercel integration, simple signed-upload flow from Studio, no separate S3 account to manage at this scale) referenced by URL from `MediaResource`. YouTube-hosted media (video, thumbnails) are referenced by ID/URL only — never re-hosted, per brief §16/§26.

---

## 16. SEO / AEO / GEO Architecture

- Reuse and extend, rather than discard, the prototype's genuinely good `schemaStructuredData.ts` JSON-LD generators and `metadata.ts` per-entity metadata generator (both were well-built but orphaned — see audit §16) — they become the implementation of Next.js's `generateMetadata`/JSON-LD `<script>` output for each route in §8, now finally attached to real per-entity pages instead of dead code.
- All metadata (title, description, canonical, OpenGraph, JSON-LD) is produced **server-side** in `generateMetadata`/the page's server component — present in the initial HTML response, not injected by client `useEffect` (the exact defect the audit identified).
- Structured data types per entity: `MusicRecording`/`MusicEvent` (Recording/Performance), `MusicComposition` (MusicalWork), `Person`/`MusicGroup` (Composer/Artist/Choir/Conductor), `Place` (Venue), `CreativeWork`/`Article` (EditorialContent/LearningGuide), `BreadcrumbList` everywhere, `ItemList` for Collections — matching brief §34, no schema added merely to inflate a count.
- A per-record **Discoverability panel** in Studio (brief §37) renders: completeness status, generated meta preview, JSON-LD validity, computed internal links (from real MMKE relationships — brief §36), sitemap inclusion state — all derived live from the same publishing data the public page uses, not a separate "SEO score."
- Sitemap/robots are generated Route Handlers querying only `PUBLISHED` records (brief §35), regenerated on publish/unpublish via the same revalidation call as §9.

---

## 17. Background Jobs

Vercel Cron triggers Route Handlers for: YouTube sync (§11), and any batch sitemap/consistency checks. Longer-running work stays inside a single Route Handler invocation sized to Vercel's function timeout; if a future job genuinely can't fit (e.g., bulk media reprocessing), that's the one place this ADR would reconsider a separate worker — not before.

---

## 18. Audit Logging & Versioning

Every mutating repository method wraps its write in a helper that also inserts an `AuditLogEntry` (`actorId`, `action`, `entityType`, `entityId`, `beforeSnapshot`, `afterSnapshot` as JSON, `timestamp`) in the same transaction — mirroring the prototype's *intent* (`auditLogs` collection, immutability rule) but now actually populated by real mutations instead of only login/logout events. For entities where full history matters editorially (e.g., Recording), an optional `RecordingRevision` table snapshots the full payload at each Publish, giving cheap "what did this look like when it went live" recall without full event-sourcing complexity.

---

## 19. Testing Architecture

- **Unit** (Vitest): domain rules in `modules/mmke` (completeness, duplicate detection), field-ownership conflict resolution, SEO metadata generators — all pure functions, no DB/network needed.
- **Integration** (Vitest + a real Postgres test database, via Prisma against a disposable schema per test run): repositories, publishing lifecycle transitions, Sheet Music Request aggregation.
- **YouTube sync tests:** the adapter is mocked at its HTTP boundary (e.g., `msw`) with fixture responses for every scenario the brief lists (§70: title change, description change, new playlist, playlist item add/remove, video made private, video deleted, sync run twice, API fails halfway) — **no test ever calls the live YouTube API** (brief §48).
- **E2E** (Playwright): the golden paths — publish a recording and see it live at its public URL with correct meta/JSON-LD; submit a Sheet Music Request and see it in the Studio queue; an unauthorized user is blocked from a Studio route.
- CI runs typecheck → lint → unit → integration → build → (E2E on a preview deployment) before anything merges toward `main`.

---

## 20. Migration Strategy

1. **Content, not code, migrates.** The 35 real `VIDEOS_DATA` entries, 4 playlists, channel description, and equipment copy from the prototype are real content assets — write a one-time seed/import script (`scripts/migrate-prototype-content.ts`) that maps them into the new schema as `DRAFT` Recordings for editorial review, never directly to `PUBLISHED` (brief §56 — "do not blindly import prototype data if it is malformed").
2. **Firebase is not deleted.** `knowledgePacks`/`auditLogs` Firestore data (currently empty in practice per the audit, since no code path ever wrote to it — but this will be re-verified, not assumed, before touching anything) is exported/archived, not dropped, until the new system is validated (brief §58).
3. **URLs:** the prototype never had real per-entity URLs (only `?tab=` query strings), so there is no existing search-engine equity to preserve at the entity-page level. The one URL worth a redirect is the bare domain root, which naturally maps to the new home page — no redirect map needed.
4. Cutover only happens after the acceptance criteria (brief §69) are demonstrated on a staging deployment.

---

## 21. Deployment Architecture

- **Environments:** `development` (local, `.env.local`, Neon dev branch), `staging` (Vercel Preview deployments tied to PRs into the rebuild branch, Neon staging branch), `production` (Vercel Production, tied to `main` only *after* cutover approval).
- **Environment variables** (per environment): `DATABASE_URL`, `DIRECT_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `GOOGLE_CLIENT_ID`/`SECRET` (if Google sign-in enabled), `YOUTUBE_API_KEY` (or OAuth client credentials if channel-owner actions are needed beyond public data), `YOUTUBE_CHANNEL_ID`, `BLOB_READ_WRITE_TOKEN` (Vercel Blob), `CRON_SECRET` (to authenticate Vercel Cron calls to `api/cron/*`).
- Nothing deploys to Vercel Production from this rebuild branch automatically — Preview deployments only, until you explicitly approve promoting to Production (brief §59, §73).

---

## 22. Future Extension Points

- **New media provider** (Vimeo/Spotify/SoundCloud/Internet Archive): implement a new `modules/media/providers/*` adapter conforming to the same interface as the YouTube adapter; `MediaResource.provider` gains an enum value; no change to MMKE core.
- **Music Intelligence Engine:** consumes MMKE exclusively through `modules/mmke`'s exported query services (never raw Prisma), so it can be added as either more Server Actions or, later, a separate service behind an API boundary, without the core domain depending on any AI SDK.
- **New entity/page type:** add a Prisma model + migration, a repository, a route under `app/(museum)/`, a `generateMetadata` implementation, and a Studio catalogue screen — the pattern is uniform by design (brief §46).

---

## 23. Open Items Requiring Your Input

These are things I cannot resolve alone — either because they need an account/payment decision, or because they need Music-Madras-specific facts I don't have:

1. **Neon/Vercel Postgres account** — needs to be created by you (I can't create accounts or add payment methods on your behalf). Free tier is sufficient to start.
2. **YouTube Data API credentials** — do you already have a Google Cloud project / API key for `@MusicMadras`, or does one need to be created? An API key is sufficient for read-only public data (videos/playlists); if we ever need to act *as* the channel (e.g., reading unlisted content ownership signals), that needs OAuth instead.
3. **Auth approach for the first admin account** — once Studio exists, someone needs the first `Founder`-role account seeded directly via a migration/script (there's no public registration, per brief §39) — confirm the email to seed.
4. **Domain/DNS** — confirm `musicmadras.com` stays pointed at this Vercel project through the rebuild, or whether staging should live on a subdomain.
5. **Vercel Blob vs. an existing storage preference** — confirm Vercel Blob is acceptable for uploaded media, or if you'd rather keep using Firebase Storage for that piece specifically.

---

## Next Step

Per your instruction, I'm stopping here for a coherence check rather than starting Phase 1 implementation. Once you confirm this ADR holds together (or tell me what to change), I'll proceed in the order from your brief's §68 Build Order: Next.js project scaffold + Prisma schema + migrations first, then MMKE CRUD, then Studio, then YouTube sync, then Museum publishing, then SEO, then Sheet Music Requests, then migration, then testing/hardening — committing incrementally on this branch, never on `main`.
