# Phase 6J-12C — Backup and restore verification (Neon production)

**Read this first.** This is an **inspection**, not a restore test. **No restore rehearsal was executed.** Nothing was created, restored, reset,
renamed or deleted in Neon, and production was only read (read-only transactions). The reasons and the exact manual steps are below.
Findings are classified **VERIFIED** (observed in this phase), **UNVERIFIED** (not observable from here, or only documented in general),
**FAILED**, or **NOT APPLICABLE**. No connection string, password, key or token appears in this document; identifiers are truncated.

## 1. Summary

| Question | Answer |
|---|---|
| Is there a current, verified backup of production? | **UNVERIFIED — no.** The only recovery artefact seen is a *pre-sync snapshot* branch that is stale (section 4). |
| Is point-in-time restore available to this project? | **UNVERIFIED.** Neon documents it, but the plan and the history window cannot be read from SQL and the console was not accessible. |
| Was an isolated restore rehearsal completed? | **No (NOT EXECUTED).** Creating a branch needs account access this session does not have. A manual procedure is provided (section 6). |
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
| **Instant restore / point-in-time restore (PITR)** | Restores a **root** branch to a timestamp or LSN *in place*; replaces all data and schema; Neon preserves the prior state in an automatic backup branch `{branch}_old_{timestamp}`; connection details stay the same; changes after the restore point are lost | **UNVERIFIED.** Depends on plan and history window (below) and on production being a root branch. |
| **History window** | Free: 6 hours (1 GB of change history); Launch: up to 7 days; Scale: up to 30 days; paid projects default to 1 day and the window can be shortened | **UNVERIFIED.** The project's plan and configured window are console/API facts. A 6-hour or 1-day window would not cover a cutover investigated the next week. |
| **Create a branch from a past point in time** | Creates a new child branch at a chosen timestamp/LSN without touching the parent | **UNVERIFIED** (permission, quota and cost not checked). This is the safe rehearsal primitive. |
| **Time Travel Assist** | Read-only queries against a historical point, to confirm the target before restoring | **UNVERIFIED** (console feature; not accessed). |
| **PITR on the restore branch** | Only root branches support PITR; child branches do not | Applies if the restore branch is a child: **it cannot itself be point-in-time restored.** |
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

## 7. Restore rehearsal — NOT EXECUTED; manual procedure (owner action required)

**Why not executed:** a rehearsal needs a new Neon branch (a resource in the account, possibly with quota or billing effect). This session has no API access and the
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
Status of every step above: **UNVERIFIED for this project** until sections 7 and 10 are completed.

## 9. Remaining blockers and preconditions before any relationship cutover

| # | Precondition | Status |
|---|---|---|
| 1 | Plan and **history window** recorded from the console; production confirmed as a root branch | **UNVERIFIED — manual** |
| 2 | A **fresh restore point** taken immediately before the cutover window (the existing branch is stale and would discard the final sync) | **NOT DONE** |
| 3 | A **restore rehearsal** on a disposable branch passes section 7's criteria; elapsed time recorded | **NOT EXECUTED — manual** |
| 4 | Decision on a **logical dump** as an independent fallback (tools not installed here; credential-bearing tables need handling) | **UNVERIFIED / open** |
| 5 | Migrations `…phase6j10f…` and `…phase6j11b…` applied to production by a person with the direct URL, after the rehearsal, with the restore point in place (forward-only) | **NOT DONE (not approved)** |
| 6 | Credentials: confirm database credentials were rotated after any earlier exposure, and that restore-branch credentials are managed | **UNVERIFIED** (not checked here) |
| 7 | Explicit written authorization of the cutover (and of any rollback), as in `recording-publication-safety.md` §12–§14 | **NOT GIVEN** |
| 8 | A fresh production measurement of the relationship data (the current counts in section 6 are zero) before the readiness decisions in §12 | **Separate, later phase — not started** |

## 10. Facts for the owner to record (fill in; not known to this session)

- Neon plan: `__________`  History window: `__________`  Production is a root branch: `yes / no`  Branches used / limit: `____ / ____`
- Rehearsal branch name and ID: `__________`  Created at: `__________`  Verified at: `__________`  Elapsed: `__________`  Result: `PASS / FAIL`
- Rehearsal branch deleted (name and ID confirmed): `__________`  Production unchanged afterwards: `yes / no`

## 11. Evidence and method

- Read-only inspector run on 2026-10-20 (~15:36 UTC): it read connection strings from `.env` in memory, opened each connection in `BEGIN READ ONLY`, ran only `SELECT`s, and printed aggregates and truncated identifiers. Its output files and the script live in the session scratchpad and are **not** committed.
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
| Plan, history window, PITR availability, root-branch status, branch quota | UNVERIFIED |
| Isolated restore rehearsal | NOT EXECUTED (no API access; console not signed in) |
| Restore time (RTO) | UNVERIFIED |
| Logical dump available on this machine | FAILED (tools not installed; nothing produced) |
| Production untouched | VERIFIED |
| Backup/restore for a Vercel/other service | NOT APPLICABLE (database only) |
