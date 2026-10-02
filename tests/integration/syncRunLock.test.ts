import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import "dotenv/config";
import { prisma } from "../../modules/db/client";
import {
  SyncAlreadyRunningError,
  SyncLockConfigurationError,
  YOUTUBE_SYNC_LOCK_KEY,
  acquireSyncRunLock,
  isSyncRunLockFree,
} from "../../modules/jobs/syncRunLock";
import { runYouTubeSyncJob } from "../../modules/jobs/youtubeSyncJob";

// Phase 6J-1 — the YouTube sync run lock, against a real Postgres. Test locks
// use a unique key so they can never collide with a real run; the one test that
// uses the real key only proves a second run is REFUSED (the job takes the lock
// before it creates any row or calls YouTube — no network call happens here).

const DIRECT = process.env.DIRECT_URL as string;
const T = 60000;

describe("sync run lock", () => {
  it("a second holder is refused while the first holds the lock, and succeeds once it is released", async () => {
    const key = `phase6j1-test-${randomUUID()}`;
    const first = await acquireSyncRunLock(DIRECT, key);
    await expect(acquireSyncRunLock(DIRECT, key)).rejects.toBeInstanceOf(SyncAlreadyRunningError);
    expect(await isSyncRunLockFree(DIRECT, key)).toBe(false);

    await first.release();
    const second = await acquireSyncRunLock(DIRECT, key);
    await second.release();
    expect(await isSyncRunLockFree(DIRECT, key)).toBe(true);
  }, T);

  it("different keys do not block each other", async () => {
    const a = await acquireSyncRunLock(DIRECT, `phase6j1-test-${randomUUID()}`);
    const b = await acquireSyncRunLock(DIRECT, `phase6j1-test-${randomUUID()}`);
    await a.release();
    await b.release();
  }, T);

  it("release is idempotent", async () => {
    const lock = await acquireSyncRunLock(DIRECT, `phase6j1-test-${randomUUID()}`);
    await lock.release();
    await expect(lock.release()).resolves.toBeUndefined();
  }, T);

  it("a pooled connection string is refused outright, before any connection is attempted", async () => {
    await expect(acquireSyncRunLock("postgresql://u:p@ep-x-pooler.eu-west-2.aws.neon.tech/db")).rejects.toBeInstanceOf(SyncLockConfigurationError);
  }, T);

  it("runYouTubeSyncJob refuses to start while another sync holds the lock — no SyncJobRun row, no YouTube call", async () => {
    const before = await prisma.syncJobRun.count({ where: { provider: "YOUTUBE" } });
    const held = await acquireSyncRunLock(DIRECT, YOUTUBE_SYNC_LOCK_KEY);
    try {
      await expect(
        runYouTubeSyncJob({ apiKey: "never-used", channelId: "UCnever-used", lockConnectionString: DIRECT })
      ).rejects.toBeInstanceOf(SyncAlreadyRunningError);
    } finally {
      await held.release();
    }
    expect(await prisma.syncJobRun.count({ where: { provider: "YOUTUBE" } })).toBe(before);
  }, T);
});
