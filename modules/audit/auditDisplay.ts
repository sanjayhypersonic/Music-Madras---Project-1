// Pure, Prisma-free formatting helpers for the Studio Audit Log UI
// (Phase 6G-15). No queries here — every function only reshapes data the
// caller already fetched, following the modules/mmke/** convention of
// keeping display logic separate from the data-access module.

interface AuditSnapshotLike {
  name?: unknown;
  title?: unknown;
}

/**
 * Best-effort friendly label for an audit entry's subject, reusing only
 * fields already present in the stored before/after snapshots. Never
 * queries the entity's current row — if a snapshot didn't capture a name
 * or title, we fall back to a shortened id rather than manufacturing one.
 */
export function deriveAuditEntityLabel(entry: {
  entityId: string;
  beforeSnapshot?: unknown;
  afterSnapshot?: unknown;
}): string {
  const after = entry.afterSnapshot as AuditSnapshotLike | null | undefined;
  const before = entry.beforeSnapshot as AuditSnapshotLike | null | undefined;

  const candidate =
    (typeof after?.name === "string" && after.name) ||
    (typeof after?.title === "string" && after.title) ||
    (typeof before?.name === "string" && before.name) ||
    (typeof before?.title === "string" && before.title);

  if (candidate) return candidate;

  return entry.entityId.length > 12 ? `${entry.entityId.slice(0, 8)}…` : entry.entityId;
}

/**
 * "COMPOSER_CREATED" -> "Composer created". Purely cosmetic string
 * formatting of the existing `<ENTITY>_<VERB>` action convention — does
 * not change or normalize the underlying action values stored in the DB.
 */
export function formatAuditActionSummary(action: string): string {
  const words = action.split("_").filter(Boolean);
  if (words.length === 0) return action;

  return words
    .map((word, index) =>
      index === 0
        ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        : word.toLowerCase()
    )
    .join(" ");
}

export function formatAuditTimestamp(timestamp: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}
