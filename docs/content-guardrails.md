# Content guardrails: five gates

Status: 2026-11-18, branch `wip/credits-extraction`, uncommitted (project register R-33). This document **extends** the existing rules; it does not repeat them. Where a rule already exists, it is cited and the gate below only adds what was missing:
- `docs/content-intelligence-architecture.md`:
  - §5: the source trust hierarchy;
  - §22: provenance tags;
  - §64: prompt injection;
  - §84: closed-world generation and evidence discipline;
  - §86: conflicts are surfaced, never resolved;
  - §90: deterministic checks cannot prove truth;
  - §95–§97 and §107: Source approval as a hard gate;
  - §125: AI may propose sources; humans approve claims; nothing unapproved is stated.
- `docs/content-editorial-standard.md`:
  - §2: roles;
  - §7: description structure and tone;
  - §8: provenance tiers (basis 1–5).

The gates are pure functions under `modules/mmke/guardrails/`. They have unit tests on fake data (`tests/unit/contentGuardrails.test.ts`, fixture `tests/fixtures/guardrailsFakeClaims.json`). Today they run in `npm run ai:video-research-sheet` and `npm run ai:video-describe-draft`. Any future route that sends a prompt to a provider must run gate 3 on the model's output before a person sees it.

| Gate | Question it answers | Code |
|---|---|---|
| 1. Sources | Does this evidence count, and is there enough of it? | `sources.ts` |
| 2. Claims | Is this a well-formed, approved, current, uncontested claim? | `claims.ts` |
| 3. Generation | Does every sentence say only what its cited claims say? | `generation.ts` (on shared text helpers in `text.ts`) |
| 4. Publication | Who publishes, in what batches, with what second look? | `publication.ts` |
| 5. Audit | Can every decision be traced, and are old claims caught? | `audit.ts` |

## 1. Words

- **Source:** one page, document or record.
- **Claim:** one sentence about one subject of one video, with its sources (a row of `research-claims.csv`).
- **Approved credit:** a fact approved in the review sheets (`docs/video-credits-review-and-approval.md`). Approved credits are cited as `[V]` and are governed by that document; the gates below govern **claims**.

## 2. Gate 1: sources

**Tiers.** These refine §5's tier 3 ("approved external sources") for research claims:

| Tier | Meaning | Examples | Counts toward a minimum |
|---|---|---|---|
| A | Authoritative for this claim | the work's publisher or a library or score catalogue (IMSLP); the performing body's own record of its performance; an institution's official page about itself | yes |
| B | Reputable secondary | reference works, hymnal indexes (Hymnary.org), national newspapers | yes |
| C | Weak | fan sites, blogs, social media, video pages, pages with no identifiable owner | no: corroboration only |
| X | Excluded | unverified pages; Wikipedia used as a source (it is a pointer, §125); lyrics sites as evidence; AI output; search snippets; our own unapproved drafts | never |

The research sheet sets the tier from the source strength. A known domain fixes or caps that strength (`modules/jobs/videoResearch.ts`, `resolveSourceStrength`).

**Approval.**
- **Claims:** a source counts only through a claim a named person accepted (gate 2).
- **Studio Sources:** registered Sources keep §95–§97's own approval state, and the approval gate stays in code (§107).
- **No automatic registration:** accepting a claim does not register a Source.

**Independence.** Two sources are independent when their registrable domains differ and their excerpts are not near-copies (word-trigram similarity below 0.6). Corroborating sources of one claim are pooled: approved claims stating the same value about the same subject count together, but one site counts once.

**Minimum evidence per claim type** (`MINIMUM_EVIDENCE`):

| Claim type | Subject kinds | Minimum to state as fact |
|---|---|---|
| performance | conductor, choir, performer, venue, performance date, institution | one A |
| credit | composer, lyricist, arranger, translator | one A, or two independent B, or the video's own text plus one B (R-34) |
| title | work title, alternate title | one A or one B |
| publication | publisher, publication, composition date, text source | one A, or two independent B |
| background | background | two independent sources, at least one A |

A usable claim below its minimum is **weak**: it may be written only with attribution ("…, according to <source>"), never as plain fact. A claim with no countable source is not usable.

## 3. Gate 2: claims

**Schema** (`GuardedClaim`): `claimId`, `youtubeVideoId`, `subjectKind`, `workTitle`, `value`, `statement`, `sources[]` (url, tier, excerpt, approved), `status`, `approver`, `approvedAt`, `retrievedAt`.

In `research-claims.csv` these are the columns `claimId`, `sourceTier`, `status`, `decision`, `approver` and `retrievedAt`, beside the existing ones (`docs/video-research-workflow.md` section 3).

**Status.** One of:
- `proposed`
- `accepted` (needs a decision **and** a named approver)
- `rejected`
- `deferred`
- `conflict`
- `stale`

**Scope rules** (`claimProblems`). A claim:
- is one sentence of at most 300 characters;
- states its value, and the value appears in a source excerpt;
- uses no banned wording (gate 3);
- has a known subject kind;
- if accepted, has an approver.

