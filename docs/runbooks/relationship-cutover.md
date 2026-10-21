# Runbook: relationship cutover (revision-scoped Sources, Rights and Occasions)

Status: **implemented in code (Phase 6L); not applied to any real database; nothing here is authorisation to do so.** Every production step below needs the owner's explicit, written go-ahead. Design and rationale: `docs/recording-publication-safety.md` §10–§15.

## What the cutover is

A Recording's Sources, Rights information and Occasions are now stored on its **revisions** (`recording_revision_sources` / `_rights` / `_occasions`). Editors change them on a **draft**; visitors, the Organisation pages and the AI evidence see the **published revision's** set; publishing swaps the visible set atomically with the pointer. The old Recording-level rows (`entity_sources`, `entity_rights`, `entity_occasions`, `entityType = 'RECORDING'`) are **frozen history**: kept, never deleted or rewritten, no longer written or read by the application.

Readers and writers switch **in one release**. There is no dual write and **no read-time fallback**: a published revision with no link rows shows none, so existing legacy links must be backfilled *before* the release serves traffic (with zero Recordings in production there is nothing to backfill).

## Who can do what (unchanged)

| Action | Permission |
|---|---|
| Attach / detach a Source, Rights record or Occasion on a draft | `CATALOGUE_WRITE` (Editor and above; **not** Contributor) |
| Start a new draft to change a published Recording's links | `RECORDING_WRITE` |
| Add a Recording to / remove it from / reorder it in a Collection | `CATALOGUE_WRITE`, plus `RECORDING_PUBLISH` when the change is live (published Collection and Recording) |
| Publish | `RECORDING_PUBLISH` |

## What an editor sees

The Relationships step shows the published links and the draft's links together: **In the published version**, **Added in this draft** (public only once published), **Removed in this draft** (still public until published). With no open draft the links are read-only and *Start a new draft to make changes* appears. An archived Recording is read-only. If the revision data is inconsistent the step says so and offers nothing editable.

## Rehearsal (loopback test database only)

The whole sequence is rehearsed by `tests/integration/relationshipCutoverRehearsal.test.ts` through the guarded integration runner:

```bash
npm run test:integration -- tests/integration/relationshipCutoverRehearsal.test.ts
```

The runner prints `127.0.0.1:54329` / `music_madras_test` and refuses any other target. The test removes its own prefix-named fixtures before and after, so a crashed earlier run cannot leave rows behind. Never run the tools below against a database you have not positively identified as the isolated test database; they refuse every other target anyway.

## Production sequence (owner-gated; none of it done)

1. **Recovery policy** decided (project register O-01) and a **fresh pre-change snapshot** taken and recorded (`docs/phase-6j-12c-backup-restore-verification.md`).
2. **Pending migrations** applied to production by a person with the direct (non-pooled) URL, after the snapshot (register O-02). They are forward-only.
3. **Measure, read-only, immediately before**: Recordings and legacy / revision-scoped link counts (the 12D read-only inspector pattern). If there are **zero Recordings**, skip step 4.
4. **Backfill** (only if Recordings exist): dry run → read the report → resolve any `DETACH_EVIDENCE_ON_OLDER_REVISION` anomaly by a person (the tool refuses `--execute` while any exists) → execute → a second dry run must plan **0** inserts. A real database needs its own reviewed, separately approved allowlist change (`recording-publication-safety.md` §11–§12).
5. **Deploy** this release (readers and writers together).
6. **Reconcile** (read-only), per `recording-publication-safety.md` §13D: per-kind counts; for a sample of Recordings the published revision's links equal the legacy links minus recorded dispositions; the Organisation page of each sampled Recording is unchanged by the switch.
7. **Soak.** Legacy rows stay. Removing them, if ever wanted, is a separate migration with its own approval and backup.

## Rollback

| When | What to do | What is lost |
|---|---|---|
| Before the first revision-scoped Studio write after the switch | Revert the release. Legacy rows were never modified; the extra revision-scoped rows are inert. | Nothing. |
| After it, and the owner has authorised a rollback | Take a fresh snapshot, then **re-project**: `npm run reproject:legacy-relationships` (dry run by default). Review the report and the plan fingerprint, resolve every blocking conflict, then `--execute --plan-fingerprint=<64 hex>`; the run is one atomic transaction with one audit entry. Then revert the release. | **Unpublished draft edits** (legacy has no draft concept; they are reported as `UNPUBLISHED_DRAFT_DIFFERENCE` and are not carried back). The original ids and order of re-created rows. |
| A committed re-projection must itself be undone | Use its audit entry (`LEGACY_RELATIONSHIPS_REPROJECTED`): re-insert `removedRows` with their ids, delete `insertedRows`. Proven by the rehearsal. Or restore from the verified snapshot. | — |

**Stop** — do not execute — if: a blocking conflict exists; the fingerprint differs; the snapshot or restore is unverified; legacy rows changed since the cutover without explanation (a legacy write cannot happen through the application any more, so this means someone wrote SQL); the dry run reports any unexplained insert or removal.

## If something looks wrong after the release

| Symptom | Meaning | Action |
|---|---|---|
| The Relationships step says "relationship data is inconsistent" | A pointer names a revision of another Recording or one in the wrong status | Do not edit data by hand. Capture the Recording id, treat it as a data incident, and use the audit trail; the Organisation page that aggregates it will also fail loudly rather than show a partial set. |
| A published Recording shows no sources or rights after the release | Its legacy links were not backfilled | Run the backfill dry run on the **test copy** first; on a real database it needs the §12 process. Do not add a fallback. |
| An editor cannot attach (message "no longer editable") | The draft they were looking at was published or replaced, or the Recording is archived | Reload; start a new draft if needed. |
| An editor's change does not appear publicly | It is in a draft by design | Publish the draft (needs `RECORDING_PUBLISH`). |

## Not covered by this cutover

Collection membership (its own live-change guard), Learning Guide membership, Sheet Music Requests, `MediaResource` rights links, and the occasions of Performances, Programmes and Collections. See `docs/project-register.md`.
