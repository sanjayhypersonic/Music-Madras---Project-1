// Public Occasion pages — the contract of /occasions/[slug]. Pure and Prisma-free (ADR §3 boundary rule).
//
// An Occasion (a service, a festival, a season: "Christmas Eve", "Easter") is a shared catalogue identity. Its public page gathers what the archive holds
// for it. An Occasion is PUBLIC only while it is not archived AND at least one public item is attached to it (Phase 6J-1 reachability: nothing is
// discoverable merely because a row exists), so a page can never be empty and a draft-only Occasion never leaks.

export interface OccasionPagePerformance {
  id: string;
  slug: string;
  performanceDate: Date | null;
  venueName: string;
  venueSlug: string;
  programmeTitle: string;
}

export interface OccasionPageProgramme {
  id: string;
  slug: string;
  title: string;
}

export interface OccasionPageRecording {
  id: string;
  slug: string;
  title: string | null;
}

export interface OccasionPageCollection {
  id: string;
  slug: string;
  title: string;
}

export interface PublicOccasionPageData {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  /** Eligible Performances attached directly, or belonging to an attached Programme. */
  performances: OccasionPagePerformance[];
  /** Eligible Programmes attached directly. */
  programmes: OccasionPageProgramme[];
  /** Published Recordings whose PUBLISHED revision carries the Occasion, or that record a listed Performance. */
  recordings: OccasionPageRecording[];
  /** Published, non-archived Collections attached directly. */
  collections: OccasionPageCollection[];
  lastModified: Date;
}
