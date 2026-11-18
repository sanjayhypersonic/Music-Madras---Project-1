# Upload-to-draft pipeline

Status: built 2026-11-18 on `wip/credits-extraction`, uncommitted (project register R-34).
- **Migration:** written, not applied.
- **Testing:** the unit tests use a fake AI provider and in-memory ports.
- **Never run:** no real AI call, no database run, and the cron has never run.
- **Default state:** switched off and dry-run.

Rules it follows:
- `docs/content-intelligence-architecture.md` §125–§126: AI may propose sources, humans approve claims, nothing unapproved is published.
- `docs/content-guardrails.md`: the five gates.
- `docs/content-editorial-standard.md`: titles, roles and style.

When a video is uploaded to YouTube, the pipeline:
1. reads its title, description, tags and hashtags;
2. extracts credits with the existing video-credits v2 prompt and validators;
3. matches every name to the catalogue;
4. researches only what is new;
5. drafts a video page and a page for every new entity, with SEO, answer-first summaries, key facts and JSON-LD.

The owner approves each bundle in Studio → Pipeline. **Approval publishes. Nothing publishes without approval.**

## 1. Stages

| Stage | What happens | Reuses | State after |
|---|---|---|---|
| 1. Ingest | The daily route `/api/cron/pipeline` (same `CRON_SECRET` and pattern as the stewardship cron) runs the existing YouTube sync. The sync is change-detecting: unchanged videos are not written. The sync now stores `tags` and `hashtags`. The route then queues public, observed videos that are new or whose text changed. | `runYouTubeSyncJob` and its run lock | `QUEUED` |
| 2. Extract | Credits through the AIProvider with the v2 prompt. A video with an empty description is title-only (title quotes only, basis 1). | `extractVideoCredits`, `validateVideoCreditsOutput` | `EXTRACTED` |
| 3. Resolve | Every accepted credit is matched by **exact normalised name**, after the **approved alias table**. A work is matched within its composer, by title or alternate title. Results: MAPPED (link only), NEW, or EXCEPTION (ambiguous, near-miss, or a work without a composer). | `normalizeNameForComparison` | `RESOLVED` |
| 4. Research | Only for NEW entities and the video's work. Entities that already have accepted research are skipped. Two calls per subject (below). | AIProvider + Anthropic web search; guardrail gates 1–2 | `RESEARCHED` |
| 5. Draft | Closed-world video page and new entity pages, built from credits (C1…) and claims (R1…), checked by gate 3. Problems become **flags**. | guardrails, editorial standard | `AWAITING_APPROVAL` |
| 6. Approve | The owner approves, edits or rejects in Studio → Pipeline. Approval creates the catalogue records through the existing creation tool, as the owner, and publishes through the existing publish flow. | `planVideo`, `executeCreditsPlans`, `publishRecordingDraft` | `PUBLISHED` (or `APPROVED` when publication is refused) |

Each run advances at most `PIPELINE_MAX_VIDEOS_PER_RUN` videos (default 3). Every stage is saved before the next starts, so an interrupted run resumes where it stopped. A stage that fails counts an attempt; after three, the video is `FAILED`. Only the error **kind** is stored.

### Research, in two calls

1. **Search.** `AIProvider.research()` runs one bounded web-search session (Anthropic `web_search_20260209`, at most `PIPELINE_MAX_SEARCHES_PER_ENTITY` searches; lyrics sites are blocked). It returns passages with the provider's citations: URL, page title, and the page's own cited text. Structured output cannot be combined with citations, so this call returns text only.
2. **Claims.** An ordinary structured `generate()` call turns the citations into claims. Each claim must name one citation. Code then checks every claim:
   - the URL and excerpt are taken from that citation, never from the model;
   - the value must appear in the cited text and in the statement;
   - the statement is one sentence of at most 300 characters, with no banned wording and never lyrics;
   - the excerpt is at most 200 characters or 30 words;
   - the tier comes from gate 1 (known domains fix or cap it; Wikipedia is X);
   - the claim is compared with the video's own text: **AGREES**, **CONFLICTS** (stored as `CONFLICT` and never resolved by code), or **NOT_STATED**.

A credit claim is sufficient with one tier-A source, two independent tier-B sources, or the video's own text plus one tier-B source. Below that it is **weak**, and a draft may state it only with attribution ("…, according to …").

### Drafts

- **SEO title:** at most 60 characters ("<Title> | <Choir> | Music Madras", shortened word by word).
- **Meta description:** at most 155 characters, from whole summary sentences.
- **Summary:** answer-first, two or three factual sentences. A conflicting claim is never used.
- **Key facts:** one labelled line per credit and per sufficient claim.
- **JSON-LD:** schema.org `MusicRecording`, `MusicComposition`, `Person`, `MusicGroup` or `Place`. `sameAs` comes **only** from claims the owner accepted, at tier A or B.
- **Answer-engine questions:** asked only where a credit already answers them ("Who composed …?").
- **Search demand:** `SearchDemandProvider`. Version 1 uses query patterns ("<song> meaning", "<composer> biography"); the Search Console and Google Ads adapters are stubs that report themselves unconfigured.
- **Checks (gate 3):**
  - every sentence traces to cited credits or claims;
  - names, numbers, months and quantities appear in what is cited;
  - denials, banned wording and the opening sentence;
  - anti-generic;
  - near-duplicates across drafts, on researched sentences only (template sentences are alike by design).

