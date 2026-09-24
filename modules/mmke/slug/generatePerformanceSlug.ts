import { slugify } from "./slugify";

// Phase 6G-8 — the slug for a Performance. Unlike Composer/MusicalWork/
// Venue/Programme, a Performance has no name or title of its own that a
// Studio editor types — its only real identity is the combination of its
// canonical Programme, Venue, and date. Following the exact same
// "content + immutable id suffix" shape as generateVideoSlug.ts: the
// content half is built only from this Performance's own canonical
// Programme title, Venue name, and performanceDate (never YouTube
// metadata, another entity's title, AI, or any other inferred data), and
// the suffix is this row's own id (unique by construction across every
// Performance that will ever exist), so the combined slug never needs a
// database collision-retry loop. Generated exactly once, at Performance
// creation — modules/db/repositories/performanceRepository.ts's
// updatePerformance/reassignPerformanceProgramme/reassignPerformanceVenue
// must never accept or regenerate `slug`, so the URL stays stable even
// when the Programme, Venue, date, or participants change later.

export interface GeneratePerformanceSlugInput {
  programmeTitle: string;
  venueName: string;
  performanceDate: Date | null;
  performanceId: string;
}

function formatDateForSlug(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function generatePerformanceSlug(input: GeneratePerformanceSlugInput): string {
  const parts = [input.programmeTitle, input.venueName];
  if (input.performanceDate) {
    parts.push(formatDateForSlug(input.performanceDate));
  }
  const base = slugify(parts.join(" ")) || "performance";
  const suffix = input.performanceId.slice(0, 8).toLowerCase();
  return `${base}-${suffix}`;
}
