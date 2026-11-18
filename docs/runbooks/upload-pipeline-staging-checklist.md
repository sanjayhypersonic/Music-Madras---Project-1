# Upload pipeline: staging switch-on checklist

Written 2026-11-18 for branch `wip/credits-extraction` (project register R-34). Nothing in this checklist has been run yet.

**Before you start:**
- Commands are for **PowerShell**, run from `D:\Claude Code\Music-Madras`.
- `<STAGING>` is the **direct (non-pooled)** connection string of the staging Neon database.
- `<HOST>` is its `host:port/database`, exactly as `npm run migrate -- status` prints it.
- Secrets are pasted by you and never written to a file.
- After each part, clear the variables you set: `Remove-Item Env:NAME`.

## Part A. Apply the migration on staging

1. **Make a restore point in Neon.**
   1. Neon Console → your project → **Branches** (left sidebar) → **Create branch**.
   2. Parent: the branch that holds `music_madras_staging`. Point in time: **Current**.
   3. Name: `restore-staging-2026-11-18-upload-pipeline` → **Create**.
2. **Copy two direct connection strings.**
   1. Neon Console → **Connect** → choose the staging branch and database `music_madras_staging` → turn **Connection pooling off** → copy. This is `<STAGING>`.
   2. Repeat for the restore-point branch. This is `<RESTORE>`.
3. **Fingerprint staging before any change:**
   ```powershell
   $env:VERIFY_DATABASE_URL = "<STAGING>"; npm run ops:verify-database -- --out restore-point-staging-upload-pipeline.json
   ```
4. **Prove the restore point matches.** Pass = `RESULT: verified`; otherwise stop.
   ```powershell
   $env:VERIFY_DATABASE_URL = "<RESTORE>"; npm run ops:verify-database -- --compare restore-point-staging-upload-pipeline.json
   ```
5. **See what is pending (read-only).** Expect exactly one pending migration, `20261118100000_upload_pipeline`, classified **ADDITIVE** with 0 blocking. Note the printed `host:port/database`: that is `<HOST>`.
   ```powershell
   $env:MIGRATE_DATABASE_URL = "<STAGING>"; npm run migrate -- status
   ```
6. **Apply** (the one irreversible step). Pass = `After: ... pending 0, failed 0`.
   ```powershell
   npm run migrate -- apply --confirm-host "<HOST>" --restore-point "restore-staging-2026-11-18-upload-pipeline"
   ```
7. **Verify the data survived and the schema matches the code.** The second command must exit with 0.
   ```powershell
   $env:VERIFY_DATABASE_URL = "<STAGING>"; npm run ops:verify-database -- --compare restore-point-staging-upload-pipeline.json --after-migration
   ```
   ```powershell
   $env:DIRECT_URL = "<STAGING>"; npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
   ```
8. **Clear the variables:**
   ```powershell
   Remove-Item Env:VERIFY_DATABASE_URL, Env:MIGRATE_DATABASE_URL, Env:DIRECT_URL
   ```

## Part B. Seed the aliases from review-names.csv

1. **Fill in the decisions.**
   1. Open `reports\video-credits\review-names.csv` in Excel.
   2. For every name that is a standing decision, fill **decision** (`accept` or `merge`) and **canonicalName** (the catalogue spelling). At least these rows:
      - performer `Allan Samuel`;
      - performer `Hannah Jane`;
      - composer `Vedha`;
      - the three choir/ensemble rows starting `TELC Arulnathar and/& Adaikalanathar …` (`merge`, the same canonicalName on all three);
      - the two venue rows `TELC Arulnathar Lutheran Church` and `TELC Arulnathar Lutheran Church, Chennai` (`merge`, the same canonicalName).
   3. **File → Save As → "CSV UTF-8 (Comma delimited)"**, same name. Keep it a CSV.
2. **Dry run (offline).** Check every alias and expect `0 conflict(s)`. If "0 decided row(s)" appears, the save lost the decisions: go back to step 1.
   ```powershell
   npm run pipeline:seed-aliases
   ```
3. **Write to staging.**
   ```powershell
   $env:STAGING_DATABASE_URL = "<STAGING>"; npm run pipeline:seed-aliases -- --confirm-host "<HOST>" --execute
   ```
   Pass = `Aliases: N created, 0 updated, 0 unchanged`. A second run prints `0 created … N unchanged`.

## Part C. Reconcile Dingiri Dingalae

`STAGING_DATABASE_URL` is still set from Part B.

1. **Offline dry run:**
   ```powershell
   npm run pipeline:reconcile-staging
   ```
2. **Read-only dry run against staging.**
   ```powershell
   npm run pipeline:reconcile-staging -- --confirm-host "<HOST>"
   ```
   Expect exactly:
   - `Work title "Dingiri Dingalae" -> "டிங்கிரி டிங்காலே"`;
   - `add alternate title(s): "Dingiri Dingalae"`;
   - `composer "Traditional" -> "Vedha" (…)`.

   A `REFUSED` line means stop.
3. **Apply:**
   ```powershell
   npm run pipeline:reconcile-staging -- --confirm-host "<HOST>" --execute
   ```
   Pass = `Work updated (slug unchanged).`, `Composer set to Vedha.` and `Done.` A repeat of step 2 now prints `nothing to do`.
