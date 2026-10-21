# Recording publication and revision-editing safety (Phases 6J-10B, 6J-10C, 6J-10D)

This describes what is implemented in `modules/db/repositories/recordingRepository.ts`,
`mediaResourceRepository.ts` and `performanceRepository.ts`. It does not claim published-page
immutability: see [Limitations](#limitations).

## Model in one paragraph

A `Recording` points at at most one open draft (`currentDraftRevisionId`) and one live revision
(`currentPublishedRevisionId`). **Every operation that changes a Recording's lifecycle or its draft takes the same
per-Recording PostgreSQL advisory lock first** (bounded wait), and only then touches rows. Under that lock each
operation re-reads current state and writes conditionally; draft content saves additionally carry a
compare-and-swap in the `UPDATE` itself as a database-level backstop.

## 1. The `recording-edit:<id>` advisory lock and the lock protocol

- `withRecordingEditLock(recordingId, fn, lockTimeoutMs = 5000)` runs `fn` in one transaction that first
  sets a transaction-local `lock_timeout` and then takes
  `pg_advisory_xact_lock(hashtext('recording-edit:<recordingId>'))`.
- The wait is bounded: after 5 seconds (`RECORDING_EDIT_LOCK_TIMEOUT_MS`) the operation fails with
  `RecordingBusyError` (publish reports reason `BUSY`). Because `lock_timeout` is transaction-local it also bounds
  row-lock waits inside that transaction.
- The lock is released at commit or rollback. State read after the lock is taken sees everything committed by
  earlier holders.
- **Order is always advisory lock first, then row locks.** Nothing takes a row lock and then waits for the advisory
  lock, so no cycle between the two is possible. The row locks held across statements are publish's
  `FOR UPDATE` on the draft row and (Phase 6J-10F) on the original Performance when promoting a clone, taken after the
  Recording lock. The one other advisory lock is the per-Programme lock (section 9); the complete order is **Recording
  lock, draft row, Programme lock, Performance rows**.
- Transaction limits: `timeout: 30000`, `maxWait: 10000`.

Operations that take the lock (own transaction): publish, submit for review, archive, restore, unpublish,
**fork a new draft**, **draft content saves**, **create a Performance for a draft**, and the child writes in
section 4. `applyApprovedContentSuggestion` runs its whole transaction through `withRecordingEditLock` (the same
lock key, the same 30 s transaction and the same 5 s `lock_timeout` as everything else; there is no exception to the
protocol) and calls fork and save with that transaction (`client`), so they join it. If the lock is not available
within 5 s it returns the typed refusal `{ ok: false, reason: "BUSY" }` ("This Recording is being changed by someone
else right now. Nothing was changed. Try again in a moment.") with nothing applied; a typed
`RevisionNotEditableError` raised inside it (the Recording changed state outside the protocol) rolls the transaction
back and maps to the matching refusal (`RECORDING_ARCHIVED`, `RECORDING_NOT_FOUND`, otherwise `NO_REVISION`).

## 2. Publication and the other lifecycle operations

`publishRecordingDraft({ recordingId, actorId, expectedDraftRevisionId?, enforceCompleteness?, lockTimeoutMs? })`,
inside the lock and in one transaction:

1. Re-reads the Recording and refuses if it is missing, `ARCHIVED`, has no open `DRAFT`, or the caller's
   `expectedDraftRevisionId` is no longer the current draft.
2. Locks the draft row (`SELECT … FOR UPDATE`) and re-checks the required completeness categories against
   committed data.
3. Applies conditional writes, each with its expected state in the `WHERE` clause and the row count checked: draft
   `DRAFT → PUBLISHED`; previous live revision `PUBLISHED → SUPERSEDED`; Recording status and pointers moved only if
   `currentDraftRevisionId` is still that draft and the Recording is not archived.
4. Writes the `RECORDING_PUBLISHED` audit entry in the same transaction.

A refused, stale or failed attempt rolls back completely: the live revision stays live and no success audit
exists. The result is explicit (`ok: false` with a reason: `RECORDING_NOT_FOUND`, `RECORDING_ARCHIVED`,
`NO_OPEN_DRAFT`, `STALE_REVISION`, `NOT_READY`, `STATE_CHANGED`, `BUSY`, `FAILED`); no database error reaches the
Studio. `publishCurrentDraft` skips the completeness gate and throws on refusal.
`modules/publishing/publishRefusal.ts` maps reasons to editor-safe messages.

`submitRecordingForReview`, `archiveRecording`, `restoreRecording` and `unpublishRecording` each run under the lock,
re-read state, refuse (plain `Error`) when the state is not the one they need, change state with a conditional
`updateMany` (row count checked), and write their audit entry through the same transaction client. Archiving an
already-archived Recording is a no-op with no second audit entry. Fault-injection tests cover both "the audit write
fails" and "the operation fails right after the audit write": in both, the state change, any new rows and the audit
entry are all rolled back.

## 3. Draft compare-and-swap (content saves)

`updateDraftRevisionContent(recordingId, expectedRevisionUpdatedAt, actorId, patch, client?, { expectedRevisionId? })`
runs under the edit lock (unless the caller passes its own transaction, which must then hold it). Inside:

1. It reads the Recording: missing / `ARCHIVED` / no open draft → `RevisionNotEditableError`
   (`RECORDING_NOT_FOUND` / `RECORDING_ARCHIVED` / `NO_OPEN_DRAFT`); a different current draft than
   `expectedRevisionId` → `ConcurrentEditError`.
2. It issues one conditional `UPDATE` (`updateMany`) whose `WHERE` requires: the draft's `id`; `revisionStatus = DRAFT`;
   `updatedAt =` the token the editor loaded; and that the revision is the current draft of a Recording whose status
   is not `ARCHIVED`. The write sets `updatedAt = max(now, expectedToken + 1ms)`. The column is `TIMESTAMP(3)`, so
   the token is advanced explicitly to be strictly greater than the one it replaces and can never repeat or move
   backwards, even for two saves in the same millisecond. A row count other than one throws `ConcurrentEditError`.

Two writers holding the same token cannot both succeed. Because saves hold the lock, a save and a lifecycle
operation on the same Recording cannot interleave: the save runs entirely before the archive (and the archive then
follows) or entirely after it (and is refused as `RECORDING_ARCHIVED`); no save can commit after an archive has
committed. The `WHERE` conditions remain the backstop for writers that do not follow the protocol (direct SQL,
tests, a future code path): a stale token, a non-`DRAFT` revision, a moved pointer or an archived Recording still
matches no row.

- The Studio binds the draft's revision id into each form; a different current draft is a conflict, never a
  redirect to another revision.
- A lock that cannot be had within 5 s becomes `RecordingBusyError`.
- `createPerformanceForDraft` takes the lock, creates a Performance and links it to the draft with the same CAS in
  one transaction, so a refused save leaves no orphan Performance row.
- Saves for different Recordings do not block each other. Saves for the same Recording are serialized.

## 4. Child writes

`attachWorkToRevision`, `detachWorkFromRevision`, `attachMediaToRevision` and `attachRightsToMedia` call
`withEditableDraftRevision(revisionId, fn)`: take the lock, then verify (in the same transaction) that the revision
exists, is a `DRAFT`, is the Recording's current draft, and the Recording is not archived. Otherwise
`RevisionNotEditableError` (`STALE_REVISION` or `RECORDING_ARCHIVED`) is thrown and nothing is written. The write
and its audit entry commit together; if either fails, both roll back.

- Recording intake passes its own transaction (it creates the Recording and its first draft in it); eligibility is
  verified on that transaction.
- `attachRightsToMedia` guards media that belongs to a revision. Media with no revision is unchanged.
- Child writes do not advance the content token.

## 5. Fork (start a new draft)

`forkDraftFromPublished(recordingId, actorId, client?)` without a transaction runs under the lock. Inside the
transaction that creates the fork it:

- re-reads the Recording and refuses an `ARCHIVED` one with `RevisionNotEditableError` (`RECORDING_ARCHIVED`) —
  nothing is created and no audit is written; the Studio check is no longer the only guard;
- refuses (plain `Error`) when a draft is already open or nothing is published;
- creates the revision with copied works and media, then moves the pointer with a conditional `updateMany`
  (`currentDraftRevisionId` still null and the status unchanged from what was read); a count other than one throws
  and rolls back the new revision, the copies and the audit.

Two simultaneous forks therefore produce exactly one draft; the loser gets the plain "already has an open draft"
message, never a raw database error. A fork racing restore or archive either runs before (and is refused or
archived afterwards) or after (and sees the final status). The Studio's "Start a new draft" shows typed refusals as
messages, treats "a draft appeared meanwhile" (double click) as success, and reports a busy Recording as busy.

## 6. Which mechanism protects what

| Operation | Edit lock | Conditional write / CAS |
|---|---|---|
| publish | yes | conditional transitions; `FOR UPDATE` on the draft row |
| submit, archive, restore, unpublish | yes | conditional `updateMany` on status |
| fork a new draft | yes | conditional pointer move |
| Studio autosave steps (source, SEO, educational) | yes | full CAS in the `UPDATE` |
| create Performance for a draft | yes | full CAS |
| attach/detach work, attach media, attach rights | yes | eligibility check under the lock |
| apply approved suggestion | yes (via `withRecordingEditLock`; fork and save join it) | full CAS inside |

## 7. Typed refusals

| Error | Meaning | Safe to show |
|---|---|---|
| `ConcurrentEditError` | stale token / revision, or the draft changed state under the write | yes |
| `RevisionNotEditableError(reason)` | not found, archived, no open draft, stale/non-current revision | yes |
| `RecordingBusyError` | the lock was not available within 5 s | yes |
| apply refusal `BUSY` | the same, reported by apply-approved-suggestion as a refusal instead of an exception | yes |
| plain `Error` from lifecycle operations | state precondition not met (e.g. not archived, draft already open) | callers show their own fixed text |

Studio callers (autosave actions, performance, works, media, review, start-new-draft) map the typed errors to
messages; raw database errors are not shown.

## 8. Running the relevant integration tests safely

Integration tests must only ever run against the isolated local test database
(`127.0.0.1:54329`, database `music_madras_test`), configured through `TEST_DATABASE_URL` (see `.env.test`,
which is gitignored). Confirm the host and port are loopback before running; never point it at a real database.

```bash
npm run test:integration:db:start
npm run test:integration:setup
npx vitest run --config vitest.integration.config.ts lifecycleSerialization draftCasAndChildWrites publishAtomicity
npm run test:integration:db:stop
```

`npm run test:integration:reset` returns the test database to an empty state. Suites:
`tests/integration/publishAtomicity.test.ts` (10B), `draftCasAndChildWrites.test.ts` (10C),
`lifecycleSerialization.test.ts` (10D), `sharedRecordIsolation.test.ts` (10F) and the apply-lock cases in `contentSuggestionApplication.test.ts` (10D);
`tests/unit/publishRefusal.test.ts` covers refusal messages. The tests use
explicit barriers (holding the edit lock or the draft row lock from outside, a hook between a function's read and
its write) rather than sleeps; `stillPending` only asserts that something is blocked. Tests that need media on an
already-published revision seed it with `tests/integration/helpers/seedRevisionRows.ts`, which bypasses the
repository on purpose and is imported only by tests.

## 9. Shared records: ownership and versioning (Phase 6J-10F)

Governing rule: **draft edits made through the Recording workflow must not silently change published content.**
Different records are owned differently, so they are handled differently:

| Record | Ownership | What the Recording workflow can do to it |
|---|---|---|
| `RecordingRevision` (content, works, media, per-media rights link) | revision-owned | edit only the editable draft (sections 3-4) |
| `Performance` participants (performers, choirs, conductors) | the Performance row is **shared** between a published revision and its fork | **copy-on-write**: the draft edits its own clone; publication promotes it (below) |
| `Performance` itself (programme, venue, date, slug) | canonical event | the workflow only creates a **new** Performance for the draft (`createPerformanceForDraft`); it never edits an existing one |
| `Programme` running order | canonical, shared | the workflow **refuses** to change a Programme that published content shows |
| `Venue`, `Artist`, `Choir`, `Conductor`, `MusicalWork`, `Composer` | canonical catalogue identities | the workflow only picks existing ones (or creates new ones); it does not edit them |
| `RightsInformation` | canonical, shared | no Studio path edits an existing record (create only) |

Catalogue editing (Studio > Catalogue: renaming a Venue or Artist, a Performance's date, a Programme's items,
reassigning a Performance's programme or venue) is the explicit, deliberate way to change a shared catalogue record
and is **intentionally global**: it is not draft preparation and is not guarded by this model.

### Performance participants: copy-on-write, promoted on publish

`editDraftPerformanceParticipants({ recordingId, expectedPerformanceId, actorId, change })` runs under the edit lock in
one transaction:

1. Verifies the draft is the editable current draft of a non-archived Recording and still uses
   `expectedPerformanceId` (otherwise `RevisionNotEditableError`; a stale form never edits another Performance).
2. If **any other revision** uses that Performance, creates a clone owned by this draft: same Programme, Venue and
   date, new id and slug, copies of the participant links and of the original's Instrument rows,
   `draftOfPerformanceId` = the original and `draftBaseParticipantsKey` = a fingerprint of the participants it was
   copied from. The original is share-locked (`FOR SHARE`) while it is read, so a concurrent promotion cannot change
   it halfway: the copy and the fingerprint are one consistent snapshot. The draft revision is re-pointed at the clone
   with a conditional write that also advances the content token (so a form loaded before the edit conflicts instead
   of overwriting). The clone, its copies and its audit entry (`PERFORMANCE_CLONED_FOR_DRAFT`) are written in the same
   transaction.
3. Applies the change (and its audit entry) to the draft-owned Performance in the same transaction. A Performance used
   only by this draft is edited in place; later edits reuse the clone.

A clone is never public: public eligibility requires a Performance to be used by a **published** revision. Studio's
Performance list hides clones.

**Publication promotes the clone — unless the original changed since.** Inside `publishRecordingDraft`, under the
Recording's lock and after the completeness check, if the draft's Performance is a clone of the previously published
revision's Performance:

1. the original Performance row is locked `FOR UPDATE` (lock order: this Recording's edit lock, the draft row, then the
   original — no other path takes them in another order). A second Recording promoting to the same original waits here
   (bounded by the 5 s `lock_timeout`: reason `BUSY`) until the first publication commits, and then reads the
   *committed* participants;
2. the original's participants are fingerprinted and compared with `draftBaseParticipantsKey`. If they differ — another
   Recording's promotion, a catalogue edit, anything — the publication is **refused** with the typed reason
   `PERFORMANCE_CHANGED` and rolls back completely (nothing is published, no audit is written, the clone and the
   draft survive). A clone with no recorded fingerprint cannot be verified and is refused the same way. The message
   tells the editor what to do: open the Participants step, choose **Discard my participant changes**, re-apply, publish
   again;
3. otherwise the clone's participants replace the original's, the draft revision is re-pointed at the original, the
   clone's instrument copies and the clone are deleted, and `PERFORMANCE_DRAFT_PROMOTED` is audited (before/after
   participant ids) — all in the publication transaction. The public page changes exactly when the publication
   commits, at the same URL (the original keeps its slug).

So two Recordings that share one Performance can no longer overwrite each other: the first promotion wins; the second
is refused instead of replacing the first result. A draft that switched to a brand-new Performance publishes that
Performance as before; a draft with no participant edit does not promote anything.

**Discarding the participant changes.** `discardDraftPerformanceClone({ recordingId, actorId })` (Participants step:
"Discard my participant changes", shown with a warning when the original has changed) runs under the edit lock in one
transaction: re-points the draft at the original Performance (conditional, advances the content token), deletes the
clone and its instrument copies, audits `PERFORMANCE_DRAFT_CLONE_DISCARDED`. It is idempotent (`discarded: false` when
the draft has no clone) and refuses an archived Recording. The editor then re-applies the edits, which makes a fresh clone
from the *current* original, and publishes — keeping the other Recording's change. There is no merge. This discards
the participant edits only, not the draft.

**Instruments.** An `Instrument` belongs to a Venue and has one optional `performanceId`, so "the clone has the same
instruments" means copies of the rows owned by the clone (same Venue, name, maker, year, archived state). They are
created in the cloning transaction, deleted when the clone is promoted or discarded (so nothing is orphaned), and
excluded from the Studio venue inventory (`findVenueById`) so no instrument shows twice. The original's instrument rows
are never touched; no Studio workflow edits instruments, so promotion writes none back.

Canonical identities stay shared: the clone references the same Programme, Venue, Artist, Choir and Conductor rows;
none are duplicated.

### Programme running order

`addProgrammeItem` / `removeProgrammeItem` accept `refuseIfInPublishedContent`; the Recording workflow's Programme
step sets it. When any Performance using the Programme is used by a published revision of a **published** Recording,
the change is refused (`ProgrammeInPublishedContentError`: create a new programme for this recording, or edit it
deliberately from the Catalogue) and nothing is written. A programme that no published content shows can be built
freely, and becomes protected once it is published (and editable again if the Recording is unpublished).

**Serialized against publication.** The check and the write run in one transaction under a per-Programme advisory lock
(`programme-edit:<id>`, bounded by `lock_timeout` 5 s; `ProgrammeBusyError` on expiry). `publishRecordingDraft` takes the
same lock for the draft Performance's Programme right after it locks the draft row and holds it until the publication
commits. So a guarded edit either completes before the publication (and is part of what gets published — publication does
not validate Programme content) or waits for it and is then refused; it can never write to a Programme after a publication
has made it live. Lock order: Recording lock, draft row, Programme lock, Performance rows. Programme edits take no other
lock and never wait for anything a publication holds, so there is no cycle; two Recordings publishing the same Programme
simply queue on the Programme lock. The catalogue path does not take the lock.

### Schema and rollout

One additive migration (`20261019120000_phase6j10f_performance_draft_clone`): two nullable columns on `performances`
(`draftOfPerformanceId`, `draftBaseParticipantsKey`), an index and a `SET NULL` self foreign key. Every existing row keeps `NULL` (an
ordinary Performance); nothing is rewritten or dropped; code that predates the column ignores it. Rollout: apply the
migration **before** deploying the code that uses the column; rolling the code back leaves the column harmless. It was
applied and tested only against the isolated test database. Existing published recordings, drafts and recordings with
no draft read and publish exactly as before (covered by tests).

## 10. Revision-scoped relationships: the foundation (Phase 6J-11B) — in use since Phase 6L

**Status (Phase 6L): in use.** The text below describes the foundation as built in 6J-11B (storage and write functions). It was
inert then; **the cutover was implemented in Phase 6L (§15)**: the Studio Relationships step writes these tables, and the Organisation
page, the AI context and the Studio read them. The legacy Recording-level rows (`entity_sources`, `entity_rights`,
`entity_occasions` with `entityType = "RECORDING"`) are now frozen history. The leak described in the Limitations section is closed
for Recording-level Sources, Rights and Occasions in code; **it is closed in production only once the migrations are applied and
the release is deployed** (§15, "Deployment sequence"). The original design and cutover plan are in the Phase 6J-11A audit.

**Decisions this foundation implements.** A Recording's sources, rights information and occasions become revision-scoped.
Source, RightsInformation and Occasion stay shared catalogue identities (links are stored, rows are never copied).
Collection membership stays collection-owned, and Learning Guide membership, Sheet Music Requests and `MediaResource`
rights links are not versioned.

**Tables** (migration `20261020120000_phase6j11b_recording_revision_relationships`, additive: three `CREATE TABLE`s with
indexes and foreign keys; no existing table is altered or dropped):

| Table | Key | Foreign keys |
|---|---|---|
| `recording_revision_sources` | `(revisionId, sourceId)` | revision `CASCADE`, source `RESTRICT` |
| `recording_revision_rights` | `(revisionId, rightsInformationId)` | revision `CASCADE`, rights `RESTRICT` |
| `recording_revision_occasions` | `(revisionId, occasionId)` | revision `CASCADE`, occasion `RESTRICT` |

Each also has `createdAt` and an index on the catalogue id. The composite key makes a duplicate link impossible at the
database level; the foreign keys make orphans impossible; a revision's links are deleted with it; a catalogue record a
revision uses cannot be deleted from under it (the app has no delete path for these anyway). Existing
`recording_revisions` need no change: a revision simply has no rows until it is forked from, or edited after, this code.

**Functions** (`modules/db/repositories/recordingRevisionRelationshipsRepository.ts`): `attach…`/`detach…` for
`Source`, `Rights` and `Occasion`, and `list…ForRevision`. Every write runs through `withEditableDraftRevision`: the
Recording's edit lock, then a check — in the same transaction — that the revision is a `DRAFT`, is the Recording's
current draft, and the Recording is not archived (`RevisionNotEditableError` otherwise; published and superseded
revisions can never be changed). The link and its audit entry (`SOURCE_/RIGHTS_/OCCASION_ATTACHED_TO_` /
`…_DETACHED_FROM_RECORDING_REVISION`, entity type `RecordingRevision`) commit or roll back together. Typed errors:
`DuplicateRevisionRelationshipError`, `RevisionRelationshipNotFoundError`; a missing Source/Rights/Occasion, or an
archived Occasion (same convention as the legacy attach), is refused with nothing written. Waits are bounded by the same
5 s `lock_timeout` (`RecordingBusyError`).

**Fork.** `forkDraftFromPublished` now also copies the published revision's three link sets onto the new draft in the
same transaction (a failure leaves no draft and no partial copy); the fork audit records `copiedSourceCount`,
`copiedRightsCount` and `copiedOccasionCount`. After the fork the two revisions' sets are independent.

**Authorization is not decided here and was not changed.** The repository functions perform no permission check. Today the
Relationships step is gated by `CATALOGUE_WRITE`. `CATALOGUE_WRITE` and `RECORDING_WRITE` are **not interchangeable**:
`CONTRIBUTOR` holds `RECORDING_WRITE` only, while `EDITOR`, `REVIEWER`, `ADMINISTRATOR`, `SUPER_ADMINISTRATOR` and
`FOUNDER` hold both. Moving the step to `RECORDING_WRITE` therefore **widens** access to contributors; that is a
decision for the cutover phase, not something this foundation does.

**Rollout and compatibility.** Apply the migration before deploying this code; rolling the code back leaves the tables
harmless (empty, or populated only by drafts forked/edited in the meantime). Existing recordings, public pages and AI
context are unchanged (covered by tests). The backfill utility exists since 6J-11C (section 11). Still to do, in later phases: running it against a real
database (needs an authorized, reviewed target allowlist), switching Studio writers and the three readers, the Collection guard,
and the rollback re-projection script.

## 11. Revision relationship backfill (Phase 6J-11C) — a utility, not wired into anything

**What it is.** A dry-run-by-default, idempotent operator script that projects the legacy Recording-level Source, Rights
Information and Occasion links (`entity_sources` / `entity_rights` / `entity_occasions`, `entityType = "RECORDING"`) into
the revision-scoped tables of section 10. It is **data-migration tooling only**: no application reader or writer uses the
new tables yet, nothing is dual-written, no legacy row is ever deleted or rewritten, and the script is **not** part of
deployment, the build, application startup, the YouTube sync or any Studio workflow (`package.json` has one operator
entry, `backfill:revision-relationships`, and nothing calls it). The leak in the Limitations section is **still present**
until the separately approved cutover.

**Projection rules** (`modules/backfill/revisionRelationships/backfillPlan.ts`, pure and unit-tested):
- For each Recording, every legacy link is projected to its **current published revision** and its **current draft
  revision**, where present and safe. Superseded revisions get nothing. Nothing is inferred from titles, descriptions, AI
  or entity matching.
- A pointer is *safe* only if its revision exists, belongs to that Recording and has the expected status (`PUBLISHED` /
  `DRAFT`). An unsafe pointer is skipped and reported; a safe sibling pointer still receives the links. A Recording with no
  safe pointer has its links skipped (counted), never guessed.
- Unapproved Sources and archived Occasions are projected like any other link (approval and archival remain read-time
  filters) and are counted as "preserved".
- Insert-only: rows that already exist are counted and left alone (not rewritten, `createdAt` included). A link an editor
  **detached** from a revision (found in the audit trail, `*_DETACHED_FROM_RECORDING_REVISION`) is not re-added to that
  revision. Revision-scoped rows with no legacy counterpart (an editor's own edits) are reported and never touched.

**Configuration and target safety.** The script never reads `DATABASE_URL` / `DIRECT_URL` as a target, never imports the
application Prisma client or `dotenv/config`, and never loads a `.env` file into the environment. It uses its own variables:

| Variable | Meaning |
|---|---|
| `BACKFILL_DATABASE_URL` | the target (required; **no fallback of any kind**) |
| `BACKFILL_TARGET_CONFIRM` | must equal `host:port/database` of that URL: the operator names the target |

It refuses (exit 4, naming only host/port/database, never a credential) unless **all** of these hold: the URL is set and
has the strict form below; the environment is not production; the host is a **loopback IP literal** (`127.0.0.1` or
`::1` — in this phase no remote database, production, staging or otherwise, and no host *name* can be a target); the
database name has a "test" word; the acknowledgement matches; the target is not any configured real database
(`DATABASE_URL` / `DIRECT_URL` in the shell or any `.env*` file, which are *parsed for comparison only*); and, after
connecting, the database carries the integration-test marker (`music-madras-integration-test`, written only by
`npm run test:integration:setup`) with the 6J-11B migration applied. A name that merely looks like a test database is
therefore not enough. A later phase that is authorized to backfill a real database must add an explicit, reviewed
allowlist to `backfillTarget.ts`; nothing else makes it possible.

**The validated target *is* the connection.** The PostgreSQL driver parses a connection string by its own rules: a query
parameter such as `?host=` or `?port=` overrides the URL's host and port, and a URL without a port takes it from the
`PGPORT` environment variable. A check that only looked at the URL's authority would therefore validate one destination
and connect to another. So the raw string is **never given to the driver**:
- `BACKFILL_DATABASE_URL` must be exactly `postgresql://user[:password]@host:port/database`. A query string or fragment
  (even an empty one), a missing port, a missing user, several hosts, a multi-segment path, a database name with anything
  but letters, digits, `_`, `.` or `-`, and any host that is not the literal `127.0.0.1` / `[::1]` (including `localhost`,
  `127.1`, `0x7f.0.0.1`, `2130706433`, `0.0.0.0`) are refused before any connection is attempted.
- The driver is constructed from the validated fields only — `{ host, port, database, user, password }`, every
  destination field explicit — so neither the URL nor `PGHOST` / `PGPORT` / `PGDATABASE` / `PGUSER` / `PGHOSTADDR` in the
  environment can change where it connects. The script also checks that the destination the driver will use equals the
  acknowledged `host:port/database` and refuses otherwise; the printed `Target:` line is that same value.
- The run-time marker check remains, but it is a second, independent signal, not the primary protection: a remote
  connection is impossible by construction.

**The comparison with the real database fails closed.** The `.env*` files are located from the repository root (resolved
from the script's own location, **not** from the shell's working directory), and the check is "can the real database be
determined?", not "was a real database found?". If the root is not recognised (no `package.json`), cannot be listed, or any
`.env*` file (other than `.env.example`) cannot be read or parsed, the script refuses (exit 4) instead of carrying on with
a shorter list. The files are parsed in memory; no value is printed, and the refusal names only the file and an error code.

**Commands** (PowerShell; the isolated local test database from `npm run test:integration:db:start`):

```powershell
# the URL must be plain (no ?options, no #fragment) and must give the port explicitly
$env:BACKFILL_DATABASE_URL = "postgresql://postgres@127.0.0.1:54329/music_madras_test"
$env:BACKFILL_TARGET_CONFIRM = "127.0.0.1:54329/music_madras_test"
npm run backfill:revision-relationships                 # dry run: reads, plans, reports, writes nothing
npm run backfill:revision-relationships -- --execute    # applies the plan in ONE transaction
npm run backfill:revision-relationships -- --json       # machine-readable report (also with --execute)
```

Exit codes: `0` done (dry run or executed), `2` failed (rolled back), `4` refused / configuration.

**How writes are made safe.** A dry run runs in a `READ ONLY` transaction: the database itself rejects any write. `--execute`
is one transaction: a global advisory lock (concurrent runs queue, never interleave), `lock_timeout` 5 s (a `recordings`
row held by a publish/fork/archive makes the run fail cleanly rather than wait), a share-lock on every `recordings` row (no
pointer moves underneath it), the plan is computed **inside** the transaction after the locks are held, rows are inserted
with `ON CONFLICT DO NOTHING` against the composite primary keys, and a post-check re-plans and requires zero remaining
inserts before `COMMIT`. Any error — including a failed post-check — rolls everything back.

**Report format.** Per relationship type (`SOURCE`, `RIGHTS`, `OCCASION`) the report states, and every line is an accounting
identity so no row is silently dropped:
- `legacy rows = orphaned + duplicates + distinct links` — *orphaned*: rows whose entityId matches no Recording (counted
  only here); *duplicates*: rows beyond the first for the same (Recording, target) — the legacy `entity_sources` and
  `entity_rights` tables have no unique constraint (`entity_occasions` does);
- `distinct links = skipped (no safe revision) + eligible`;
- per target revision: `planned inserts`, `already present`, `skipped (editor detached)`, and the count of revision-scoped
  rows with no legacy counterpart (left untouched); plus the preserved unapproved-Source / archived-Occasion counts.

It also lists anomalies by code with exact counts and up to 10 sample ids each (`ORPHANED_LEGACY_LINK`,
`DUPLICATE_LEGACY_LINK`, `NO_REVISION_POINTER`, `POINTER_REVISION_MISSING`, `POINTER_REVISION_OTHER_RECORDING`,
`POINTER_STATUS_MISMATCH`, and — the only one that blocks `--execute` — `DETACH_EVIDENCE_ON_OLDER_REVISION`) and the recordings summary. Anomalies are facts about the legacy data, so they are reported on
every run, including after an execute. The report contains counts and opaque ids only.

**What the script is, and what it is not (read before scheduling it).**
- **Detach evidence is scoped to the exact revision and is not inherited by a fork.** A detach recorded in the audit trail
  names one revision. It keeps that link off *that* revision only. A draft forked from a published revision later gets the
  fork's own copied link set (6J-11B), so a link detached from the old draft is not suppressed on a new fork, and the
  backfill never carries it across revisions.
- **Detach evidence cannot be reliably ordered against later legacy edits.** The legacy link tables have no timestamps.
  If an editor detached a link from a revision and a legacy writer later re-added or re-edited the same Recording-level
  link, the script cannot tell which came last; it treats the detach as the editor's decision and does not re-add the row.
  (An existing revision-scoped row always wins over detach evidence. Since 6J-12, evidence on an *older published* revision of the
  same Recording, for a link planned onto a newer one, is reported as `DETACH_EVIDENCE_ON_OLDER_REVISION` and blocks
  `--execute`; see section 13.) Review the "skipped (editor detached)" counts in the
  dry run: any non-zero figure is a place where legacy and revision-scoped data were already editor-diverged.
- **It is an insert-only projection, not a synchronisation.** It never updates or deletes a revision-scoped row and never
  mirrors later legacy changes. Run once, **immediately before the approved cutover**, after the legacy writers can no
  longer diverge from what the cutover will read. Running it earlier leaves a gap that nothing fills; running it repeatedly
  is safe (idempotent) but is not a way to keep two stores in step.
- **A dry-run report can be affected by concurrent changes.** The dry run reads in a single read-only transaction at
  `READ COMMITTED`, not a snapshot: Studio and sync writes that commit while it runs may be partly reflected in the
  report. Treat a dry run as an estimate; `--execute` recomputes the plan after taking its locks, and its post-check
  (which can fail, safely, with a rollback, if a legacy edit lands during the run) is the authoritative one. Legacy link
  edits take no `recordings` lock, so the share lock does not hold them off.
- **`--execute` can block recording writers briefly and must be scheduled as maintenance.** It takes a share lock on
  every `recordings` row and a global advisory lock for the duration of the transaction. A publish, fork, archive or
  any other write that needs to update or exclusively lock a `recordings` row queues behind it, and if the script cannot
  acquire a Recording's lock within 5 s (because one of those operations holds it) it fails and rolls back. Run it in a maintenance window with writers quiet, never from a
  schedule or a hook.

**Rollback considerations.** The script only ever inserts; legacy rows are never modified, so there is nothing to restore
there. A run is all-or-nothing. A *committed* run cannot be undone by a script in this phase (none is provided): the rows
it added are ordinary revision-scoped links that nothing reads yet, so leaving them is harmless, and the reviewed re-projection
script (revision-scoped → legacy, dry-run first) belongs to the cutover phase. Run a dry run, review the anomalies, and
run `--execute` **before** the Studio writers are switched: afterwards, an editor's change to a draft is only protected from
being re-added by the audit trail, not by any other record.

## 12. Pre-cutover checklist for the relationship backfill (Phase 6J-11D) — NOT approved, NOT scheduled

Nothing here authorises a cutover. It lists what must be true, and who must decide what, before the backfill is run on a
real database and the Studio writers/readers are switched. Every production figure below is **unknown until measured**:
the numbers in this repository come from the integration-test fixture and say nothing about production data.

**What was rehearsed (fixture facts, isolated loopback test database only).** The committed script was dry-run against the
test fixture (9 Recordings; every classification below occurs in it). Reproduce with the commands in section 11. Expected
fixture figures, asserted by `tests/integration/revisionRelationshipBackfill.test.ts`:

| | legacy rows | orphaned | duplicates | distinct | skipped (no safe revision) | planned inserts | already present | skipped (detached) |
|---|---|---|---|---|---|---|---|---|
| Source | 12 | 2 | 1 | 9 | 1 | 9 | 1 | 1 |
| Rights | 5 | 1 | 1 | 3 | 0 | 4 | 0 | 0 |
| Occasion | 4 | 1 | 0 | 3 | 0 | 5 | 0 | 0 |

Totals: 18 planned inserts, 1 already present, 1 skipped (editor detached); 2 unapproved Sources and 1 archived Occasion
preserved; anomalies `DUPLICATE_LEGACY_LINK` 2, `ORPHANED_LEGACY_LINK` 4, `NO_REVISION_POINTER` 1,
`POINTER_REVISION_OTHER_RECORDING` 1. `POINTER_REVISION_MISSING` and `POINTER_STATUS_MISMATCH` are covered by the planner's
unit tests but do not occur in the integration fixture (the database's foreign keys prevent the first; the second needs a
pointer to a superseded revision). The same script against an empty database reports all zeros.

### Checklist (all items must be satisfied, in this order)

1. **Fresh dry run immediately before the approved maintenance window.** Not a report from days earlier. Archive the
   complete text and `--json` output (counts and opaque ids only) with the change record.
2. **Explicit disposition of every anomaly category, by a named approver.** The script's *behaviour* is fixed (below); what
   is *unknown* is how many occur in production and whether the behaviour is acceptable for them:

   | Category | What the script does | Production count | Decision required |
   |---|---|---|---|
   | `ORPHANED_LEGACY_LINK` | counts it; never projects it (no Recording to attach to) | unknown — measure | leave as is, or clean up the legacy rows separately before cutover |
   | `DUPLICATE_LEGACY_LINK` | projects one link; counts the extra rows | unknown — measure | none expected (one link results); confirm |
   | `NO_REVISION_POINTER` | skips that Recording's links | unknown — measure | whether those Recordings' links are intentionally dropped, or a pointer must be repaired first |
   | `POINTER_REVISION_MISSING` / `_OTHER_RECORDING` / `_STATUS_MISMATCH` | skips that pointer; a safe sibling pointer still receives the links | unknown — measure | each is a data-integrity fault: repair the pointer (a separate, reviewed change) or accept the loss of that revision's links |
   | Unapproved Sources / archived Occasions | projected and counted (approval/archival stay read-time filters) | unknown — measure | confirm that readers keep filtering; no data decision |
   | Editor-detached links | not re-added to that exact revision | unknown — measure | see item 4 |
   | `DETACH_EVIDENCE_ON_OLDER_REVISION` (6J-12; only a detach on an older *published* revision counts, 6J-12A) | still planned, but **`--execute` refuses** while any exist | unknown — expected 0, measure | a person decides each case (section 13 C); there is no override |
   | Revision-scoped rows with no legacy counterpart | left untouched | unknown — measure | confirm they are editor-created, not leftovers |

   A category with a non-zero production count and no recorded disposition is a **stop condition**.
3. **The legacy relationship dataset has not changed since the accepted rehearsal.** Record, at acceptance time, the row
   counts of `entity_sources` / `entity_rights` / `entity_occasions` (`entityType = 'RECORDING'`), the Recording pointer
   state (`currentPublishedRevisionId`, `currentDraftRevisionId`) and the dry-run totals; repeat the measurement
   immediately before `--execute`. Any difference means the accepted rehearsal no longer describes what will run: re-run,
   re-review, re-approve. (The legacy tables carry no timestamps, so counts and the dry-run totals are the evidence.)
4. **Decision on detach / fork behaviour (needs approval).** Evidence of an editor's detach is read from the audit trail,
   is scoped to one revision, is not inherited by a fork, and cannot be ordered against later legacy edits (section 11).
   Decide, and record, whether that is acceptable: for example whether a link an editor removed from a draft but that still
   exists at Recording level should reappear on the first fork after cutover. Until decided, the script's behaviour is the
   only one available.
5. **Decision on legacy links added after the one-time backfill (needs approval).** The backfill is insert-only and not a
   sync. A legacy link written between the backfill and the cutover is **not** projected. The options are: freeze
   Recording-level link writes from the start of the maintenance window until the readers/writers switch (the product
   decision of Phase 6J-11A is that legacy rows are frozen at cutover); or re-run a dry run after the window to measure the
   delta and decide whether to run again. Which one applies, and who confirms the window is quiet, must be decided.
6. **A verified backup and restore plan.** A restore point of the target database taken immediately before `--execute`,
   with a *tested* restore (to a scratch database, never over the live one) and a named owner. The script cannot undo a
   committed run; this is the only recovery for the inserts. Whether Neon branch/point-in-time restore satisfies this is
   to be confirmed with evidence, not assumed.
7. **Application readers and writers are unchanged until a separate cutover approval.** At backfill time no Studio
   writer, public reader, AI context builder or Collection guard uses the revision-scoped tables (verify with a search of
   the code at the deployed commit for any reference to the `recording_revision_*` models outside their repository and the
   fork copy, and with the backfill's no-wiring test). The backfill and the cutover are separate
   approvals; approving one is not approving the other.
8. **The script's target safety has been re-reviewed for the real target.** In this phase the script refuses every
   database except the local, marked test database. Running it on a real database needs a separate, reviewed change to
   the allowlist in `backfillTarget.ts` and its tests, approved on its own. Do not work around the refusal.

### After `--execute`: reconciliation and stop conditions

- **Reconcile immediately** (read-only): re-run the dry run — it must report 0 planned inserts, and `already present`
  must equal the pre-run planned inserts plus the previously present rows. Compare per-table row counts with the dry run's
  expected totals. Spot-check a sample of Recordings: the links of the published and draft revisions equal the legacy links
  (minus the recorded dispositions).
- **Stop, do not proceed to cutover, and restore from the backup or re-plan** if any of these holds: the execute run exits
  non-zero or rolled back (nothing was written — find out why first); the post-run dry run reports any planned insert; the
  row counts differ from the accepted dry run; an anomaly category appears that had no recorded disposition; legacy row
  counts changed during the window; any sampled Recording does not reconcile; or a writer was active during the window.
- Cutover itself (switching writers/readers, the RBAC decision, the Collection-membership guard, the rollback
  re-projection script) is a later, separately approved phase.

## 13. Cutover design: decisions, controls and the rollback boundary (Phase 6J-12) — implemented in Phase 6L (§15)

*Phase 6L implemented this design; §15 records what was built and how it differs, if at all. The text below is the design as approved.*

Nothing in this section switches a reader or a writer to revision-scoped relationships. (The one behaviour change made in code is the Collection-membership guard of B, which applies to the existing Collection tables.) The legacy Recording-level rows stay authoritative until a separate,
approved cutover. The decisions below come from reading the code, the grant matrix and the tests; the first two are pinned by
`tests/integration/relationshipEditingPermissions.test.ts`.

### A. Who may edit relationships — decision: keep `CATALOGUE_WRITE` (no RBAC change)

What exists today:
- `RECORDING_WRITE` = create/edit a Recording draft revision; held by **every** role including Contributor.
  `CATALOGUE_WRITE` = create/edit catalogue records (Composer, Work, Artist, Venue, Collection, Source, Rights, Occasion…);
  held by Editor, Reviewer, Administrator, Super Administrator, Founder — **not** Contributor. The role comments in
  `modules/auth/policy.ts` describe Editor as "relational entity mapping" and Contributor as "ingestion / draft-creation only".
- Every mutation of the Relationships step — attach/detach Source, Rights, Occasion, and add to Collection — checks
  `can(role, "CATALOGUE_WRITE")` in its Server Action, and the page shows the controls only when `can(…, "CATALOGUE_WRITE")`.
  The repository functions (legacy and revision-scoped) take an `actorId` and do **not** check roles: the Server Action is the gate.

Decision: the revision-scoped Source / Rights / Occasion writers must be gated by **`CATALOGUE_WRITE`**, exactly as now. It is
the least privilege that preserves today's workflow: `RECORDING_WRITE` would newly allow Contributors to attach Sources, Rights
and Occasions, a widening nothing has asked for. No grant changes. The cutover's new Studio actions must call
`can(role, "CATALOGUE_WRITE")` before the repository (the 6J-11B repository enforces only draft-eligibility, locking and audit).
Whether Contributors should ever relate content is a separate product question, not part of this cutover.

### B. Collection membership — decision (Phase 6J-12A): live changes need `RECORDING_PUBLISH`

Before 6J-12A nothing checked the publication state of a Collection or Recording when membership changed; any Editor (`CATALOGUE_WRITE`)
could change what visitors see in a live Collection. The rule now enforced, server-side:

> **A change is live when the Collection is `PUBLISHED` and the Recording is `PUBLISHED`. A live add, remove or reorder of a Recording
> needs `RECORDING_PUBLISH`** (Administrator, Super Administrator, Founder) in addition to the existing `CATALOGUE_WRITE`.
> Every other combination — draft Collection, or a Recording that is draft, in review or archived — keeps `CATALOGUE_WRITE` alone.

Precise semantics (all pinned by `tests/integration/relationshipEditingPermissions.test.ts`):
- "Published" means the `status` column. A **published-but-archived Collection counts as published** (restoring it would publish the
  change instantly). The guard reads the state at the moment of the change and follows it: unpublishing a Collection frees Editors,
  republishing blocks them again.
- **Reorder:** moving a Recording changes the visitors' order of the published Recordings only if the *moved* Recording is itself published
  (every other Recording keeps its relative order). So a reorder is live exactly when the Collection and the **moved** Recording are
  published. Moving a draft Recording inside a published Collection is not guarded.
- **Entry points (all of them):** add — Recording > Relationships `addToCollectionAction` and Collection page `addRecordingAction`;
  remove — `removeRecordingAction`; reorder — `moveRecordingAction`. Each passes `canPublish: can(role, "RECORDING_PUBLISH")` to the repository,
  which decides and writes in **one transaction while holding share locks on the Collection and Recording rows**, so a concurrent publish
  cannot slip between the check and the write (a test holds an uncommitted publish and shows the Editor's add waits, then is refused).
  A refusal is a typed error (`CollectionMembershipPublishRequiredError`) shown as an ordinary message; nothing is written and no audit entry is made.
  A static test fails if any code under `app/`, `modules/` or `scripts/` calls these functions without the guard.
- **Not changed:** Work membership (`addWorkAction`/`removeWorkAction`/`moveWorkAction`) and every other Collection operation keep
  `CATALOGUE_WRITE`; Contributors remain refused on every membership path; no grant changed. Callers that pass no guard (tests, scripts)
  get the old unguarded behaviour — this is by design for non-Studio callers, and no Studio entry point may do it (see the static test).
- The Studio pages still show the controls to Editors; a live change is refused when attempted (the server is the gate).
### C. Detach, fork, publish — the rule, the behaviour, and what the backfill enforces

**Rule (Phase 6J-12A).** An explicitly detached relationship becomes part of the **published revision's canonical relationship set when that
revision is published**. Later drafts fork from that set and must not get the relationship back. A detachment that stays in an **unpublished draft**
is only that draft's state: it must not suppress the relationship in any other revision.

| Event | Revision-scoped behaviour (6J-11B, tested) | Legacy rows |
|---|---|---|
| Fork a published Recording into a draft | the draft gets an exact copy of the published revision's three link sets | untouched |
| A draft detaches a link | the row is removed from **that draft only**; the published revision keeps it (frozen); one audit entry names the draft | untouched |
| That draft is published | the published set is exactly the draft's set: the detachment is now canonical; the previous revision is superseded and unchanged | untouched |
| Another draft is created after that | a fork of the *new* published set, so the detached link stays off | untouched |
| The draft is not published | nothing else changes: the published set (and the next fork's source) still has the link | untouched |
| A legacy link is added/removed later | nothing happens: no mirror, no sync (insert-only backfill, no dual writes) | changes |

The existing lifecycle already satisfies the rule (a fork copies only the published set, and a draft is the only place a detach can happen), and
`tests/integration/revisionRelationshipBackfill.test.ts` now walks both cases end to end: published detachment (the published set loses the link,
the earlier superseded revision keeps it, the next fork lacks it) and unpublished draft detachment (the published set keeps it, the draft alone lacks it).

**What the backfill does with detach evidence** (it cannot see intent in legacy rows: they carry no timestamps and revisions record no parent):
- A detach on the *same* revision as the target is respected (not re-added to that revision), whether or not it is published.
- A detach on an **older revision that was published** (status `PUBLISHED`, or `SUPERSEDED` after having been published; an unknown status is treated as
  published) while a link is planned onto a **newer** revision is reported as **`DETACH_EVIDENCE_ON_OLDER_REVISION`** (counted, with
  `kind:recordingId:targetId` samples) and **`--execute` refuses while any exist** (it rolls back and exits non-zero; the dry run still completes and labels
  it `BLOCKS --execute`). The script neither re-adds nor drops the link on its own: a person decides. There is no override.
- A detach on an older revision that is **still a draft** (never published) is **not** canonical: it is not flagged, does not suppress anything
  elsewhere, and the link is planned normally. A detach on a *newer* draft than the published target is the normal case and is not flagged.
- In the intended cutover sequence no revision-scoped writer is in use before the backfill, so the anomaly is expected to be **zero in production —
  to be verified by the pre-execute dry run, not assumed.**
### D. Cutover controls

**Prerequisites before switching any reader or writer** (all must hold, in order):
1. Section 12's checklist is satisfied (fresh dry run accepted, dispositions recorded, backup verified, target-allowlist change
   separately approved) and the backfill has been executed once on the real database, with a clean reconciliation (below).
2. Decisions A (keep `CATALOGUE_WRITE`), B (live membership needs `RECORDING_PUBLISH`, implemented in 6J-12A) and C (detach rule, section 13 C) are approved as recorded.
3. The new Studio relationship actions exist with `CATALOGUE_WRITE`, the draft-eligibility repository functions, and tests
   equivalent to the legacy ones (attach, detach, duplicate, concurrency, audit-in-transaction, published set frozen).
4. Every public reader that shows Recording-level Source / Rights / Occasion (Recording page, Organisation page aggregation, AI
   context) reads the **published revision's** rows, with a test that a draft edit does not change the public page.
5. Readers and writers switch **in one release**, writers never ahead of readers (a writer writing rows nothing reads, or a reader
   reading rows nothing wrote, is a silent divergence). No dual writes.
6. Legacy Recording-level link writes are removed or refused in that same release (decision of Phase 6J-11A: legacy frozen).

**Reconciliation (read-only), run immediately after the backfill and again after the switch:** the post-backfill dry run
reports 0 planned inserts; per-table revision-scoped row counts equal the accepted dry run's expected totals; for a sample of
Recordings the published revision's links equal the legacy links minus the recorded dispositions; the public page of each sampled
Recording is unchanged by the switch; no `DETACH_EVIDENCE_ON_OLDER_REVISION` anomaly existed.

**Rollback triggers:** any failed reconciliation check; a public page whose Source/Rights/Occasion content differs from before the
switch; an editor's relationship edit that does not appear on the draft or leaks to the published page; an anomaly with no
recorded disposition; errors on the new writers.

**The safe rollback boundary is the first revision-scoped Studio write after the switch.** Before it, reverting the release is
lossless: legacy rows were never modified, so the old readers/writers resume exactly where they left off, and the extra
revision-scoped rows are inert. After it, legacy rows no longer receive edits (no dual writes), so a revert loses those edits
unless they are first re-projected revision-scoped → legacy. That re-projection tool is **prepared** (Phase 6J-12B, section 14) but is not an approval of anything: it must be reviewed, its backup procedure verified and a rollback explicitly authorized before it is relied on, or the switch must be accepted as one-way past that boundary. The
backup of section 12 is the recovery for the backfill's inserts only.

**Legacy data:** nothing in this phase, the backfill, or the switch deletes or rewrites a legacy relationship row. Removing
them, if ever wanted, is a separately approved migration after a soak period, with its own backup.

**Backfill target restrictions are unchanged:** the script still refuses every database except the local marked test database
(section 11). Running it on a real database needs its own reviewed, separately approved allowlist change; this phase adds no
override of any kind.

## 14. Revision-to-legacy re-projection: rollback preparation (Phase 6J-12B) — prepared, NOT approved, NOT scheduled

**Preparing rollback capability is not approving a cutover, and it is not approving a rollback.** This section describes a dry-run-first
tool, `npm run reproject:legacy-relationships` (`scripts/reprojectLegacyRelationships.ts`, `modules/backfill/legacyReprojection/`), that
could put the legacy Recording-level Source / Rights / Occasion rows back in line with the revision-scoped relationships if a *future,
separately approved* cutover had to be reversed. Nothing here switches a reader or a writer, adds a dual write, or runs against any
database other than the isolated, marked, loopback test database. Production anomaly counts and dispositions remain **unknown until
measured from approved production evidence**; every figure in the tests is a fixture fact.

### The projection contract

It is **not** the inverse of the insert-only backfill. The backfill only adds rows; reversing a cutover must also remove the legacy links an
editor deliberately removed since, and the legacy tables (`id, entityType, entityId, target` — no timestamps, no origin) cannot say why a
row exists. So the tool removes a legacy row **only when the audit trail proves** it was removed, and otherwise reports a conflict and keeps it.

1. **Authoritative revision** (per Recording; `Recording.status` is not consulted, so unpublished and archived Recordings are projected too):

   | Recording state | Authoritative revision |
   |---|---|
   | published pointer present and safe | the **published** revision (legacy rows are what visitors see once readers are rolled back; a draft's unpublished edits must not become public) |
   | no published pointer, draft pointer present and safe (never published) | the **draft** revision (nothing public is affected) |
   | published pointer unsafe (revision missing, another Recording's, wrong status — e.g. a superseded revision) | **none: BLOCKING conflict**, Recording skipped; it never falls back to the draft |
   | draft pointer unsafe next to a good published one | the published revision; reported (`DRAFT_POINTER_UNSAFE`, information) |
   | no pointers | none: skipped and counted (`NO_REVISION_POINTER`), legacy rows untouched |
   | superseded revisions | never authoritative |

2. **Representation.** A link is one legacy row `(entityType "RECORDING", entityId = the Recording, source / rights / occasion id)` in
   `entity_sources` / `entity_rights` / `entity_occasions`. Inserted rows get new ids (legacy rows carry no timestamps to preserve).
3. **Per Recording and kind**, with D = the authoritative revision's links and L = the legacy links:
   - D \ L → **insert** (unapproved Sources and archived Occasions are inserted as they are; approval and archival are read-time filters);
   - D ∩ L → **retained**, untouched (duplicate legacy rows of a retained link are left and counted);
   - L \ D **with proof** → **remove every legacy row of that link**. Proof is an audit "detached" entry for that link on a revision of the same
     Recording that was **published** (status `PUBLISHED`, or `SUPERSEDED` after having been published) or on the authoritative revision itself.
     So a **published detachment is preserved** (it removes the legacy link; a later fork, which lacks the link too, never brings it back), while a
     **draft-only detachment** is not proof: the published set still holds the link, so it is retained;
   - L \ D **without proof** → **conflict** (`LEGACY_LINK_NOT_IN_REVISION_SET`): the row is kept and the run is blocked. It may be a link the
     backfill never projected or one a legacy writer added; the tables cannot tell. An unknown revision status is never proof.
4. **Never touched:** orphaned legacy rows (no such Recording), links of Recordings with no authoritative revision, revision-scoped rows, and
   the Source / Rights / Occasion records themselves.
5. **Blocking conflicts** (no override): `AUTHORITATIVE_POINTER_MISSING`, `_OTHER_RECORDING`, `_STATUS_MISMATCH`, `LEGACY_LINK_NOT_IN_REVISION_SET`.
   Information only: orphans, duplicates, no pointer, unsafe draft pointer, `UNPUBLISHED_DRAFT_DIFFERENCE`.
6. **Report:** per kind, legacy rows = orphans + duplicates + distinct links; distinct links = skipped + retained + removed + conflicts;
   authoritative links = retained + inserts; plus a deterministic **plan fingerprint** (SHA-256 of the sorted inserts, removals and blocking counts).

### What it can and cannot restore

| Can | Cannot |
|---|---|
| Re-create legacy links that exist in the published (or never-published draft) revision but not in legacy | **Unpublished draft edits.** Legacy has no draft concept; where a draft's set differs from the published one the Recording is reported (`UNPUBLISHED_DRAFT_DIFFERENCE`) and those edits are *not* carried back |
| Remove legacy links an editor removed in published history (proven by audit) | The **original ids or order** of rows it removes and re-adds, and any information the legacy rows never held (no timestamps or origin exist) |
| Leave everything it cannot explain exactly as it is, reported | **Detach history not in the audit trail** (e.g. audit entries that were deleted): such a link is a conflict, not a removal |
| Be re-run safely (idempotent: a second plan is empty) | Links added by a **legacy writer after cutover**: they look like unexplained links and block the run. The cutover must have frozen legacy writes (section 13 D) |
| Be undone: the audit entry lists every removed row (restore with the same ids) and every inserted row id (delete) | Anything for Recordings with no safe authoritative revision (skipped) |

### How a run is made safe

- **Target.** `REPROJECT_DATABASE_URL` + `REPROJECT_TARGET_CONFIRM=host:port/database`, under *exactly* the backfill's rules (same function, own variable names, never
  `BACKFILL_*`, `DATABASE_URL` or `DIRECT_URL`): strict `postgresql://user@host:port/database`, no query string or fragment, explicit port, loopback IP literal only, a "test"
  database name, not a configured real database (fail-closed `.env*` scan from the repository root), the integration-test marker and the 6J-11B migration verified after connecting.
  The driver receives the validated fields only, and the destination it will use must equal the confirmed target. **In this phase no remote database is accepted, and there is no override.**
- **Dry run is the default** and runs in a `READ ONLY` transaction. **`--execute` requires `--plan-fingerprint=<64 hex>`** copied from a reviewed dry run; the plan is recomputed
  inside the transaction and must have that fingerprint, otherwise nothing is written (exit 2).
- **Execution** is one transaction: `lock_timeout` 5 s; the backfill's advisory lock and its own (the two tools exclude each other); a share lock on every Recording
  (no publish/fork/archive moves a pointer underneath it); `SHARE ROW EXCLUSIVE` on the three legacy tables (no legacy writer can interleave; readers are not blocked). Then it deletes the proven
  removals, inserts the missing links, writes **one audit entry** (`LEGACY_RELATIONSHIPS_REPROJECTED`: removed rows in `beforeSnapshot`, inserted row ids and the fingerprint in `afterSnapshot`) and
  re-plans: nothing may remain. Any error — including a blocked or stale plan, a lock timeout or a failed post-check — rolls everything back, and a `LEGACY_RELATIONSHIPS_REPROJECTION_FAILED` audit entry is recorded afterwards (best effort).
- **Recovery if execution fails partway through:** it cannot fail partway — it is atomic, so a failure leaves the legacy tables exactly as they were. If a *committed* run must be undone, use its audit entry
  (re-insert `removedRows` with their ids, delete `insertedRows`) — a test proves this restores the tables exactly — or restore from the verified backup below. The backup is the primary recovery;
  the audit entry is the fine-grained one.

### Preconditions and stop conditions (all must hold; none is evidence yet)

1. A **separately approved cutover rollback**: explicit written authorization naming the database and the maintenance window. This section is not that authorization.
2. A **verified backup and a tested restore** of the target immediately before execution (to a scratch database, never over the live one), with a named owner; Neon point-in-time restore must be shown, not assumed.
3. Section 11's backfill and section 13 D's switch are the operations being reversed; legacy writers were refused from the cutover onward (otherwise every legacy write shows up as a conflict).
4. A fresh dry run immediately before the window with **zero blocking conflicts** and a reviewed disposition of every information-level anomaly and of `UNPUBLISHED_DRAFT_DIFFERENCE` (those draft edits will not survive a rollback — a product decision). Production counts: **unknown, to be measured.**
5. Revision-scoped writers are stopped, so the plan cannot change between the dry run and execution (the fingerprint check refuses a changed plan).
6. A **tool-target allowlist change** for any real database is a separate, reviewed, separately approved change (as for the backfill); this phase adds none.

**Stop** — do not execute — if: any blocking conflict exists; the fingerprint differs; the backup or restore is unverified; legacy rows changed since cutover without explanation; the run exits non-zero (nothing was written: find out why first);
or after a run the next dry run reports any insert or removal. After a successful run: the next dry run must be empty, the audit entry's counts must equal the reviewed plan, and the public pages must be compared with their pre-cutover state before readers are switched back.
## 15. Phase 6L — the relationship cutover (implemented; not yet applied to any real database)

**What changed.** A Recording's Sources, Rights information and Occasions are those of its **revisions**:

| Concern | Before | Now |
|---|---|---|
| Studio Relationships step (writes) | generic `…ToEntity({entityType:"RECORDING"})`, live at once | `attach/detach…ToRevision` on the **open draft** the editor was looking at (`recordingRevisionRelationshipsRepository.ts`); `CATALOGUE_WRITE` unchanged |
| Studio Relationships step (reads) | legacy rows | `loadRecordingRelationshipWorkspace`: published set and draft set side by side, each link marked *In the published version* / *Added in this draft* / *Removed in this draft* |
| Public Organisation page (occasions, approved sources, rights) | legacy rows | `loadPublishedRecordingRelationships`: the **published revision's** links |
| AI evidence (Recording-level sources and rights) | legacy rows | the links of the **revision being assembled** (draft in `DRAFT` mode, published in `PUBLISHED` mode), read with the revision |
| Legacy writes (`entityType "RECORDING"`) | allowed | **refused** (`LegacyRecordingRelationshipsFrozenError`) by the generic attach/detach functions; other entity types unaffected; legacy rows are kept, never deleted or rewritten |

**Decisions implemented (owner-approved).** D1 no read-time fallback to legacy rows (a Recording whose published revision has no link rows shows none; the backfill is a prerequisite, not something a reader hides). D2 with no open draft the published links are shown **read-only** and a draft is
started by an explicit action (`startNewDraftAction`, `RECORDING_WRITE`); an archived Recording is read-only too. D3 legacy Recording-level writes are rejected. D4 the three link states are displayed.

**Consistency under concurrent publication.** Which revision is "the published one" is read from the Recording's pointer; the pointer and the revision's status are verified together and re-read (three attempts) if a publication moved the pointer between the two reads, and the links are then read for exactly
the verified revisions. A published revision is immutable (`withEditableDraftRevision` refuses it), so the set read is one coherent published version, never a mixture of two. Tested with 40 reads racing a publication, and with attaches racing a publication (an attach either lands before the publication and is part of
the published set, or is refused; it never reaches the published revision afterwards).

**Inconsistent data is an error, never a silently incomplete set.** A published pointer naming a revision of another Recording or one that is not `PUBLISHED`, or a draft pointer likewise, is `RevisionRelationshipDataError` (internal; the message carries no secret). Where it surfaces differs on purpose:
Studio shows it as itself and offers nothing editable; the AI context and the default reader throw, because an editor must see it. The **public Organisation page degrades per Recording**: the reader runs in `onInconsistent: "omit"` mode, the affected Recording's unverified Sources, Rights and Occasions are **omitted** (never shown unverified, and
never replaced by legacy rows), every other Recording keeps rendering, and each omission is logged on the server (`Organisation page: … recording <id> were omitted … (<reason code>)`: ids and a code only). The result is typed (`inconsistent: [{recordingId, reason}]`), not a swallowed exception. A Recording with **no** published pointer is simply not published (reported, not an error).
Remaining gap: the log line is the only signal (no alert or counter; project register R-11).
**Static guard.** `tests/unit/recordingRelationshipsStaticGuard.test.ts` fails if any code under `app/`, `modules/`, `components/` or `scripts/` calls a legacy reader or writer for `"RECORDING"` or touches the legacy tables, except the three generic repositories (which carry the write guard) and the guarded backfill and
re-projection tools. It also asserts the Studio step is wired to the revision writers with the unchanged permission.

**Tests (loopback test database only).** `recordingRelationshipsCutover.test.ts` (immutability across Organisation page, published reader and AI context; publication swap; no writes to published revisions; detach semantics; workspace states; filters; no fallback; inconsistent-data errors; concurrency),
`relationshipCutoverRehearsal.test.ts` (below), `relationshipEditingPermissions.test.ts` (updated: Contributor refused, Editor allowed on the draft, refused on a published revision, legacy rows untouched), plus the updated provenance, occasion, organisation-page and eligibility tests.

**Rollback and recovery rehearsal (`relationshipCutoverRehearsal.test.ts`).** On the loopback test database only: legacy-only Recording (readers show nothing) → backfill dry run, execute, second dry run plans nothing, legacy rows unchanged → the new Studio actions edit a draft (published set and legacy rows do not move) →
publication makes the detach canonical → **re-projection dry run** plans exactly the insert and the proven removal → a wrong fingerprint is refused and writes nothing → the reviewed run executes atomically with an audit entry → a second plan is empty → the legacy rows equal the published set → **recovery from the audit entry restores the
legacy tables exactly**. The runbook is `docs/runbooks/relationship-cutover.md`.

**Rollback boundary (unchanged from §13D).** Before the first revision-scoped Studio write after the switch, reverting the release is lossless. After it, legacy rows no longer receive edits, so a revert needs the re-projection (which cannot carry **unpublished draft** edits back) or the switch is accepted as one-way.

**Deployment sequence (none of it done; each step needs the owner).** (1) Recovery policy decided and a fresh pre-change snapshot taken (project register O-01). (2) Pending migrations applied by a person with the direct URL (O-02). (3) Re-measure production relationship data read-only; with zero Recordings the backfill is not needed, otherwise
run the dry run and follow §12 (a real database needs the separate, reviewed allowlist change). (4) Deploy this release (readers and writers switch together). (5) Reconciliation per §13D.

## Limitations

These are not fixed by this work. Published-page immutability is **not** complete.

- **Recording-level Sources, Rights and Occasions are revision-versioned since Phase 6L (§15) — only in code until the release is deployed.** **Collection membership is still not versioned** (collection-owned; live
  changes need `RECORDING_PUBLISH`, 6J-12A), and so are Learning Guide membership, Sheet Music Requests and `MediaResource` rights links. Occasions on Performance, Programme and Collection stay live shared-catalogue
  links (project register R-02).
- **A refused promotion has no merge.** When the original changed since the clone, the editor discards the participant
  changes and re-applies them; there is no automatic three-way merge. The fingerprint covers participants only (performers
  with roles, choirs, conductors) — not the Programme, Venue, date or instruments, none of which promotion writes.
- **A refused or waiting promotion holds the original's row lock only for its own transaction**; other publications to
  the same original wait up to 5 s and then report "busy".
- **Abandoned drafts leave their clone behind.** There is no "discard draft" operation yet (only "discard my participant
  changes"); an unpublished draft keeps its clone and its instrument copies (not public, hidden from the Studio list
  and the venue inventory) until the draft is published or the participant changes are discarded. A cleanup belongs with
  a draft-discard operation.
- **Catalogue edits are global by design** (see above) and can change published pages immediately.
- **Autosave recovery is local and manual.** Since Phase 6J-10E the autosave steps serialize saves, keep the
  editor's text on conflict and offer it back after a reload (see [`studio-autosave.md`](studio-autosave.md)), but
  recovery is per browser, there is no merge (the editor restores or discards), delivery during browser termination is
  not guaranteed, and only the Source, SEO and Educational steps autosave.
- **No database constraints enforce revision-pointer consistency.** Nothing ties a pointed revision to its Recording
  or status; the protocol and conditional writes above are application-level. A writer that bypasses the repository
  (raw SQL) is caught only where a conditional `WHERE` applies (content saves, lifecycle writes), not for child rows.
- **Callers that pass their own transaction** to fork or save (apply, intake) own the locking. Apply holds the
  lock through `withRecordingEditLock`; intake works on a Recording that does not yet exist for anyone else.
- **Saves for one Recording are serialized**, so a long-held lock (a publish in progress) makes a save wait up to 5 s
  and then fail with a "busy" message.
