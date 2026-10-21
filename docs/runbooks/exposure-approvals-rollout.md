# Runbook: rolling out (and rolling back) the exposure-approval change

Status: **written, not executed.** Nothing in this runbook has been run against the production database. The migrations were applied only to the isolated local test database. Every step below that touches production needs explicit authorization first.

Read **"Rolling back"** before the rollout, not after: rolling back is *not* a no-op, and doing it carelessly can make pages public that the new software had hidden.

## What changes, in one paragraph

An unlisted YouTube video used to be public if its page carried one flag (`youtube_video_pages.unlistedPublicationApprovedAt`). It now needs recorded, scoped, revocable approvals (`video_exposure_approvals`: PAGE, DISCOVERY, PLAYLIST) **and** the flag (the flag is kept as a cache of "an active PAGE approval exists"); an active hold (`video_exposure_reviews.holdReason`) blocks everything; and the lifecycle rules end an approval when the video becomes private or the page is archived (a *fresh* approval is then needed). Under the old rule an approved unlisted video was both reachable and listed everywhere. The migrations carry those approvals over **without delisting anything that was public**, mark them so an editor can reconsider them in Studio, and record **no approver** for them (the flag never stored one).

## The migrations involved (apply together, in order, with `prisma migrate deploy` against the DIRECT (unpooled) connection)

| Migration | Effect on existing data |
|---|---|
| `20261021100000_phase6k1_settings_editorial_notifications` | New tables; adds defaulted columns to `editorial_content` (existing rows become unpublished drafts). |
| `20261021110000_phase6k2_video_exposure_approvals_and_review` | New tables; **data step:** one PAGE approval per page that carries the flag (time = the flag's time; it also stored the page's last editor as approver — corrected by `…100000` below). |
| `20261021120000_phase6k3_featured_videos`, `…130000_phase6k4_playlist_pages`, `…140000_phase6k5_playlist_context_and_drafts` | New tables only. |
| `20261021150000_phase6k_fix_carry_over_legacy_approvals` | Adds `origin` / `confirmedAt` / `confirmedById`; marks the carried-over PAGE approvals `MIGRATED_LEGACY`; adds an explicit, marked DISCOVERY approval so those pages stay listed; one audit entry per carried-over approval (actor empty). |
| `20261022100000_phase6k_hardening_lifecycle_provenance` | Makes the approver optional and **clears the inferred approver** on every carried-over approval; **revokes every active approval on an archived page or a private video** (reason recorded, flag cleared, audited); **revokes carried-over listing approvals on pages that are still drafts**. Idempotent: it only touches rows still in the state it corrects. |
| `20261022110000_phase6k_hardening_metadata_review` | A table and two columns for metadata review (no existing row changes). Raw-SQL partial unique index: one pending change per page. |
| `20261022120000_phase6k_hardening_integrity` | **Pre-flight checks first**: if any page has two active approvals for one target, two featured videos share a position, a playlist page has two members at one position, or two live playlist pages share a published title, the migration **stops with a message and changes nothing**. Then adds the playlist snapshot columns, backfills the published-title key of live pages, and creates the unique indexes (one raw-SQL partial index). |
| `20261022130000_phase6k_hardening_operations` | Delivery-claim columns and the scheduled-job run tables (empty). |
| `20261022140000_phase6k_hardening_playlist_snapshot` | One nullable column (the context a page was published with). |
| `20261022150000_phase6k_hardening_partial_steps` | One enum value. |

All are additive in effect on content (no column or row is dropped; the only data changes are the corrections in `…100000`, which revoke, never delete). Locks are brief: metadata-only `ALTER TABLE`s, new empty tables, and foreign-key validation over small tables. **There are no down-migrations**; recovery is a restore point (below). The partial and expression indexes are written in raw SQL because Prisma cannot declare them; they are re-created by any fresh `migrate deploy`, and `prisma migrate diff` does not report them.

## The hazards this runbook exists for

1. **A rollout window.** The new rule needs the approval **rows**; older software writes only the **flag**. Between "migrations applied" and "new code live", and again after a rollback, an editor using the older software can approve or revoke an unlisted video with the flag alone: a flag-only **approval** has no row, so the new software would not show the video (a silent loss); a flag-only **revocation** leaves an active approval row (harmless to visitors, because the rule also requires the flag, but untidy). `findApprovalFlagInconsistencies` detects both and the reconciliation procedure repairs them.
2. **Old code ignores what the new code added.** See "Rolling back".

## The reconciliation procedure

