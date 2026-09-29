# Content Intelligence Architecture

Status: **architecture and contracts only. No Content Intelligence code exists yet.**
This document records what was found in the repository and proposes a future
architecture. Nothing described here as "future" or "proposed" has been built.

- §1–§17: **Phase 6H-1** — Architecture & Inventory (commit `fbc75bd`).
- §18–§36: **Phase 6H-2** — Content Suggestion & Context Contract addendum.
- §37 onward: **Phase 6H-3** — Recording Context Assembler, the first real implementation.

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

---

# Phase 6H-2 — Content Suggestion & Context Contract

Status: **contract definition only. No `ContentSuggestion` model, no context
assembler, no LLM provider, and no Studio UI exist yet.** This section defines the
contracts a future implementation must obey. Where it refines a 6H-1 proposal, the
refinement and its justification are stated explicitly (see §26).

## 18. What is a Content Suggestion?

Not one generic blob. Seven distinct categories were evaluated against the actual
repository evidence from §3–§4:

| Type | Example | Target |
|---|---|---|
| `EDITORIAL_PROSE` | Listening-guide draft for a Recording | an existing editorial field (§3D) |
| `SEO_METADATA` | Suggested `seoMetaTitle`/`seoMetaDescription` | existing, currently-empty SEO fields on `RecordingRevision`/`YouTubeVideoPage` |
| `INTERNAL_LINK` | "Link to this Composer and Work" | must resolve only through paths in §3B/§11 — never a new/fuzzy path |
| `INFORMATION_GAP` | "Performance date unknown" | no field — see §22 |
| `SOURCE_LEAD` | "This source may add context" | a proposed `Source`, not an attached one |
| `SEARCH_TERMINOLOGY` | Candidate questions/terms users might search | no canonical target, editorial-review-only |
| `CANONICAL_RELATIONSHIP_CANDIDATE` | "This video may correspond to Work X" | a candidate FK — never auto-applied |

`CANONICAL_RELATIONSHIP_CANDIDATE` (type G) is architecturally distinct from the
other six: A–F propose *content* (text, metadata, a lead to evaluate); G proposes a
*structural change to the archive graph itself*. Decision (answering Step 10): it
shares the same `ContentSuggestion` shape and review pipeline as the other six — so
there is exactly one audit trail and one review queue, not two systems — but no
code path anywhere ever lets accepting a G-type suggestion *itself* create or
modify a canonical relationship. Acceptance only marks the candidate as
`ACCEPTED`; a human must separately perform the relationship edit through the
existing Studio catalogue-write flow (`CATALOGUE_WRITE`), which is audited exactly
as it already is today, independent of this contract. **G is included in the
contract shape but excluded from the first implementation's scope** (§27).

## 19. Trust boundary (six states)

| State | Definition | Example |
|---|---|---|
| Canonical fact | Lives in a canonical entity table or its FK relationship (§3B) | Composer = X |
| Editorial factual content | Human-authored prose stating a fact not otherwise modeled as a relationship | Programme.notes: "benefit concert for the flood relief fund" |
| Editorial interpretation | Human-authored analytical/aesthetic prose, not a fact claim | `educationalAnalysis`: "exemplifies late-Romantic harmonic language" |
| AI suggestion | Output of Content Intelligence, any type from §18 | "The composer is likely X" |
| Unverified claim | A Tier 3/4 (§5) mention not yet elevated by editorial review | YouTube description mentions a venue name |
| Missing information | A flagged, first-class absence (§22), never silently blank | Performance date: not recorded |

An AI suggestion never overwrites, and is never treated as equivalent to, a
canonical fact. "The composer is likely X" remains a suggestion — visibly
provisional — until a human reviewer either accepts it (converting it, through
their own action, into editorial content or a canonical-relationship edit) or
rejects it, at which point the archive is exactly as it was before the suggestion
existed.

## 20. Recording Context contract (conceptual — not implemented)

A `RecordingContext` a future assembler could produce for one `RecordingRevision`
at a time (draft or published — an editor may want CI assistance while still
drafting, so the assembler is not published-only). Every leaf value below is
conceptually tagged with the source tier from §5; nothing here is a new database
field.

- **Identity** — Recording id/slug, `RecordingAggregateStatus`, revision id/number/
  `revisionStatus`. Tier 1.