### Flags

A bundle with any flag cannot be bulk-approved. Flags are raised for:
- resolution exceptions;
- conflicts;
- weak claims used;
- gate-3 problems;
- near-duplicates;
- videos held out by the planner (for example, a work without a composer);
- a missing venue type;
- a venue type inferred from the venue's own name;
- title-only videos.

## 2. How a second video is linked automatically

Suppose the owner approved video 1, which created the Composer "Ann Example", the Venue "Fake Chapel" and the Choir "Fake Chapel Choir". Video 2 credits the same names:
- **Resolution.** Each name matches exactly one existing record by exact normalised name, or through an approved alias such as "TELC Arulnathar & Adaikalanathar Combined Church Choirs" → the canonical spelling. They are MAPPED.
- **No research.** MAPPED entities are not researched, and no new entity page is drafted for them.
- **Approval.** `executeCreditsPlans` finds the same records (its own exact-normalised match) and links the new Recording to them: the work under that Composer, the Performance at that Venue, and the Choir as a participant.
- **Public pages.** Once the Recording is published, the existing entity pages (composer, venue, choir, person) list it through the shared relationship graph (`resolveRelatedContent`). No page is edited.

A different spelling is never linked by guesswork. It is an EXCEPTION until an alias decides it.

## 3. Database (migration `20261118100000_upload_pipeline`, not applied)

The migration is purely additive; the project's own classifier rates it additive-only, 0 blocking.

| Table / column | Purpose |
|---|---|
| `youtube_videos.tags`, `youtube_videos.hashtags` (text[], default empty) | The uploader's tags and #hashtags, stored by the sync |
| `persons` (id, slug, name, biography, archivedAt, audit columns) | One public page per human across roles |
| `composers.personId`, `conductors.personId`, `artists.personId` (nullable) | Optional link from a role record to its person; never backfilled |
| `musical_work_contributors` (musicalWorkId, personId, role ARRANGER/LYRICIST/TRANSLATOR) | Arrangers, lyricists and translators of a work |
| `ensembles` (id, slug, name, description, …), `performance_ensembles` | Orchestras and instrumental groups (choirs stay `choirs`) |
| `entity_aliases` (entityKind, alias, aliasKey, canonicalName, entityId, source, decidedBy) | Standing decisions that two spellings are one entity |
| `pipeline_runs` (trigger, dryRun, status, lease, tokens, searches, costUsd, costCapUsd, stoppedReason, steps) | Run lease, cost and token log |
| `pipeline_videos` (youtubeVideoRowId, status, sourceFingerprint, attempts, lastErrorKind, extraction / resolution / research / draft JSON, flags, costUsd, recordingId, decision) | One bundle per video |
| `pipeline_claims` (subjectKey, entityKind, entityName, subjectKind, workTitle, value, statement, sourceUrl, sourceTitle, excerpt, sourceTier, videoRelation, status, decidedBy, retrievedAt) | Research claims and the owner's decisions |
| `entity_page_copies` (entityKind, entityId, seoTitle, metaDescription, summary, keyFacts, sameAs, sourceClaimIds, status, approvedBy) | Approved entity page copy; public pages read only `PUBLISHED` |

**Public pages.**
- **New routes:** `/people/[slug]`, `/arrangers/[slug]` and `/lyricists/[slug]` (the last two have their canonical URL on `/people`), and `/ensembles/[slug]`. Each is public only while a published, not-held Recording reaches it.
- **Existing pages:** composer, conductor, choir, artist and venue pages show the approved copy when there is one.

## 4. Studio → Pipeline (RECORDING_PUBLISH only)

- **Inbox (`/studio/pipeline`):**
  - counts by status;
  - the switch state (off / dry run);
  - one row per bundle: video, status, flag count, claim count, AI cost;
  - a bulk-approve checkbox, enabled only for bundles with no flags;
  - the last five runs: status, stages advanced, tokens, searches, cost against the cap, stop reason.
