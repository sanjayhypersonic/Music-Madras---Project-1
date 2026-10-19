// Phase 6J-10F — "this statement failed because `lock_timeout` expired" (SQLSTATE 55P03), however the driver wrapped it.
// Shared by the repositories that bound their waits for advisory/row locks (recordingRepository, programmeRepository).

export function isLockTimeoutError(err: unknown, depth = 0): boolean {
  if (typeof err !== "object" || err === null || depth > 4) return false;
  const e = err as { message?: unknown; code?: unknown; meta?: { code?: unknown }; cause?: unknown };
  return (
    e.code === "55P03" ||
    e.meta?.code === "55P03" ||
    (typeof e.message === "string" && /lock timeout|55P03/i.test(e.message)) ||
    isLockTimeoutError(e.cause, depth + 1)
  );
}