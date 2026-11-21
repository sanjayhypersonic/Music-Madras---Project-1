# Video credits: review and approval

Status: Phase B1, 2026-11-17; Phase B2 (sections 6 and 7) the same day. This document says how the editorial review sheet is used, records the one exception under which approved credits may become staging DRAFT records, and describes the tool that does it (section 6) and the description drafts (section 7). **The sheet is for review only. It approves nothing, creates nothing and publishes nothing.**

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

The tool now exists (section 6). It has been run only as a dry run on fake data; `--execute` has not been run against any database (project register R-31).

## 6. Creating staging DRAFT records: `npm run ai:video-credits-create`

```bash
npm run ai:video-credits-create
```

```bash
npm run ai:video-credits-create -- --only <videoId>,<videoId>
```

The dry run (the default) reads `review-credits.csv` and `review-names.csv` in `reports/video-credits/` (another folder inside the repository with `--dir`), and `review-videos.csv` when it is there. It prints a plan per video and writes `credits-create-dry-run-<time>.json` beside them. It connects to **no** database, so matching against existing records is reported only on `--execute`.

How the sheets are read (`modules/jobs/videoCreditsApproved.ts`):
- A row counts only with `accept`, or `edit` with an `editedName`. Blank, `defer` and `reject` are ignored. Any other word is refused and listed.
- A RED row needs a note. A credit the checker rejected cannot be accepted as it stands: `edit` it if you know it, and it becomes editor-supplied (basis 4).
- Every person, group, work and venue must be decided in `review-names.csv` (`accept` or `merge`). Its `canonicalName` is the catalogue spelling. A name seen in several spellings needs a `canonicalName`. An `editedName` that contradicts the `canonicalName` is refused.
- An edit that changes a name (not only its spelling), a venue type or a date makes the fact editor-supplied (basis 4). Editor-supplied rows keep basis 4.
- **Venue type.** On a venue-type row, write `edit` with `CHURCH`, `CATHEDRAL`, `CONCERT_HALL`, `STUDIO`, `OUTDOOR` or `INDOOR_AUDITORIUM` (for an indoor auditorium; "Indoor Auditorium" is read the same way), and a note. This works for a RED row with no type, and records the type as "editor-chosen". Accepting a type inferred from the venue's name keeps it "inferred from name (editor-accepted)": it never becomes a stated type.
- **Medley.** A medley needs its Recording title approved: write `accept` on the video in `review-videos.csv`. The slug is built from that title and never changes.
- **Transliteration.** It is approved when the row with the original-script work title is accepted, or when the video is accepted.

What is planned (`modules/jobs/videoCreditsCreate.ts`; the schema mapping is in project register R-31):
- **Held out.** A video is held out entirely, and listed, when:
  - any approved work lacks exactly one approved composer (a composer is never invented);
  - no work is approved;
  - it has several works and no approved Recording title.
- **The Recording.** One DRAFT Recording per video, with its works in sheet order (a medley is one Recording). Each work keeps its own composer. An original-script title stays the title; the transliteration and an editor's Latin spelling become alternate titles.
- **Venue and Performance.** A Venue is planned only with exactly one approved venue and one approved type. Without a Venue there is no Performance, and its choir, conductor and performers go to the sidecar. A Performance needs a Programme (schema), so one Programme per Recording is created, titled with the Recording title.
- **Dates.** A date is stored only when complete (`YYYY-MM-DD`). A partial date goes to the sidecar.
- **Sidecar.** Facts with no schema home go to the report's `sidecar` list with their basis and quote, never into a field that would distort them: lyricist, arranger, ensemble, presenter, institution, translator, subtitle, published title, original performer.

`--execute` (built, not yet run):

```bash
STAGING_DATABASE_URL=<direct url of the STAGING database> npm run ai:video-credits-create -- --confirm-host <host:port/database> --execute
```

- **Target guard.** Same as the staging content loader: STAGING_DATABASE_URL only, a direct Neon host, "staging" in the database name, `--confirm-host` typed exactly, not a configured real database, NODE_ENV not production, all migrations applied.
- **Author.** Records are created by the non-login import actor.
- **Videos.** A video must be stored as public and OBSERVED.
- **Existing records.** Catalogue records are matched by exact normalised name and created only when absent. An existing record is never modified; a differing venue type or a missing alternate title is reported. Slugs follow the new-record rule (`modules/mmke/slug/canonicalSlug.ts`).
- **Editor-changed Recordings.** A linked Recording is touched only while it is DRAFT and its draft was last changed by the import actor. Once an editor has saved anything, it is left alone.
- **Empty slots only.** Only empty draft slots are filled: title, works, performance. Participants are added only to a Performance created in the same run, through the copy-on-write participant service.
- **Never.** It never publishes, never creates a video page or exposure approval, and never writes anything YouTube-controlled. A re-run creates nothing twice. Each step is printed as it happens and saved in `credits-create-execute-<time>.json`.

## 7. Description drafts: `npm run ai:video-credits-describe`

```bash
npm run ai:video-credits-describe
```

The command is local only: no database, no network, no API. It reads the same reviewed sheets and writes `review-descriptions.csv` (UTF-8 with BOM). Each video gets one DRAFT description, built by a fixed template (`modules/jobs/videoCreditsDescribe.ts`) in the order of `docs/content-editorial-standard.md` section 7:
1. opening line;
2. performance sentence with creators and conductor;
3. context (published title, subtitle), when approved;
4. archive sentence, and the presenter when approved;
5. "Performance Details" block;
6. invitation (`--no-invitation` leaves it out).

It uses approved facts only and keeps original-script titles. It makes no characterisation of the music and no historical or theological claim, and it adds no hashtags. Held-out videos still get a draft, with the reason in `notes`. The editor fills `decision`, `editedDescription` and `editorNotes`. Nothing replaces the YouTube text automatically.
