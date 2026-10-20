# Phase 6J-12C — Backup and restore verification (Neon production)

**Read this first.** This is an **inspection plus a read-only verification of a branch-based copy**, not a restore test. **No true restore (instant restore, point-in-time
restore, or restore from a historical backup) was executed.** This session created, restored, reset, renamed or deleted nothing in Neon; production and the branches were only read
(read-only transactions). The owner created the rehearsal branch manually; section 7a records what was verified about it. A child branch created from production is a **branch-based copy of current data** — it shows that a branch can be created and read, **not** that a historical backup or point-in-time recovery works.
Findings are classified **VERIFIED** (observed by this session), **OWNER-CONFIRMED** (read by the owner in the Neon console; this session cannot see the console, so it records them but did not observe them), **UNVERIFIED** (not observable from here, or only documented in general),
**FAILED**, or **NOT APPLICABLE**. No connection string, password, key or token appears in this document; identifiers are truncated.

## 1. Summary

| Question | Answer |
|---|---|
| Is there a current, verified backup of production? | **UNVERIFIED — no.** The only recovery artefact seen is a *pre-sync snapshot* branch that is stale (section 4). |
| Is point-in-time restore available to this project? | **OWNER-CONFIRMED, and limited: Free plan, 6-hour history window, `production` is the root branch** (section 7b). Point-in-time recovery therefore reaches back **six hours at most**; whether a given restore is actually available must be confirmed in Neon's restore interface. It has **not** been exercised: **backup/restore is not proven**. |
| Was an isolated restore rehearsal completed? | **Partly.** The owner created a rehearsal branch; this session verified it read-only and found it **identical to production** (section 7a). **No true restore was performed**, so historical-backup and point-in-time recovery remain **UNVERIFIED**. |
| Was production modified? | **No.** (Verified: read-only transactions; no writes, no migrations, no backfill, no re-projection.) |
| Cutover blockers | See section 9. The central one: **recoverability is unproven**, and a fresh restore point plus a rehearsal are required first. |

## 2. Starting state — VERIFIED

- Branch `music-madras-production-rebuild`, HEAD `230067d`, `main` `3bcfe85`; nothing staged; the only untracked file was
  `docs/phase-6j-8-production-readiness-audit.md` (not touched).
- `.env` and `.env.test` unchanged (last write 2026-10-14 and 2026-10-04). No application code, schema, migration, RBAC or environment change in this phase.

## 3. Identities (safe identifiers only) — VERIFIED

Observed 2026-10-20 ~15:36 UTC through read-only connections (`transaction_read_only = on`). Identifiers are truncated.

| | Production (direct and pooled endpoints) | Existing restore branch (`pre-final-youtube-sync-2026-10-14`) |
|---|---|---|
| Neon project | `ancient-…5838` | `ancient-…5838` (**same project**) |
| Timeline (branch) | `764b4c03…b60e` | `e2bac06d…f956` (**different timeline**) |
| Compute endpoint | `ep-icy-f…zi6d` (the pooled URL is the same endpoint with `-pooler`) | `ep-delic…ydyq` |
| Database / Postgres | `neondb`, PostgreSQL 18.6, region `c-3` | `neondb`, PostgreSQL 18.6, region `c-3` |
| Database size | 14.9 MB | 14.8 MB |
| Migrations (applied / problems) | 12 / 0, last `20261001055648_source_approval_state` | 12 / 0, same |

- The two are different branches of the same project and tenant. **Parentage ("parent production, expiry never") comes from the project's own
  records and is not observable from SQL: UNVERIFIED.** Whether production is a *root* branch is also UNVERIFIED.
- Opening a connection can wake an idle compute; no data on either branch was changed.

## 4. Recovery mechanisms

