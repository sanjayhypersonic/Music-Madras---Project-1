# Phase 2 — Canonical MMKE Domain & Persistence Layer

Companion to [`docs/phase-1-foundation.md`](phase-1-foundation.md) and [`docs/phase-2-gais-functionality-map.md`](phase-2-gais-functionality-map.md). This document explains what changed in the schema and domain/repository layer during Phase 2, and why, including the two review points the Phase 2 brief specifically asked to be reasoned through rather than defaulted on.

## 1. What Phase 2 added to the schema

All additions are either (a) closing a gap where Phase 1 used a loose string where a real relationship belonged, or (b) rounding out an entity's fields to match what the ADR/brief actually asked for — never new hardcoded content, never a second draft/versioning mechanism.

| Change | Entity | Why |
|---|---|---|
| `youtubeVideoId` real FK | `MediaResource` → `YouTubeVideo` | Phase 1 only had `providerResourceId: String?` — a bare, unconstrained string. This is exactly the "free text instead of a relationship" pattern brief §3 says to avoid. Now `Recording → MediaResource → YouTubeVideo` is a real, queryable chain. |
| `rightsInformationId` real FK | `MediaResource` → `RightsInformation` | `RightsInformation` existed in Phase 1 but was never actually attachable to anything. This implements the ADR's own stated design (§17: "attaching a MediaResource... with its own RightsInformation"). |
| `EntityRights` (generic join) | new table | Rights aren't always tied to one media asset — a `MusicalWork` itself might have a copyright status independent of any recording of it. Mirrors the existing `EntitySource` pattern exactly, so this is additive, not a new mechanism. |
| `EntityEducationalContent` (generic join) | new table | `EducationalContent` had zero relationships in Phase 1 — a floating entity. Brief §9 asks for it to be "associated with relevant MMKE entities," plural and open-ended, so a generic join (again mirroring `EntitySource`) was chosen over a dedicated join table per entity type. |
| `alternateTitles String[]`, `language String?`, `notes String? @db.Text` | `MusicalWork` | Brief §5's explicit list (alternate titles, language, notes) — none of this assumes one musical tradition; it's just three optional fields. |
| `role String?` | `PerformancePerformer` | Brief §6: distinguish "Organist" from "Soloist" from "Accompanist" without a role-entity engine. A free-text label is the smallest thing that works and needs no migration to add a new role later. |
| `organisationId String?` | `Venue` → `Organisation` | See §7 below — this is the one schema decision the brief specifically asked to be reasoned through rather than defaulted. |
| `status CollectionStatus` (`DRAFT`/`PUBLISHED`) | `Collection` | Brief §8: Studio needs a real publish toggle for collections. A simple two-value enum, not a second revision/versioning system — archival still uses the existing `archivedAt` column, consistent with every other entity. |

