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
  lock, so no cycle between the two is possible. The only row lock held across statements is publish's
  `FOR UPDATE` on the draft row, and it is taken after the advisory lock.
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
`lifecycleSerialization.test.ts` (10D) and the apply-lock cases in `contentSuggestionApplication.test.ts` (10D);
`tests/unit/publishRefusal.test.ts` covers refusal messages. The tests use
explicit barriers (holding the edit lock or the draft row lock from outside, a hook between a function's read and
its write) rather than sleeps; `stillPending` only asserts that something is blocked. Tests that need media on an
already-published revision seed it with `tests/integration/helpers/seedRevisionRows.ts`, which bypasses the
repository on purpose and is imported only by tests.

## Limitations

These are not fixed by this work. Published-page immutability is **not** complete.

- **Shared records are not revision-isolated.** Performance, Programme, Venue, participant (performer, choir,
  conductor) and `RightsInformation` rows are shared across revisions; a fork copies `performanceId`. Editing them
  changes the live page immediately regardless of draft state.
- **Recording-level source and rights links are not revision-versioned.** Links with `entityType: "RECORDING"`
  are keyed to the Recording and are editable while it is live.
- **Autosave conflict recovery is incomplete.** There is no in-flight guard, no flush on unload and no recovery; a
  stale save is refused with a clear message but the editor must reload by hand.
- **No database constraints enforce revision-pointer consistency.** Nothing ties a pointed revision to its Recording
  or status; the protocol and conditional writes above are application-level. A writer that bypasses the repository
  (raw SQL) is caught only where a conditional `WHERE` applies (content saves, lifecycle writes), not for child rows.
- **Callers that pass their own transaction** to fork or save (apply, intake) own the locking. Apply holds the
  lock through `withRecordingEditLock`; intake works on a Recording that does not yet exist for anyone else.
- **Saves for one Recording are serialized**, so a long-held lock (a publish in progress) makes a save wait up to 5 s
  and then fail with a "busy" message.
