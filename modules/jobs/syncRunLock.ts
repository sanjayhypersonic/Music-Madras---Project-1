import { Client } from "pg";

// A cross-process "only one sync at a time" lock (ADR §12/§13: overlapping runs
// must be impossible, not merely unlikely). It is a Postgres SESSION-level
// advisory lock held on its own dedicated connection for the whole run.
//
// Two properties make it trustworthy, and both are enforced rather than hoped for:
//  1. It must live on a DIRECT connection. A session lock taken through a
//     transaction-mode pooler (Neon's "-pooler" host, PgBouncer) is handed to
//     whichever backend the pooler picks and can silently be released or
//     inherited by another client — a lock that looks held but is not. So a
//     pooled connection string is refused outright.
//  2. It is released by the database itself if the process dies, so a crashed
//     run can never leave the lock stuck.

export const YOUTUBE_SYNC_LOCK_KEY = "music-madras:youtube-full-sync";

export class SyncAlreadyRunningError extends Error {
  constructor(key: string) {
    super(`Another synchronization already holds the lock "${key}". Wait for it to finish (or confirm it is dead) — nothing was started.`);
    this.name = "SyncAlreadyRunningError";
  }
}

export class SyncLockConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncLockConfigurationError";
  }
}

export interface SyncRunLock {
  readonly key: string;
  /** True if the lock's connection dropped after acquisition (the database has then released the lock). */
  readonly lost: boolean;
  release(): Promise<void>;
}

/** A pooled/proxied endpoint, on which a session-level advisory lock is not reliable. */
export function isPooledConnectionString(connectionString: string): boolean {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return false;
  }
  if (/-pooler(\.|$)/i.test(url.hostname)) return true;
  if (url.port === "6432") return true;
  if (/^(true|1)$/i.test(url.searchParams.get("pgbouncer") ?? "")) return true;
  return false;
}

/** The host only — never credentials — for logs. */
export function describeConnectionHost(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    return `${url.hostname}${url.port ? `:${url.port}` : ""}${url.pathname}`;
  } catch {
    return "(unparseable connection string)";
  }
}

export async function acquireSyncRunLock(connectionString: string, key: string = YOUTUBE_SYNC_LOCK_KEY): Promise<SyncRunLock> {
  if (isPooledConnectionString(connectionString)) {
    throw new SyncLockConfigurationError(
      "The synchronization lock needs a DIRECT database connection (DIRECT_URL), but the connection string given is a pooled endpoint. " +
        "A session lock through a pooler is not reliable, so the run was refused."
    );
  }

  const client = new Client({ connectionString });
  let lost = false;
  client.on("error", () => {
    lost = true;
  });
  await client.connect();

  try {
    const { rows } = await client.query<{ locked: boolean }>("select pg_try_advisory_lock(hashtext($1)) as locked", [key]);
    if (!rows[0]?.locked) throw new SyncAlreadyRunningError(key);
  } catch (error) {
    await client.end().catch(() => undefined);
    throw error;
  }

  let released = false;
  return {
    key,
    get lost() {
      return lost;
    },
    async release() {
      if (released) return;
      released = true;
      try {
        if (!lost) await client.query("select pg_advisory_unlock(hashtext($1))", [key]);
      } finally {
        await client.end().catch(() => undefined);
      }
    },
  };
}

/** Whether the lock is currently free, without keeping it (for a read-only preflight). */
export async function isSyncRunLockFree(connectionString: string, key: string = YOUTUBE_SYNC_LOCK_KEY): Promise<boolean> {
  try {
    const lock = await acquireSyncRunLock(connectionString, key);
    await lock.release();
    return true;
  } catch (error) {
    if (error instanceof SyncAlreadyRunningError) return false;
    throw error;
  }
}
