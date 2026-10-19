# Recording publication and revision-editing safety (Phases 6J-10B and 6J-10C)

This describes what is implemented in `modules/db/repositories/recordingRepository.ts`,
`mediaResourceRepository.ts` and `performanceRepository.ts`. It does not claim published-page
immutability: see [Limitations](#limitations).

## Model in one paragraph

A `Recording` points at at most one open draft (`currentDraftRevisionId`) and one live revision
(`currentPublishedRevisionId`). Two mechanisms protect them. **Lifecycle changes** (publish, submit, archive,
restore, unpublish) and **child-row writes** serialize on a per-Recording PostgreSQL advisory lock.
**Draft content saves** do not take that lock; they are a compare-and-swap on the draft revision row.

## 1. The `recording-edit:<id>` advisory lock

- `withRecordingEditLock(recordingId, fn, lockTimeoutMs = 5000)` runs `fn` in one transaction that first
  sets a transaction-local `lock_timeout` and then takes
  `pg_advisory_xact_lock(hashtext('recording-edit:<recordingId>'))`.
- The wait is bounded: after 5 seconds (`RECORDING_EDIT_LOCK_TIMEOUT_MS`) the operation fails with
  `RecordingBusyError` (publish reports reason `BUSY`). Because `lock_timeout` is transaction-local it also
  bounds row-lock waits inside that transaction.
- The lock is released at commit or rollback. State read after the lock is taken sees everything committed by
  earlier holders.
- The same key is taken by apply-approved-suggestion (`contentSuggestionApplicationRepository.ts`).
- Transaction limits: `timeout: 30000`, `maxWait: 10000`.

## 2. Publication

`publishRecordingDraft({ recordingId, actorId, expectedDraftRevisionId?, enforceCompleteness?, lockTimeoutMs? })`
runs inside the lock and, in one transaction:

1. Re-reads the Recording and refuses if it is missing, `ARCHIVED`, has no open `DRAFT`, or the caller's
   `expectedDraftRevisionId` is no longer the current draft.
2. Locks the draft row (`SELECT … FOR UPDATE`) and re-checks the required completeness categories against
   committed data.
3. Applies conditional writes, each with its expected state in the `WHERE` clause and the row count checked:
   draft `DRAFT → PUBLISHED`; previous live revision `PUBLISHED → SUPERSEDED`; Recording status and
   pointers moved only if `currentDraftRevisionId` is still that draft and the Recording is not archived.
4. Writes the `RECORDING_PUBLISHED` audit entry in the same transaction.

A refused, stale or failed attempt rolls back completely: the live revision stays live and no success audit
exists. The result is explicit (`ok: false` with a reason: `RECORDING_NOT_FOUND`, `RECORDING_ARCHIVED`,
`NO_OPEN_DRAFT`, `STALE_REVISION`, `NOT_READY`, `STATE_CHANGED`, `BUSY`, `FAILED`); no database error reaches the
Studio. `publishCurrentDraft` is a thin wrapper that skips the completeness gate and throws on refusal.
`modules/publishing/publishRefusal.ts` maps reasons to editor-safe messages.

`submitRecordingForReview`, `archiveRecording`, `restoreRecording` and `unpublishRecording` use the same lock,
re-read state under it, write conditionally and audit in the same transaction.

## 3. Draft compare-and-swap (content saves)

`updateDraftRevisionContent(recordingId, expectedRevisionUpdatedAt, actorId, patch, client?, { expectedRevisionId? })`
is a single conditional `UPDATE` (`updateMany`) whose `WHERE` requires all of:

- `id` = the Recording's current draft;
- `revisionStatus = DRAFT`;
- `updatedAt =` the token the editor loaded;
- that revision is the current draft of a Recording whose status is not `ARCHIVED`.

The write sets `updatedAt = max(now, expectedToken + 1ms)`. The column is `TIMESTAMP(3)`, so the token is
advanced explicitly to be strictly greater than the one it replaces; a token can never repeat or move
backwards, even for two saves in the same millisecond. A row count other than one throws
`ConcurrentEditError`. Two writers holding the same token cannot both succeed: the second waits on the first's
row lock, re-evaluates its `WHERE` after the first commits, and matches nothing.

- The Studio binds the draft's revision id into each form; a different current draft is a conflict
  (`ConcurrentEditError`), never a redirect to another revision.
- A Recording with no open draft or an archived Recording keep their earlier plain `Error` messages.
- A row lock that cannot be had within 5 s becomes `RecordingBusyError`.
- With a caller-owned transaction (`client`) the write joins it and the caller owns locking
  (apply-approved-suggestion holds the advisory lock first).
- `createPerformanceForDraft` creates a Performance and links it to the draft in one transaction using the same
  CAS, so a refused save leaves no orphan Performance row.

## 4. Child writes

`attachWorkToRevision`, `detachWorkFromRevision`, `attachMediaToRevision` and `attachRightsToMedia` call
`withEditableDraftRevision(revisionId, fn)`: take the advisory lock, then verify (in the same transaction) that
the revision exists, is a `DRAFT`, is the Recording's current draft, and the Recording is not archived. Otherwise
`RevisionNotEditableError` (reason `STALE_REVISION` or `RECORDING_ARCHIVED`) is thrown and nothing is written.
The write and its audit entry commit together; if either fails, both roll back.

- `attachMediaToRevision` and `attachRightsToMedia` take an optional caller-owned transaction path only for
  Recording intake, which creates the Recording and its first draft in the same transaction; eligibility is
  verified on that transaction.
- `attachRightsToMedia` guards media that belongs to a revision. Media with no revision is not revision content
  and is unchanged.
- Child writes do not advance the content token, so an attach in one Studio step cannot cause a false conflict in
  another.

## 5. Which mechanism protects what

| Operation | Advisory lock | Revision-row CAS |
|---|---|---|
| publish, submit for review, archive, restore, unpublish | yes | publish also `FOR UPDATE` on the draft row |
| attach/detach work, attach media, attach rights | yes (plus eligibility check) | no |
| apply approved suggestion | yes (outer) | yes, inside the held lock |
| Studio autosave steps (source, SEO, educational) | no | yes |
| create Performance for a draft | no | yes |

Lock order is always advisory lock first, then row lock. Content saves take only the row lock and never wait for
an advisory lock, so no cycle exists.

## 6. Running the relevant integration tests safely

Integration tests must only ever run against the isolated local test database
(`127.0.0.1:54329`, database `music_madras_test`), configured through `TEST_DATABASE_URL` (see `.env.test`,
which is gitignored). Confirm the host and port are loopback before running; never point it at a real database.

```bash
npm run test:integration:db:start
npm run test:integration:setup
npx vitest run --config vitest.integration.config.ts draftCasAndChildWrites publishAtomicity
npm run test:integration:db:stop
```

`npm run test:integration:reset` returns the test database to an empty state. The new suites are
`tests/integration/publishAtomicity.test.ts` (10B) and `tests/integration/draftCasAndChildWrites.test.ts` (10C);
`tests/unit/publishRefusal.test.ts` covers the refusal messages. Tests that need media on an already-published
revision seed it with `tests/integration/helpers/seedRevisionRows.ts`, which bypasses the repository on purpose
and is imported only by tests.

## Limitations

These are not fixed by this work. Published-page immutability is **not** complete.

- **Shared records are not revision-isolated.** Performance, Programme, Venue, participant (performer, choir,
  conductor) and `RightsInformation` rows are shared across revisions; a fork copies `performanceId`. Editing them
  changes the live page immediately regardless of draft state.
- **Recording-level source and rights links are not revision-versioned.** Links with `entityType: "RECORDING"`
  are keyed to the Recording and are editable while it is live.
- **`forkDraftFromPublished` has no archived-Recording guard.** It also does not take the advisory lock on its own
  path (apply-approved-suggestion holds it around the call).
- **Autosave conflict recovery is incomplete.** There is no in-flight guard, no flush on unload and no recovery;
  a stale save is refused with a clear message but the editor must reload by hand.
- **No database constraints enforce revision-pointer consistency.** Nothing ties a pointed revision to its
  Recording or status; every guard above is application-level.
- **Narrow save-versus-archive race (tracked for Phase 6J-10D).** A content save takes no advisory lock. If a save
  is queued behind another row lock and an archive commits meanwhile, the save can still land on that archived
  Recording's draft. It cannot modify a published revision.