These add to the research sheet's checks: a short excerpt, the value in the excerpt, no lyrics, Wikipedia as a pointer only.

**Exclusions.** These subjects are never claims:
- lyrics;
- theological or musical interpretation (that is the editor's own writing);
- reception, popularity and superlatives;
- private facts about living people;
- motives.

**Conflicts are never resolved by code.** This applies §86 to claims. Two live claims about the same subject with different values put **both** in `conflict`, and so does a claim that disagrees with the video's approved credits. A conflicted claim is blocked until a person rejects all but one value, or corrects the approved credits. Code never picks the stronger source.

## 4. Gate 3: generation

Closed-world generation and evidence discipline are §84's rules, and untrusted text is handled as §64 says. Three additions:
- **Prompt data.** The prompt data block holds only approved credits (`C1…`) and usable claims (`[1]…`), each marked with its tier and whether it is weak (`video-description-v1`).
- **Untrusted text.** Uploader text, web pages and proposals files are data. A page that gives instructions becomes a `notFound` note, never an action.
- **Code-enforced output checks.** These run on every draft's prose, whoever wrote it (`checkDraftProse`, `checkTraceability`):

| Check | Rule |
|---|---|
| Traceability | Every sentence that is not fixed boilerplate (the archive sentence, the invitation) cites at least one usable claim. |
| Names | Every capitalised word, and every word in a non-Latin script, appears in the cited claims or the recording's own title. |
| Dates and numbers | Every number, year, month and quantity word appears in the cited claims. |
| Denials | A "not / never / no" must appear in a cited claim. |
| Weak claims | Must carry attribution ("according to …", or a named source with a reporting verb). Stating one as plain fact is rejected. |
| Opening sentence | Starts with the title as written (original script kept), is not a generic opener ("In this video", "Welcome", "Discover"…), and is at most 250 characters. |
| Banned phrases | No superlatives or praise ("timeless", "masterpiece", "beloved", "one of the most"…), no hedges that carry claims ("it is believed", "reportedly", "traditionally"…), and no filler ("a testament to", "delve"…). |
| Anti-generic | A sentence that names nothing and dates nothing is refused. |
| Near-duplicates | Claim paragraphs of different videos must be under 50% trigram similarity, and must not share an opening once each title is removed. |

These checks reuse the playlist assistant's text handling (folding, tokens in any script, Tamil marks kept, the conservative English stemmer, sentence boundaries, negation). It moved unchanged to `modules/mmke/guardrails/text.ts`, so there is one implementation.

What the checks cannot do is §90's limit: they test words, not meaning. Words from the claims can be recombined into something the claims do not say, so a person still reads every sentence beside its citations.

## 5. Gate 4: publication

- **No automatic publication**, anywhere. `planPublicationBatches` returns `autoPublish: false` as a fixed type. It only arranges review batches for people.
- **What can enter a batch.** A draft is batched only when gate 3 passed, a named editor approved it, and none of its claims is in an unresolved conflict. The plan lists every exclusion with its reason.
- **Batches.** At most 25 drafts, 10 by default. One reviewer publishes a batch by hand through the existing Studio / YouTube workflow.
- **Sampling.** A deterministic, seeded sample of at least 20% of each batch (and at least one draft) goes to a second reviewer first. That sample **always** includes every draft that relies on a weak claim.

## 6. Gate 5: audit

- **Decision log.** `npm run ai:video-describe-draft` compares `research-claims.csv` with the log's latest state and appends `research-audit.jsonl` (append-only, never rewritten). It logs:
  - `CLAIM_DECIDED`: a first decision;
  - `CLAIM_DECISION_CHANGED`: a changed decision, with the previous one;
  - `CLAIM_APPROVER_CHANGED`: a change of approver;
  - `CLAIM_MARKED_STALE`: a claim marked stale.

  The spreadsheet can change silently, so the log is written by the first tool that reads the decisions.
- **Stale claims.** A claim is marked stale when a source is known to have changed, or when it was read more than 365 days ago (`markStaleClaims`, from `retrievedAt`). A stale claim is not usable until it is re-researched and re-approved. Marking a claim stale never deletes it and never silently un-approves it: the status changes and the log records it.
- **Studio records.** Studio's own records keep their audit trail (`AuditLogEntry`, §51 and §96).

## 7. Limits and open items (R-33)

- **Approval stays human.** The approver is a typed name in a spreadsheet, not an authenticated Studio user. The audit log makes changes visible but cannot prove who typed them. Moving claims into Studio would make approval authenticated.
- **Source changes.** `changedUrls` (a source that changed) has no producer yet. Nothing re-fetches pages, so only the age rule fires today.
- **Imperfect site matching.** Registrable domains use a heuristic, not the public-suffix list. Independence cannot see that one page copied another without sharing words.
- **Names in lower case.** The name check finds capitalised words. A name written in lower case is caught only by the editor.
- **Model output.** The prompt's model output still has no end-to-end validator wiring gate 3 to a provider call (R-32). The checks exist; the route does not.
