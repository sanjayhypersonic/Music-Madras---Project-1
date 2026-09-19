// Catalogue completeness rule engine (ADR §4, brief §13). A pure function —
// no database, no framework, no I/O — operating on a plain description of
// a fully-loaded RecordingRevision. Callers (a repository or, in a later
// phase, a Studio Server Action) are responsible for loading the relevant
// relations and mapping them into this shape; this module never imports
// Prisma (ADR §3 boundary rule: only modules/db may do that).
//
// This never returns a stored percentage — only a structured report the
// caller can render or gate a Publish action on.

export type CompletenessLevel = "REQUIRED" | "RECOMMENDED" | "OPTIONAL";
export type CompletenessStatus = "COMPLETE" | "MISSING";

export interface CompletenessReportItem {
  category: string;
  level: CompletenessLevel;
  status: CompletenessStatus;
  detail?: string;
}

export interface RecordingRevisionCompletenessInput {
  title: string | null;
  linkedWorkCount: number;
  hasPerformance: boolean;
  hasVenue: boolean;
  participantCount: number;
  hasPrimaryVideo: boolean;
  hasEducationalContent: boolean;
  hasSeoMetaTitle: boolean;
}

export function checkRecordingRevisionCompleteness(
  input: RecordingRevisionCompletenessInput
): CompletenessReportItem[] {
  return [
    {
      category: "Identity",
      level: "REQUIRED",
      status: input.title && input.title.trim().length > 0 ? "COMPLETE" : "MISSING",
    },
    {
      category: "Musical Works",
      level: "REQUIRED",
      status: input.linkedWorkCount > 0 ? "COMPLETE" : "MISSING",
      detail: `${input.linkedWorkCount} work(s) linked`,
    },
    {
      category: "Media",
      level: "REQUIRED",
      status: input.hasPrimaryVideo ? "COMPLETE" : "MISSING",
      detail: "A primary video media resource is required before publishing",
    },
    {
      category: "Performance",
      level: "RECOMMENDED",
      status: input.hasPerformance ? "COMPLETE" : "MISSING",
    },
    {
      category: "Venue",
      level: "RECOMMENDED",
      status: input.hasVenue ? "COMPLETE" : "MISSING",
    },
    {
      category: "Performers",
      level: "RECOMMENDED",
      status: input.participantCount > 0 ? "COMPLETE" : "MISSING",
      detail: `${input.participantCount} participant(s) linked`,
    },
    {
      category: "SEO",
      level: "RECOMMENDED",
      status: input.hasSeoMetaTitle ? "COMPLETE" : "MISSING",
    },
    {
      category: "Educational Content",
      level: "OPTIONAL",
      status: input.hasEducationalContent ? "COMPLETE" : "MISSING",
    },
  ];
}

/**
 * Matches the ADR's stated Publish gate: refuse while any REQUIRED
 * category is MISSING. The actual gating call site (a Server Action) is a
 * later phase; this is the pure predicate it will use.
 */
export function isReadyToPublish(report: CompletenessReportItem[]): boolean {
  return report.every((item) => item.level !== "REQUIRED" || item.status === "COMPLETE");
}
