# Phase 6H-1 — Content Intelligence Architecture & Inventory

Status: **architecture and inventory only. No Content Intelligence code exists yet.**
This document records what was found in the repository as of this phase and proposes
a future architecture. Nothing described here as "future" or "proposed" has been built.

## 1. Purpose

Music Madras is a cultural archive, not a content farm. The goal of a future Content
Intelligence (CI) layer is to help the Studio editorial team turn structured archive
facts into discoverable, educational public content — not to auto-generate articles
from a video title.

Governing hierarchy (restated from the phase brief, and confirmed consistent with
everything found in the repository):

```
TRUTH → STRUCTURE → CONTEXT → INTELLIGENCE → EDITORIAL JUDGMENT → PUBLICATION
```

AI assists the archive. AI does not become the archive.

## 2. Architectural position

Current, verified pipeline (Steps 1–5 of the investigation; see §3–§4 for the ground
truth behind each arrow):

```
YouTube Data API
  → modules/youtube/adapter          (read-only API wrapper)
  → modules/youtube/sync-engine      (runYouTubeSync — writes YouTubeVideo/
                                       YouTubePlaylist/YouTubePlaylistItem only)
  → [NOT CONNECTED: no cron, no Studio "Sync Now" button, no operator script]
  → manual Studio action (Path A): attachMediaToRevision → MediaResource
                                    → RecordingRevision → Recording
  → manual Studio action (Path B): createDraftVideoPage → YouTubeVideoPage
  → MMKE canonical entities (Composer/Work/Programme/Performance/Recording/
    Artist/Choir/Conductor/Venue/Organisation/Collection/LearningGuide)
  → public Museum pages (16 routes, app/(museum)/**)
  → sitemap / SEO metadata / JSON-LD
  → GA4 analytics (Phase 6G-18, page views + entity views, no feedback loop yet)
```

Proposed future position for Content Intelligence (not built):

```
SOURCE LAYER            MMKE repositories, synced YouTube tables, Source/Citation/
                         RightsInformation, existing editorial prose fields
        ↓
CONTENT CONTEXT          A new, Prisma-free assembler module (modules/mmke/contentIntelligence/**,
ASSEMBLER                following the existing assemble*PageData pattern) that gathers
                         Tier 1–4 input for one target entity, calling the SAME per-entity
                         repository functions already used by public pages — never a new
                         traversal mechanism, never resolveRelatedContent (see §11).
        ↓
CONTENT INTELLIGENCE     (Future, out of process — an LLM call. Not built. No provider
                         chosen. See §16.)
        ↓
DRAFT / SUGGESTION       A new model, tentatively "ContentSuggestion" (see §15). Does not
                         exist today. Never writes into a canonical or editorial field
                         directly.
        ↓
EDITORIAL REVIEW         Future Studio UI, mapped onto existing RBAC (§8).
        ↓
APPROVAL                 A human write into the real editorial field (e.g.
                         RecordingRevision.description, LearningGuide.contentMarkdown),
                         audited via the existing generic AuditLogEntry — no schema
                         change needed for auditing (see §6, §15).
        ↓
PUBLIC MUSEUM            Existing publish/unpublish toggle per entity type. Unchanged.
```

## 3. Current Content Intelligence inputs — ground truth

### A. YouTube source

Persisted today on `YouTubeVideo` (`prisma/schema.prisma`): `title`, `description`,
`thumbnailUrl` (single best thumbnail only, not the full set), `publishedAt`,
`channelId`, `durationSeconds`, `privacyStatus`, `embeddable`,
`currentViewCount`/`currentLikeCount`/`currentCommentCount`, `etag`,
`observabilityState`.

**Not persisted, and not even fetched from the API**: hashtags/tags
(`snippet.tags` is never requested). **Fetched but discarded**: `channelTitle`,
`uploadStatus`, and per-playlist-item `title`/`publishedAt` — these exist on the
sync engine's DTOs but have no destination column and are dropped.

A full field-ownership/conflict system exists at the persistence layer
(`FieldOwnership`, `SyncConflict`, legal-transition rules in
`modules/youtube/ownership/`) so that a Studio-edited field is not silently
overwritten by the next sync — **but it is completely unwired to any Studio UI**.
`setFieldOwnership()` has zero production callers. In practice this means: if the
sync engine were run today, every `YOUTUBE_CONTROLLED` field (the default for all
tracked fields) would be overwritten on every sync, and there is no way for an
editor to protect a field from that. There is also no cron/button wired to
`runYouTubeSyncJob` at all, so this risk is currently dormant, not active.

