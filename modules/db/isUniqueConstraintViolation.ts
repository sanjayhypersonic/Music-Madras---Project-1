import { Prisma } from "@prisma/client";

// Phase 6G-4C — a shared, reusable check for "this write failed because a
// @unique column collided", so repositories can translate Postgres's raw
// P2002 into a clear, catchable application error (e.g. SlugConflictError)
// instead of letting a generic 500 reach the Studio action. Prefers the
// database's own constraint over a redundant, race-prone pre-check query
// (brief §23: "prefer database constraints where already available").

export function isUniqueConstraintViolation(err: unknown, field?: string): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") {
    return false;
  }
  if (!field) return true;

  const target = err.meta?.target;
  if (Array.isArray(target) && target.includes(field)) return true;
  if (typeof target === "string" && target === field) return true;

  // The @prisma/adapter-pg driver-adapter error shape (this project's
  // Prisma 7 setup) doesn't populate `target` — it nests the Postgres
  // constraint name instead. Postgres's default unique-index naming
  // convention is `<table>_<column>_key`, so matching the field name
  // against the constraint identifier (or, failing that, the raw
  // message) is a reliable-enough fallback across both error shapes.
  const driverAdapterError = err.meta?.driverAdapterError as { cause?: { constraint?: { index?: string } } } | undefined;
  const constraintIndex = driverAdapterError?.cause?.constraint?.index;
  if (typeof constraintIndex === "string" && constraintIndex.includes(field)) return true;

  return err.message.includes(field);
}
