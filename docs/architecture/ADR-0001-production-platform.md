# ADR-0001: Music Madras Production Platform Architecture

- **Status:** Proposed (Revision 2) — awaiting sign-off before Phase 1 implementation begins.
- **Branch:** `music-madras-production-rebuild` (created off `main`; `main` is untouched and remains the rollback point).
- **Supersedes:** The AI-Studio-era prototype audited separately (two competing MMKE models, in-memory Studio, no YouTube integration, no per-entity public pages — see prior audit report).
- **Input:** Approved decisions from the Master Engineering Brief (Next.js/App Router, PostgreSQL, Vercel, modular monolith, YouTube-as-adapter, field-ownership conflict model, Sheet Music Requests as MVP), refined per your Revision 2 review.

This document is deliberately concrete about *shape* (module boundaries, schema, request/response flow) and deliberately silent about code that hasn't been written yet. Nothing in this ADR should be read as "already built."

## Revision 2 Changelog

Nine substantive changes from Revision 1, each traced to your review comments:

1. **§2** — Next.js version is no longer pinned to "15" in this document; it now specifies "current stable production release at implementation time."
2. **§5 (new)** — the ambiguous `Recording` row + `draftPayload` JSON + "later reconciliation" design is replaced with an explicit, single-canonical-representation **Draft & Revision model** (copy-on-write revisions, no JSON shadow state).
3. **§16** — field ownership is generalized from a `Recording`-only mechanism into one generic table covering `YouTubeVideo`, `YouTubePlaylist`, and `YouTubePlaylistItem` as well.
4. **§16** — `SHARED` / "last-write-wins-with-audit" is removed entirely and replaced with `SHARED_REQUIRES_REVIEW`, which never auto-applies either side's value.
5. **§15 (new)** — a explicit `ObservabilityState` model (`OBSERVED / NOT_OBSERVED / PRIVATE / UNLISTED / UNAVAILABLE / DELETED / SYNC_ERROR`) replaces the old "missing from a listing ⇒ maybe unavailable" heuristic.
6. **§7** — full Studio account lifecycle documented: Founder seeding, invitations, activation, password reset, disablement, role changes, sessions, optional (non-mandatory) Google OAuth, no public registration.
7. **§10** — the publishing service now calls Next.js's revalidation functions **directly, in-process**; the standalone `/api/revalidate` HTTP endpoint is demoted to "build only if an external trigger genuinely needs it."
8. **§12 (new)** — an explicit `Scheduler/Trigger → Job → Service` layering, so Vercel Cron is swappable later without touching the sync engine.
9. **§13** — the reconciliation algorithm is now spelled out concretely (uploads-playlist enumeration, batched `videos.list`, paginated playlists/items, checkpointing, and explicit behaviour under partial failure/quota exhaustion/retries/duplicate runs).