4. **Clear the variable:**
   ```powershell
   Remove-Item Env:STAGING_DATABASE_URL
   ```

## Part D. Environment variables in Vercel

These matter only for the **deployed** site: the `/api/cron/pipeline` route and Studio → Pipeline. Parts A–C and E run from this computer.

1. The code is uncommitted. Commit and push the branch, and let Vercel build a **Preview** deployment of it (or use your staging project).
2. **Open the variables page.** Vercel dashboard → the project → **Settings** (top tabs) → **Environment Variables** (left).
3. For each variable below: enter **Key** and **Value**, tick only the **Preview** environment (staging), turn **Sensitive** on for secrets, then **Save**.

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | staging pooled connection string (if not already set) |
   | `DIRECT_URL` | `<STAGING>` (direct) |
   | `AI_PROVIDER` | `anthropic` |
   | `ANTHROPIC_API_KEY` | from your secrets store (Sensitive) |
   | `CRON_SECRET` | at least 32 random characters (Sensitive; reuse the stewardship one if set) |
   | `YOUTUBE_API_KEY` | from your secrets store (Sensitive) |
   | `YOUTUBE_CHANNEL_ID` | the Music Madras channel id |
   | `PIPELINE_ENABLED` | `true` |
   | `PIPELINE_DRY_RUN` | leave **unset** for now (dry run) |
   | `MAX_USD_PER_RUN` | `2` |
   | `PIPELINE_MAX_VIDEOS_PER_RUN` | `1` |

4. **Redeploy.** **Deployments** (top tabs) → the latest Preview deployment → **⋯** → **Redeploy**. Variables apply only to new deployments.
5. **Check readiness.** Open `https://<preview-url>/api/ready`. It must answer `200 {"status":"ready"}`; "not ready" means Part A was not applied to the database this deployment uses.
6. **Do not add the cron to `vercel.json` yet.** It is pinned to one cron by a test, and Part E covers the first runs.

## Part E. Run the five reference videos

The videos: `Vl8Xe2COp2c`, `zRjM7rP7hpM`, `S4aemnTWODM`, `jiNrP52imwg`, `rxGfBGWLnTI`.

1. **Set this shell.** The scripts do not read `.env`.
   ```powershell
   $env:STAGING_DATABASE_URL = "<STAGING>"; $env:PIPELINE_ENABLED = "true"; $env:MAX_USD_PER_RUN = "2"; $env:AI_PROVIDER = "anthropic"; $env:ANTHROPIC_API_KEY = "<paste>"
   ```
2. **Dry run all five (read-only, no AI call).**
   ```powershell
   npm run pipeline:run -- --only Vl8Xe2COp2c,zRjM7rP7hpM,S4aemnTWODM,jiNrP52imwg,rxGfBGWLnTI --confirm-host "<HOST>"
   ```
   Every video should show `would: queue …`. A `refused` line gives the reason (a hold, already approved, not public); leave that video out.
3. **Run one video at a time.** One video's conservative estimate is about $1.30, so two would not fit a $2 cap. Start with the simplest:
   ```powershell
   npm run pipeline:run -- --only Vl8Xe2COp2c --confirm-host "<HOST>" --execute
   ```
   Pass looks like this:
   - `Vl8Xe2COp2c: QUEUED -> EXTRACTED -> RESOLVED -> RESEARCHED -> AWAITING_APPROVAL`;
   - a `Usage:` line with tokens, searches and cost (the actual charge, usually well under the estimate).

   `STOPPED: … MAX_USD_PER_RUN` means run the same command again: it resumes from the saved stage.
4. **Repeat for each of the other four:**
   ```powershell
   npm run pipeline:run -- --only zRjM7rP7hpM --confirm-host "<HOST>" --execute
   ```
   ```powershell
   npm run pipeline:run -- --only rxGfBGWLnTI --confirm-host "<HOST>" --execute
   ```
   ```powershell
   npm run pipeline:run -- --only S4aemnTWODM --confirm-host "<HOST>" --execute
   ```
   ```powershell
   npm run pipeline:run -- --only jiNrP52imwg --confirm-host "<HOST>" --execute
   ```
   Expected from the editor's reference decisions:
   - **S4aemnTWODM** (no stated composer) is drafted, but its bundle is flagged `held` and approval will be refused.
   - **jiNrP52imwg**, the medley, behaves the same way: *Ding Dong! Merrily on High* states no composer.
   - **rxGfBGWLnTI** keeps its Tamil title.
5. **Review the bundles.** Open Studio → **Pipeline** on the Preview deployment from Part D (signed in as a Founder or Administrator). Open each bundle; check the drafts, the claims and every flag. Decide each CONFLICT claim. Approve only what you have checked line by line. Approval publishes on staging.
6. **Clear the shell:**
   ```powershell
   Remove-Item Env:STAGING_DATABASE_URL, Env:PIPELINE_ENABLED, Env:MAX_USD_PER_RUN, Env:AI_PROVIDER, Env:ANTHROPIC_API_KEY
   ```
