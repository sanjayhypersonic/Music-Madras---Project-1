# ADR-0002: Settings, editorial content, unlisted-video exposure, featured content, playlist pages and notifications

- **Status:** Implemented on branch `music-madras-production-rebuild`; **uncommitted and not deployed**. Migrations were developed and applied **only** to the isolated local test database. Nothing here has run against production.
- **Date:** 2026-10-21
- **Builds on:** ADR-0001 (platform), the 6J phases (publishing integrity, RBAC rule "`RECORDING_PUBLISH` governs what visitors see").
- **Research:** `docs/research/museum-platform-research.md` (external sources cited by URL, kept separate from repository facts and from Music Madras's own decisions).

## 1. Context

Before this work the Museum could not (a) hold any editorial setting in the database, (b) show or edit site-level copy with a draft/publish lifecycle, (c) record *who* approved an unlisted video or approve it for anything narrower than "the whole Museum", (d) list its videos in a catalogue, (e) feature videos deliberately, (f) publish playlist pages, or (g) tell an editor that something needed their attention. The principle that governs all of it: **no hardcoded business content — data-driven and configurable by design**, with the exceptions written down (§9).

## 2. Decisions

### 2.1 Typed settings, not a key-value store
`modules/settings/settingsRegistry.ts` **defines** each setting in code (key, type, bounds, default, label, effect, owner, sensitivity, `viewAction`, `changeAction`). Values live in `site_settings` (`modules/db/repositories/siteSettingRepository.ts`). Rules:
- A row is only ever written for a registered key, after the definition's validator accepted the value; a stored value that no longer validates falls back to the default (never an error on a public page).
- Updates are one transaction with their audit entry and an optimistic-concurrency `version` (`expectedVersion`; 0 = nothing stored yet). Reset deletes the row (audited).
- Authorization is **per setting** (`modules/settings/siteSettingsService.ts`); a refused change is itself audited. Kinds cannot hold secrets: only boolean and bounded integer builders exist. Credentials, hostnames and provider keys stay in the deployment environment (Twelve-Factor); security, rights and visibility **invariants** are not settings.
- Studio: `/studio/settings/site`, grouped, showing owner, effect, default, who may change it.

### 2.2 Editorial content with a real lifecycle
`EditorialContent` gained `status`, SEO fields, `version`, a **published snapshot** (`published*`) and `editorial_content_publications` history. The public site reads the snapshot only; a draft edit can never change the live site. Publishing names the draft version reviewed, is exactly-once per version, and records history + audit in the same transaction. The block registry (`modules/mmke/editorial/editorialBlocks.ts`) is the technical binding between a **place on a page** and a stored row; the words are data. Rendering is a safe paragraph/heading parser into React text (no HTML, no Markdown).

### 2.3 One eligibility rule, with distinct surfaces
`modules/mmke/catalogue/videoExposure.ts` (`isVideoExposed(facts, surface)`) is the specification. Surfaces: **PAGE** (reachable by URL), **DISCOVERY** (listed: the `/videos` catalogue, homepage, featured, sitemap, and the related-video sections on entity pages — composers, works, venues, performances and the rest, all of which read `findPublicVideoPagesByYouTubeVideoIds`) and **PLAYLIST** (shown on one specific playlist page). Public YouTube videos need no exception; **private never**; an **unlisted** video needs, in addition, a *recorded, scoped, revocable* approval: PAGE, then (separately) DISCOVERY and/or a PLAYLIST approval per playlist page. YouTube playlist membership is not an input — the function cannot be told about it.

`modules/mmke/catalogue/videoExposureQuery.ts` is the SQL twin (`exposedVideoPageWhere(surface)`), used by every list so filtering, ordering and pagination happen in the database. **`tests/integration/videoExposureParity.test.ts` proves the two agree over 720 combinations × 4 surfaces** (visibility, availability, page state, approval history incl. revoked rows and look-alike values); `tests/unit/videoExposure.test.ts` checks the function against an independently written truth table.

Approvals (`video_exposure_approvals`, never deleted): approver, time, scope, note; revocation records who/when/why and **revoking PAGE revokes every other scope with it**; approvals for a page are serialized by a row lock; a recorded hold (rights/copyright/privacy) blocks approval; PLAYLIST approvals require an existing, un-archived playlist page the video is a curated member of. Revoking removes the video from discovery/playlists **without touching YouTube privacy**. The legacy flag `unlistedPublicationApprovedAt` remains as a cache of "an active PAGE approval exists" (a data step in migration 2 mirrors existing flags into PAGE approvals; `findApprovalFlagInconsistencies` and tests keep them in step).

### 2.4 Review queue for unlisted videos
`unlisted_review` rows + decision history + a **proposal fingerprint** (title, description, visibility, duration, availability, publish date — not view counts). An unchanged item is never surfaced as new; a changed one, a due deferral, or an approval revoked elsewhere is. Decisions (approve page / page + listing / chosen playlists, request information, defer, decline, revoke, hold) need `RECORDING_PUBLISH`, carry the fingerprint the reviewer saw (a changed video refuses the decision), apply in one transaction with their exposure change, and are audited. **One** deduplicated notification summarises the queue; it is re-raised only when the set or facts change, or once per `unlistedReview.cadenceDays` window. A recorded hold keeps a declined item from resurfacing.

### 2.5 Hybrid featured content
`featured_videos` holds editorial pins (`position`). `modules/mmke/featured/featuredRanking.ts` is a pure function: pins first (only if currently listable), then automatic fill ranked by `log(1+views) × (1 − w + w·0.5^(age/halfLife))` using **only** `currentViewCount` and `publishedAt` — the only evidence that exists (no watch time or engagement is invented). Every slot carries a plain-language reason. Slots, automatic-fill on/off, `w` and half-life are settings. Studio: pin, unfeature, reorder, preview of exactly what the homepage shows, pins shown as "not currently shown" when a video stops being listable.

### 2.6 Public `/videos` catalogue
Server-rendered, paginated in SQL, searchable (LIKE wildcards escaped — Prisma's `contains` does not), newest/most viewed. Page *n* is its own canonical; searches and non-default sorts are `noindex, follow` and canonicalise to `/videos`. Page size is a setting; the introduction is an editorial block. Navigation is **derived**: "Playlists" and "About" appear only while their destination exists; a skip link and a focusable `<main>` satisfy WCAG 2.4.1.

### 2.7 Playlist pages with an enforced quality rubric
`playlist_pages` (curated membership in `playlist_page_items`, **not** a mirror of a YouTube playlist), a draft + published snapshot (including the ordered member ids) and publication history. A page is published only when the **current** draft passes `modules/mmke/playlists/playlistQuality.ts` — deliberately **not a word count**: a title; a unique title; a summary saying what it is (switchable); at least *N* videos the Museum can show *on that playlist* (setting); human-supplied context (setting; 0 disables); a search description (switchable). Each result explains itself and the numbers. A failing page stays a draft, nothing is recorded as live, and **one** notification names the missing items (re-raised only if the failing *set* changes; resolved on publish). Live pages are re-checked by `runPlaylistQualitySweep` (revalidation after a material change: an approval revoked, a video made private, a threshold raised): one warning, never an automatic unpublish. Members are shown through the PLAYLIST surface, so an unlisted video appears only with its approval *for that playlist*.

### 2.8 AI-guided interview and drafting (propose, never decide)
`modules/ai/gateway/playlistAssistant.ts` uses the existing provider-neutral `AIProvider`. It asks **one** question at a time (never repeats, bounded by `playlistAssistant.maxQuestions`) and proposes a summary/introduction **only from an evidence set built in code** (`playlistEvidence.ts`): the playlist title; each *shown* member's title, publication date and the editor's curator note; every ACTIVE human-supplied answer/note. YouTube descriptions are excluded (uploader-written, injection surface). Model output is untrusted: `validatePlaylistOutput.ts` checks every sentence word by word against the evidence it cites and requires verbatim quotations (the first version's weaker capitalisation/number heuristic was replaced after the audit — see §10), and a draft that passes is only ever "needs human verification". A draft is stored as a **proposal** bound to an evidence fingerprint; a person accepts it into the page's *draft* (refused if evidence or the page changed since); it must still pass the rubric and be published by someone with `RECORDING_PUBLISH`. **Structurally the assistant has no path to publish, approve rights or approve an unlisted video** (a test asserts its modules import none of those functions). Without a configured provider (or when switched off) it says so plainly and notes still work.

### 2.9 Notifications
In-Studio is the reliable channel (always on, RBAC via `audienceAction`, per-user read state); email is optional (setting + configured provider) with per-recipient delivery rows, bounded retries with exponential backoff and jitter, honest `SKIPPED`/`FAILED`, and an administrator-visible delivery-problem notification. A unique `dedupeKey` + `contentFingerprint` make raising idempotent: the same unchanged condition never notifies twice.

## 3. Authorization map

| Action | Required |
|---|---|
| Edit a draft (editorial block, playlist page, its members, context notes, answers), ask the assistant, accept a draft into a draft | `CATALOGUE_WRITE` |
| Publish / unpublish / archive (editorial block, playlist page); approve or revoke any exposure; decide on the review queue; set/clear a hold; pin/unpin/reorder featured; change a review/catalogue/featured/playlist/assistant setting | `RECORDING_PUBLISH` |
| Change notification delivery (email) | `SETTINGS_MANAGE` |
| View settings that are editorial | `CATALOGUE_WRITE` |

No role or permission was added or widened. Every Server Action re-checks session and permission itself; refusals are tested for every action family.

## 4. Settings (15), ownership, validation, defaults, who may change them

| Key | Default | Valid | Owner | View / change |
|---|---|---|---|---|
| `notifications.email.enabled` | off | boolean | Platform administrator | `SETTINGS_MANAGE` / `SETTINGS_MANAGE` |
| `unlistedReview.enabled` | on | boolean | Editorial lead | `CATALOGUE_WRITE` / `RECORDING_PUBLISH` |
| `unlistedReview.cadenceDays` | 7 | 1–90 | Editorial lead | same |
| `unlistedReview.deferDays` | 30 | 1–365 | Editorial lead | same |
| `catalogue.videos.pageSize` | 24 | 6–60 | Editorial lead | same |
| `featured.homepage.count` | 6 | 1–24 | Editorial lead | same |
| `featured.autoFill.enabled` | on | boolean | Editorial lead | same |
| `featured.autoFill.recencyWeightPercent` | 50 | 0–100 | Editorial lead | same |
| `featured.autoFill.recencyHalfLifeDays` | 365 | 7–1825 | Editorial lead | same |
| `playlistQuality.requireSummary` | on | boolean | Editorial lead | same |
| `playlistQuality.minEligibleVideos` | 3 | 1–50 | Editorial lead | same |
| `playlistQuality.requireSeoDescription` | on | boolean | Editorial lead | same |
| `playlistQuality.minContextInputs` | 3 | 0–20 (0 = off) | Editorial lead | same |
| `playlistAssistant.enabled` | on | boolean | Editorial lead | same |
| `playlistAssistant.maxQuestions` | 8 | 1–30 | Editorial lead | same |

Not settings, on purpose: secrets/credentials/provider keys; the exposure rule itself; hold and rights invariants; which roles may do what.

## 5. Schema changes (all additive; developed and applied only to the isolated test database)

1. `20261021100000_phase6k1_settings_editorial_notifications` — `site_settings`; `EditorialContent` lifecycle columns + `editorial_content_publications`; `studio_notifications`, `…_reads`, `…_deliveries`.
2. `20261021110000_phase6k2_video_exposure_approvals_and_review` — `video_exposure_approvals`, `video_exposure_reviews`, `video_exposure_review_decisions` (+ a data step mirroring existing `unlistedPublicationApprovedAt` flags into PAGE approvals).
3. `20261021120000_phase6k3_featured_videos` — `featured_videos`.
4. `20261021130000_phase6k4_playlist_pages` — `playlist_pages`, `playlist_page_items`, `playlist_page_publications`, and the FK `video_exposure_approvals.playlistPageId → playlist_pages` (`ON DELETE RESTRICT`).
5. `20261021140000_phase6k5_playlist_context_and_drafts` — `playlist_context_inputs`, `playlist_draft_proposals`.
6. `20261021150000_phase6k_fix_carry_over_legacy_approvals` — adds `origin` / `confirmedAt` / `confirmedById` to `video_exposure_approvals`; marks the approvals carried over from the old flag and gives exactly those pages an explicit, marked listing approval so nothing is delisted (see §10).

Nothing was applied to production; applying them (and the legacy revision-relationship backfill, which was **not** run) needs explicit authorization.

## 6. Behaviour changes to existing public pages (intended)
- An unlisted video with an approved *page* is reachable by URL but **not listed** (homepage, related sections, sitemap) until it also has a DISCOVERY approval; its page is `noindex` and emits no JSON-LD. Five existing integration suites were updated to approve DISCOVERY explicitly.
- Homepage hero/story, footer tagline, site SEO and the `/videos` and `/playlists` introductions are editorial blocks. The homepage's "Discover" section is now "Featured videos" (hybrid selection), and public copy says "video" for video pages (the card, the page eyebrow); "Recording" stays reserved for the canonical archive entity.

## 7. Verification (see the final report for results)
Unit suites; isolated-DB integration suites including SQL/predicate parity, permission, revocation, notification-dedupe, draft/public separation, quality-failure, AI-evidence-validation, public-visibility, playlist-membership, settings-validation and audit-record tests; `tsc`; ESLint; `prisma validate`; production build.

## 8. Consequences and open items
- **No scheduler is configured.** A secured, hosting-neutral entry point exists (`/api/cron/stewardship`, see §10–§11 and `docs/runbooks/scheduled-maintenance.md`), but nothing calls it until a scheduler is chosen and `CRON_SECRET` is set. Every run is now recorded (Studio → Health shows when it last ran, what each step did and whether it has stopped). Until a scheduler exists the lifecycle, metadata, review and playlist checks also refresh when a signed-in Studio user loads a page (`modules/stewardship/runStewardshipSweepIfStale.ts`), and notification emails are never sent.
- **Email** needs a configured provider before it can deliver; until then the inbox is the only channel and Studio says so.
- **AI** needs `AI_PROVIDER`/`ANTHROPIC_API_KEY` on the deployment; without it the assistant is unavailable and says so.
- **Rubric cannot judge prose.** It tests structure and supplied evidence; a human still reads and approves. Thresholds are settings so they can be tuned with experience.
- **Automatic ranking** uses a view count that is a single overwritten value (no history) — it is not a trend. Cross-format comparison caveats from the YouTube API change apply.
- Public search (`/archive` and `/videos`) prepares visitor text in one place (`modules/mmke/search/searchText.ts`): bounded to 100 characters and with LIKE wildcards escaped, so `%` and `_` are literal. Studio's own internal lists still use plain `contains`; they are not public.

## 9. Exception register — what deliberately remains in code, and why

| Item | Where | Why it is not data / what bounds it |
|---|---|---|
| Setting **definitions** (keys, bounds, defaults, owners, authorization) | `settingsRegistry.ts` | They are the contract between code and stored values; values are data. |
| Editorial **block slots** (slug ↔ place on the page) | `editorialBlocks.ts` | The binding is code; the words are stored content. |
| **Transitional built-in copy** for 4 blocks | `builtInCopy.ts` | Keeps the live site from going blank before the first publish; shown only until a block is first published, labelled in Studio, one click to turn into an editable draft; never returns after a deliberate unpublish. **Remove once the blocks are published.** |
| Notification **kinds**, their audience action and severity | `notificationKinds.ts` | Name the conditions code detects; notification text/content is data. |
| Quality rubric **criteria** and their order | `playlistQuality.ts` | Logic; thresholds and on/off are settings. |
| Ranking **formula shape**; candidate pool bound (300 most viewed + 300 newest) | `featuredRanking.ts`, `featuredVideoRepository.ts` | Algorithm / technical bound; its parameters are settings. |
| Assistant **prompts** and output **schemas**; question length cap (300) | `modules/ai/prompts/playlistPage`, `modules/ai/prompts/recordingEditorial` | Instructions are code, versioned and recorded on every row: `playlist-page-v1` (interview), `playlist-draft-v2` (drafting), `recording-editorial-v3` (recordings: v2 plus an explicit rule that source text is data, never instructions). A prompt is never edited once a request has referenced it; a change is a new sibling version. |
| **Data-integrity limits** (title 160, summary 1000, body 12000, SEO 120/320, notes 1000/2000) | `playlistFields.ts`, `editorialBlocks.ts` | Protect storage/rendering, not editorial policy. |
| Delivery **retry** constants (3 attempts, backoff, jitter) | `studioNotificationRepository.ts` | Technical reliability bounds. |
| Opportunistic **sweep interval** (10 min) | `runStewardshipSweepIfStale.ts` | Technical throttle; idempotent. |
| Museum frame **cache lifetime** (30 s) | `museumChrome.ts` | Technical bound on how stale optional navigation chrome (footer tagline, About/Playlists links) may be. It caches nothing about visibility. |
| Email **stall threshold** (30 min) and minimum **CRON_SECRET length** (32) | `studioNotificationRepository.ts`, `cronAuth.ts` | A reporting threshold and a security minimum, not editorial policy. |
| The draft checker's **word lists** (function words, page-description words, number/quantity words) and sentence/quotation limits | `validatePlaylistOutput.ts` | Part of the mechanical grounding check; deliberately small and in code so they are reviewed like code. |
| **Navigation labels, section headings, UI labels**, the brand name used as the `<h1>` if the homepage introduction is withdrawn, logo alt text, button labels | `museumNavigation.ts`, page components | Interface chrome naming real routes, not editorial content. |
| **Archive category descriptions** and "Continue exploring" labels | `modules/mmke/homepage/archiveCategories.ts` | **Pre-existing** business copy in code. Known gap; recommended follow-up is to move the descriptions into editorial blocks. |
| Public-site **brand and descriptor text**: the site title and default description (``app/layout.tsx``), the phrase "Chennai's Western Classical Music heritage" in the metadata descriptions of the entity pages, ``/archive``, ``/collections`` and ``/learning`` (``app/(museum)/**/page.tsx``), the introductory sentences and headings of ``/archive``, ``/collections``, ``/learning`` and the homepage's "Explore the Archive" section, and the logo's alt text | ``app/layout.tsx``, ``app/(museum)/**``, ``components/museum/**`` | **Pre-existing** business copy in code, deliberately left in code for now (not moved into the database in this phase): it is the site's constant self-description, not content editors revise. The recommended follow-up, if it is ever to be editable, is ONE brand-descriptor editorial block that all of these compose from — not a block per page. Security rules, route names, technical defaults and the other items in this register are NOT candidates for editing in the database. |
| **Material-metadata rules**: which fields of an approved video's metadata count as a change (title, description, thumbnail, duration, published date, embeddability, channel), and how they are normalised | ``modules/mmke/catalogue/metadataFingerprint.ts`` | Logic, versioned (``mm-meta-v1``); it decides what a person must look at, so it is reviewed like code. |
| **Approval lifecycle rules**: private and archived end an approval, uncertainty never does | ``modules/mmke/catalogue/videoLifecycle.ts`` | Product policy fixed by the product owner and enforced in code at the state-transition boundary. |
| **Rubric text rules**: the placeholder list, the "repeats another note" rule | ``modules/mmke/playlists/textQuality.ts`` | Rubric logic (the criteria are code; thresholds are settings). Deliberately small and English-only: it catches the demonstrably empty, not poor prose. |
| Sweep **batch sizes** (100 videos, 50 pages, 50 playlist pages), transaction time limit per batch (20 s), stewardship lease (10 min), retained runs (500), "schedule stopped" threshold (3 h), email claim lease (5 min), step-failure notification threshold (2 runs) | ``unlistedReviewRepository.ts``, ``videoMetadataReviewRepository.ts``, ``videoLifecycleRepository.ts``, ``playlistPageRepository.ts``, ``stewardshipRunRepository.ts``, ``studioNotificationRepository.ts``, ``stewardshipJob.ts`` | Technical bounds and reporting thresholds. They decide no editorial matter and never what is public. |
| Search **length bound** (100 characters) | ``modules/mmke/search/searchText.ts`` | A bound on the work one request can ask of the database. |
| Review **states**, hold kinds, decision kinds | Prisma enums | The vocabulary of a workflow; records are data. |
| Tests use **synthetic** videos, titles, people and playlists only | `tests/**` | No production content or IDs are fixtures. |

## 10. Changes made after the implementation audit (findings F1–F9)

An independent read-only audit found nine defects that had to be fixed before the work could be split into commits. Product decisions: a deferred or information-requested approved video loses its approvals; existing approvals must not be silently delisted; holds are part of the eligibility rule; unsupported AI claims are rejected and nothing is ever "validated" without a person; email either really works or is not claimed.

- **F1** `decideReview`: DEFER and REQUEST_INFO now revoke the video's approvals (as DECLINE and REVOKE already did), so visibility always matches the decision on record. Re-approval is explicit; nothing is restored when a deferral falls due. The audit entry records how many approvals were revoked.
- **F2** Migration 6 and the Studio review path: the legacy approval is carried over as a marked PAGE **and** listing (DISCOVERY) approval — only for pages that already carried it — attributed to the page's last editor at the original time, with an audit entry (no human actor). Studio → Unlisted videos → *Carried-over approvals* lists them with *keep* (records who reconsidered), *stop listing*, and *withdraw completely*; one quiet notification stands while any wait. Nothing changes until someone decides.
- **F3** `reconcile:exposure-approvals` (script, dry run by default) and `docs/runbooks/exposure-approvals-rollout.md`: an idempotent reconciliation of flag-only approvals/revocations written by an older version of the software, with safe rollout and rollback sequencing. Not executed against any database other than the test database through tests.
- **F4** An active hold is an input of `isVideoExposed` and of its SQL twin (`exposedVideoPageWhere`): it denies every surface for every video, public or unlisted, whatever is approved. The parity matrix and the unit truth table include holds. Studio can record and clear a hold on any video from its page. Clearing a hold approves nothing.
- **F5** The assistant's draft is now a list of single sentences, each with the evidence ids it cites and verbatim quotations; the page text is assembled from those sentences by code. The checker verifies every word of every sentence (including the first, in any script) against the cited evidence only — numbers, number words, ordinals, vague quantities, negations, comparisons and causal links all need support — and that each quotation is verbatim in the cited evidence and bears on the sentence. What it cannot establish (that a sentence means what its evidence means) is stated beside every draft; a draft is never "verified" by code; accepting requires an explicit human confirmation, re-checks the stored sentences against the evidence as it is then, and applies only the re-assembled text. Drafts from the earlier, weaker version cannot be accepted.
- **F6** The "cannot be published yet" notification is raised when a failure is detected on a save, a change of videos, context or approvals, an AI draft being accepted, an explicit *Check now*, or a failed publish attempt — never only on publishing. It is updated only when the SET of missing items changes (its figures are refreshed quietly), and resolved when the draft passes. The sweep re-checks every page that has had one.
- **F7** `/api/cron/stewardship` (GET/POST, `Authorization: Bearer <CRON_SECRET>`; disabled with no/weak secret; constant-time comparison; counts-only responses) runs the review sweep, the playlist checks and **email delivery** through the existing provider. Each delivery is claimed before it is sent (never twice), DELIVERED is recorded only after the mail service accepts it, statuses are honest (skipped / failed), errors never store credentials, and Studio says when emails are waiting with nothing picking them up. Not configured → skipped and reported; switched off after queueing → skipped.
- **F8** The Museum frame no longer fans out: the Playlists-link check is two queries however many playlist pages exist; the frame's optional data is cached briefly and shared; and the site-wide 404 uses a static frame with no database access.
- **F9** Review-row creation is race-safe (`createMany … skipDuplicates`); sweep writes are conditional on the row being what the sweep read, so a decision made in between is never overwritten; decisions and holds create-then-lock the row; the review page tolerates a failed refresh.

The remaining findings (F10–F20), and the corrections to F2/F3/F5/F7/F9/F18 that the second audit required, are dealt with in §11.

## 11. Lifecycle and reliability hardening (second audit, F2–F20)

A second read-only audit found defects in the work above and in the lifecycle of what it protects. The product owner decided the open policy questions; this section records the policy as enforced, then each finding. Migrations 20261022100000–20261022150000 are additive and were applied only to the isolated test database.

### 11.1 The approval lifecycle (F11) — policy as enforced

| Situation | What happens to the approvals of an unlisted video's page |
|---|---|
| The video **stays unlisted** (any metadata change, statistics, a repeated write) | Nothing. Unlisted status alone never revokes an approval. |
| The video becomes **private** (YouTube reports ``privacyStatus: private``) | Every approval (page, listing, playlist) is revoked in the same transaction as the write, the legacy flag is cleared, the reason (``VIDEO_PRIVATE``) and the audit entry are recorded. Becoming unlisted again does NOT restore them: a **fresh, explicit approval** is required. |
| The page is **archived** | Same, reason ``PAGE_ARCHIVED``, in one transaction with the archive and its audit entry. **Restoring** the page restores no approval. An archived page cannot be approved (restore it first). |
| The video is **not observed** (a full pass that did not see it, a partial or failed sync, a sync error) | Nothing. Uncertainty is not a transition: the exposure rule hides the video while it is unobserved, but its approvals stand, and when it is observed again it is exposed with the same approvals. A partial or implausible pass flags nothing at all. |
| YouTube confirms the video **unavailable or deleted** (an explicit state the sync engine does not write from a partial pass; today it writes only observed / not-observed) | **Nothing is revoked** (owner decision: permanent revocation is authorised only for *private* and *archived*). The exposure rule hides the video — public or unlisted, on every surface — for as long as it is not observed, so it is never presented as available content; its approvals and their history stand untouched, and it is exposed again only when it is observed again **and** privacy, archive state, approval, publication and holds all still allow it. The revoke reason ``VIDEO_UNAVAILABLE`` is **retired**: it remains in the database enum only because removing a value needs a migration and a row carrying it would be history, but no code writes it, and it is not a lifecycle reason. |
| The page is **unpublished** | Nothing (the editor's own act; the approval stands). |

Enforcement is layered: (1) the **state-transition boundary** — ``updateYouTubeVideoFields`` / ``setYouTubeVideoObservability`` (the only writers of a video's privacy, metadata and observability) and ``archiveVideoPage`` — revokes inside the same transaction; (2) the **final exposure predicate** independently denies every private, archived, held, unapproved, unpublished or not-observed (so also unavailable, deleted, not-observed, sync-error) video whatever approvals exist — availability, privacy, archive state, approval and holds are each enforced on their own, so a retained approval never exposes anything by itself; (3) a **repeatable invariant sweep** (``runLifecycleInvariantSweep``, in the stewardship job and on Studio page loads) repairs any approval left standing on an archived page or a private video by a writer that bypassed (1), so a later return to unlisted or a restore cannot resurrect it. Studio says which of four states a page is in: *approved*, *approved — metadata review pending*, *approval revoked (private/archived)*, *awaiting fresh approval*.

### 11.2 Metadata re-review (F12)

An approved page stays public while its YouTube-side metadata changes. A **material** change — title, description, thumbnail (host and path; cache-busting queries ignored), duration, published date, embeddability, channel; whitespace and line-ending noise ignored; statistics, etag and playlist order never counted (``mm-meta-v1``) — is recorded as ONE pending review per page (``video_metadata_changes``) naming the fields and the before/after, audited, and shown in Studio (the page's panel, the review queue's section, one standing notification). Further changes update that review; a change back to the reviewed values resolves it as reverted; only an editor's explicit "I have reviewed this change" marks the new metadata as reviewed (audited with who). The reviewed baseline is recorded when a page approval is created; a page approved before this existed gets its baseline on first observation, stated in the audit log as a baseline, never as a reviewed change. When the approval ends (a person revokes it, the video goes private, the page is archived) the pending review is voided with it, and a fresh approval starts from a fresh baseline — the private/archive rules always win.

### 11.3 Findings

- **F2** Carried-over approvals no longer name an approver: the legacy flag recorded none, and "the page's last editor" was never evidence of who approved (migration 20261022100000 clears it on legacy rows and rewrites their note; the reconciliation script no longer invents one; Studio says "the old approval flag recorded no approver"). A carried-over **listing** approval is not kept on a page that is still a draft or is archived (a draft was never listed), and an approval on an archived page or a private video is not kept at all. Previously approved, published, unlisted pages stay public and listed exactly as before, marked and auditable, and open to reconsideration.
- **F3** The reconciliation rules no longer list a draft page, carry an approval onto an archived page or a private video (the stale flag is cleared instead), or add anything for a video that is not unlisted. The rollout runbook now documents what old code does after a rollback and a safe rollback sequence.
- **F5** The evidence checks keep combining marks of every non-Latin script (Tamil கல் ≠ கால்), tokenise marks as part of words, stem only plain English words and never below four letters ("news" no longer licenses "new"), recognise abbreviations ("St. Mary's", "No. 5", initials) and non-ASCII sentence ends, and tie a denial to a quotation in both directions. The residual limits (recombination of true words into a false statement; English-only word lists) are stated in the module and are the reason a person still verifies every sentence. Interview-question de-duplication no longer collapses every non-Latin question to an empty string.
- **F7** A delivery is CLAIMED for a lease (5 min) with a token before it is sent: a worker that starts later does not take it, the outcome is written only by the holder of the token, an expired claim (a crashed worker) is retaken, and re-raising a notification no longer deletes deliveries (an in-flight one keeps its claim and goes back to pending afterwards so the new text is sent too). A worker sends the notification as it is *now*. Failures are logged and stored on the delivery, scrubbed. If the mail service accepts a message but the outcome cannot be written, the delivery is reported (``unrecorded``) and sent again after the claim expires: **delivery is at-least-once, never exactly-once.** E-mail links are absolute and built from a validated origin (https, or loopback http); otherwise the e-mail carries no link.
- **F9** Sweeps work in bounded batches in a stable order, each in its own short transaction (20 s limit), and report batches and failures; a failed batch leaves only its own records for the next run and the queue notification is not rewritten from an incomplete picture.
- **F10** Durable per-step run state, a named lease so overlapping invocations cannot run the job twice, recovery of a crashed run, a scrubbed failure description per step, PARTIAL steps, a notification when a step fails twice in a row, and a Studio *Health* page. No scheduler is chosen or configured.
- **F13** The rubric refuses placeholders, text with no letters, a summary that repeats the title, a search description that repeats the title or summary, and context notes that are placeholders or repeat each other (they are not counted). It uses no word count and does not claim anything a page says is true.
- **F14** Member notes and the context a page was published with are part of the published snapshot; the public page reads them from there. The sitemap and public list report the publication time, not the last draft edit.
- **F15** Archiving a playlist page is one transaction (unpublish, archive, audit) under the page's row lock; every edit, member change, move, context change, draft proposal and publication of an archived page is refused with a typed error; restoring returns a draft. A published title is unique among live pages, guaranteed by a unique key (``publishedTitleKey``) maintained at publish, unpublish and archive; drafts and archived pages never conflict. Archiving a video page is one transaction with its audit entry.
- **F16** Active-approval uniqueness is a partial unique index (raw SQL, documented in migration 20261022120000; Prisma cannot express it); featured and playlist-member positions are unique indexes; reorders go through a temporary position and, for featured videos, a transaction-scoped advisory lock. The migration checks for duplicates first and stops with a clear message; it never deletes or rewrites data.
- **F17** The brand and descriptor text, the new rule modules and the new technical bounds are registered in §9; nothing was moved into the database.
- **F18** Review history has its own kinds for *hold recorded* and *hold cleared*; confirmation text is accurate for public and unlisted videos; the approval text says the page exposes the embedded player and the YouTube address; role wording is derived from the policy (``describeRolesThatCan``).
- **F19** The playlist sweep judges a live page by its published snapshot (title, summary, search description, context as published) and by what visitors can see of its published members, evaluated for a whole batch from one query with the same pure rule the SQL twin is proven equal to. It never compares a live page with another page's draft, works in bounded batches and resolves notifications that no longer apply.
- **F20** Public search escapes LIKE wildcards and bounds its input; recording-editorial prompt v3 states explicitly that source text and uploader metadata are data, never instructions (the structural separation of instructions and context was already in place and is unchanged).

### 11.4 What is still not claimed

Nothing here was run against production, a real mail server or a real AI model. Studio's authenticated pages were not exercised in a browser. No scheduler, hosting provider or monitoring service is selected or configured. The public site's brand text is still code (§9). Public videos have no approval and no metadata review: only approvals of unlisted videos are tracked.