`npm run reconcile:exposure-approvals` (script: `scripts/reconcileExposureApprovals.ts`; rules: `modules/mmke/catalogue/approvalReconciliation.ts`).

| Page state | Action |
|---|---|
| flag set, no active PAGE approval, page **archived** or video **private** | **clear the stale flag** (such a page cannot hold an approval). |
| flag set, no active PAGE approval, video unlisted, a hold in place | skipped and reported (a hold blocks approval). |
| flag set, no active PAGE approval, video unlisted | add a PAGE approval marked `RECONCILED_LEGACY` with **no approver recorded**, and a listing (DISCOVERY) approval **only if the page is published**, at the flag's time — the legacy approval stands as it was, never wider. |
| flag set, video not unlisted | nothing (approvals exist only for unlisted videos). |
| flag cleared, active approvals | revoke them all (the legacy revocation stands), reason `RECONCILED`. |
| flag set and an active PAGE approval | nothing — including a deliberate page-only approval made by the new software (no listing is added). |
| neither | nothing. |

Properties: **dry run by default** (writes nothing); idempotent (a second run finds nothing to do); re-derives each page's decision under the page's row lock (safe while editors work; two operators at once create one set of rows); one audit entry per change with the operator recorded; never calls YouTube; never invoked by start-up, deployment, a Studio page or a scheduler.

Safety interlocks of the script itself: it never reads `DATABASE_URL`/`DIRECT_URL`/`.env` as a target. You set `RECONCILE_DATABASE_URL` and type `RECONCILE_TARGET_CONFIRM=<host>:<port>/<database>` (it refuses unless they match exactly); `--execute` needs `--actor <email>` of an ACTIVE Studio user who may publish; a target that is not on the same machine also needs `--confirm-restore-point`.

## Safe rollout sequence (production — **not yet authorized**)

0. **Restore point.** Create a Neon branch from the current head, name it with the date and release, confirm it opens (`docs/deployment-readiness-gate.md`). Do not proceed without it.
1. **Read-only measurement** (Neon SQL editor, SELECT only) — do not trust this runbook's or any earlier note's belief about what production holds:
   ```sql
   select count(*) as flagged from youtube_video_pages where "unlistedPublicationApprovedAt" is not null;
   select count(*) as flagged_and_published_unlisted
   from youtube_video_pages p join youtube_videos v on v.id = p."youtubeVideoId"
   where p."unlistedPublicationApprovedAt" is not null and p.status = 'PUBLISHED' and p."archivedAt" is null and v."privacyStatus" = 'unlisted';
   select count(*) as flagged_but_archived_or_private
   from youtube_video_pages p join youtube_videos v on v.id = p."youtubeVideoId"
   where p."unlistedPublicationApprovedAt" is not null and (p."archivedAt" is not null or v."privacyStatus" = 'private');
   select count(*) as flagged_drafts
   from youtube_video_pages p
   where p."unlistedPublicationApprovedAt" is not null and p.status <> 'PUBLISHED' and p."archivedAt" is null;
   ```
   Record the numbers. The first two say what the migrations carry over and keep listed; the third is what they will **end** (archived or private); the fourth is what stays reachable but is **not** listed. Check them against what you expect before going on.
2. **Run the duplicate checks** the integrity migration will run (same four conditions, as SELECTs) and resolve anything found; the migration would refuse otherwise.
3. **Announce a short freeze** on approving or revoking unlisted videos in Studio from step 4 until step 7.
4. **Apply all pending migrations** to production with `prisma migrate deploy` using the direct connection. Never edit an applied migration.
5. **Deploy the new code** immediately.
6. **Dry run** the reconciliation against production and read the report: it should list only pages approved or revoked during the window (usually none).
7. **Execute** it with `--actor <your Studio email>` (and `--confirm-restore-point`). Re-run the dry run: expect no pending actions other than hold-blocked pages.
8. **Verify**: Studio → Catalogue → *Unlisted videos* → *Carried-over approvals* lists every carried-over page, approver shown as "not recorded"; the public homepage, `/videos` and the sitemap still list the videos you recorded in step 1; `findApprovalFlagInconsistencies` returns empty; Studio → Health shows the run records once a scheduler exists.
9. **Lift the freeze.** Then reconsider the carried-over approvals at your leisure (keep, stop listing, or withdraw) — nothing changes until you do.

## Rolling back

### What older code does with this data (read this first)

The older application knows only the legacy flag. After a code rollback, **everything the new code added is ignored**:

