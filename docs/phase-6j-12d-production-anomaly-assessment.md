# Phase 6J-12D — Production anomaly assessment for the revision-relationship cutover

**Read-only.** Production was read in **read-only transactions** (SELECTs only) on **2026-10-20 ~16:21 UTC**. Nothing was written; no migration, backfill or re-projection was run;
no reader, writer, RBAC or setting was changed. The connection was **identity-gated before any data query**: the target matched the production
project `ancient-…5838`, timeline `764b4c03…b60e`, endpoint `ep-icy-f…zi6d`, tenant `56ec0512…6a0b`, database `neondb`, and was read-only; the run aborts otherwise. No connection string or secret appears here.
Related: `phase-6j-12c-backup-restore-verification.md` (recoverability), `recording-publication-safety.md` §11–§14 (the rules assessed).
Classes: **CONFIRMED ZERO** (counted, 0, at the time above), **UNAVAILABLE** (the production schema cannot answer it), **UNKNOWN** (cannot be known today), **NOT APPLICABLE**.

## 1. Headline

**Production holds no Recording data at all, so there is nothing for the backfill or the re-projection to act on and no anomaly can exist today.** Every count below is a confirmed zero.
That is a property of *this moment*, not a guarantee: the first Recording created in Studio changes it. The assessment must be repeated immediately before any execution.

## 2. Counts (production, 2026-10-20 ~16:21 UTC)

| Item | Count | Class |
|---|---|---|
| Recordings / Recording revisions / revision works / media resources / video pages | 0 / 0 / 0 / 0 / 0 | CONFIRMED ZERO |
| Legacy **Source** links (`entity_sources`, all entity types / `RECORDING`) | 0 / 0 | CONFIRMED ZERO |
| Legacy **Rights** links (`entity_rights`) | 0 / 0 | CONFIRMED ZERO |
| Legacy **Occasion** links (`entity_occasions`) | 0 / 0 | CONFIRMED ZERO |
| Duplicate legacy links (same Recording and target) | 0 (all three kinds) | CONFIRMED ZERO |
| Orphaned legacy rows (entity is not a Recording that exists) | 0 (all three kinds) | CONFIRMED ZERO |
| Legacy rows pointing at a missing Source / Rights / Occasion | 0 (all three kinds) | CONFIRMED ZERO |
| Recordings with no pointer / unsafe published pointer / unsafe draft pointer / orphaned revisions | 0 / 0 / 0 / 0 | CONFIRMED ZERO |
| Links with **no safe authoritative revision** | 0 | CONFIRMED ZERO (no links, no Recordings) |
| Sources in the catalogue / not APPROVED | 1 / 1 (state `UNREVIEWED`) — **linked to nothing** | CONFIRMED (0 links to preserve) |
| Rights-information records | 1 — linked to nothing | CONFIRMED |
| Occasions / archived Occasions | 0 / 0 | CONFIRMED ZERO |
| Other records that reference a Recording (`collection_recordings`, `learning_guide_recordings`, `sheet_music_requests`, `media_resources`) | 0 / 0 / 0 / 0 | CONFIRMED ZERO |
| Revision-scoped attach / detach audit entries (Source, Rights, Occasion) | 0 / 0 | CONFIRMED ZERO |
| Entries from the re-projection or backfill tools | 0 | CONFIRMED ZERO |
| Revision-scoped relationship tables (`recording_revision_sources/_rights/_occasions`) | **do not exist** in production | see section 4 |
| Applied migrations | 12 of the repository's 14; **pending: `20261019120000_phase6j10f_performance_draft_clone`, `20261020120000_phase6j11b_recording_revision_relationships`** | VERIFIED |
| Studio users | FOUNDER 1 active; EDITOR 3 active | VERIFIED |

**Audit history (context, not an anomaly).** Between 2026-09-28 and 2026-10-02 the audit log records earlier testing: 33 `SOURCE_ATTACHED` and 33 `RIGHTS_INFORMATION_ATTACHED` on `RECORDING`,
135 `SOURCE_ATTACHED` on `WORK`, 33 `OCCASION_ATTACHED` on `PERFORMANCE`, 18 `RIGHTS_INFORMATION_ATTACHED` on `COMPOSER`, and 19 `WORK_ATTACHED_TO_RECORDING_REVISION`.
**None of those links or Recordings exists now** (the counts above are 0), and there is **no detach evidence of any kind** (no `*_DETACHED_*` action exists in the audit log). They do not affect either tool.

## 3. The rules applied to this data

Rules are the ones in the committed code and in `recording-publication-safety.md` (§11 backfill, §14 re-projection). **Neither tool was run.** Both iterate Recordings and their legacy/revision links; with 0 Recordings and 0 links:

| Rule / anomaly code | Applies to | Result for current production |
|---|---|---|
| Backfill: projection targets (published + draft pointer), planned inserts, already present, skipped (editor detached) | each Recording | 0 inserts, 0 present, 0 detached — nothing to project |
| `ORPHANED_LEGACY_LINK`, `DUPLICATE_LEGACY_LINK` | legacy rows | cannot arise: 0 legacy rows |
| `NO_REVISION_POINTER`, `POINTER_REVISION_MISSING` / `_OTHER_RECORDING` / `_STATUS_MISMATCH` | Recording pointers | cannot arise: 0 Recordings |
| Unapproved Sources / archived Occasions "preserved" counts | linked targets | 0 (the one unapproved Source is unlinked; no Occasions exist) |
| `DETACH_EVIDENCE_ON_OLDER_REVISION` (blocks backfill `--execute`) | detach audit entries | 0 — none exist |
| Re-projection: authoritative revision, inserts, proven removals | each Recording | 0 / 0 |
| `LEGACY_LINK_NOT_IN_REVISION_SET`, `AUTHORITATIVE_POINTER_*` (block re-projection `--execute`) | legacy links, pointers | cannot arise: 0 links, 0 Recordings |
| `UNPUBLISHED_DRAFT_DIFFERENCE` | Recordings with a draft and a published revision | cannot arise |
| Checks that need the revision-scoped tables ("revision-scoped rows with no legacy counterpart", "already present") | revision-scoped rows | **UNAVAILABLE** in the production schema (tables absent); trivially none, as there are no revisions |

