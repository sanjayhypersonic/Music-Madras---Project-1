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

## 10. Revision-scoped relationships: the foundation (Phase 6J-11B) — NOT yet in use

**Status: inert.** This phase adds the storage and the write functions only. **Public readers, the Studio Relationships
step, Content Intelligence and every existing writer still use the legacy Recording-level rows** (`entity_sources`,
`entity_rights`, `entity_occasions` with `entityType = "RECORDING"`), which are untouched. Nothing is backfilled, nothing is
dual-written, and no public behavior changes. The leak described in the Limitations section (Recording-level source,
rights and occasion links change live pages at once) is therefore **still present** until the separately approved
cutover. The design and cutover plan are in the Phase 6J-11A audit.

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
`POINTER_STATUS_MISMATCH`) and the recordings summary. Anomalies are facts about the legacy data, so they are reported on
every run, including after an execute. The report contains counts and opaque ids only.

**What the script is, and what it is not (read before scheduling it).**
- **Detach evidence is scoped to the exact revision and is not inherited by a fork.** A detach recorded in the audit trail
  names one revision. It keeps that link off *that* revision only. A draft forked from a published revision later gets the
  fork's own copied link set (6J-11B), so a link detached from the old draft is not suppressed on a new fork, and the
  backfill never carries it across revisions.
- **Detach evidence cannot be reliably ordered against later legacy edits.** The legacy link tables have no timestamps.
  If an editor detached a link from a revision and a legacy writer later re-added or re-edited the same Recording-level
  link, the script cannot tell which came last; it treats the detach as the editor's decision and does not re-add the row.
  (An existing revision-scoped row always wins over detach evidence.) Review the "skipped (editor detached)" counts in the
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

## Limitations

These are not fixed by this work. Published-page immutability is **not** complete.

- **Recording-level links are not revision-versioned (storage foundation since 6J-11B and a backfill utility since 6J-11C exist; neither is in use by the application).** Sources, rights information, occasions and
  collection membership attached to a Recording (`entityType: "RECORDING"`, Studio > Relationships step) are keyed to
  the Recording, shown on public pages (for example the Organisation page aggregates APPROVED sources and rights of its
  Recordings) and take effect **immediately**, whatever the draft state. Making them draft-scoped needs revision-scoped
  link rows (or a new `RECORDING_REVISION` entity type), copy on fork, readers switched to the published revision, and
  a backfill of existing links for published revisions; that touches several public readers and the AI context and was
  not attempted here.
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
