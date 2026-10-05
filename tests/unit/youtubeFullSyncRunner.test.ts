import { describe, expect, it } from "vitest";
import {
  RUNNER_EXIT_CODES,
  assessRunnerEnvironment,
  exitCodeForStatus,
  findMissingCheckpointScopes,
  formatSyncSummary,
  parseRunnerArgs,
} from "../../modules/jobs/youtubeFullSyncRunner";
import { deriveYouTubeSyncStatus } from "../../modules/jobs/youtubeSyncStatus";
import { describeConnectionHost, isPooledConnectionString } from "../../modules/jobs/syncRunLock";
import type { YouTubeSyncResult } from "../../modules/youtube/sync-engine/syncYouTubeChannel";

// Phase 6J-1 — the pure parts of the committed YouTube sync operator script.
// (The script itself is never run by a test: it would call the real API.)

const SECRET_KEY = "AIzaSy-super-secret-key-value";
const PASSWORD = "p4ssw0rd-never-print-me";
const GOOD_ENV = {
  YOUTUBE_API_KEY: SECRET_KEY,
  YOUTUBE_CHANNEL_ID: "UCchannel",
  DATABASE_URL: `postgresql://user:${PASSWORD}@ep-abc-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require`,
  DIRECT_URL: `postgresql://user:${PASSWORD}@ep-abc.eu-west-2.aws.neon.tech/neondb?sslmode=require`,
};

function result(overrides: Partial<YouTubeSyncResult> = {}): YouTubeSyncResult {
  const counts = { discovered: 3, created: 1, updated: 1, unchanged: 1, flagged: 0 };
  return {
    completeness: "FULL",
    videoAbsenceEvaluated: true,
    reconciliation: null,
    videos: counts,
    playlists: counts,
    playlistItems: counts,
    conflictsDetected: 0,
    recordsFailed: 0,
    errors: [],
    ...overrides,
  };
}

describe("parseRunnerArgs", () => {
  it("defaults to a dry run — nothing executes without --execute", () => {
    expect(parseRunnerArgs([])).toEqual({ execute: false });
  });
  it("--execute opts in", () => {
    expect(parseRunnerArgs(["--execute"])).toEqual({ execute: true });
  });
  it("refuses unknown flags rather than guessing (a typo must never start a sync)", () => {
    expect(parseRunnerArgs(["--exec"])).toHaveProperty("error");
    expect(parseRunnerArgs(["--execute", "--force"])).toHaveProperty("error");
  });
});

describe("assessRunnerEnvironment", () => {
  it("passes a complete environment with a direct lock connection", () => {
    expect(assessRunnerEnvironment(GOOD_ENV).ok).toBe(true);
  });

  it.each(["YOUTUBE_API_KEY", "YOUTUBE_CHANNEL_ID", "DATABASE_URL", "DIRECT_URL"])("reports a missing %s", (name) => {
    const env = { ...GOOD_ENV, [name]: undefined };
    const preflight = assessRunnerEnvironment(env);
    expect(preflight.ok).toBe(false);
    expect(preflight.problems.join(" ")).toContain(name);
  });

  it("refuses a pooled DIRECT_URL, because a session lock through a pooler is not reliable", () => {
    const preflight = assessRunnerEnvironment({ ...GOOD_ENV, DIRECT_URL: GOOD_ENV.DATABASE_URL });
    expect(preflight.ok).toBe(false);
    expect(preflight.problems.join(" ")).toMatch(/pooled/i);
  });

  it("(Phase 6J-5) refuses a DIRECT_URL that names a different database than DATABASE_URL — the lock would protect nothing", () => {
    for (const direct of [
      `postgresql://user:${PASSWORD}@ep-abc.eu-west-2.aws.neon.tech/another_db?sslmode=require`,
      `postgresql://user:${PASSWORD}@ep-other.eu-west-2.aws.neon.tech/neondb?sslmode=require`,
      "not a connection string",
    ]) {
      const preflight = assessRunnerEnvironment({ ...GOOD_ENV, DIRECT_URL: direct });
      expect(preflight.ok).toBe(false);
      expect(preflight.problems.join(" ")).toMatch(/same database/);
    }
  });

  it("accepts the pooled/direct pair of ONE Neon database (a -pooler suffix and port are ignored)", () => {
    expect(assessRunnerEnvironment(GOOD_ENV).problems).toEqual([]);
    expect(assessRunnerEnvironment({ ...GOOD_ENV, DIRECT_URL: GOOD_ENV.DIRECT_URL.replace("/neondb", ":5432/neondb") }).ok).toBe(true);
  });

  it("its printable report contains host names and flags only — no key, no password, no connection string", () => {
    const text = JSON.stringify(assessRunnerEnvironment(GOOD_ENV).report);
    expect(text).not.toContain(SECRET_KEY);
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain("postgresql://");
    expect(text).toContain("ep-abc-pooler.eu-west-2.aws.neon.tech");
    expect(text).toContain('"youtubeApiKeyConfigured":true');
  });
});

