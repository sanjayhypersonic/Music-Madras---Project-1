import type { ArchiveEntityType } from "./archiveSearchContract";

// Phase 6G-7 — pure URL-state helpers for /archive (Prisma-free, no
// Next.js import), so the query-string contract (?q=&type=&page=) is
// unit-testable independent of rendering. The page component is the only
// caller — this exists purely so "does /archive?type=works normalize to
// the work type" and "does building a link preserve q/type/page
// correctly" can be tested without a running server.

export const ARCHIVE_TYPE_LABELS: Record<ArchiveEntityType, string> = {
  composer: "Composers",
  work: "Musical Works",
  recording: "Recordings",
  programme: "Programmes",
  performance: "Performances",
  venue: "Venues",
};

const TYPE_ALIASES: Record<string, ArchiveEntityType> = {
  composer: "composer",
  composers: "composer",
  work: "work",
  works: "work",
  recording: "recording",
  recordings: "recording",
  programme: "programme",
  programmes: "programme",
  performance: "performance",
  performances: "performance",
  venue: "venue",
  venues: "venue",
};

export interface NormalizedArchiveType {
  type: ArchiveEntityType | null;
  invalid: boolean;
}

/**
 * Accepts both singular and plural forms (?type=work or ?type=works),
 * case-insensitively. An absent type is valid (means "all"); an
 * unrecognized non-empty type is flagged invalid so the page can show an
 * explicit message rather than silently guessing.
 */
export function normalizeArchiveType(raw: string | undefined): NormalizedArchiveType {
  if (!raw || raw.trim().length === 0) return { type: null, invalid: false };
  const normalized = TYPE_ALIASES[raw.trim().toLowerCase()];
  return normalized ? { type: normalized, invalid: false } : { type: null, invalid: true };
}

export interface BuildArchiveHrefInput {
  q?: string;
  type?: ArchiveEntityType | null;
  page?: number;
}

/** Builds a /archive URL carrying forward only the params that are actually set — page=1 is never written explicitly. */
export function buildArchiveHref(params: BuildArchiveHrefInput): string {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.type) search.set("type", params.type);
  if (params.page && params.page > 1) search.set("page", String(params.page));
  const qs = search.toString();
  return qs ? `/archive?${qs}` : "/archive";
}

/** Clamps an arbitrary/possibly-malformed page param to a valid 1-based page number. */
export function parseArchivePage(raw: string | undefined): number {
  const parsed = raw ? parseInt(raw, 10) : 1;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}