- **Works** — via `RecordingRevisionWork`: work id/title/alternateTitles/
  catalogueNumber/keySignature/language (Tier 1), each work's Composer id/name/era/
  bornDate/diedDate (Tier 1) and biography (Tier 2).
- **Performance** — performance id/date, Programme id/title/notes (Tier 2). **Optional**:
  a Recording attached only via direct `RecordingRevisionWork` (no Performance in
  the chain, per §3B) has no Performance section at all — the assembler must not
  assume one exists.
- **Participants** — performers/choirs/conductors via the Performance join tables
  (Tier 1), each with their biography/description field (Tier 2) where populated.
- **Venue** — name/type/address/city/country (Tier 1), Organisation name/
  description (Tier 1/2). **Explicitly flagged absent, not null-as-unknown**: Venue
  has no description field at all (§3D) — the context must mark this as a schema
  gap, not "no data yet."
- **Media** — the YouTubeVideo(s) reached via `MediaResource`: title, description
  (Tier 4, explicitly tagged as unvetted YouTube-authored text, never conflated
  with Tier 2 editorial prose), publishedAt, durationSeconds, thumbnailUrl,
  playlist memberships. Hashtags are **not available** (never fetched, §3A) — the
  context must not claim to have them.
- **Collections / Learning** — public Collections and LearningGuides linked to this
  Recording or its Works (Tier 1 relationship + Tier 2 description/excerpt — not
  the full `contentMarkdown` body, to avoid duplicating an entire document per §21).
- **Provenance** — `Source`/`Citation`/`RightsInformation` attached to this
  Recording, its Works, or their Composers (the only eligible entity types, §3C).
  Tier 3.
- **Existing editorial content already in the sections above** (description,
  `educationalListeningGuide`, `educationalAnalysis`, `curatorNote`) is surfaced
  in place, not duplicated into a separate "editorial" block.
- **Completeness** — the six dimensions from §7, computed at assembly time, not
  stored.

**Excluded from context on principle**: any fuzzy-matched candidate relationship,
any entity type's data the target Recording isn't actually linked to, and any
prior AI suggestion's content (a regeneration reads canonical/editorial/source
data again, not a previous AI output, to avoid compounding drift).

## 21. Read-only boundary

The assembler is conceptually **read-only**: it may call only existing `find`/
`list`/`get` repository functions (the same ones `getPublicRecordingPageData` and
similar already call), and must never call a `create`/`update`/`archive`/`publish`/
`setFieldOwnership`/rights-changing function. This mirrors the existing
Prisma-free `assemble*PageData` boundary (`modules/mmke/**`) — the assembler
produces a deterministic snapshot; it does not mutate anything it reads.

## 22. Source/evidence contract

Every fact the context contract surfaces is taggable with a minimal provenance
reference — never a duplicated copy of the source document:

```
{ sourceType: CANONICAL_MMKE | YOUTUBE_METADATA | APPROVED_EDITORIAL
             | APPROVED_EXTERNAL_SOURCE,
  entityType, entityId, field }
```