describe("pooled-endpoint detection", () => {
  it.each([
    ["postgresql://u:p@ep-x-pooler.eu-west-2.aws.neon.tech/db", true],
    ["postgresql://u:p@db.example.com:6432/db", true],
    ["postgresql://u:p@db.example.com/db?pgbouncer=true", true],
    ["postgresql://u:p@ep-x.eu-west-2.aws.neon.tech/db?sslmode=require", false],
    ["postgresql://u:p@localhost:5432/db", false],
    ["not a url", false],
  ])("%s -> pooled=%s", (url, pooled) => {
    expect(isPooledConnectionString(url)).toBe(pooled);
  });

  it("describeConnectionHost never includes credentials", () => {
    expect(describeConnectionHost(GOOD_ENV.DIRECT_URL)).toBe("ep-abc.eu-west-2.aws.neon.tech/neondb");
    expect(describeConnectionHost("garbage")).not.toContain("garbage");
  });
});

describe("status and exit codes", () => {
  it("SUCCEEDED only for a FULL pass with no failed records and no errors", () => {
    expect(deriveYouTubeSyncStatus(result())).toBe("SUCCEEDED");
  });
  it("a pass that failed any record is PARTIAL, never SUCCEEDED, even if it claims FULL", () => {
    expect(deriveYouTubeSyncStatus(result({ recordsFailed: 1 }))).toBe("PARTIAL");
  });
  it("any recorded error, or a PARTIAL completeness, is PARTIAL", () => {
    expect(deriveYouTubeSyncStatus(result({ errors: [{ phase: "x", message: "y" }] }))).toBe("PARTIAL");
    expect(deriveYouTubeSyncStatus(result({ completeness: "PARTIAL" }))).toBe("PARTIAL");
  });

  it("every outcome has its own non-colliding exit code, and only SUCCEEDED is zero", () => {
    const codes = Object.values(RUNNER_EXIT_CODES);
    expect(new Set(codes).size).toBe(codes.length);
    expect(RUNNER_EXIT_CODES.SUCCEEDED).toBe(0);
    expect(codes.filter((c) => c === 0)).toHaveLength(1);
    expect(exitCodeForStatus("SUCCEEDED")).toBe(0);
    expect(exitCodeForStatus("PARTIAL")).not.toBe(0);
  });
});

describe("formatSyncSummary", () => {
  it("prints the run id, status, counts, and any errors — and says plainly when absence flagging was skipped", () => {
    const lines = formatSyncSummary({
      syncJobRunId: "run-123",
      status: "PARTIAL",
      result: result({ completeness: "PARTIAL", videoAbsenceEvaluated: false, recordsFailed: 2, errors: [{ phase: "listPlaylistItems(PL1)", message: "boom" }] }),
    }).join("\n");
    expect(lines).toContain("run-123");
    expect(lines).toContain("PARTIAL");
    expect(lines).toContain("Records failed:     2");
    expect(lines).toContain("SKIPPED");
    expect(lines).toContain("listPlaylistItems(PL1)");
  });

  it("includes the reconciliation verdict when there is one", () => {
    const lines = formatSyncSummary({
      syncJobRunId: "r",
      status: "SUCCEEDED",
      result: result({
        reconciliation: { status: "MISMATCH", reportedVideoCount: 14, uploadsVideoIds: 12, uploadsPublicVideos: 12, observedVideoIds: 14, resolvedVideos: 14, difference: 2, note: "differs" },
      }),
    }).join("\n");
    expect(lines).toMatch(/MISMATCH.*14.*12/);
  });
});

describe("findMissingCheckpointScopes — the 12-versus-14 gap is reported, not silent", () => {
  const full = { playlistItemScopeKeys: ["channel-uploads", "PL1", "PL2"], playlistScopeKeys: ["channel-playlists"], observedYoutubePlaylistIds: ["PL1", "PL2"] };

  it("is empty when every scope is present", () => {
    expect(findMissingCheckpointScopes(full)).toEqual([]);
  });
  it("names a missing sentinel", () => {
    expect(findMissingCheckpointScopes({ ...full, playlistItemScopeKeys: ["PL1", "PL2"] })).toEqual(["YOUTUBE_PLAYLIST_ITEM:channel-uploads"]);
    expect(findMissingCheckpointScopes({ ...full, playlistScopeKeys: [] })).toEqual(["YOUTUBE_PLAYLIST:channel-playlists"]);
  });
  it("names an observed playlist that has no checkpoint", () => {
    expect(findMissingCheckpointScopes({ ...full, playlistItemScopeKeys: ["channel-uploads", "PL1"] })).toEqual(["YOUTUBE_PLAYLIST_ITEM:PL2"]);
  });
});
