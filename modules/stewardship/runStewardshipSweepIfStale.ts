import { runPlaylistQualitySweep } from "../db/repositories/playlistPageRepository";
import { runUnlistedReviewSweep } from "../db/repositories/unlistedReviewRepository";
import { runLifecycleInvariantSweep } from "../db/repositories/videoLifecycleRepository";
import { runMetadataReviewSweep } from "../db/repositories/videoMetadataReviewRepository";

// Phase 6K — keeping the Studio's standing conditions accurate without a scheduler. When a signed-in Studio user loads a page, this refreshes:
//   - the approval lifecycle check (an approval standing on an archived page or a private video is ended);
//   - the metadata review check (material changes to approved pages are recorded);
//   - the unlisted-video review queue and its single notification;
//   - the re-check of every published playlist page against its published snapshot.
// Best-effort and bounded: throttled per server instance, never throws (a failed refresh must not break the page), and every sweep is
// idempotent and works in bounded batches, so running on several instances or more often than intended changes nothing. This does not replace the
// scheduled job: it keeps no run record and sends no email. The scheduled call (modules/jobs/stewardshipJob.ts) is the reliable path.

const MIN_INTERVAL_MS = 10 * 60 * 1000;
let lastRunAt = 0;

export async function runStewardshipSweepIfStale(now: Date = new Date()): Promise<void> {
  if (now.getTime() - lastRunAt < MIN_INTERVAL_MS) return;
  lastRunAt = now.getTime();
  for (const [name, run] of [
    ["Approval lifecycle", () => runLifecycleInvariantSweep()],
    ["Metadata review", () => runMetadataReviewSweep({ now })],
    ["Unlisted-video review", () => runUnlistedReviewSweep(now)],
    ["Playlist page checks", () => runPlaylistQualitySweep()],
  ] as const) {
    try {
      await run();
    } catch (err) {
      console.error(`${name} sweep failed:`, err instanceof Error ? err.message : "unknown error");
    }
  }
}

/** Test-only: forget the throttle so a test can run the sweeps again immediately. */
export function resetStewardshipSweepThrottleForTests(): void {
  lastRunAt = 0;
}