Video → Recording linkage is **always manual**, via one of two independent,
non-automatic Studio actions (never title/description/keyword matching — confirmed
by an explicit code comment in `mediaResourceRepository.ts`):
- Path A: attach a `MediaResource` to a `RecordingRevision` (Studio "Media" tab).
- Path B: create a `YouTubeVideoPage` catalogue page (Studio "Catalogue > Videos").
A given video can have neither, either, or both.

### B. MMKE canonical context

Every traversal path in the target conceptual graph exists today via real foreign
keys — no fuzzy matching anywhere:

| Path | Exists | Mechanism |
|---|---|---|
| YouTubeVideo → Recording | yes | `findPublishedRecordingSlugForYouTubeVideo` (`mediaResourceRepository.ts`) |
| Recording → MusicalWork | yes | `RecordingRevisionWork` join, or via Performance→Programme→items |
| MusicalWork → Composer | yes | direct FK |
| Recording → Programme → Performance | yes (indirect) | via `RecordingRevision.performanceId` |
| Performance → Artist/Choir/Conductor | yes | `PerformancePerformer`/`PerformanceChoir`/`PerformanceConductor` |
| Recording → Venue → Organisation | yes (indirect) | via Performance.venue, Venue.organisationId |
| Collection → Recording/MusicalWork | yes | `CollectionRecording`/`CollectionWork`, own traversal, never via Performance |
| LearningGuide → MusicalWork/Recording | yes | `LearningGuideWork`/`LearningGuideRecording`, direct joins, no Performance in the chain |
| Composer/Work/Recording → Source/Citation/Rights | yes, but scoped | `EntitySource`/`EntityRights`, hard-limited to `["COMPOSER","WORK","RECORDING"]` by `modules/mmke/provenance/provenanceEntityType.ts` (app-layer constant, not a DB constraint) |

The shared traversal core, `resolveRelatedContent` (`entityRelationshipsRepository.ts`),
is deliberately **Performance-rooted** and is explicitly *not* extended to reach
LearningGuide or Collection, because those connect via direct Work/Recording joins
with no Performance in the chain — extending it would leak unrequested sections onto
Programme/Performance/Venue/Artist/Choir/Conductor pages. A future CI context
assembler must respect this same boundary: reuse the existing per-entity resolvers
(`getComposerEntityPageData`, `getPublicWorkPageData`, `getPublicRecordingPageData`,
etc.), never extend `resolveRelatedContent` itself.

### C. Provenance

`Source`, `Citation`, `RightsInformation` models exist, with generic polymorphic
joins `EntitySource`/`EntityRights` (Citation has no entity-join; it hangs off
`Source` only). Editor-curated (created via Studio, not synced). Scope is currently
Composer/Work/Recording only — Programme, Performance, Venue, Artist, Choir,
Conductor, Organisation, Collection, Occasion, and YouTube video pages have no
provenance section.

### D. Existing editorial content

Every free-text prose field found is explicitly human-authored, and several are
commented in code as "never generated / never rewritten or summarized":

| Entity | Field | Depth |
|---|---|---|
| Composer, Artist, Conductor | `biography` | short |
| Choir, Organisation, Collection | `description` | short |
| Programme | `notes` | short |
| Recording (via RecordingRevision) | `description`, `educationalListeningGuide`, `educationalAnalysis` | richest structured-entity prose |
| LearningGuide | `contentMarkdown` | only genuine long-form, paragraph-structured body in the app |
| YouTubeVideoPage | `curatorNote` | short, optional |
| **Venue, Performance** | **none** | **no prose field exists on either model at all** |

No field, anywhere, is designed to hold AI-generated or AI-assisted text. A future
CI layer generating prose cannot write into these fields directly without breaking
that established invariant (see §6).

### E. Future analytics

GA4 event pipeline (Phase 6G-18) is live but produces no feedback loop yet — no
code reads GA4 data back into the app. YouTube Analytics has a persisted
observation model (`YouTubeAnalyticsObservation`) but no sync engine. Search
Console is not integrated at all. See §13.

