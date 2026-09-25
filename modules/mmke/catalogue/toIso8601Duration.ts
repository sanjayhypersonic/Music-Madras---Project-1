// Phase 6G-11 — a pure, Prisma-free formatter (ADR §3 boundary rule) so
// /videos/[slug]'s VideoObject JSON-LD duration field is independently
// unit-testable without importing the page module itself (which,
// transitively through its repository imports, requires a live
// DATABASE_URL — see modules/db/client.ts).

/** ISO 8601 duration (e.g. "PT5M32S"), the format schema.org's VideoObject.duration requires. */
export function toIso8601Duration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  let duration = "PT";
  if (hours > 0) duration += `${hours}H`;
  if (minutes > 0) duration += `${minutes}M`;
  if (seconds > 0 || (hours === 0 && minutes === 0)) duration += `${seconds}S`;
  return duration;
}