- **Bundle (`/studio/pipeline/[id]`):**
  - the flags;
  - the video page draft (SEO title and meta with their lengths, summary with each sentence's support ids, key facts, questions, search patterns, JSON-LD), with fields to edit the SEO title, meta description and summary;
  - each new entity's draft;
  - the existing entities, which will only be linked (marked when matched through an alias);
  - the exceptions;
  - a claims table: statement, excerpt, source link, tier, relation to the video, and accept/reject per claim (a conflict must be decided);
  - "Approve and publish", and "Reject" with a reason.

## 5. Safety

- **Switched off by default.** `PIPELINE_ENABLED` must be exactly `true`.
- **Dry run by default.** Until `PIPELINE_DRY_RUN=false`, a run calls no AI provider and runs no sync. It writes only the run record and reports what it would queue and do.
- **Cost cap.** `MAX_USD_PER_RUN` defaults to $2. Each paid call's conservative estimate is checked first, and the run stops instead of exceeding the cap. Actual token and search usage is charged and logged per run and per video. Prices are list prices; an unknown model is charged at the highest known rate.
- **Idempotent and recorded.** A run holds a lease, so a second run is skipped. The same text is never queued twice. Every approval, rejection, claim decision, created person or ensemble, link and page copy is audit-logged.
- **Untrusted text.** Video text, tags, hashtags and web pages are data, never instructions. The system instructions travel apart from them (§64).
- **No secrets in logs.** Only error kinds and counts are stored or returned. The route never returns content.
- **Never publishes by itself.**
  - Approval calls `publishRecordingDraft`, so completeness, locks, Recording holds and audit apply unchanged.
  - **Video exposure approvals are not touched**: their own workflow decides whether the YouTube video page is public.
  - An existing record is never modified, except to add a missing `personId` link.
  - SEO fields are filled only where empty.

## 6. Reconciling the staging loader's records (item 8)

`npm run pipeline:reconcile-staging` sets the Dingiri Dingalae Work's title to **டிங்கிரி டிங்காலே**, keeps "Dingiri Dingalae" as an alternate title, and sets the composer to **Vedha**.
- **Dry run.** Offline by default. With `--confirm-host` and `STAGING_DATABASE_URL` it reads the Work read-only and prints the exact changes.
- **`--execute`.** Writes through `updateMusicalWork`, `changeMusicalWorkComposer` and `createComposer`, staging only (the staging loader's guard). The slug never changes, and a Work shown by a published Recording is refused.
- **The placeholder.** "Traditional" is left in place, and the run reports whether it became unused.

`npm run pipeline:seed-aliases` reads `reports/video-credits/review-names.csv` and records only rows the editor **decided** (accept or merge, with a canonical name). It is dry-run and offline by default; `--execute` writes to staging only. On 2026-11-18 the sheet had **0 decided rows of 262**. The names the owner described as standing decisions are in the sheet without decisions:
- Allan Samuel;
- Hannah Jane;
- the three spellings of the TELC Arulnathar & Adaikalanathar combined choir;
- the two spellings of TELC Arulnathar Lutheran Church;
- Vedha.

Fill `decision` and `canonicalName` for them, then run the seed.

## 7. Switching it on

1. Review and commit; apply the migration through the guarded procedure (`docs/runbooks/production-launch.md` section 3), on staging first.
2. Run `npm run migrations:manifest -- --check` (already regenerated) and `prisma generate` on the deployment.
3. Fill the decisions in `review-names.csv` and run `npm run pipeline:seed-aliases -- --confirm-host … --execute` against staging.
4. Optionally run `npm run pipeline:reconcile-staging -- --confirm-host …`, check its plan, then add `--execute`.
5. Set `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, `CRON_SECRET`, `YOUTUBE_API_KEY`, `YOUTUBE_CHANNEL_ID` and `DIRECT_URL` (the last three for the sync). Then set `PIPELINE_ENABLED=true` and leave `PIPELINE_DRY_RUN` unset.
6. Call `/api/cron/pipeline` once by hand with the bearer secret, and read the dry-run report in Studio → Pipeline → Recent runs.
7. Set `PIPELINE_DRY_RUN=false` with a small `MAX_USD_PER_RUN` (for example 0.50), and call the route again. Review the first bundles carefully.
To run chosen videos by hand instead of waiting for the cron, use `npm run pipeline:run -- --only <id,id> [--limit N] [--confirm-host <host:port/database>] [--execute]` (`scripts/runPipeline.ts`):
- **Modes.** Offline without `--confirm-host`; a read-only dry run with it; stages run only with `--execute`.
- **Guards.** The staging guard, `PIPELINE_ENABLED=true`, `MAX_USD_PER_RUN`, and the pipeline lease, so it cannot overlap the cron.
- **Refusals.** Held-out videos (a video hold, a Recording hold, or a planner hold) and already approved videos are refused and never run (`modules/pipeline/select.ts`).
- **Output.** It prints stages, tokens, searches and cost.
- **Cost.** One video's conservative estimate is about $1.30 (extraction plus up to six research subjects). With the default $2 cap, run one video per command.

8. Schedule the route. `vercel.json` is pinned to one cron by `tests/unit/vercelCron.test.ts`, so either add the second cron there (and update that test, checking the plan's cron limits) or call the route from an external scheduler once a day.

## 8. Not done, or not verified

- **Never run for real.** No real Anthropic call was made: the web-search adapter is type-checked and its response reader unit-tested, but has never run. Neither the Prisma repository nor the cron route has run against a database.
- **No refusal fallback.** `fallbacks` (server-side refusal fallback) is not enabled; a refused research request is recorded as REFUSAL and the bundle is flagged.
- **Existing pages show the approved summary without its `sameAs`.** The composer, conductor, choir, artist and venue pages keep their own JSON-LD, so the approved `sameAs` appears only on the new person and ensemble pages.
- **Some duplication between drafts.** A person in two roles in one video (for example composer and lyricist) gets a composer page draft and a person page draft.
- **Search demand is pattern-based only.** The Search Console and Google Ads adapters are stubs.
