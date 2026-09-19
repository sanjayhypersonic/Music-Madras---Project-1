# modules/jobs — later-phase scope

Structural placeholder for the Scheduler/Trigger → Job → Service layering (ADR §12). Phase 1 guardrails explicitly exclude implementing scheduled jobs. This directory will hold job definitions like `youtubeSyncJob.ts` once the YouTube synchronization phase begins — thin wrappers that add run-level locking and `SyncJobRun` bookkeeping around the pure logic in `modules/youtube/sync-engine`, called identically by Vercel Cron and by a Studio "Sync Now" action.