## 4. Current public/editorial coverage

All 16 Museum routes exist (`/`, `/archive`, 10 entity-slug types, `/collections`
×2, `/learning` ×2, `/videos/[slug]`), each with `generateMetadata`, JSON-LD, and
sitemap inclusion. Editorial prose is present for Composer/Artist/Conductor
(biography), Choir/Organisation/Collection (description), Programme (notes),
Recording (description + educational fields), and LearningGuide (contentMarkdown —
the only true long-form body). **Venue and Performance pages are 100%
structured-data-only today because the underlying models have no prose field at
all** — this is a model gap, not an unpopulated-field gap. Only the Organisation
page renders anything provenance-like (Sources, Rights Information, Occasions).

## 5. Source trust hierarchy (proposed)

Derived from the evidence above, not assumed from the brief's suggested default
ordering:

1. **Canonical MMKE structured facts** — the entity tables and their real FK
   relationships (Composer, Work, Programme, Performance, Recording, Venue,
   Organisation, Artist/Choir/Conductor, Collection/LearningGuide membership), plus
   objectively-true YouTube technical/identity fields (video ID, duration,
   publishedAt). Ground truth. AI may read; never write.
2. **Approved Music-Madras-authored editorial prose** — biography/description/
   notes/educationalListeningGuide/educationalAnalysis/contentMarkdown/curatorNote.
   Already reviewed for the archive's voice and accuracy by a Studio editor.
3. **Approved external sources/citations** — `Source`/`Citation`/`RightsInformation`,
   editor-curated (required a deliberate Studio action to attach), but the
   underlying claim originates outside the archive.
4. **Synchronized YouTube metadata** — title/description/thumbnail/stats. Descriptive
   and potentially useful for concert context, terminology, or acknowledgements, but
   authored by the channel uploader with zero Music Madras editorial vetting step.
   Ranked below Tier 3 specifically because it arrives passively/automatically,
   unlike a Source/Citation which requires an editor to deliberately create and link it.
5. **AI-generated interpretation/suggestions** — lowest trust, always provisional,
   must pass editorial review before touching any Tier 1–4 field, and never
   silently promoted.

This differs from the brief's illustrative default only in placing approved
Source/Citation above raw YouTube metadata — justified by the fact that Source/
Citation always required a human editorial act, while a video's own description
did not.

## 6. Fact vs. editorial vs. AI boundary

- **Canonical fact**: anything living in a canonical entity table or its FK
  relationships (§3B), plus objective YouTube technical fields. Immutable except
  through the existing Studio catalogue-write flows. AI must never be treated as a
  source for these.
- **Editorial content**: the existing human-authored prose fields (§3D) and any
  future long-form content types. All currently 100% human-authored; several
  fields carry explicit "never generated" comments in the code today — a future CI
  layer must preserve that invariant by never writing directly into these fields.
- **AI suggestion**: a new conceptual category with **no existing model**.
  Suggested title, suggested intro, suggested internal links, suggested keywords,
  suggested external sources, suggested review questions. Always attributed as
  AI-origin, always provisional, and promoted to "editorial content" only through
  an explicit human accept action that is itself audit-logged (§9).

AI must never silently convert an AI suggestion into a canonical fact or into
approved editorial content.

## 7. Content completeness model