`AI_GENERATED` is reserved for suggestion *output*, never an input tag. Storing
only `(entityType, entityId, field)` — not the value itself — is sufficient because
the referenced record can always be re-fetched at review time, and it keeps
evidence lightweight (directly answers Step 6's "minimum provenance
representation").

## 23. Content Suggestion contract

Four concerns, deliberately not merged into one opaque JSON field:

1. **Content** — `suggestionType` (§18), `targetEntityType`/`targetEntityId`,
   `targetField` (e.g. `educationalListeningGuide`), `proposedContent`.
2. **Evidence** — an array of §22 references, plus a `contextFingerprint` (§25).
3. **Generation metadata** — provider, model, prompt/template version,
   `generatedAt` (§24).
4. **Status + review decision** — kept as two distinct concerns (§20/§21 below):
   the suggestion's current lifecycle position, and the historical record of what
   a human decided and why.

## 24. Review lifecycle — which model owns which states

The eight states from 6H-1 §8 (`NOT_REQUESTED … REJECTED`) do not all belong to
one model. Splitting them, mirroring the existing `SyncJobRun` precedent
(`RUNNING/SUCCEEDED/PARTIAL/FAILED` — a system-side job-attempt record, already
separate from the content it produces):

- **`ContentGenerationRequest`** (system-side, mirrors `SyncJobRun`): owns
  `NOT_REQUESTED → GENERATING → SUCCEEDED/FAILED` — did the AI call itself
  complete.
- **`ContentSuggestion`** (human-review-side): owns `DRAFT_READY → EDITOR_REVIEW →
  CHANGES_REQUESTED → APPROVED/REJECTED` — did an editor accept it.
- **`PUBLISHED` belongs to neither.** Acceptance means a human copies
  `proposedContent` (or their edited version) into the real editorial field (e.g.
  `RecordingRevision.description`); from that point, the **existing**
  Recording/Collection/LearningGuide publish machinery governs publication, exactly
  as it does today for human-authored content. This directly satisfies 6H-1's own
  finding that "an AI suggestion should not automatically become an
  `EditorialContent` record" — publication is never duplicated into a second
  system.

## 25. Review decision model

`ACCEPT`, `EDIT_AND_ACCEPT` (the reviewer's final text is preserved separately
from the AI's `proposedContent` — never overwritten, so both remain inspectable),
`REJECT` (with a reason: `UNSUPPORTED | INCORRECT | DUPLICATE | OTHER`), `REQUEST_REGENERATION`
(creates a new `ContentGenerationRequest` against the same target — not a mutation
of the rejected suggestion). "Request more information" is not a separate decision;
it is naturally expressed as accepting the suggestion's own `INFORMATION_GAP` type
(§18) or rejecting a suggestion with reason `UNSUPPORTED`. Rejecting a suggestion
never touches canonical MMKE data — the archive is unchanged either way.

## 26. Canonical relationship suggestions — final decision

Resolved in §18: included in the `ContentSuggestion` contract shape as
`CANONICAL_RELATIONSHIP_CANDIDATE`, but **excluded from the first implementation**
(§27) and, structurally, acceptance never triggers a canonical write — only a
human, using the existing catalogue-write UI, can actually create the relationship.
No fuzzy matching, no automatic entity creation, ever.

## 27. Information-gap contract

`INFORMATION_GAP` suggestions carry structured content, not prose — the
"proposed content" *is* the question, never a guessed answer:

```
{ missingField, whyItMatters, candidateResolutionSource?  // an optional §22
                                                            // reference — a hint,
                                                            // never a filled-in
                                                            // value
  requestedAction }                                        // confirm / provide / attach
```

Evidenced gaps from the actual schema: no Composer on a Work, no Performance date,
no Venue on a Performance, ambiguous performer attribution, no eligible
Source/Citation, or a video with sparse YouTube metadata and no canonical
Recording link at all (§3A, both linkage paths optional).

## 28. Recording as the first target — verified, not assumed

Confirmed suitable by re-checking the actual graph (§3B): Recording already
reaches Work, Composer, Performance, Participants, Venue, Media, Collections, and
in-scope Provenance, entirely through real FKs, and already has the richest
existing editorial surface of any entity (`description` +
`educationalListeningGuide` + `educationalAnalysis`) — proving it's already a
content-bearing entity type, not a new one. Its Draft/Published `RecordingRevision`
model also means "generate against a draft, review before publish" requires no new
state machinery — a draft revision is already the place work-in-progress content
lives. By contrast, Venue and Performance are confirmed **unsuitable** as a first
target for the opposite reason: §3D found they have no prose field to hold output
at all — starting there would require a schema change before any contract could be
exercised, which this phase explicitly avoids.

## 29. First safe use case (recommended, not implemented)

**Recording listening-guide suggestion**, targeting `RecordingRevision.
educationalListeningGuide` — not `.description`. Reasoning: `description` is more
likely to feed the page's primary summary and metadata, so an early misfire there
has a larger blast radius; `educationalListeningGuide` is already modeled as
optional, supplementary content, rendered in a clearly separate "Educational
Content" section, making an AI-assisted draft easy for an editor to spot, evaluate,
and reject in isolation without touching the recording's core description. It
satisfies every criterion in the brief: strong canonical context (§28), low risk to
canonical facts (writes nowhere near a fact field), produces prose rather than a
relationship mutation, and is easy to review side-by-side with the existing field
it extends. `description` and `educationalAnalysis` are the natural next
candidates once this path is validated.

SEO/AEO/GEO suggestions (`SEO_METADATA`) remain a separate, later candidate: they
would target the existing, currently-empty `seoMetaTitle`/`seoMetaDescription`
fields only, and must never alter canonical names, dates, attribution, rights, or
relationships, and must never fabricate search-volume or ranking claims.

## 30. AI generation metadata

Minimum required for reproducibility/auditability (Step 15's actual question):
`provider`, `model`, `promptVersion`, `contextFingerprint` (§31), `generatedAt`.
Token/cost/temperature tracking is a nice-to-have, not required by the contract,
and is deferred. No secrets are ever stored in this metadata — provider
credentials remain out of scope entirely (§16, unchanged).

## 31. Staleness / versioning

Minimum architecture (not a new subsystem): a `contextFingerprint` — a composite of
the `updatedAt` timestamps of every entity/field the assembler actually read for
that generation — computed once at assembly time and stored on the
`ContentGenerationRequest`. Staleness is then a **computed** comparison at read
time (re-fetch the same entities' current `updatedAt`, compare) — mirroring the
existing `EditorialPhase` precedent (6H-1 §8) of computing a derived status rather
than storing one. This requires exactly one new field, not a new versioning table.

## 32. Auditability

No second audit system. The existing generic `AuditLogEntry` (`action`/
`entityType`/`entityId`/JSON snapshots, already proven flexible enough by every
existing repository) is reused as-is with new action strings only:
`CONTENT_GENERATION_REQUESTED`, `CONTENT_SUGGESTION_CREATED`,
`CONTENT_SUGGESTION_EDITED`, `CONTENT_SUGGESTION_ACCEPTED`,
`CONTENT_SUGGESTION_REJECTED`, `CONTENT_SUGGESTION_REGENERATION_REQUESTED`. The
eventual write into a real field (e.g. `RecordingRevision.description`) is audited
by the **existing** action for that mutation (e.g. `RECORDING_DRAFT_UPDATED`) —
never a duplicate record.

## 33. Database decision

**A new model is genuinely required** — re-confirming 6H-1 §15, not merely
repeating it. `AuditLogEntry` was evaluated as a possible reuse and rejected: it is
documented as append-only history, has no status field to transition
(`DRAFT_READY → EDITOR_REVIEW → …`), and is not meant to be queried as "my pending
review queue" — repurposing it would conflate an audit trail with a work queue.
No existing editorial prose field can hold AI output without breaking its
established "never generated" invariant (§3D). **This phase does not apply any
migration** — the following is a proposal only, to be approved before any future
implementation phase applies it.

**Proposed minimum: two models, not three** (a `ContentSuggestionRevision` for
multi-turn edit history is explicitly not part of the minimum — see below).

```
model ContentGenerationRequest {
  id                 String   @id @default(uuid())
  targetEntityType   String            // e.g. "Recording"
  targetEntityId     String
  suggestionType     ContentSuggestionType
  status             ContentGenerationStatus @default(PENDING)  // PENDING|GENERATING|SUCCEEDED|FAILED
  contextFingerprint String?           // §31 — null until generation completes
  provider           String?
  model              String?
  promptVersion      String?
  requestedById      String
  requestedAt        DateTime @default(now())
  completedAt        DateTime?
  errorDetails       String?  @db.Text
  suggestions        ContentSuggestion[]
  requestedBy        StudioUser @relation(fields: [requestedById], references: [id])
}

model ContentSuggestion {
  id                  String   @id @default(uuid())
  generationRequestId String
  suggestionType      ContentSuggestionType
  targetEntityType    String
  targetEntityId      String
  targetField         String?           // e.g. "educationalListeningGuide"; null for
                                         // types with no field target (INFORMATION_GAP,
                                         // SEARCH_TERMINOLOGY, CANONICAL_RELATIONSHIP_CANDIDATE)
  proposedContent     String   @db.Text // or structured JSON for INFORMATION_GAP (§27)
  evidenceRefs        Json              // §22 references, array
  status              ContentSuggestionStatus @default(DRAFT_READY)
  reviewedById        String?
  reviewDecision       ReviewDecision?
  reviewNote          String?  @db.Text
  finalContent        String?  @db.Text // populated only for EDIT_AND_ACCEPT
  reviewedAt          DateTime?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  generationRequest   ContentGenerationRequest @relation(fields: [generationRequestId], references: [id])
  reviewedBy          StudioUser? @relation(fields: [reviewedById], references: [id])
}

enum ContentSuggestionType {
  EDITORIAL_PROSE
  SEO_METADATA
  INTERNAL_LINK
  INFORMATION_GAP
  SOURCE_LEAD
  SEARCH_TERMINOLOGY
  CANONICAL_RELATIONSHIP_CANDIDATE
}
enum ContentGenerationStatus { PENDING GENERATING SUCCEEDED FAILED }
enum ContentSuggestionStatus { DRAFT_READY EDITOR_REVIEW CHANGES_REQUESTED APPROVED REJECTED }
enum ReviewDecision { ACCEPT EDIT_AND_ACCEPT REJECT_UNSUPPORTED REJECT_INCORRECT REJECT_DUPLICATE REJECT_OTHER }
```

Why two models and not one: `ContentGenerationRequest` tracks the system-side
generation attempt (mirroring `SyncJobRun`'s separation of "did the job run" from
the rows it produces); `ContentSuggestion` tracks the human-reviewable artifact.
These are genuinely different lifecycles with different actors (system vs. human);
collapsing them would conflate "did the AI call succeed" with "did the editor
accept it." Why not three: a `ContentSuggestionRevision` history model is not
needed for the first pilot — a regeneration is simply a new
`ContentGenerationRequest` + new `ContentSuggestion` row against the same target;
multi-turn refinement history can be added later without reshaping this contract.

**What this minimum enables**: a persistent, queryable per-role review queue; full
audit trail (combined with `AuditLogEntry`); staleness detection (§31);
reproducibility (§30). **What it deliberately does not enable**: auto-publish
(acceptance is still a separate, existing write into a real field); canonical
relationship mutation (no FK to "the relationship it would create," only free-text/
JSON describing the candidate, §26); multi-turn conversational refinement; any
public-facing exposure (no slug, no public repository function, not
sitemap-eligible).

## 34. RBAC boundary

No new roles. Two existing `StudioAction` gates suffice: **request generation +
view suggestions** → `RECORDING_WRITE` (the same permission that already allows
creating/editing a Recording draft — Contributor and above); **edit/accept/reject
a suggestion, and perform the resulting field write** → `EDITORIAL_REVIEW` (Editor/
Reviewer and above — the same permission that already governs moving a Recording
through its review phases). `AUDIT_VIEW` already covers visibility into what
happened. Never exposed to public users; no AI draft is ever reachable from any
public Museum route (§16, unchanged).

## 35. Deferred (this phase)

Everything from 6H-1 §16 remains deferred, plus, specific to this phase: the
`ContentGenerationRequest`/`ContentSuggestion` migration itself (proposed, not
applied — awaiting explicit approval); any Studio review UI; the context assembler
module; any LLM provider or call; `CANONICAL_RELATIONSHIP_CANDIDATE` generation
(contract-only, §26); multi-turn suggestion revision history.

## 36. Resolving the 6H-1 → 6H-2 contradiction

6H-1 §15 proposed a single `ContentSuggestion` model with fields including
`publishedById` and a single `status` spanning the full lifecycle. §24/§33 above
refine this: the lifecycle is split across two models (`ContentGenerationRequest`
for the system-side attempt, `ContentSuggestion` for the human review), and
`publishedById` is removed because §24 establishes that publication is never
tracked by `ContentSuggestion` at all — it is delegated entirely to the existing,
already-built publish machinery on the real target entity. This refinement is
grounded in the newly-completed lifecycle analysis (§24) and the `SyncJobRun`
precedent found in the schema; it supersedes the 6H-1 sketch.

---

# Phase 6H-3 — Recording Context Assembler

Status: **implemented.** This is the first real, deterministic component of
Content Intelligence — a read-only context-assembly layer. It is not an LLM
integration, not a `ContentSuggestion` generator, and not an editorial publishing
system; none of those exist yet. No contradiction with the 6H-2 contract was
found during implementation — §41 records the two decisions 6H-2 left open that
this phase had to resolve.

## 37. Module location and dependency direction

Following the ADR §3 boundary (only `modules/db` touches Prisma) and the exact
precedent `entityRelationshipsRepository.ts` already sets for `assemble*PageData`
functions:

- **`modules/mmke/contentIntelligence/recordingContextContract.ts`** — pure types
  only (`RecordingContext` and its nested shapes), Prisma-free.
- **`modules/mmke/contentIntelligence/assembleRecordingContext.ts`** — a pure
  function (`assembleRecordingContext`) that shapes already-loaded data into the
  contract, including all determinism/dedup/gap-derivation logic. No I/O.
- **`modules/db/repositories/recordingContextRepository.ts`** — the only file in
  this phase that touches Prisma. Exports `getRecordingContext(recordingId, mode)`,
  which loads data via existing repository functions
  (`findPublicVideoPagesByYouTubeVideoIds`, `findPublicCollectionsByIds`,
  `listPublicLearningGuidesForRecording`, `listSourcesForEntity`,
  `listRightsForEntity`, `checkRecordingRevisionCompleteness`,
  `computeRecordingReadiness`) and one fresh, revision-scoped query (needed
  because the existing `getCanonicalContextForRevision` doesn't load
  `Venue.organisation` — the same reason `getPublishedRecordingContextBySlug`
  already runs its own fresh query instead of widening that function).

Dependency direction is one-way: `recordingContextRepository.ts` imports from
other `modules/db/repositories/*` files; none of them import it back, and no
canonical repository or public page depends on anything under
`modules/mmke/contentIntelligence/**`.

## 38. Actual `RecordingContext` shape

Ten top-level sections, all built from real fields confirmed in Phase 6H-1's
inventory — nothing fabricated: `identity`, `works` (+ deduped `composers`),
`performance` (nullable — `venue`, `programme`, `performers`/`choirs`/`conductors`),
`editorial` (the six existing human-authored fields on `RecordingRevision`),
`media` (YouTube videos attached via `MediaResource`), `collections`,
`learningGuides`, `provenance` (`sources`/`rights`), and `completeness`. Full
type definitions are in `recordingContextContract.ts`. Deliberately excluded and
documented as such in code comments: Venue has no `description` field (an
explicit schema gap, not a null value); no arranger field exists on
`MusicalWork`; `channelTitle`/hashtags are never fetched by the sync engine
(6H-1 §3A) so they cannot appear here.

## 39. Source classification

`RECORDING_CONTEXT_SOURCE_MAP` (a static, exported constant) maps each of the
ten sections to one of `CANONICAL_MMKE` / `YOUTUBE_METADATA` /
`APPROVED_EDITORIAL` / `APPROVED_EXTERNAL_SOURCE` — never `AI_GENERATED`, since
this is an input assembler with no AI-generated content at this stage (brief
Step 5). A future Content Intelligence consumer cites a specific fact using this
map plus the entity id already present in that section; no per-field provenance
wrapper was added, since it would duplicate information already available via
each section's own `id`.

## 40. Visibility rules

- **Collections and Learning Guides**: reuses the existing public-only functions
  (`findPublicCollectionsByIds`, `listPublicLearningGuidesForRecording`)
  unconditionally, in both PUBLISHED and DRAFT mode — no new, less-restrictive
  query was written for this phase (brief Step 2: reuse, don't duplicate
  database-access logic).
- **YouTube media**: title/description/duration/thumbnail are included
  regardless of whether the video has a public `YouTubeVideoPage` yet (6H-1 §3A:
  YouTube descriptions are meaningful editorial input independent of the video's
  own public status). `publicSlug` is a separate, nullable convenience field,
  populated only via the existing `findPublicVideoPagesByYouTubeVideoIds` gate —
  never a second competing predicate.
- **Provenance**: `Source`/`RightsInformation` are aggregated across the
  Recording itself, its attached Works, and their Composers — the only three
  entity types `modules/mmke/provenance/provenanceEntityType.ts` supports,
  unchanged in this phase.

## 41. Revision semantics and the two decisions 6H-2 left open

**Mode (brief Step 13)**: the assembler supports both an explicit `"PUBLISHED"`
and `"DRAFT"` mode (`RecordingContextMode`), defaulting to `PUBLISHED` — the
safer choice, since a caller must deliberately opt into seeing in-progress
content. This was necessary because the first safe use case (6H-2 §29, a
listening-guide suggestion) is meant to assist an editor while still drafting,
which the published-only public-page functions cannot serve.

**Result shape (brief Step 17)**: `getRecordingContext` returns a small
discriminated union — `{ok:true, context}` or `{ok:false, reason}` with
`reason` one of `NOT_FOUND` / `ARCHIVED` / `NO_DRAFT_REVISION` /
`NO_PUBLISHED_REVISION` — rather than the public-page convention of collapsing
every failure into `null`. That convention exists specifically to avoid leaking
existence information to anonymous public visitors; this is an internal,
Studio-only service where a future caller genuinely needs to know *why* context
isn't available. This is a deliberate, documented divergence from the public-page
convention, not an inconsistency with it.

Neither decision contradicts the 6H-2 contract — both were left open there and
are resolved here with reasoning grounded in the existing codebase.

## 42. Completeness and information gaps

Reuses `checkRecordingRevisionCompleteness`/`computeRecordingReadiness`
(`modules/mmke/completeness`) directly and unmodified — no second completeness
system. `RecordingContext.completeness.report`/`.readiness` are exactly that
existing report. Additive to it: `hasProvenance` (a boolean, since provenance
isn't one of that report's categories) and a `gaps` array using exactly the
`MISSING` / `NOT_APPLICABLE` distinction the brief asked for (Step 8) — `MISSING`
for an absent-but-supportable relationship (e.g. no Work attached), and
`NOT_APPLICABLE` for a genuine schema gap (Venue's missing `description` field,
surfaced only when a Venue actually exists in context — never fabricated as
"unknown"). No numeric score or "AI readiness" percentage was introduced (brief
Step 7's explicit prohibition).

## 43. Determinism and data minimization

Every list the assembler returns is explicitly sorted (performers/choirs/
conductors by name then id; media by `publishedAt` then id; collections and
learning guides by title then id; composers/sources/rights by id) rather than
relying on incidental database row order, so identical database state always
produces identical output — verified by a unit test that calls the assembler
twice on the same input and asserts equality. No `StudioUser` field
(`createdById`, `updatedById`, email, password hash, session data) appears
anywhere in the contract or its assembly — verified by an integration test that
serializes a real assembled context and asserts the fixture's email, password
hash, and user id are all absent.

## 44. Test coverage

- `tests/unit/assembleRecordingContext.test.ts` (9 tests, DB-free): sort
  determinism, repeated-call equality, composer dedup, all five gap types,
  the `MISSING`/`NOT_APPLICABLE` distinction, no `AI_GENERATED` in the source
  map, and verbatim YouTube description preservation.
- `tests/integration/recordingContextRepository.test.ts` (12 tests, real Neon
  database): `NOT_FOUND`/`ARCHIVED`/`NO_DRAFT_REVISION`/`NO_PUBLISHED_REVISION`
  lifecycle states; full canonical graph resolution (works, composer,
  performance, venue, organisation, participants, programme); a
  direct-work-only recording with no Performance; PUBLISHED vs. DRAFT mode
  diverging on in-progress edits; YouTube description preserved verbatim with
  `publicSlug` gated correctly; published-vs-draft Collection visibility;
  provenance aggregated across Recording/Work/Composer; zero database writes
  (row counts compared before/after); and no Studio user data leakage.
- No YouTube API call and no AI/provider call is possible by construction —
  neither `modules/youtube/adapter` nor any LLM client is imported anywhere in
  `modules/mmke/contentIntelligence/**` or `recordingContextRepository.ts`.

## 45. Known limitations (deferred, not built here)

Playlist context (brief Step 16) was evaluated and explicitly excluded: no
existing repository function surfaces "which playlists contain this video," and
the first safe use case (a listening-guide suggestion) does not need it — adding
a new query for it was judged unnecessary scope for this phase. Everything from
6H-1 §16 and 6H-2 §35 remains deferred unchanged: the `ContentGenerationRequest`/
`ContentSuggestion` migration itself, any Studio UI, any LLM provider or call,
and `CANONICAL_RELATIONSHIP_CANDIDATE` generation.