Everything else from Revision 1 (framework choice, Postgres/Prisma, Vercel/Neon, modular monolith, adapter-not-domain-model for YouTube, Sheet Music Requests design, SEO approach, migration strategy) is unchanged and re-included below for a single coherent read.

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
| Framework | **Next.js, App Router — current stable production release at implementation time** | Not pinned to "15" in this document: whatever `create-next-app` resolves as the current stable (non-canary, non-RC) release when Phase 1 actually starts is what gets used, and that exact version is recorded in the Phase 1 implementation commit, not guessed here. One codebase serves both a crawlable, SSR/SSG/ISR public Museum and a dynamic, authenticated Studio via Route Handlers/Server Actions. First-party Vercel deployment. Server Components let domain/data-access code run server-side by default, which directly enforces "no DB calls in UI components" without extra tooling. |
| Language | **TypeScript, strict mode** | Required by brief §9; also the only realistic way to keep a ~25-entity relational domain model coherent across Museum, Studio, and sync engine. |
| Database | **PostgreSQL** | Composer↔Work↔Performance↔Recording↔Venue is a genuinely relational graph with integrity rules ("no orphan performances," referential composer/work links) that Firestore's flat-document model fights. Postgres gives real foreign keys, transactions, and migrations. |
| ORM / data access | **Prisma** | Type-safe queries matching strict TS, first-class migrations, works well with connection pooling on serverless (via the provider's own pooler — see §6.3), and keeps all DB access inside one `modules/db` layer rather than scattered through routes. |
| Hosting | **Vercel** | Continuity with current DNS/deployment, native Next.js support, cron/Route-Handler-based background jobs (§12), ISR/on-demand revalidation for the publish pipeline (§10). |
| Managed Postgres | **Neon (via the Vercel-Neon native integration)** — see §6.4 for the full evaluation | Serverless Postgres with connection pooling built in (critical for Vercel's ephemeral functions), branch-per-environment (a genuine Postgres branch per dev/staging/prod, not just separate databases), generous free tier, automatic backups on paid tiers, first-party Vercel env-var wiring. **No account will be created and no paid tier will be provisioned by me — this is a recommendation for you to action.** |
| Architecture style | **Modular monolith** | One Next.js app, one Postgres database, strict internal module boundaries (§3). No microservices, no message bus, no separate services unless a concrete need appears. |
| YouTube integration | **Adapter + Synchronization Engine**, not a core domain type | `Recording` never *is* a `YouTubeVideo`; it *has* a `MediaResource` that may reference one. Swapping/adding a provider (Vimeo, Spotify) later touches the adapter layer only. |
| Draft/revision model | **Copy-on-write `RecordingRevision` rows, no JSON shadow state** (§5) | Removes the Revision-1 ambiguity between a live row and a `draftPayload` blob — there is exactly one normalized representation of a Recording's content at any point in its history. |
| Field ownership | **One generic ownership/conflict mechanism across `Recording`, `YouTubeVideo`, `YouTubePlaylist`, `YouTubePlaylistItem`** (§16) | Avoids duplicating the same enum+conflict logic per entity type. |
| Auth | **Auth.js (NextAuth) v5, database sessions, Credentials + optional Google provider, backed by Postgres via the Prisma adapter; invite-only, no public registration** (§7) | Keeps auth data in the same relational database as everything else, allows immediate session invalidation on disable/role-change (needed for correct RBAC), and Google sign-in is available but never required. |

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
      studio/accept-invite/page.tsx        # token-based activation only; no /studio/register route exists
      studio/reset-password/page.tsx
      studio/dashboard/page.tsx
      studio/recordings/[id]/page.tsx      # 11-step editorial wizard, now editing a draft revision (§5)
      studio/catalogue/[entity]/page.tsx
      studio/youtube-sync/page.tsx         # sync dashboard + conflict/review queue (§16) + availability review (§15)
      studio/sheet-music-requests/page.tsx
      studio/users/page.tsx                # invite, role change, disable
      studio/settings/page.tsx
      studio/audit-log/page.tsx
    api/
      sheet-music-requests/route.ts        # public POST endpoint
      cron/youtube-sync/route.ts           # thin Scheduler→Job adapter (§12), authenticated via CRON_SECRET
      revalidate/route.ts                  # NOT part of the internal publish path — see §10; built only if/when
                                            # a genuinely external trigger needs it
  modules/                          # the actual domain code — framework-agnostic where possible
    mmke/                           # canonical domain model + business rules
      entities/                    # Composer, MusicalWork, Programme, Performance, Recording, ...
      relationships/
      completeness/                # catalogue-completeness rule engine (brief §13)
      duplicate-detection/
    drafts/                         # Draft & Revision lifecycle (§5) — revision creation, fork-on-publish, diffing
    db/                             # Prisma client, schema.prisma, migrations, repositories
      repositories/                # one repository per aggregate (ComposerRepository, RecordingRepository, ...)
    publishing/                     # draft → review → publish → revalidate lifecycle (§10)
    youtube/
      adapter/                     # thin wrapper over YouTube Data API v3 (typed DTOs in, DTOs out)
      sync-engine/                 # reconciliation logic (§13), no knowledge of Cron/HTTP/"jobs"
      ownership/                   # generic field-ownership + conflict model (§16), covers all synced resource types
      availability/                # ObservabilityState model + escalation rules (§15)
    media/                         # MediaResource abstraction over YouTube/Vimeo/Spotify/uploaded files
    sheet-music/                   # SheetMusicRequest domain + aggregation
    seo/                           # metadata + JSON-LD generators, consuming publishing data (not UI state)
    auth/                          # RBAC policy definitions, session helpers, invite/activation logic (§7)
    audit/                         # audit-log writer, used by every mutating repository call
    jobs/                          # Scheduler-agnostic job definitions (§12) — e.g. youtubeSyncJob.run()
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

**Boundary rule (unchanged):** `app/**` (routes/pages) may import from `modules/**` and `components/**`, but `modules/**` may never import from `app/**` or `components/**`. `modules/db` is the *only* place `prisma` is imported. `modules/youtube/sync-engine` may never import anything from `app/api/**` or reference Vercel Cron — it is called *by* `modules/jobs`, never the reverse (§12).

---

## 4. MMKE Domain Model

Reconciling the two incompatible models found in the audit (`src/mmke/types/entities.ts`'s normalized graph vs. `studio/types.ts`'s flat `RecordingDraft`) into **one** canonical model. Per §5, entities that go through a multi-step editorial wizard (currently: `Recording`) separate their **identity** from their **content**, so the identity row never itself holds ambiguous "is this draft or published" content — see §5 for exactly how.

**Core entities** (each gets: `id` (UUID), `slug` where public, `status` lifecycle, `createdAt`/`updatedAt`, `createdById`/`updatedById`, soft-delete via `archivedAt`):

- `Composer` — name, dates, era, biography, external references. Simple direct-edit lifecycle (create/edit/audit-log); does not need the revision system in §5 because it isn't authored through a multi-step wizard with autosave.
- `MusicalWork` — title, catalogue number, key, `composerId` (FK). Same simple lifecycle as Composer.
- `Programme` — title, notes, ordered `ProgrammeItem[]` (each item points to a `MusicalWork`, carries movement/encore/order) — a real table with real rows, not a nested JSON blob.
- `Performance` — `programmeId` (FK), `venueId` (FK), date, participants (via join tables below).
- `Recording` — the aggregate root edited by the 11-step wizard. Per §5 this table holds only **identity and pointers** (`id`, `slug`, `status`, `currentPublishedRevisionId`, `currentDraftRevisionId`, timestamps, audit fields) — no content fields live here directly.
- `RecordingRevision` — the actual canonical content (title, description, `performanceId`, media/works/participants links scoped to this revision) — see §5 for full definition.
- `Artist`, `Choir`, `Conductor`, `Organisation` — participant entities, linked to a `Performance` (and, transitively, to whichever `RecordingRevision` references that performance) via join tables (`PerformancePerformer`, `PerformanceChoir`, `PerformanceConductor`) rather than free-text strings.
- `Instrument` — linked to `Venue` (e.g., a pipe organ installation) and optionally to a `Performance`.
- `Venue` / `Church` — one `Venue` table with a `type` enum (`CHURCH | CATHEDRAL | CONCERT_HALL | STUDIO | OUTDOOR`).
- `Collection` — curated groupings of Recordings/Works (replaces the ad-hoc `Playlist` type; a `Collection` can optionally be *backed by* a `YouTubePlaylist` via the media layer).
- `EducationalContent` / `LearningGuide` — structured guide content with `associatedWorkIds`/`associatedRecordingIds`.
- `EditorialContent` — general articles/pages (the `/articles/[slug]` route type).
- `MediaResource` — polymorphic: `provider` (`YOUTUBE | UPLOAD | ...`), `providerResourceId`, `role` (`PRIMARY_VIDEO | THUMBNAIL | POSTER | PROGRAMME_PDF | SHEET_MUSIC | AUDIO_MASTER`), FK to whichever entity (or revision) it belongs to.
- `YouTubeVideo`, `YouTubePlaylist`, `YouTubePlaylistItem` — first-class tables, each with sync metadata (`etag`, `contentHash`, `observabilityState` — §15) and generic ownership rows attached (§16).
- `SheetMusicRequest` — see §17.
- `Source`, `Citation`, `RightsInformation` — attachable to any entity needing provenance via a generic `EntitySource(entityType, entityId, sourceId)` join.
- `AuditLogEntry` — append-only, written by the audit module (§20), never edited/deleted.

**Relationship rule** (carried over from the prototype's own `EDITORIAL.md`, which was correct in principle but unenforced): store the *forward* FK (e.g., `MusicalWork.composerId`) and derive reverse lists (`Composer.works`) via query — Postgres/Prisma relations do this natively.

**Catalogue completeness** (brief §13) is a pure function in `modules/mmke/completeness/` operating on a fully-loaded `RecordingRevision` (not the identity row), returning a structured report (`{ category: 'Sources', level: 'REQUIRED', status: 'MISSING' }[]`) — never a stored percentage. The Publish action refuses to proceed while any `REQUIRED` category is `MISSING`.

---

## 5. Draft, Revision & Publishing Lifecycle Model

*(New in Revision 2 — replaces the Revision-1 design of a live `Recording` row plus a `draftPayload` JSON column reconciled later, which you correctly flagged as two ambiguous representations of the same data.)*

### 5.1 What is canonical

**A `RecordingRevision` row (plus its scoped child rows — works, participants, media links, SEO fields, educational content) is the only canonical representation of a Recording's content, ever.** There is no second, JSON-shaped representation anywhere in the system. The `Recording` row itself holds no content — only identity and two pointers:

```
Recording {
  id
  slug
  status                    // DRAFT | IN_REVIEW | PUBLISHED | ARCHIVED (aggregate-level status)
  currentDraftRevisionId    // FK -> RecordingRevision, nullable once fully published with no open draft
  currentPublishedRevisionId // FK -> RecordingRevision, nullable until first publish
  createdAt / updatedAt / createdById / updatedById
}

RecordingRevision {
  id
  recordingId               // FK -> Recording
  revisionNumber             // monotonically increasing per Recording
  revisionStatus             // DRAFT | PUBLISHED | SUPERSEDED
  title, description, performanceId, seo fields, educational fields, ...
  // works / participants / media are their own tables scoped by revisionId,
  // e.g. RecordingRevisionWork(revisionId, musicalWorkId, order, catalogueNumberOverride, ...)
  createdAt / updatedAt / createdById / updatedById
}
```

### 5.2 What is draft state, and when normalization occurs

There is no deferred "normalization step." **Every autosave writes directly to the normalized `RecordingRevision` (and its scoped child rows) that `Recording.currentDraftRevisionId` currently points to.** The 11-step wizard's steps are simply different sub-forms editing different columns/child-rows of the same one draft revision. A debounced Server Action per field/step performs a partial `UPDATE`/`UPSERT` scoped to `currentDraftRevisionId` — there is nothing to "reconcile" later because the draft was never anything other than normalized rows.

- **Partial/incomplete records:** fields on a `DRAFT`-status revision are simply nullable/incomplete; the completeness checker (§4) reads the draft revision directly.
- **Multi-step wizard editing:** each step's Server Action updates only the columns/child-rows relevant to that step, scoped to `currentDraftRevisionId`.
- **Refresh/recovery:** because autosave lands in Postgres immediately, reloading the wizard (from any browser or device, by any authorized editor) re-fetches the current draft revision from the database — recovery is not a `localStorage` concern anymore, which also fixes the prototype's "drafts lost on refresh, invisible to other editors" defect.
- **Abandoned drafts:** a `DRAFT`-status revision with no update in N days is simply flagged by a Studio Dashboard query ("drafts awaiting attention") — no special lifecycle state needed, no cleanup job required for correctness (only optionally for housekeeping/reporting).

### 5.3 When a new draft revision is created

- The **first** edit of a brand-new Recording (e.g., from a YouTube ingestion draft or a manually created one) creates `RecordingRevision #1` with `revisionStatus: DRAFT`, and `Recording.currentDraftRevisionId` points to it.
- **On Publish** (§10): the current draft revision's `revisionStatus` flips to `PUBLISHED`; `Recording.currentPublishedRevisionId` is updated to point to it; `Recording.currentDraftRevisionId` is cleared (`null`) — there is now no open draft, and the published revision *is* the single source of truth for the public Museum.
- **On "Edit" of an already-published Recording:** a **new** `RecordingRevision` (e.g., `#2`) is created as a **copy** of the current published revision's content (copy-on-write fork), with `revisionStatus: DRAFT`, and `Recording.currentDraftRevisionId` points to it. The previously `PUBLISHED` revision's status becomes `SUPERSEDED` only once the new one is itself published — until then, the old `PUBLISHED` revision remains exactly as-is and continues to be what the public Museum serves, completely unaffected by in-progress edits to the new draft. This is what makes "editors can safely edit a live recording without the public seeing half-finished changes" true by construction, not by convention.

### 5.4 How conflicts are avoided

- **Single draft pointer per Recording:** `Recording.currentDraftRevisionId` is exactly one FK — there is structurally only one "current" draft at a time, never divergent parallel drafts for the same Recording.
- **Optimistic concurrency:** every save Server Action includes the `updatedAt` (or a `version` integer) the client last loaded; if it doesn't match the current value in the database, the save is rejected with an explicit "this recording was edited by someone else since you loaded it — reload to see the latest draft" error, rather than silently overwriting. This is a deliberately simple mechanism (no editorial locking/presence system) sufficient for the Studio's likely concurrency level; a live "who else is editing this" indicator is a plausible future enhancement, not required for MVP.

### 5.5 How a published version is represented, and version history

- The public Museum (§9) **only ever reads via `Recording.currentPublishedRevisionId`**. It never queries `RecordingRevision` rows directly by status — it always goes through the identity row's pointer, so there is one unambiguous definition of "what's live."
- Past `PUBLISHED` (now `SUPERSEDED`) revisions are **never deleted** — they remain queryable by `revisionNumber`, giving free "what did this look like when it went live on 2026-03-15" history (satisfying the original ADR's `RecordingRevision` versioning intent from §20, now without a redundant second table — the revision system itself *is* the version history).
- Every revision transition (`DRAFT → PUBLISHED`, `PUBLISHED → SUPERSEDED`) writes an `AuditLogEntry` (§20).

### 5.6 Scope of this pattern

This Draft & Revision pattern applies to `Recording` now, because it's the only entity currently authored through a multi-step wizard with autosave. It is deliberately generic enough (`{Entity}Revision` with the same `currentDraftRevisionId`/`currentPublishedRevisionId` pointer pattern) to extend to `EditorialContent`/`LearningGuide` later if/when those also need a draft-before-publish workflow (brief §46's extensibility requirement) — without redesigning the mechanism, only adding a new revision table following the same shape.

---

## 6. Database Architecture

### 6.1 Schema strategy
One Prisma schema, one Postgres database, environment-separated by **branch** (§6.4), not by separate hand-maintained databases. Migrations are Prisma Migrate files, committed to `prisma/migrations/`, applied via `prisma migrate deploy` in CI/CD before each deploy — never by hand-editing a live database.

### 6.2 Integrity
Every relationship is a real foreign key with an explicit `onDelete` policy (`RESTRICT` for things like Composer→Work to prevent orphaning, `SET NULL` where a soft-optional link like Recording→Performance makes sense). Unique constraints on `slug` per entity type. Composite uniqueness on join tables (e.g., `(performanceId, artistId)` on `PerformancePerformer`) to make duplicate-membership structurally impossible. `RecordingRevision(recordingId, revisionNumber)` is uniquely constrained.

### 6.3 Serverless connection handling
Vercel functions are ephemeral — naive Postgres connections exhaust the connection limit fast. Mitigation: use the managed provider's pooled connection string (PgBouncer-compatible) for the app's runtime `DATABASE_URL`, and a separate *direct* connection string (`DIRECT_URL`) for migrations, which Prisma supports natively.

### 6.4 Managed Postgres provider evaluation

| Provider | Reliability | Cost | Vercel integration | Backups | Dev/staging/prod separation | Notes |
|---|---|---|---|---|---|---|
| **Neon** (recommended) | Strong; used widely in production, backed by AWS | Generous free tier (0.5 GB, scales to zero when idle), pay-as-you-grow | **Native** Vercel integration — one click wires `DATABASE_URL`/`DIRECT_URL` into every Vercel environment | Point-in-time restore on paid plans | **Best-in-class**: true copy-on-write database *branches* — a "staging" branch is a real Postgres branch of production data/schema | Recommended primary choice |
| Supabase | Strong | Similar free tier, adds bundled Auth/Storage you won't use | Good, non-native (manual env vars) | Yes, on paid plans | Manual (separate projects per environment) | Fine alternative if you'd rather have one vendor dashboard for DB+storage later |
| Vercel Postgres (native product) | Now Neon-backed under the hood | Similar to Neon direct | Most seamless (first-party Vercel product) | Yes | Good | Essentially "Neon, wrapped by Vercel" |
| Railway | Good | Simple flat pricing, no free tier for Postgres anymore | Not native to Vercel (manual env vars) | Yes | Manual | Better fit if hosting were also on Railway |

**Recommendation unchanged from Revision 1:** Neon via the Vercel integration. **No account created, no database provisioned, no payment method added by me.**

---

## 7. Authentication, RBAC & Studio Account Lifecycle

*(Expanded in Revision 2 per your request — Studio remains invite-only; Google OAuth remains optional, never required.)*

- **Auth.js v5**, database-backed sessions (not pure JWT, so a disable/role-change takes effect immediately server-side rather than waiting for a token to expire), Credentials provider (email + password, hashed with argon2) as the default, with an **optional** Google OAuth provider — both backed by the same Postgres `StudioUser`/`Session`/`Account` tables via the Prisma adapter.
- Roles: `Founder | Super Administrator | Administrator | Editor | Reviewer | Contributor`, stored as a real Postgres enum column on `StudioUser`, never inferred from an email string.

**Lifecycle:**

1. **First Founder account.** No public registration exists anywhere in the app (there is no `/studio/register` route). The first `Founder`-role `StudioUser` is created by a one-time, server-side seed script run during deployment setup, using an email address you confirm (§Open Items) and either a securely generated temporary password communicated out-of-band, or a first-login "set your password" token — never a value committed to the repository.
2. **Invitation.** An existing `Founder`/`Super Administrator`/`Administrator` creates an `Invitation` row (`email`, `role`, `invitedById`, hashed single-use `token`, `expiresAt`) from Studio's Users screen. A transactional email (provider TBD — see §Open Items; e.g., Resend or Postmark) is sent with an activation link. **No account is usable before this step** — an invitation is the only path to a new Studio account.
3. **Activation.** The invitee visits `/studio/accept-invite?token=...`, sets a password (or links Google OAuth using the *same* invited email address), which flips `StudioUser.status` from `INVITED` to `ACTIVE` with the role fixed at whatever the inviter assigned.
4. **Password reset/recovery.** Standard token-based flow: a `PasswordResetToken` (short expiry, single-use, hashed at rest) emailed only to the account's registered address. No security questions, no SMS fallback for MVP.
5. **Account disablement.** A `Founder`/`Super Administrator`/`Administrator` sets `StudioUser.status = DISABLED`. Because sessions are database-backed, disabling immediately revokes every active session for that user on their next request — not just blocking future logins.
6. **Role assignment/changes.** Restricted to `Founder`/`Super Administrator`/`Administrator` (matching the existing permissions matrix). Every invite, activation, disablement, and role change writes an `AuditLogEntry` (`actorId`, `targetUserId`, `previousRole`, `newRole` or `previousStatus`/`newStatus`).
7. **Session handling.** Server Actions/Route Handlers re-check the current role from the database session on every mutating request (§ below) rather than trusting a cached client-side value — this is what makes an immediate disable/role-change actually take effect.
8. **Optional Google OAuth.** Sign-in via Google is available **only** for an email that already has an `ACTIVE` or `INVITED` `StudioUser` row — it is a second authentication method for an account that must already exist via the invitation flow, never a way to self-register. It is offered because some editors may prefer it, not because it's required.
9. **Authorization, not just authentication.** Every Server Action / Route Handler that mutates data calls a `can(user, action, resource)` check from `modules/auth/policy.ts` before touching the repository layer. Hiding a button in Studio's UI for a lower-privileged role is a UX nicety; the actual gate is always server-side (brief §39).

---

## 8. Studio (Admin) Architecture

- Fully server-rendered where possible (Server Components for read views), Server Actions for mutations (create/update/publish/archive/invite/disable), avoiding a large client-side API surface.
- The 11-step editorial wizard's *intent* is preserved (Recording → Programme → Works → Venue → Participants → Educational → Media → SEO → Relationships → Review → Publish); each step now edits the current `RecordingRevision` directly (§5) — no `localStorage`-only autosave, no JSON draft blob, no reconciliation step.
- Entity pickers (Composer/Work/Venue/Choir/Conductor) are real typeahead search against the Postgres tables (`pg_trgm`), with an explicit "create new" affordance that runs the duplicate-detection module first (brief §42).
- Global search (brief §41) is a Postgres full-text/trigram query across the canonical tables, structured behind a search-service interface so a future semantic/vector layer can be added without touching callers.
- The YouTube Sync screen (§13) doubles as the review queue for both **field conflicts** (§16) and **availability escalations** (§15) — one screen, two clearly labeled sections, not two separate dashboards.

---

## 9. Museum (Public) Architecture

| Route type | Strategy | Why |
|---|---|---|
| Home, category indexes | **ISR** (revalidate on a short interval + on-demand) | Changes moderately often, benefits from being served instantly from cache |
| `/composers/[slug]`, `/works/[slug]`, `/venues/[slug]`, `/artists/[slug]` | **SSG at build + on-demand ISR revalidation** triggered by publish/unpublish | These change only when an editor publishes something |
| `/recordings/[slug]`, `/performances/[slug]`, `/programmes/[slug]` | **SSG + on-demand ISR**, same trigger, reading only `currentPublishedRevisionId` (§5.5) | This is also where Sheet Music Request UI and structured data live |
| `/collections/[slug]`, `/learning/[slug]`, `/articles/[slug]` | **SSG + on-demand ISR** | Same pattern |
| Sitemap / robots | **Route Handlers regenerated on publish/unpublish**, not static files | Must reflect only published, non-private content (brief §35) |

Every public page is server-rendered HTML on first response — no per-tab client-side SPA state, no query-string-addressed "pages" like the prototype's `?tab=Concert`.

---

## 10. Publishing & Revalidation Architecture

*(Revised in Revision 2 — the internal HTTP revalidation hop is removed; direct in-process invocation is used instead.)*

Lifecycle (brief §14): `DRAFT → ENRICHMENT → EDITORIAL_REVIEW → APPROVED → PUBLISHED → (UPDATED) → ARCHIVED`, implemented as the `Recording`/`RecordingRevision` transitions in §5.

- Publishing is a single `modules/publishing` service function, always invoked **in-process** from either a Studio Server Action ("Publish" button) or the sync engine's Route Handler (§13, if an already-published record's public-facing field legitimately needs to trigger a page refresh). It: validates completeness (§4), performs the revision transition + writes an audit entry inside one DB transaction, then calls Next.js's `revalidatePath`/`revalidateTag` **directly as a function call** — not over HTTP — because both call sites already execute inside the same Next.js server process.
- The standalone `app/api/revalidate/route.ts` endpoint from Revision 1 is **not part of this internal path**. It is deliberately not built in Phase 1, and is only introduced later if a genuinely external caller needs to trigger revalidation — e.g., a future separate admin tool, or a third-party webhook outside this Next.js deployment. If/when that need arises, it stays a thin, separately-authenticated wrapper that calls the same `modules/publishing` function — it does not become a second implementation of the publish logic.
- YouTube-ingested drafts are **never** auto-published — ingestion only creates/updates a `DRAFT`-status `Recording`/`RecordingRevision`; a human must move it through review.
- AI-generated content (future, brief §65) is written with a `contentOrigin: AI_GENERATED` flag and is excluded from auto-publish by the same rule.

---

## 11. YouTube Integration Architecture

```
YouTube Data API v3
      ↓
modules/youtube/adapter          (typed fetch wrappers: channels.list, playlists.list, playlistItems.list,
                                   videos.list — all through a quota-aware, retrying HTTP client; returns DTOs,
                                   never raw API JSON, to the rest of the app)
      ↓
modules/youtube/sync-engine      (reconciliation orchestration — §13; has no knowledge of Cron/HTTP/"jobs")
      ↓
modules/youtube/availability     (ObservabilityState resolution — §15)
      ↓
modules/youtube/ownership        (per-field merge/conflict decision before any write — §16)
      ↓
modules/mmke repositories        (the only place that actually writes Postgres rows)
      ↓
modules/publishing                (only invoked if an already-published record's public-facing field changed)
```

The adapter is the **only** place YouTube Data API v3 calls are made — no scraping, matching brief §16/§27 and directly rejecting the prototype's abandoned `test_invidious.ts`/`test_results.ts` experiments.

---

## 12. Background Job & Scheduler Architecture

*(New in Revision 2 — decouples the synchronization engine from Vercel Cron specifically.)*

```
Scheduler / Trigger   (Vercel Cron initially — fires an authenticated HTTP request on a schedule)
      ↓
Job                    (modules/jobs/definitions/youtubeSyncJob.ts — run-level locking, SyncJobRun
                        bookkeeping, timeout guard, error capture; knows nothing about the domain logic itself)
      ↓
Service                 (modules/youtube/sync-engine — pure reconciliation logic; knows nothing about
                         Cron, HTTP, or "jobs" as a concept)
```

- `app/api/cron/youtube-sync/route.ts` is a thin adapter: authenticate the incoming Cron request via `CRON_SECRET`, then call `youtubeSyncJob.run()`.
- Studio's "Sync Now" Server Action calls **the same** `youtubeSyncJob.run()` function directly, in-process — satisfying "manual sync must use the same engine as scheduled sync" (brief §23) by construction, since there is only one job function to call.
- `youtubeSyncJob.run()` acquires a run-level lock (a unique partial index / Postgres advisory lock keyed by job name) before calling into `modules/youtube/sync-engine`, so a Cron-triggered run and a manually-triggered run can never execute concurrently (this is also the mechanism that makes duplicate/overlapping runs safe — see §13).
- Replacing Vercel Cron later (e.g., with a dedicated queue/worker) only means writing a new Scheduler/Trigger adapter that calls the existing `youtubeSyncJob.run()` — `modules/jobs` and `modules/youtube/sync-engine` do not change.

---

## 13. Synchronization Engine Architecture

*(The reconciliation algorithm is now specified concretely, per your request — Revision 1 only asserted properties like "idempotent" without describing the actual API call sequence.)*

### 13.1 Reconciliation sequence, per run

1. **Channel uploads enumeration:** call `channels.list(part=contentDetails)` once to obtain the channel's `relatedPlaylists.uploads` playlist ID (cheap, cached — this rarely changes), then paginate `playlistItems.list` on that uploads playlist to enumerate all video IDs the channel has ever published. This is the quota-efficient way to discover uploads (far cheaper than `search.list`).
2. **Video metadata:** batch `videos.list(id=...)` calls (up to 50 IDs per call) with `part=snippet,contentDetails,status` for every known + newly discovered video ID.
3. **Playlists:** paginate `playlists.list(channelId=...)` to enumerate all playlists owned by the channel.
4. **Playlist items:** for each known playlist, paginate `playlistItems.list(playlistId=...)`, capturing each item's `position` explicitly.
5. **Diffing:** for each resource type, the full set of IDs observed in a **complete, error-free** pass for that resource is compared against the previously known set in Postgres:
   - New ID → create row (`ObservabilityState: OBSERVED` — §15).
   - Existing ID with a changed `etag`/computed `contentHash` → update, run through ownership resolution (§16) before writing any editorially-relevant field.
   - Existing ID not observed in this pass → **not** treated as deleted; goes through the `NOT_OBSERVED` escalation rule in §15.
   - Playlist item `position` changes on an existing `(playlistId, videoId)` pair → treated as an update to that row, never a delete+recreate (this is what makes reordering detectable, per brief §20).

### 13.2 Checkpointing

A `SyncCheckpoint` row per `(resourceType, parentId)` (e.g., one per playlist being paged through) stores the current `pageToken` and `lastFullCompletionAt`. If a run is interrupted mid-pagination, the next run resumes from the saved page token rather than restarting from page one. A run's overall `SyncJobRun.completeness` is recorded as `FULL` only if every resource type's pagination completed without error in that run; otherwise `PARTIAL` or `FAILED`. **`NOT_OBSERVED` escalation (§15) only ever counts evidence from `FULL` runs** — a `PARTIAL`/`FAILED` run contributes no deletion-relevant evidence at all.

### 13.3 Safety properties

- **Partial failures / network errors:** a failing API call stops that resource type's pagination for the run, is recorded on `SyncJobRun`, and the checkpoint is preserved for the next run to resume — never interpreted as "the missing items were deleted."
- **Quota exhaustion:** the adapter tracks estimated quota units spent per run against a configurable daily budget and stops cleanly (not mid-write) before exceeding it; the partial run is marked `PARTIAL` per §13.2.
- **Retries:** individual failed API calls retry with exponential backoff up to a capped attempt count; a run does not infinitely retry as a whole.
- **Interrupted jobs:** the run-level lock (§12) plus per-resource checkpointing (§13.2) together mean an interrupted job leaves the system in a consistent, resumable state — no half-applied resource is left ambiguous, because every write is a single-row upsert keyed by a stable external ID.
- **Duplicate runs:** the same run-level lock (§12) prevents two reconciliation passes from executing concurrently; even without the lock, every upsert is idempotent by construction (keyed by `youtubeVideoId`/`youtubePlaylistId`/`(playlistId, videoId)`), so a duplicate run is a safe no-op for anything unchanged.
- **Official API only:** every call in §13.1 is a documented YouTube Data API v3 endpoint. No HTML scraping, no unofficial third-party proxies (explicitly rejecting the prototype's abandoned `test_invidious.ts`/`test_results.ts` approach).

### 13.4 Sync history / dashboard

Every run writes one `SyncJobRun` row (`startedAt`, `finishedAt`, `completeness`, counts of created/updated/flagged/failed resources per type, error details) that Studio's YouTube Sync screen renders directly (brief §23–24) — this **is** the dashboard, not a separate analytics system.

---

## 14. Playlist Synchronization Architecture

`YouTubePlaylist` and `YouTubePlaylistItem` are independent tables, not an array on a video. Playlist item **position** is a real column, so reordering is detected as an update to existing rows (§13.1) rather than a diff of an opaque array. A `Collection` can optionally declare `backingPlaylistId`, letting the sync engine keep a public Collection's membership derived from a YouTube playlist while still allowing editorial Collections with no YouTube backing at all.

---

## 15. Resource Observability & Availability State Model

*(New in Revision 2 — replaces the Revision-1 heuristic of "missing from a listing may mean unavailable.")*

Every synced external resource (`YouTubeVideo`, `YouTubePlaylist`, `YouTubePlaylistItem`) carries an explicit `observabilityState`:

| State | Meaning | Set when |
|---|---|---|
| `OBSERVED` | Seen, accessible, normal | Present with a normal status in the most recent `FULL` reconciliation pass |
| `NOT_OBSERVED` | Not seen in the most recent pass — **provisional, non-destructive** | Absent from a `FULL` pass; does **not** by itself change publish state |
| `PRIVATE` | Exists, but visibility explicitly reported as private | API explicitly returns a private status for a known ID |
| `UNLISTED` | Exists, visibility explicitly reported as unlisted | API explicitly returns an unlisted status |
| `UNAVAILABLE` | API explicitly reports the resource as removed/blocked/terminated | A direct, definitive error/status response for a known ID — not inferred from absence |
| `DELETED` | High-confidence, corroborated absence | Only after **N consecutive `FULL` reconciliation passes** (default: 3) record `NOT_OBSERVED` for this ID, **or** a direct confirming lookup for that specific ID returns a definitive not-found response |
| `SYNC_ERROR` | This specific resource's status could not be determined this run | The run itself failed/was partial for this resource — never allowed to contribute toward a `DELETED`/`UNAVAILABLE` conclusion |

**Escalation rule:** `NOT_OBSERVED` only accumulates from `FULL`-completeness runs (§13.2). A `PARTIAL`/`FAILED` run neither increments nor resets the `NOT_OBSERVED` counter — it simply contributes no evidence either way, so a flaky run can never accidentally push a resource toward `DELETED`.

**Editorial consequence policy:** reaching `DELETED` or `UNAVAILABLE` on a `YouTubeVideo` linked to a `PUBLISHED` Recording **never auto-unpublishes it.** It creates a high-priority item in the Studio Sync/Review screen (§8) for a human to decide: unpublish, keep as an archival record with a "no longer available on YouTube" notice, or mark as a false positive pending further investigation. `PRIVATE`/`UNLISTED` are lower-urgency informational flags in the same screen, since the resource still exists.

---

## 16. Field Ownership & Conflict Resolution Model

*(Generalized in Revision 2 to cover all synced resource types via one mechanism, and "last-write-wins" is removed entirely per your instruction.)*

### 16.1 One generic mechanism, not one per entity

Rather than a `titleSource`/`descriptionSource` column pair duplicated across `Recording`, `YouTubeVideo`, `YouTubePlaylist`, and `YouTubePlaylistItem`, ownership is tracked in one generic table:

```
FieldOwnership {
  id
  resourceType     // RECORDING | YOUTUBE_VIDEO | YOUTUBE_PLAYLIST | YOUTUBE_PLAYLIST_ITEM
  resourceId
  fieldName        // e.g. 'title', 'description', 'thumbnailUrl', 'visibilityStatus', 'position'
  ownership        // YOUTUBE_SOURCE | MUSIC_MADRAS_EDITORIAL | EDITORIAL_OVERRIDE | SHARED_REQUIRES_REVIEW
  lastExternalValue
  lastEditorialValue
  lastSyncedAt
}

SyncConflict {
  id
  resourceType
  resourceId
  fieldName
  previousEditorialValue
  newExternalValue
  detectedAt
  status            // OPEN | RESOLVED
  resolution        // KEPT_EDITORIAL | ACCEPTED_EXTERNAL | MANUAL_MERGE
  resolvedById
  resolvedAt
}
```

This covers, at minimum:

- **`YouTubeVideo`:** `title`, `description`, `thumbnailUrl`, `visibilityStatus`, and any other synchronized metadata field.
- **`YouTubePlaylist`:** `title`, `description`, `visibilityStatus`, `thumbnailUrl` where applicable.
- **`YouTubePlaylistItem`:** `position` (ordering). Pure membership (an item added to or removed from a playlist) is handled as a row create/delete by the reconciliation diff in §13.1, not as a "field" — ownership/conflict semantics apply to mutable field *values* on an existing row, not to whether the row exists at all.
- **`Recording`:** `title`, `description` (the fields most likely to originate from an ingested `YouTubeVideo` and then be edited editorially).

### 16.2 Ownership states and their behaviour — no silent last-write-wins

- **`YOUTUBE_SOURCE`** (default for a freshly ingested field): the sync engine may overwrite this field's value freely on each successful sync, because no editorial input has ever been recorded against it.
- **`MUSIC_MADRAS_EDITORIAL`**: the field is intrinsically editorial-only (has no YouTube-sourced counterpart at all, e.g. `analysisMarkdown`) — the sync engine never reads or writes it, and no `FieldOwnership` row is even needed for such fields.
- **`EDITORIAL_OVERRIDE`**: set automatically the instant an editor changes a field that started as `YOUTUBE_SOURCE`. From that point on, the sync engine **never** overwrites the value. If it detects a different external value on a later sync, it writes a `SyncConflict` row (`status: OPEN`) and leaves the current editorial value completely untouched.
- **`SHARED_REQUIRES_REVIEW`** *(replaces the Revision-1 "SHARED / last-write-wins-with-audit")*: for fields where neither side is unconditionally authoritative. **Any** detected external change to such a field — in either direction — always creates a `SyncConflict` (`status: OPEN`) and **never auto-applies a value from either side.** There is no automatic resolution path for this state; it always requires a human decision.

### 16.3 Conflict resolution workflow

When a `SyncConflict` is created (from `EDITORIAL_OVERRIDE` detecting drift, or from any `SHARED_REQUIRES_REVIEW` field changing):

1. The current editorial value is preserved exactly as-is — no write happens automatically.
2. The new external value, detection timestamp, and the previous editorial value are all recorded on the `SyncConflict` row.
3. The conflict appears in Studio's Sync/Review screen (§8), grouped by Recording/resource, for an authorized editor (`Editor` role or above).
4. The editor resolves it explicitly: **keep editorial** (closes the conflict, no data change), **accept external** (writes the new value, flips `FieldOwnership.ownership` back to `YOUTUBE_SOURCE` if appropriate), or **manual merge** (editor types a new value directly, which itself becomes a fresh `EDITORIAL_OVERRIDE`).
5. Every resolution writes an `AuditLogEntry` (`actorId`, `resourceType`, `resourceId`, `fieldName`, `resolution`) — resolutions are never silent.

This is a small, generic mechanism (one enum + one ownership table + one conflict table) rather than a bespoke rule per field or per entity, so extending coverage to a new field (e.g., a future `thumbnailUrl` override) is additive — a new `FieldOwnership` row shape, not new code paths.

---

## 17. Sheet Music Requests

- `SheetMusicRequest`: `id`, `requesterName`, `requesterEmail`, `musicalWorkId` (nullable FK), `recordingId` (nullable FK, resolved via the Recording's `currentPublishedRevisionId`), `instrumentOrVoice`, `intendedUse`, `message`, `status` (`NEW | IN_REVIEW | FULFILLED | DECLINED`), `consentGivenAt`, timestamps.
- Public entry point: a "Request Sheet Music" action on any published Recording page, pre-filled with that page's Recording/Work/Composer context — a Server Action that validates and inserts, no client-exposed DB credentials.
- Studio queue: filterable list, and an **aggregation view** grouping open requests by `musicalWorkId` ("5 requests for this work") via a `GROUP BY` query, not a denormalized counter that can drift.
- Rights-aware by construction: fulfillment is a manual Studio action (attaching a `MediaResource` of role `SHEET_MUSIC` with its own `RightsInformation`); the system never auto-distributes anything.

---

## 18. Media & Storage

`MediaResource` is the one abstraction every entity (or revision — §5) attaches media through. For genuinely uploaded files (posters, programme PDFs, sheet-music scans) use **Vercel Blob** storage (native Vercel integration, simple signed-upload flow from Studio) referenced by URL from `MediaResource`. YouTube-hosted media (video, thumbnails) are referenced by ID/URL only — never re-hosted.

---

## 19. SEO / AEO / GEO Architecture

- Reuse and extend the prototype's `schemaStructuredData.ts` JSON-LD generators and `metadata.ts` per-entity metadata generator (both well-built but orphaned in the audit) as the implementation of Next.js's `generateMetadata`/JSON-LD output for each route in §9, now finally attached to real per-entity pages reading from `currentPublishedRevisionId` (§5.5).
- All metadata is produced **server-side**, present in the initial HTML response — never injected by client `useEffect`.
- Structured data types per entity: `MusicRecording`/`MusicEvent` (Recording/Performance), `MusicComposition` (MusicalWork), `Person`/`MusicGroup` (Composer/Artist/Choir/Conductor), `Place` (Venue), `CreativeWork`/`Article` (EditorialContent/LearningGuide), `BreadcrumbList` everywhere, `ItemList` for Collections.
- A per-record **Discoverability panel** in Studio renders completeness status, generated meta preview, JSON-LD validity, computed internal links, and sitemap inclusion state — all derived live, not a separate "SEO score."
- Sitemap/robots are Route Handlers querying only Recordings where `currentPublishedRevisionId` is set (i.e., actually published), regenerated on publish/unpublish via the same in-process publishing call as §10.

---

## 20. Audit Logging & Versioning

Every mutating repository method wraps its write in a helper that also inserts an `AuditLogEntry` (`actorId`, `action`, `entityType`, `entityId`, `beforeSnapshot`, `afterSnapshot` as JSON, `timestamp`) in the same transaction. Full content history for `Recording` is provided by the revision chain itself (§5.5) rather than a separate snapshot table — this removes a redundancy that would otherwise exist between "audit log" and "revision history." Account lifecycle events (§7) and sync-conflict resolutions (§16.3) are audited through this same mechanism, not a parallel one.

---

## 21. Testing Architecture

- **Unit** (Vitest): domain rules in `modules/mmke` (completeness, duplicate detection), the ownership/conflict decision logic (§16), the `ObservabilityState` escalation rules (§15), SEO metadata generators — all pure functions, no DB/network needed.
- **Integration** (Vitest + a real Postgres test database via Prisma, disposable schema per run): repositories, the full draft→publish→re-edit→re-publish revision lifecycle (§5), Sheet Music Request aggregation, invite/activation/disable flows (§7).
- **YouTube sync tests:** the adapter is mocked at its HTTP boundary (e.g., `msw`) with fixture responses covering: title/description/thumbnail change, new/updated/deleted playlist, playlist item add/remove/reorder, video made private/unlisted/deleted, a sync run interrupted mid-pagination then resumed, quota-exhaustion mid-run, two runs triggered concurrently (lock contention), and a field in `EDITORIAL_OVERRIDE` drifting externally (must produce a conflict, never a silent overwrite). **No test ever calls the live YouTube API.**
- **E2E** (Playwright): publish a recording and see it live at its public URL with correct meta/JSON-LD; edit an already-published recording and confirm the public page is unaffected until the new revision is itself published; submit a Sheet Music Request and see it in the Studio queue; an invited-but-not-yet-activated account cannot sign in; a disabled account's active session is rejected on its next request; an unauthorized role is blocked from a Studio route server-side even if a client somehow rendered the button.
- CI runs typecheck → lint → unit → integration → build → (E2E on a preview deployment) before anything merges toward `main`.

---

## 22. Migration Strategy

1. **Content, not code, migrates.** The 35 real `VIDEOS_DATA` entries, 4 playlists, channel description, and equipment copy from the prototype are real content assets — a one-time seed/import script (`scripts/migrate-prototype-content.ts`) maps them into the new schema as `DRAFT`-revision Recordings for editorial review, never directly to `PUBLISHED`.
2. **Firebase is not deleted.** `knowledgePacks`/`auditLogs` Firestore data (found to be empty in practice during the audit, since no prototype code path ever wrote to it — this will be re-verified, not assumed, before touching anything) is exported/archived, not dropped, until the new system is validated.
3. **URLs:** the prototype never had real per-entity URLs (only `?tab=` query strings), so there is no existing search-engine equity to preserve at the entity-page level beyond the bare domain root, which naturally maps to the new home page.
4. Cutover only happens after the acceptance criteria (brief §69) are demonstrated on a staging deployment.

---

## 23. Deployment Architecture

- **Environments:** `development` (local, `.env.local`, Neon dev branch), `staging` (Vercel Preview deployments tied to PRs into the rebuild branch, Neon staging branch), `production` (Vercel Production, tied to `main` only *after* cutover approval).
- **Environment variables** (per environment): `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `AUTH_URL`, `GOOGLE_CLIENT_ID`/`SECRET` (only if Google sign-in is enabled), `YOUTUBE_API_KEY`, `YOUTUBE_CHANNEL_ID`, `BLOB_READ_WRITE_TOKEN`, `CRON_SECRET` (authenticates Vercel Cron calls to `api/cron/*` per §12), transactional-email provider credentials (§7, provider TBD).
- Nothing deploys to Vercel Production from this rebuild branch automatically — Preview deployments only, until you explicitly approve promoting to Production.

---

## 24. Future Extension Points

- **New media provider** (Vimeo/Spotify/SoundCloud/Internet Archive): a new `modules/media/providers/*` adapter conforming to the same interface as the YouTube adapter; `MediaResource.provider` gains an enum value; no change to MMKE core.
- **New scheduler:** replacing Vercel Cron only requires a new Scheduler/Trigger adapter calling the existing `modules/jobs` functions (§12) — the sync engine is untouched.
- **Music Intelligence Engine:** consumes MMKE exclusively through `modules/mmke`'s exported query services (never raw Prisma), so it can be added as more Server Actions or, later, a separate service behind an API boundary, without the core domain depending on any AI SDK.
- **New entity/page type:** add a Prisma model + migration, a repository, a route under `app/(museum)/`, a `generateMetadata` implementation, and a Studio catalogue screen — and, if it needs draft/publish semantics, a `{Entity}Revision` table following the exact pattern in §5.

---

## 25. Open Items Requiring Your Input

1. **Neon/Vercel Postgres account** — needs to be created by you. Free tier is sufficient to start.
2. **YouTube Data API credentials** — confirm whether a Google Cloud project/API key for `@MusicMadras` already exists, or needs creating. A read-only API key covers public video/playlist data; OAuth is only needed if we must act *as* the channel.
3. **First Founder account email** — confirm the email address to seed as the first Studio account (§7.1).
4. **Transactional email provider** for invitations/password resets (§7) — no default has been chosen yet (candidates: Resend, Postmark, SES). Any preference, or should I recommend one during Phase 1?
5. **Domain/DNS** — confirm `musicmadras.com` stays pointed at this Vercel project through the rebuild, or whether staging should live on a subdomain.
6. **Vercel Blob vs. an existing storage preference** — confirm Vercel Blob is acceptable for uploaded media, or if you'd rather keep using Firebase Storage for that piece specifically.

---

## Next Step

Per your instruction, I'm stopping here again for review rather than starting Phase 1. No external accounts, credentials, databases, or infrastructure have been created. `main` has not been modified. Once you approve this revision, I'll proceed in the order from your brief's §68 Build Order, committing incrementally on this branch only.