Six independent dimensions, deliberately not conflated (evidence: a video can have
complete YouTube metadata and a complete canonical Recording/Composer/Venue chain
while having zero editorial prose — that does not mean the archive record is
incomplete, it means editorial content hasn't been written yet):

1. **Archive completeness** — does a canonical Recording exist and is it linked to
   a Work/Performance?
2. **Metadata completeness** — are the technical facts populated (duration,
   thumbnail, publishedAt, etc.)?
3. **Relationship completeness** — are the expected FK links populated (composer,
   venue, performers, programme)?
4. **Provenance completeness** — does the entity have Source/Citation/Rights
   attached, where the entity type is even eligible (Composer/Work/Recording only
   today)?
5. **Editorial completeness** — does the entity have human-authored prose? Note:
   for Venue and Performance this dimension is **structurally impossible to
   satisfy today** — no schema field exists to hold it. That is a distinct
   condition from "not yet written."
6. **Publication status** — the DRAFT/PUBLISHED gate, orthogonal to all five
   dimensions above (an entity can be archive-complete and metadata-complete while
   still unpublished, and vice versa for editorial content specifically).

## 8. Future editorial lifecycle

No `GENERATING`/`DRAFT_READY`/`EDITOR_REVIEW`/`CHANGES_REQUESTED`/`APPROVED`/
`REJECTED` states exist anywhere in the codebase (confirmed by repo-wide grep —
zero hits outside this document). The closest existing precedent is Recording's
**derived, non-stored** `EditorialPhase` (`modules/publishing/editorialPhase.ts`):
`DRAFT → ENRICHMENT → EDITORIAL_REVIEW → APPROVED → PUBLISHED → UPDATED →
ARCHIVED`, computed from `aggregateStatus` + draft completeness — never a
persisted, actor-attributed approval event. Every other publish action
(Collection, YouTubeVideoPage, LearningGuide) is a **single-actor, single-step**
publish/unpublish toggle with no review step at all.

There is **no existing precedent anywhere for a persisted multi-party review chain**
(distinct generator/reviewer/publisher identities on one row). A future CI review
workflow with states like `EDITOR_REVIEW`/`CHANGES_REQUESTED`/`APPROVED` would be
new ground for this codebase — not a reuse of an existing pattern, but not
contradicted by one either.

Existing RBAC surface it would map onto (`modules/auth/policy.ts`, 6 roles ×
7 `StudioAction` keys): `CATALOGUE_WRITE` (Editor+), `EDITORIAL_REVIEW` (Editor/
Reviewer), `RECORDING_PUBLISH` (Administrator+), `AUDIT_VIEW` (Administrator+). A
future `CONTENT_REVIEW`/`CONTENT_PUBLISH` action would likely sit at the same
Editor/Reviewer/Administrator levels as the existing catalogue and recording
actions — not implemented, a design note only.

What happens when source data changes underneath a published AI-assisted article
(source Recording/Composer edited, YouTube description changes) is an **open
question** (see §17) — no staleness-detection mechanism exists for any existing
content type today (Collection/LearningGuide/VideoPage do not re-flag themselves
when their linked entities change).

## 9. Future content types

Not ranked; evidence-based grouping only.

**High-confidence** (existing prose field already establishes the pattern, entity
already has rich canonical context): Recording article enrichment (extends
`educationalListeningGuide`/`educationalAnalysis`), Composer contextual article,
Work contextual article, Collection introduction.

**Potentially useful later** (canonical context exists, but the content type or
its home field does not yet): Programme article, Performance article (blocked
today by §4's model gap), Learning content expansion.

**Unnecessary/speculative given current evidence**: a generic "Video page article"
divorced from Recording context (YouTubeVideoPage's only real Music-Madras field is
the short `curatorNote` — a long-form article there would duplicate, not extend,
the Recording/LearningGuide surfaces that already exist); Venue/Artist/Choir/
Conductor profile enrichment ranks lower priority than Recording/Composer/Work
because those pages already have a human-authored biography/description field
while Venue has none at all (a schema question, not a CI question).

## 10. SEO / AEO / GEO role

CI should assist with title/meta description/headings/internal linking/FAQ
opportunities/semantic completeness — grounded in real canonical relationships
already surfaced by the existing `generateMetadata`/JSON-LD per route (§4). It must
not keyword-stuff, must not generate content purely because a keyword has volume,
and must not distort the archive's actual content to chase search intent. No
keyword-research or rank-tracking infrastructure exists in the repo today, and none
is proposed here.

## 11. Internal linking

Must be derived exclusively from the real FK paths inventoried in §3B, using the
same per-entity repository functions the public pages already call — never fuzzy
title matching, never automatic entity creation because two names look similar.
Concretely: Composer→Works→Recordings/Performances; Work→Composer→Recordings→
LearningGuides; Recording→Programme→Performance→Venue→Participants→YouTubeVideo→
Collections→LearningGuides. `resolveRelatedContent`'s existing boundary (§3B) is
the operative constraint — a CI internal-linking suggestion must draw only from
paths a human editor could also click through today.

## 12. Information-gap handling

A future CI system should be able to output `NEEDS_EDITORIAL_INPUT` rather than
invent an answer, for cases evidenced by real schema gaps and optional fields
found in this inventory: no Composer linked to a Work, no Performance date, no
Venue on a Performance, ambiguous/missing performer attribution, no
Source/Citation for a claim that needs one, or a video with only sparse synced
YouTube metadata and no canonical Recording link at all (Path A/B in §3A, both
optional). This concept is not implemented in 6H-1.

## 13. Analytics feedback loop (concept only)

Phase 6G-18 provides `page_view`/`entity_view`/`catalogue_search`/`video_view`/
`youtube_click` events, but nothing reads them back yet — no GA4 Reporting API
integration, no Search Console integration, no YouTube Analytics sync engine
(only the `YouTubeAnalyticsObservation` schema exists, unpopulated). A future
feedback loop could eventually surface "which published content has weak
discoverability" to editors, but analytics must never become a source of
historical fact — it can prioritize editorial attention, never assert what
happened at a concert. Not implemented here.

## 14. Future module boundary

See the diagram in §2. Concretely, by responsibility:

- **modules/db** (existing): the only place touching Prisma; would gain, at most,
  repository functions for a future `ContentSuggestion` model (§15) — no changes
  proposed now.
- **modules/mmke/contentIntelligence/** (future, Prisma-free): pure context
  assembler, reusing existing per-entity resolvers; pure suggestion-shaping
  functions; never calls an LLM directly (that stays in a separate, swappable
  provider boundary, mirroring how `modules/analytics` isolates its GA4 adapter).
- **A CI provider boundary** (future, not designed here): the one place that would
  know about a specific LLM vendor, analogous to `Ga4Adapter` being the one place
  that knows GA4's shape.
- **Studio UI** (future): review/approve screens, mapped onto existing RBAC.
- **modules/audit** (existing, reusable as-is): logs suggestion-accepted/rejected
  events with zero schema change (see §15).

Security/editorial boundary: identical to the existing Studio RBAC boundary — no
new authentication mechanism, no public-facing AI interaction surface (explicitly
out of scope, §16).

## 15. Future data-model requirements

**No schema change is required to complete 6H-1** — this phase is inventory and
architecture only, and every finding above was obtained by reading existing code.

For a *future* implementation subphase, the following would genuinely be new
(not available in any existing model):

- **A suggestion-holding model** (tentatively `ContentSuggestion`), because every
  existing editorial prose field is explicitly documented as human-authored and
  reusing one for AI output would break that invariant. Proposed shape (not
  applied): generic `targetEntityType`/`targetEntityId` (mirroring the existing
  `EntitySource`/`EntityRights` polymorphic-join pattern already in the schema),
  `contentType`, `suggestedText`, `status` (the lifecycle states from §8),
  `sourceSnapshot` (JSON — which Tier 1–4 inputs were used, for reproducibility),
  `generatedAt`, `reviewedById`, `publishedById`, audit timestamps.
- **Provenance scope extension**: `modules/mmke/provenance/provenanceEntityType.ts`
  is an application-layer constant, not a DB constraint — extending Source/Citation/
  Rights to new entity types (e.g. Venue, Collection) needs no migration, only a
  code change to that constant, if a future phase decides it's warranted.
- **Prose fields on Venue/Performance**, only if a future phase actually approves
  those as content types (§9 flags them as lower-priority, not blocked).

These are documented as future proposals only. None are created in this phase.

## 16. Explicitly deferred (not built, not started)

LLM provider integration; prompt orchestration; vector database/embeddings/RAG;
automatic publishing; autonomous relationship or entity creation; external web
crawling; Search Console integration; analytics feedback automation; contributor
portal; public AI/chat interface; a generic tagging taxonomy; YouTube hashtag
fetch/extraction; wiring the YouTube sync engine to a cron or Studio button;
building a Studio UI for `FieldOwnership`/`SyncConflict` resolution.

## 17. Open questions

- What happens to a published, AI-assisted article when its source canonical data
  (Composer/Work/Performance) is later edited? No staleness-detection precedent
  exists for any current content type.
- What happens when a re-sync would touch a YouTube field an editor has manually
  incorporated into an article, given the field-ownership UI does not exist yet?
- Should the first CI review workflow introduce this codebase's first persisted
  multi-actor approval chain, or reuse the existing single-actor publish pattern
  with the AI-origin flag carried only in the audit log?
- Should Venue/Performance's lack of any prose field be addressed as its own
  narrow schema phase before or independent of Content Intelligence?