Everything else the brief asked me to review (Programme/ProgrammeItem, MusicalWork's core shape, Artist/Choir/Conductor as canonical entities, the Recording/RecordingRevision mechanism itself, Source/Citation/EntitySource) was already correctly modeled in Phase 1 and needed no schema change — see §2 for what was reviewed and kept as-is.

## 2. Reviewed and kept as-is (no change needed)

- **Programme/ProgrammeItem** (brief §4): already a real, ordered, normalized structure (`order`, `movement`, `isEncore`, FK to `MusicalWork`) — not a text field. Phase 2 added the pure `reorderProgrammeItems`/`computeNextOrder` logic and a `programmeRepository` to make this genuinely usable, but the schema itself was already right.
- **Recording/RecordingRevision** (brief §11): the Phase 1 design — `Recording` as stable identity with two pointers, `RecordingRevision` as the one canonical content representation, no JSON shadow state — is unchanged. Phase 2 only extracted the fork/publish preconditions into pure, tested functions (`canForkNewDraft`, `canPublishCurrentDraft` in `modules/publishing/revisionTransitions.ts`) and added real relationship-traversal (`getCanonicalContextForRevision`).
- **Artist/Choir/Conductor as canonical entities** (brief §6): already real tables joined via `PerformancePerformer`/`PerformanceChoir`/`PerformanceConductor`, never free-text names. Only the `role` field was added (see table above).
- **Recording → Programme chain** (brief §3): deliberately kept as an *indirect* path — `RecordingRevision.performanceId → Performance.programmeId → Programme` — rather than adding a redundant direct FK from `Recording`/`RecordingRevision` straight to `Programme`. A direct shortcut would create two ways to answer "what programme is this recording's," which is exactly the kind of duplicated source of truth this project has been explicit about avoiding. `getCanonicalContextForRevision` in `recordingRepository.ts` walks the real chain so this is genuinely usable without a shortcut FK.
- **Source/Citation/EntitySource**: unchanged. `EntityRights`/`EntityEducationalContent` (added this phase) deliberately follow the exact same generic-join shape rather than inventing a new pattern.

## 3. Venue / Church / Organisation (brief §7 — reasoned through, not defaulted)

**The question:** does `Venue.type = CHURCH` adequately represent a church, given a church is both a physical building *and* potentially a meaningful institution (a congregation, a trust) in the cultural catalogue?

**The reasoning:**

- Merging `Venue` and `Organisation` into one table would conflate two different things: a physical place (with an address, capacity, acoustic profile) and an institution (which can outlive a building, move premises, or operate more than one venue). That's a real modeling mistake, not just theoretical purity.
- Adding a second, Church-specific table would risk exactly the "duplicate venue/church records for the same building" the brief explicitly warned against, and would need its own relationships to Performance/Instrument that `Venue` already has.
- The **smallest justified change** was an optional `Venue.organisationId → Organisation` foreign key. A church venue can now *optionally* be linked to the organisation that operates it (e.g., a specific parish or trust), while:
  - A venue with no meaningful separate institution (e.g. a concert hall) simply leaves it `null` — no forced busywork.
  - One `Organisation` can, in principle, be linked from more than one `Venue` (a diocese/trust operating several churches) without any schema change.
  - Nothing about the existing `Venue`-as-Church representation changes — this is additive, not a replacement.

This is a genuine judgment call, not a certainty — if, once real Studio/Museum usage exists, it turns out organisations need their own richer relationships to performances or works directly (not just via a venue), that would be a legitimate reason to revisit this. Nothing here should be read as foreclosing that.

## 4. Repository / service layer (brief §13)

New repositories in `modules/db/repositories/`: `musicalWorkRepository`, `programmeRepository` (with real ordering via the pure reorder logic), `venueRepository` (with the organisation link), `performanceRepository` (participant linking with roles), `artistRepository`, `choirRepository`, `conductorRepository`, `organisationRepository`, `collectionRepository` (with publish/archive and item ordering), `mediaResourceRepository`. Each follows the same shape `composerRepository`/`recordingRepository` established in Phase 1 (thin, Prisma-only-here, audit-logged writes).

**Deliberately not built this phase:** dedicated repositories for `Instrument`, `EducationalContent`, `LearningGuide`, `EditorialContent`, `Source`/`Citation`/`RightsInformation`, `SheetMusicRequest` — these follow an identical, already-demonstrated pattern and would be pure repetition to write now, before any Studio screen exists to consume them (brief §13's own "do not build API endpoints for every possible operation yet unless genuinely required for this phase").

## 5. Duplicate prevention (brief §17/§18)

`modules/mmke/duplicate-detection/detectDuplicateName.ts` — a pure, exact-normalized-match check (trim/lowercase/collapse-whitespace) — is now wired into `composerRepository`, `musicalWorkRepository` (scoped per-composer, since two different composers may share a work title), `artistRepository`, `choirRepository`, and `conductorRepository`. Fuzzy/similarity matching (catching "J.S. Bach" as a likely duplicate of "Johann Sebastian Bach") remains deferred — it needs a real similarity strategy (the ADR's stated choice is Postgres `pg_trgm`) and is only meaningfully testable against a live database and a real Studio entity-picker, neither of which exist yet.

## 6. Search foundation (brief §14)

`modules/mmke/search/searchTypes.ts` defines a small `CatalogueSearchProvider` interface (framework/database-agnostic). `modules/db/search/postgresSearchProvider.ts` implements it with simple case-insensitive `contains` matching across `Composer`, `MusicalWork`, `Venue`, `Collection`, and published `Recording` titles. This is deliberately not the semantic/AI/natural-language search the legacy prototype only ever specified as an unimplemented interface (`legacy-prototype/src/mmke/types/search.ts`) — a future dedicated provider (e.g. trigram-based, or a real semantic/vector service) can implement the same `CatalogueSearchProvider` interface without callers changing.

## 7. Content completeness (brief §12)

`modules/mmke/completeness/checkRecordingRevisionCompleteness.ts` (Phase 1) now has a companion `computeRecordingReadiness()` returning one of three named categories — `INCOMPLETE`, `READY_FOR_REVIEW`, `PUBLISHABLE` — derived from the same completeness report, never a numeric score. This is a thin categorization on existing data, not a second completeness mechanism.

## 8. No hardcoded content (brief §16)

No catalogue records were added as TypeScript constants anywhere in this phase. Test fixtures (e.g. `"Toccata and Fugue in D minor"` in `tests/unit/checkRecordingRevisionCompleteness.test.ts`) are exactly that — inputs to pure-function unit tests, not application source data, and are not claimed as real catalogue content. No `prisma/seed.ts` was added in Phase 2; there is no database to run one against yet, and adding an unexecuted seed script would be unverifiable scope creep rather than useful foundation work.

## 9. Module boundary note

`modules/mmke/relationships/README.md` was corrected this phase: it originally (Phase 1) implied query helpers might live there, but any function that actually queries the database must live in `modules/db` (ADR §3 — only `modules/db` imports Prisma). Real traversal of the Composer↔Work↔Performance↔Recording graph now lives in `modules/db/repositories/recordingRepository.ts` (`getCanonicalContextForRevision`); `modules/mmke/relationships/` holds only pure helpers over already-loaded data (`formatComposerCredit.ts`).