**Dispositions:** none are required for any category today (all CONFIRMED ZERO or cannot arise). The dispositions that `recording-publication-safety.md` §12 asks for would be needed **only** if a measurement immediately before execution is non-zero.

## 4. What these zeros do and do not mean

- **They are time-bound.** The first Recording with a Source/Rights/Occasion link makes counts non-zero; every figure must be re-measured right before any execution (one check suffices: `recordings = 0` and no `RECORDING` rows in the three legacy tables).
- **If the cutover happens before the first Recording exists, the backfill and the re-projection are not needed at all.** There is nothing to project and nothing to roll back to. Rollback is then "revert the release"; the migrations are additive.
- **If Recordings exist by then**, every category in section 3 becomes live and §12–§14 apply in full, including their separate approvals (a target-allowlist change to let either tool touch a real database, a verified restore point, written authorization).
- **UNKNOWN:** how many Recordings, links and anomalies there will be at the time of any future cutover. Nothing here predicts them.

## 5. Findings that matter beyond the anomaly counts

1. **The pending migrations are a hard prerequisite for deploying the current code (code-read; not run).** `forkDraftFromPublished` reads and writes the three revision-scoped relationship tables, which do not exist in production, so forking a published Recording would fail there; and migration 10F adds columns to `performances` that the Prisma client now selects, so reading a Performance against the current production schema would fail. The migrations are additive and, on an empty domain, low risk, but they are **forward-only**: recovery from a bad migration is a restore (see the 12C report, including its six-hour limit).
2. **No application reader or writer uses the revision-scoped tables** (code-read: only the repository and the fork copy reference them). The relationship cutover therefore still means **implementing** the switch of Studio relationship actions and the public readers; the migration and the two tools do not do that.
3. **Recoverability is the unresolved dependency** (12C): Free plan, 6-hour window, production is the root branch (owner-confirmed); nothing restored yet.

## 6. Blockers and the approvals still needed

| # | Item | Needed from | Status |
|---|---|---|---|
| 1 | A decision on the Neon plan / recovery policy (six-hour window; pre-change snapshot discipline) | Owner (cost and risk) | **Open** |
| 2 | A fresh child-branch snapshot immediately before the migrations, kept until stable | Owner / operator | **Not done** |
| 3 | **Approval to apply** `…phase6j10f…` and `…phase6j11b…` to production (direct URL, by a person, after the snapshot) | Owner | **Not given** |
| 4 | A decision whether the relationship cutover (implementing revision-scoped writers/readers) is a **launch gate** or post-launch hardening | Owner | **Open** |
| 5 | Re-measure production immediately before any execution; if Recordings exist, the §12 dispositions, the target-allowlist change and written authorization apply | Owner | Not triggered while counts are zero |
| 6 | The operational launch blockers recorded in `phase-6j-8-production-readiness-audit.md` (dated 2026-10-14; **not re-verified here**): empty Museum, no CI, no migration/deploy/rollback runbook, no error monitoring, unproven email delivery, production domain/environment unset. Since then the repository moved to `next` 16.4.0 (installed) and the publish-atomicity item was addressed in code; the rest are external or owner decisions | Owner / engineering | Open |

## 7. Shortest safe path to launch (recommendation)

1. **Decide the recovery policy** (blocker 1) — the cheapest safe option is a plan with a longer history window; otherwise accept snapshot-only recovery and its limits in writing.
2. **Take a fresh pre-change snapshot branch**, then **apply the two pending migrations** with the direct URL (approval 3). Re-run this read-only measurement the same hour: it should still show 0 Recordings.
3. **Deploy the current code**; Source/Rights/Occasion keep working through the legacy path (nothing reads the new tables), so this step needs **no data migration and no backfill**.
4. **Do not make the relationship cutover a launch gate.** The known limitation (Recording-level links apply immediately, not draft-scoped) is documented; mitigate it editorially (attach relationships before the first publish) until the cutover. Implement the revision-scoped writers/readers as post-launch hardening **while data volume is small**, re-measuring first; with 0 Recordings the backfill and re-projection tools are not needed, and with a handful they are cheap to run under §12–§14.
5. Work the **operational launch blockers** of the 6J-8 audit in parallel (they, not the relationship data, are what actually gate the launch): content to publish, CI/gate, migration/deploy/rollback runbook, monitoring, email, domain and environment.
6. **Counter-option (owner's call):** if the "drafts never change published content" guarantee must hold for Source/Rights/Occasion from day one, make blocker 4 a launch gate and implement the switch before the first Recording is created — it is cheapest now, and the backfill/re-projection stay unused.

## 8. Evidence and method

- One read-only script (identity gate, then SELECTs; aggregates only; output files in the session scratchpad, **not committed**). It read the production connection from `.env` in memory; nothing was printed. Run twice the same minute (16:21:07 and 16:21:32 UTC) with identical results; the second run added the audit breakdown by entity type.
- Compared against: `modules/backfill/revisionRelationships/backfillPlan.ts`, `modules/backfill/legacyReprojection/reprojectionPlan.ts`, `recording-publication-safety.md` §11–§14, and the repository's `prisma/migrations` (14 directories) for the pending list.
- Not done, by design: any write, migration, backfill, re-projection, sync, Neon change, or change to readers/writers; no code, schema or environment change.
