# Video credits: review and approval

Status: Phase B1, 2026-11-17. This document says how the editorial review sheet is used, and records the one exception under which approved credits may later become staging DRAFT records. **The sheet is for review only. It approves nothing, creates nothing and publishes nothing.**

Related: `docs/video-credits-manual-workflow.md` (how proposals are made and checked) and `docs/content-editorial-standard.md` (titles, roles, provenance tiers and the editor's decisions).

## 1. Building the sheet

```bash
npm run ai:video-credits-review
```

The command is local only: no database, no network, no API. It reads `reports/video-credits/` (git-ignored):
- every `proposals-v2-*.json`;
- the export written at the same moment (same timestamp);
- the newest check report for each proposals file.

For each video it uses the **newest** v2 proposal, re-checks it with the checker's validators, and turns what they accept into rows. It prints each proposals file's accepted-credit count beside its check report's count; a difference means the files changed after checking.

It writes three files into the same folder, UTF-8 **with BOM** (so Excel shows Tamil correctly) and CRLF line ends:

| File | One row per | Columns the reviewer fills in |
|---|---|---|
| `review-credits.csv` | fact (credit, title, date, venue type, institution, presenter, other unmodelled item, open question) | `decision`, `editedName`, `notes` |
| `review-videos.csv` | video: worst tier, counts per tier, credits, unmodelled items, open questions | `decision`, `notes` |
| `review-names.csv` | unique role + name across all videos: video count, spellings seen, video ids | `decision`, `canonicalName` |

A cell that would start a spreadsheet formula (`=`, `+`, `-`, `@`) is prefixed with an apostrophe. For example, the video id `-vgQs9QTWhw` appears as `'-vgQs9QTWhw`; the `youtubeUrl` column always holds the exact id.

## 2. What the columns mean

- **basis:**
  - `1` stated in title;
  - `2` stated in description;
  - `3` supported by another source;
  - `4` editor-supplied (from `tests/fixtures/videoCreditsReference.json`);
  - `5` AI-inferred or unresolved.

  A venue type taken from the venue's own name ("Bishop Heber Chapel") is basis 5 with `venueTypeBasis = inferred from name`. Only a type the text states (a "Church:" label) is `stated in text`.
- **tier:**
  - **GREEN:** a labelled line ("Conductor: …") or an explicit role sentence ("conducted by …", "music by …") in the description names the role, the name is exact in the quote, and nothing is flagged.
  - **AMBER:** a credit read from other prose or from the YouTube title; a venue type inferred from a name; a performance date; an UNMODELLED item; an editor-supplied fact; an editor's research flag.
  - **RED:** any of the following:
    - a CONFLICT or placeholder gap ("To be confirmed", "[Please confirm]");
    - a name spelled differently elsewhere (different letters, letter case or punctuation; adding or dropping a short form like "(MCC)" or a leading "The" does not count);
    - a date taken only from a title;
    - a possible duplicate performance;
    - a venue with no venue type (the catalogue cannot store a venue without one);
    - a credit the checker rejected;
    - a proposal the editor has ruled out.
- **kind `open question`:** a gap with no fact to attach to, such as a placeholder composer. It never carries a name. **No row creates or implies a composer that the text does not state.**
- **isReference:** `true` for the five videos the editor verified. Their editor-supplied facts appear as extra rows with basis 4.
- **schemaHome:** the model or field that could store the fact today, or `none`. See `docs/content-editorial-standard.md`, section 10.

## 3. How to review

1. Start with `review-names.csv`. Decide each person, group, work and venue once:
   - `decision`: accept, merge or reject;
   - `canonicalName`: the catalogue spelling.

   This settles spelling variants for every video at once.
2. Work through `review-videos.csv` from RED to GREEN. For each video, open `youtubeUrl` and read the description on YouTube.
3. In `review-credits.csv`, fill `decision` for every row of that video:
   - `accept`, `reject` or `edit` (with `editedName`);
   - `defer`, when a source is needed.

   Use `notes` for the reason. A RED row needs an explicit decision and a note. A row with `schemaHome = none` can be accepted as a fact but cannot be stored until the schema has a home for it.
4. Never accept a credit because it appears in the YouTube title alone, or because a hashtag mentions a name.
5. Keep the reviewed files. Re-running the command overwrites them, so copy a reviewed file to a dated name before running it again.

## 4. Approval is separate, and publication is not part of this

Filling in `decision` records an editorial judgement. It is not an approval in the catalogue and has no effect by itself. Nothing in this workflow:
- writes to any database (staging or production);
- creates a Composer, MusicalWork, Venue, Performance, Choir, Conductor or Recording;
- changes a YouTube video or publishes anything.

## 5. Written exception: approved credits may later create staging DRAFT records

The architecture says accepting an AI suggestion never creates a canonical record by itself (`docs/content-intelligence-architecture.md` §18, §26; ADR-0002 D-02). This section records the **one** exception, for credits, under these conditions. It belongs in ADR-0002's exception register when that tool is built.

- **Separate tool:** approved credits may be turned into records only by a separate tool, not by the review sheet, the checker, the export or any Studio action that exists today.
- **Human-run:** a person starts it deliberately. No schedule, no automatic trigger, no AI agent runs it.
- **Dry run by default:**
  - without `--execute` it only prints what it would create;
  - `--execute` creates records;
  - it follows the same pattern as the staging content loader (`npm run seed:staging-content`): it names its target database, refuses anything not named staging, and asks the operator to confirm the host.
- **Staging DRAFT records only:**
  - Recordings stay DRAFT;
  - catalogue entities are created as drafts or unpublished where the model allows it;
  - nothing is published, no video page is created, no exposure approval is made.
  - Publication stays a separate human action through Studio's existing review and publish workflow.
- **Only reviewed, explicit approvals:** a row is used only when the reviewer wrote `accept` (or `edit` with `editedName`). RED rows need a note as well. Blank, `defer` and `reject` rows are ignored.
- **Nothing invented:**
  - a credit with no schema home is skipped and listed;
  - a work with no stated composer is never given one;
  - existing records are matched by exact canonical name only, never fuzzily;
  - every created record cites its basis.
- **Auditable and repeatable:** the tool reads a reviewed sheet, prints a report of everything created, matched or skipped, and creates nothing twice when re-run.

Until that tool exists, approved credits stay in the reviewed CSV files.