| Mechanism | What is documented (general Neon documentation, fetched 2026-10-20) | Status for **this** project |
|---|---|---|
| **Existing restore branch** | A branch copies data at a point in time | **VERIFIED to exist and open, and to hold a consistent pre-sync state. VERIFIED NOT a current backup:** it predates the final YouTube sync (section 5). Restoring production from it would discard that sync. It must not be used as a test target. |
| **Instant restore / point-in-time restore (PITR)** | Restores a **root** branch to a timestamp or LSN *in place*; replaces all data and schema; Neon preserves the prior state in an automatic backup branch `{branch}_old_{timestamp}`; connection details stay the same; changes after the restore point are lost | **OWNER-CONFIRMED prerequisites:** production is a root branch (so the mechanism applies in principle), on the **Free plan with a 6-hour window**. **Not exercised; actual availability UNVERIFIED** — confirm in Neon's restore interface (Time Travel Assist shows what a chosen point holds before anything is restored). |
| **History window** | Free: 6 hours (capped at 1 GB of change history); Launch: up to 7 days; Scale: up to 30 days; paid projects default to 1 day and the window can be shortened | **OWNER-CONFIRMED: Free plan, 6 hours.** Anything older than six hours (and anything beyond the plan's change-history cap) cannot be point-in-time restored. An incident noticed the next day is **outside** it. |
| **Create a branch from a past point in time** | Creates a new child branch at a chosen timestamp/LSN without touching the parent | **UNVERIFIED** (permission, quota and cost not checked). This is the safe rehearsal primitive. |
| **Time Travel Assist** | Read-only queries against a historical point, to confirm the target before restoring | **UNVERIFIED** (console feature; not accessed). |
| **PITR on the existing branches** | Only root branches support PITR; child branches do not | **OWNER-CONFIRMED:** both `pre-final-youtube-sync-2026-10-14` and `music-madras-recovery-rehearsal-20261020` are **children** of `production`, so **neither can itself be point-in-time restored**. They are snapshots of their creation moments, not rolling backups. |
| **Logical backup (`pg_dump`/`pg_restore`)** | Standard Postgres | `psql`, `pg_dump`, `pg_restore` are **not installed on this machine (VERIFIED)**; none was produced. A dump would also contain credential-bearing tables (`studio_users`, `studio_sessions`, `studio_accounts`), so its storage needs its own decision. |
| **Neon API / CLI access from this session** | — | **VERIFIED absent:** no API key, no `neonctl`; the console in the built-in browser was **not signed in** (nothing was entered). Hence no branch could be created. |

Neon plan documentation: <https://neon.com/docs/introduction/plans> and <https://neon.com/docs/introduction/branch-restore>
(general facts, not proof for this account).

## 5. Read-only reconciliation: production vs the existing restore branch — VERIFIED

This compares two branches of the same project. It is **not** a restored-from-backup reconciliation; it shows what the restore branch is.

- **Schema:** both have 55 public tables with identical names; both have the same 12 migrations, all applied.
- **Row counts:** 48 of 55 tables are identical. The differences are exactly the final sync's footprint:

| Table | Production | Restore branch |
|---|---|---|
| `youtube_videos` | 236 (178 public, 58 unlisted, all OBSERVED) | 226 (169 public, 57 unlisted) |
| `youtube_playlists` | 14 | 12 |
| `youtube_playlist_items` | 186 | 173 |
| `field_ownerships` | 1187 | 1126 |
| `sync_checkpoints` | 16 | 12 |
| `sync_job_runs` | 3 | 2 |
| `audit_log_entries` | 729 (last 2026-10-13 20:11 UTC) | 728 (last 2026-10-02 17:20 UTC) |

- **Conflict / ownership records:** `sync_conflicts` 0 in both; `field_ownerships` as above.
- **Invariants (both branches):** no revision-pointer problems, no orphaned revisions, no orphaned or duplicate legacy relationship rows — *trivially*, because neither branch holds any recordings or legacy rows (section 6), so these checks prove consistency of an empty domain, not of recording data.
- **What this establishes:** the restore branch is a coherent snapshot taken before the final sync (**VERIFIED**). A restore from it would lose 10 videos,
  2 playlists, 13 playlist items, 61 field ownerships, 4 checkpoints, 1 sync run and the sync's audit entry. It is **not** a current backup.

## 6. Observations about production that matter for the cutover — VERIFIED (as of 2026-10-20 ~15:36 UTC; subject to change)

- Production has **0 recordings, 0 recording revisions, 0 collections and 0 legacy relationship rows** (`entity_sources`, `entity_rights`, `entity_occasions`), and the `recording_revision_sources/_rights/_occasions` tables **do not exist**.
- Production has **12 migrations applied**; the repository has two later ones that production lacks: `20261019120000_phase6j10f_performance_draft_clone` and
  `20261020120000_phase6j11b_recording_revision_relationships`. They are additive but **forward-only**: after they are applied, "recovery from a bad migration" means restore, not a down-migration.
- These are facts about the current state, not a production anomaly assessment (which is a separate, later phase and was not started).

## 7. Restore rehearsal procedure (the branch was created by the owner; a true restore was NOT executed)

**Why this session could not create it:** a rehearsal needs a new Neon branch (a resource in the account, possibly with quota or billing effect). This session has no API access and the
console was not signed in; creating it would be an account action that must not be improvised. The live database and the historical restore branch were **not**
used as substitutes. Do **not** run any of this against production.

**Owner steps (Neon console, or `neonctl` authenticated by the owner):**
1. **Confirm and record the facts** (Project → Settings): the plan, the **history window**, whether the production branch is a **root** branch, the branch count against the limit, and where the existing branch
   `pre-final-youtube-sync-2026-10-14` sits. Record them in section 10. *Do not change retention or delete anything in this step.*
2. **Pick the recovery point** to rehearse: the current head (simplest), and, if the window allows, a timestamp a few hours back (this exercises point-in-time reach). Use **Time Travel Assist** (read-only) to confirm that the chosen point holds the expected data.
3. **Create a new child branch** from production at that point, named explicitly, e.g. `restore-rehearsal-2026-10-DD-12c` (never reuse the historical branch). Note the start time. It must be a *new* branch with its own endpoint.
4. **Open it and verify identity before anything else:** the endpoint and timeline differ from production's (section 3), the database is `neondb`, and the project matches. Do the checks below with a **read-only** user session; **do not paste connection strings into chat, tickets or logs.**
5. **Reconcile against production at the same point:** (a) migration state — `select count(*), count(*) filter (where finished_at is not null and rolled_back_at is null) from _prisma_migrations`; (b) exact row counts of every public table (section 5's query, per table); (c) invariants —
   revision pointers resolve, no orphaned revisions, no orphaned or duplicate legacy relationship rows, audit entry count and latest timestamp, YouTube video / playlist / ownership counts, and `sync_conflicts`; (d) data samples: a few recordings/videos compared field by field; (e) the application can read it: point a **non-production** deployment or local run at the branch with `DIRECT_URL` and load the public and Studio pages.
6. **Optional, on the rehearsal branch only:** apply the two pending migrations with `prisma migrate deploy` using the direct (non-pooled) URL, and run the relationship backfill dry run there, to rehearse the cutover path. *Never* on production in this phase.
7. **Record the elapsed time** from step 3 to a verified branch, the manual steps, and any error.
8. **Clean up only what was created:** confirm the branch **name and ID** are the rehearsal branch's, that it has no children, then delete it. Confirm production's endpoint, timeline and row counts are unchanged afterwards.

Pass criteria: identity differs from production; schema and migration state equal; **every** table's count equal at the chosen point; invariants hold; the application reads it; elapsed time recorded.

### 7a. Result: the rehearsal branch, verified read-only (2026-10-20, ~16:09 UTC)

**What was done.** The owner created the branch `music-madras-recovery-rehearsal-20261020` in the Neon project `music-madras-dev` (console: parent `production`, a separate branch; no existing branch reset or modified —
*owner-reported; this session did not see the console*). The owner placed its direct connection string in a gitignored file (`.env.rehearsal.txt`, ignored by the `.env.*` rule, not tracked or staged). This session read it
**in memory only**, validated the endpoint **before connecting**, opened both databases in **read-only transactions**, ran an **identity gate before any data query**, and then ran SELECTs only (about 9 seconds in total).
No write, migration, backfill, re-projection, reset or cleanup was run; nothing was deleted. Credentials were never printed.

**Identity gate — VERIFIED (passed):**

| | Production | Rehearsal branch | Historical restore branch (for contrast) |
|---|---|---|---|
| Project | `ancient-…5838` | `ancient-…5838` (same) | `ancient-…5838` |
| Tenant | `56ec0512…6a0b` | `56ec0512…6a0b` (same) | same |
| Timeline | `764b4c03…b60e` | `e6fb3a81…a18e` (**different**) | `e2bac06d…f956` (**different from both**) |
| Compute endpoint | `ep-icy-f…zi6d` | `ep-dark-…3c5d` (**different**, direct/non-pooled) | `ep-delic…ydyq` |
| Database / Postgres | `neondb` / 18.6 | `neondb` / 18.6 | `neondb` / 18.6 |
| Session mode | read-only | read-only | — |

The gate would have aborted the run before any data query had the endpoint or timeline matched production or the historical branch, or had the project, tenant or database differed. None did.

**Reconciliation, rehearsal branch vs production, same moment — VERIFIED (passed):**

| Check | Result |
|---|---|
| Tables | 55 in each; none only on one side |
| Row counts | **55 of 55 equal** |
| Row **content** (per-table MD5 over every row, computed in the database; nothing exported) | **55 of 55 equal** |
| Migrations | 12 / 12 applied in each; names **and checksums** identical; last `20261001055648_source_approval_state`; no unfinished or rolled-back migration |
| YouTube data | videos 236 (178 public, 58 unlisted, 236 OBSERVED), playlists 14, playlist items 186 — identical |
| Field ownership / conflicts | `field_ownerships` 1187, `sync_conflicts` 0 — identical |
| Sync runs | `sync_job_runs` 3, last started 2026-10-13 20:09 UTC — identical |
| Audit | 729 entries, last 2026-10-13 20:11 UTC — identical |
| Recordings / revisions | 0 / 0 on both; pointer problems 0; orphaned revisions 0 |
| Legacy relationship rows (`entity_sources`, `entity_rights`, `entity_occasions`) | 0 on both |
| Revision-scoped relationship tables | **absent on both** (the 6J-11B migration is not applied to production, so none was copied) |
| Invariants overall | identical on both |

**What this proves, and what it does not.**
- **VERIFIED:** the branch is a separate, readable copy that **reflects current production** at the time of the check — every row of every table matches, so it was taken from production's current head and production has not changed since.
  Its parentage is **owner-reported** (the console), consistent with, but not proven by, the identical content.
- **VERIFIED:** it is **not** the historical branch (different timeline and endpoint) and it is current, unlike that branch (section 5).
- **NOT PROVEN — and not claimed:** that a **historical backup** can be restored, that **point-in-time restore** works or reaches back as far as needed (plan and history window are still **UNVERIFIED**), that production is a root branch, or how long an actual restore takes.
  Creating a child branch is the same operation as the recommended pre-cutover restore point; it does not exercise PITR or instant restore, which overwrite in place.
- **Elapsed time:** the owner's branch-creation time was not reported, so **recovery time is UNVERIFIED**. Verification itself took about 9 seconds on a 15 MB database.
- The rehearsal branch has **not** been deleted (as instructed). Remaining steps: the optional rehearsal of the pending migrations on this branch only (step 6, not run), and the owner's cleanup (step 8) when finished — then delete `.env.rehearsal.txt`.
### 7b. Owner-confirmed Neon facts (console, 2026-10-20) and what they mean

Confirmed by the owner from the Neon console; **recorded here, not observed by this session** (OWNER-CONFIRMED). Nothing in Neon was changed, created or deleted by this session.

| Fact | Value |
|---|---|
| Project | `music-madras-dev` |
| Plan | **Free** |
| History window | **6 hours** |
| `production` | the **root** branch (Parent column `-`) |
| `music-madras-recovery-rehearsal-20261020` | a **child** of `production` |
| `pre-final-youtube-sync-2026-10-14` | a **child** of `production` |

**Consequences (no recovery is claimed to be proven):**
1. **Point-in-time recovery is limited to the configured six-hour history window** (and, per Neon''s plan documentation, to a cap on change history on the Free plan). It cannot reach an event older than six hours. Whether a restore to a chosen point is **actually available** must be confirmed in Neon''s restore interface (Time Travel Assist, then the restore itself); this has **not** been done.
2. Because `production` is the root branch, instant restore *can* apply to it in principle; Neon documents that it overwrites in place and keeps the previous state in an automatic backup branch. Restoring production **from** a child branch (for example the rehearsal branch) as the source is a variant whose support must also be **confirmed in the restore interface** — do not assume it. The alternative that needs no restore feature is to **repoint the application** to a verified branch (section 8).
3. The two existing children are **snapshots**, not rolling backups, and child branches have no point-in-time restore of their own. The historical one is stale (it predates the final sync); the rehearsal branch is a **current snapshot as of its creation (verified identical to production at ~16:09 UTC on 2026-10-20)** and is only as fresh as that moment — any later production change is not in it. **Keep it** (do not delete) until a deliberate pre-cutover snapshot replaces it.
4. A cutover problem noticed **after six hours** has **no point-in-time path** on this plan. The pre-cutover safety net is therefore a **fresh child-branch snapshot taken immediately before the migrations / cutover**, kept until the change has been stable, with its limits stated above. Moving to a plan with a longer window is the owner''s cost decision.
5. The Free plan''s other limits (storage, branch count, compute) are **not** assessed here.
## 8. Exact recovery procedure for an incident (to be verified by the rehearsal above; not yet proven)

1. **Stop the damage:** stop writers (Studio writes, cron/sync jobs, any backfill/re-projection) — set maintenance or revert the release. Do **not** run anything else against production.
2. **Establish the incident time `T`** (audit log, deploy time). Choose the recovery point just before it.
3. **Prefer a non-destructive recovery first:** create a **new branch from `T`** (point-in-time) and verify it as in section 7 (identity, reconciliation, application read).
4. **Choose the path (owner decision, written down):**
   - *Repoint:* change `DATABASE_URL`/`DIRECT_URL` in the deployment to the verified branch's endpoint (keeps production intact for forensics); or
   - *Instant restore of production in place* to `T` (overwrites data and schema; Neon keeps the prior state as `{branch}_old_{timestamp}`; **everything after `T` is lost** and that cost must be accepted explicitly).
5. **Verify after recovery:** reconciliation checks, public pages, Studio sign-in, audit trail continuity; compare with the pre-incident counts.
6. **Record** what was lost (everything after `T`), re-run what can be re-run (e.g. the idempotent YouTube sync *only* by explicit instruction), and delete temporary branches only after confirming identity.
7. Data written after `T` (editorial edits) is **not** recoverable from the restore; capture it first if it matters.
Note on the Free plan (section 7b): the point-in-time options in steps 3 and 4 exist **only within the six-hour history window**. Beyond it, recovery means **repointing to, or restoring from, the most recent pre-change branch snapshot**, and everything after that snapshot is lost.
Status of every step above: **UNVERIFIED for this project** until sections 7 and 10 are completed.

## 9. Remaining blockers and preconditions before any relationship cutover

| # | Precondition | Status |
|---|---|---|
| 1 | Plan, history window and root-branch status recorded | **OWNER-CONFIRMED** (Free, 6 hours, root). **Consequence — a genuine launch decision for the owner:** point-in-time recovery covers six hours only. Either move production to a plan with a longer window, or accept that recovery beyond six hours relies on a **pre-change branch snapshot** taken immediately before each risky change (migration, cutover, bulk operation) and kept until the change is stable, with the loss of everything after it |
| 2 | A **fresh restore point** taken immediately before the cutover window (the existing branch is stale and would discard the final sync) | **NOT DONE** |
| 3 | A **restore rehearsal** on a disposable branch passes section 7's criteria; elapsed time recorded | **PARTIAL:** a branch copy was verified identical to production (7a). **Not exercised:** point-in-time restore, a historical-backup restore, elapsed time, and the application reading the branch |
| 4 | Decision on a **logical dump** as an independent fallback (tools not installed here; credential-bearing tables need handling) | **UNVERIFIED / open** |
| 5 | Migrations `…phase6j10f…` and `…phase6j11b…` applied to production by a person with the direct URL, after the rehearsal, with the restore point in place (forward-only) | **NOT DONE (not approved)** |
| 6 | Credentials: confirm database credentials were rotated after any earlier exposure, and that restore-branch credentials are managed | **UNVERIFIED** (not checked here) |
| 7 | Explicit written authorization of the cutover (and of any rollback), as in `recording-publication-safety.md` §12–§14 | **NOT GIVEN** |
| 8 | A fresh production measurement of the relationship data before the readiness decisions in §12 | **DONE 2026-10-20 ~16:21 UTC** (read-only): all zero — see `phase-6j-12d-production-anomaly-assessment.md`; re-measure before any execution |

## 10. Facts for the owner to record (fill in; not known to this session)

- Neon plan: **Free** (owner-confirmed)  History window: **6 hours** (owner-confirmed)  Production is a root branch: **yes** (owner-confirmed: Parent column `-`)  Branches used / limit: `____ / ____` (not recorded; the Free plan documents a limit of 10 per project)
- Rehearsal branch name: `music-madras-recovery-rehearsal-20261020` (project `music-madras-dev`, created by the owner)  ID: `__________`  Created at: `__________`  Verified at: 2026-10-20 ~16:09 UTC (read-only)  Elapsed to create: `__________`  Result of the read-only reconciliation: **PASS** (not a PITR or backup test)
- Rehearsal branch deleted (name and ID confirmed): `__________`  Production unchanged afterwards: `yes / no`

## 11. Evidence and method

- Read-only inspector run on 2026-10-20 (~15:36 UTC): it read connection strings from `.env` in memory, opened each connection in `BEGIN READ ONLY`, ran only `SELECT`s, and printed aggregates and truncated identifiers. Its output files and the script live in the session scratchpad and are **not** committed.
- Rehearsal verification (7a): a second read-only script compared the owner-created branch with production (identity gate, per-table counts and MD5 content, migrations, invariants); its output is in the session scratchpad and is **not** committed. The owner's gitignored `.env.rehearsal.txt` was read in memory and never printed.
- Neon console: reached the sign-in page only; nothing entered. Neon documentation: fetched from neon.com on 2026-10-20 (general facts).
- Not done, by design: any Neon write action, any restore, any migration, backfill or re-projection against a remote database, any change to the historical restore branch.

## 12. Classification of findings

| Finding | Class |
|---|---|
| Starting Git/env state as expected | VERIFIED |
| Production and the restore branch are distinct timelines in the same project/tenant, same database name and migrations | VERIFIED |
| Restore branch opens, is internally consistent, and is a **pre-sync** snapshot (not a current backup) | VERIFIED |
| 48/55 tables identical; the 7 differing tables are exactly the final sync | VERIFIED |
| Production has 0 recordings / 0 legacy relationship rows and lacks the 10F and 11B migrations and tables | VERIFIED (as of 2026-10-20) |
| Restore branch parentage and "expiry never" | UNVERIFIED (project records only) |
| Plan = Free; history window = 6 hours; production is the root branch; both other branches are its children | OWNER-CONFIRMED (console; not observed by this session) |
| Whether a point-in-time restore is actually available and works for this project; branch quota | UNVERIFIED (confirm in Neon's restore interface; not exercised) |
| Owner-created rehearsal branch is a distinct branch (timeline, endpoint) in the same project/tenant, and matches production on all 55 tables (count and content), migrations and invariants | VERIFIED |
| Rehearsal branch parent is `production` and it is a separate branch | UNVERIFIED by this session (owner-reported from the console) |
| True restore: instant restore / point-in-time restore / restore from a historical backup | NOT EXECUTED (and therefore UNVERIFIED) |
| Restore time (RTO) | UNVERIFIED |
| Logical dump available on this machine | FAILED (tools not installed; nothing produced) |
| Production untouched | VERIFIED |
| Backup/restore for a Vercel/other service | NOT APPLICABLE (database only) |