| New behaviour | What the old code does |
|---|---|
| A **hold** (rights, copyright, privacy) hides a video | **Ignored.** A held **public** video whose page is published is public again. A held unlisted video stays hidden only because setting the hold also cleared its flag. |
| **Stop listing** (revoking only the listing approval) | **Ignored.** The old rule lists every page that carries the flag, so a page you stopped listing is listed again. |
| A **lifecycle revocation** (private / archived) | The flag was cleared by the revocation, so such a page stays hidden. But: the old software has no lifecycle rule, so if the video becomes private and unlisted again, or the page is restored, and an editor re-approves it with the old one-click flag, nothing records or limits that. |
| **Metadata review**, review queue, playlist pages, featured pinning, notifications, scheduled maintenance | Not present: pages and routes for them disappear or do not exist; nothing reviews or reconciles anything. |
| A **flag-only** approval or revocation made by the old code | Invisible to the new rule until reconciled (hazard 1). |

### A safe rollback sequence (the new code is live; the decision is to go back)

Do **not** simply redeploy the old code. In this order:

1. **Stop exposure of what old code would get wrong.** While the *new* code is still serving, in Studio: (a) list every video with an active hold (Studio → Unlisted videos shows holds; or `select … from video_exposure_reviews where "holdReason" is not null`) and **unpublish each one's catalogue page** — unpublishing is honoured by old code, holds are not; (b) for every page whose listing you stopped but whose page approval stands, decide: withdraw the page approval (it becomes unreachable under old code too) or accept that old code will list it again. Record the list.
2. **Take a restore point** (a Neon branch), and keep the new migrations in place — they are additive and the old code ignores them.
3. **Put public traffic on hold** if you can (a maintenance page or a platform-level pause — your hosting decision; none is chosen here). This closes the window in which old code would serve pages before step 6.
4. **Deploy the old code.**
5. **Verify the deployed version before anything resumes.** The new code has routes the old one lacks: `GET /api/cron/stewardship` answers 401/503 on the new code and 404 on the old; `/videos` and `/playlists` exist only on the new code; check the deployment record's commit as well. Do not trust the label of a deployment — request these URLs.
6. **Reconcile in the direction old code needs:** the old code reads the flag, and the new code kept the flag in step with PAGE approvals, so nothing is needed for approvals the new code made. Spot-check with `findApprovalFlagInconsistencies`. Re-verify step 1(a) held: open `/videos/<slug>` of each held video and confirm it is not public.
7. **Resume public traffic.** Anything the old code approves or revokes from now on is flag-only.

### Rolling forward again (after any period on old code)

Re-run the procedure: apply any pending migrations, deploy the new code, **dry-run** the reconciliation, execute it. It carries flag-only approvals over (marked as carried over, no approver, listed only if published) and revokes the leftovers of flag-only revocations. Then re-check holds and stopped listings: the new code enforces them again from the moment it is live, so a page old code listed will disappear if its hold or stopped listing still stands.

### Other failure cases

- **Before step 5 (code not yet deployed):** nothing to undo. The migrations are additive and inert apart from the corrections in `…100000`, which only revoke approvals the lifecycle rules say cannot stand; leave them in place. The old software ignores the new tables and columns.
- **Reconciliation failed part-way:** each page is its own transaction and the procedure is idempotent: fix the cause and run it again.
- **A carried-over approval was a mistake:** withdraw it in Studio (the ordinary revocation, audited). Do not delete rows.
- **The integrity migration refused:** it changed nothing. Resolve what its message names and run `prisma migrate deploy` again.
- **Data loss or corruption (last resort):** restore from the restore point taken in step 0 (a branch; points-in-time and plan retention are the Neon plan's, confirm them in advance). Everything written since the restore point is lost, which is why the freeze and the short window matter.
- **Never:** run ad-hoc `DELETE`/`UPDATE` on `video_exposure_approvals`; set the legacy flag by hand; edit an applied migration; run the reconcile script without a dry run first.

## What remains true about public visibility after rollout

A video is shown on a surface only if the shared rule allows it: published, unarchived page, available video, **no active hold**, public — or unlisted with the matching recorded approval (page → reachable; listing → catalogue, homepage, featured, sitemap, related-video sections; playlist → that playlist). Approvals are revocable at any time and revocation takes effect on the next request (every public route reads the database per request; none is cached). An approval ends by itself when the video becomes private or the page is archived, and nothing — a return to unlisted, a restore — brings it back without a fresh approval. See `docs/runbooks/approval-lifecycle-and-metadata-review.md`.
