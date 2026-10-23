// The Studio Occasion workspace — the PURE classification of each item connected to an Occasion: is it publicly visible on the Occasion's page, and if not, WHY
// (Prisma-free, no I/O; ADR §3 boundary rule).
//
// There is deliberately NO second definition of "public" here. Whether an item is visible is decided by the database with the very fragments the public Occasion
// page uses (eligiblePerformanceWhere, eligibleProgrammeWhere, the public-collection rule, isRecordingPublished plus the published-revision link), and arrives
// here as the boolean `visible`. The facts that arrive with it are used ONLY to explain a "not visible" verdict in words. If the facts offer no explanation, the
// answer is UNKNOWN ("not determined"), never a guess.

export type ConnectionKind = "PERFORMANCE" | "PROGRAMME" | "COLLECTION" | "RECORDING";

/** How the item is connected to the Occasion. DIRECT is an attachment made on the item itself; the others are the routes the public page also follows. */
export type ConnectionVia = "DIRECT" | "VIA_PROGRAMME" | "VIA_PERFORMANCE" | "PUBLISHED_REVISION" | "DRAFT_REVISION_ONLY" | "OLDER_REVISION_ONLY";

export type VisibilityStatus =
  /** On the public Occasion page. */
  | "VISIBLE"
  /** Linked, but not public yet because it is a draft or unpublished (or reachable only through one). */
  | "DRAFT"
  /** Linked, but archived. */
  | "ARCHIVED"
  /** Linked, but excluded for another reason the rules identify (an archived parent, an unpublished recording). */
  | "EXCLUDED"
  /** The Occasion itself is archived: it has no public page, whatever its items are. */
  | "OCCASION_ARCHIVED"
  /** The facts do not establish a reason. */
  | "UNKNOWN";

export interface Classification {
  status: VisibilityStatus;
  reason: string;
}

export interface ConnectedItem {
  kind: ConnectionKind;
  id: string;
  label: string;
  via: ConnectionVia;
  status: VisibilityStatus;
  reason: string;
  /** The item's own Studio record, where one exists. */
  studioHref: string | null;
  /** Where to change this connection (the existing, authorized route), where one exists. */
  manageHref: string | null;
  /** Its public page, only when it is publicly visible. */
  publicHref: string | null;
  /** A short factual detail (a date, a status). */
  detail: string | null;
}

const unknown = (what: string): Classification => ({ status: "UNKNOWN", reason: `Not determined: the ${what} is not on the public page, but the available facts do not say why.` });

export interface PerformanceFacts {
  visible: boolean;
  archived: boolean;
  programmeArchived: boolean;
  venueArchived: boolean;
  hasPublishedRecording: boolean;
}

export function classifyPerformance(facts: PerformanceFacts): Classification {
  if (facts.visible) return { status: "VISIBLE", reason: "Listed on the public page: a published recording uses this performance." };
  if (facts.archived) return { status: "ARCHIVED", reason: "This performance is archived; an archived performance is never public." };
  if (facts.programmeArchived) return { status: "EXCLUDED", reason: "Excluded: its programme is archived." };
  if (facts.venueArchived) return { status: "EXCLUDED", reason: "Excluded: its venue is archived." };
  if (!facts.hasPublishedRecording) return { status: "DRAFT", reason: "Not public yet: no published recording uses this performance. A performance becomes public only through a published recording." };
  return unknown("performance");
}

export interface ProgrammeFacts {
  visible: boolean;
  archived: boolean;
}

export function classifyProgramme(facts: ProgrammeFacts): Classification {
  if (facts.visible) return { status: "VISIBLE", reason: "Listed on the public page: at least one of its performances is public." };
  if (facts.archived) return { status: "ARCHIVED", reason: "This programme is archived; an archived programme is never public." };
  // The rule is "not archived and has a public performance": not archived and not visible can only mean it has none yet.
  return { status: "DRAFT", reason: "Not public yet: none of its performances is public (a performance needs a published recording)." };
}

export interface CollectionFacts {
  visible: boolean;
  published: boolean;
  archived: boolean;
}

export function classifyCollection(facts: CollectionFacts): Classification {
  if (facts.visible) return { status: "VISIBLE", reason: "Listed on the public page: the collection is published." };
  if (facts.archived) return { status: "ARCHIVED", reason: "This collection is archived; an archived collection is never public." };
  if (!facts.published) return { status: "DRAFT", reason: "Not public yet: the collection is still a draft." };
  return unknown("collection");
}

export interface RecordingFacts {
  visible: boolean;
  via: ConnectionVia;
  /** The recording's status column (DRAFT, IN_REVIEW, PUBLISHED, ARCHIVED). */
  recordingStatus: string;
  /** The recording's PUBLISHED revision carries this Occasion. */
  publishedRevisionCarries: boolean;
  /** Only the open DRAFT revision carries it. */
  draftRevisionCarries: boolean;
  /** Neither the published nor the draft revision carries it: only an older, superseded revision did. */
  onlyOlderRevisionCarries?: boolean;
}

export function classifyRecording(facts: RecordingFacts): Classification {
  if (facts.visible) {
    return facts.via === "VIA_PERFORMANCE"
      ? { status: "VISIBLE", reason: "Listed on the public page: it is a published recording of a performance listed there." }
      : { status: "VISIBLE", reason: "Listed on the public page: the recording is published and its published revision carries this occasion." };
  }
  if (facts.recordingStatus === "ARCHIVED") return { status: "ARCHIVED", reason: "This recording is archived; an archived recording is never public." };
  if (facts.draftRevisionCarries && !facts.publishedRevisionCarries) {
    return { status: "DRAFT", reason: "Linked only in the open draft revision. It appears on the public page only after that draft is published." };
  }
  if (facts.onlyOlderRevisionCarries) {
    return { status: "EXCLUDED", reason: "Excluded: only an older revision of this recording carried the occasion; neither its published nor its draft revision does now." };
  }
  if (facts.publishedRevisionCarries && facts.recordingStatus !== "PUBLISHED") {
    return { status: "EXCLUDED", reason: `Excluded: the recording is not published (status ${facts.recordingStatus}), so its occasions are not shown.` };
  }
  return unknown("recording");
}

/** When the Occasion itself is archived it has no public page. Say so, and keep the item's own verdict as context. */
export function underArchivedOccasion(own: Classification): Classification {
  return { status: "OCCASION_ARCHIVED", reason: `The occasion is archived, so it has no public page. On its own, this item is: ${own.reason}` };
}

export interface PublicPageSummary {
  state: "PUBLIC" | "NOT_PUBLIC";
  reason: string;
}

/** The headline: does the Occasion have a public page, and why not. */
export function summarisePublicPage(input: { occasionArchived: boolean; linked: number; visible: number }): PublicPageSummary {
  if (input.occasionArchived) return { state: "NOT_PUBLIC", reason: "This occasion is archived, so it has no public page. Restore it to make a page possible." };
  if (input.visible > 0) return { state: "PUBLIC", reason: `The public page exists and lists ${input.visible} item${input.visible === 1 ? "" : "s"}.` };
  if (input.linked === 0) return { state: "NOT_PUBLIC", reason: "No public page: nothing is attached to this occasion yet. An occasion becomes public when something public is attached to it." };
  return { state: "NOT_PUBLIC", reason: "No public page yet: everything attached is a draft, archived or otherwise not public (see the reasons below). The page appears as soon as one attached item becomes public." };
}

export const STATUS_LABEL: Record<VisibilityStatus, string> = {
  VISIBLE: "Publicly visible",
  DRAFT: "Draft / not public yet",
  ARCHIVED: "Archived",
  EXCLUDED: "Linked but excluded",
  OCCASION_ARCHIVED: "Occasion archived",
  UNKNOWN: "Not determined",
};

export const KIND_LABEL: Record<ConnectionKind, string> = { PERFORMANCE: "Performance", PROGRAMME: "Programme", COLLECTION: "Collection", RECORDING: "Recording" };

/** A stable display order: visible first, then drafts, then the rest; by kind and label inside a status. */
export function sortConnections(items: readonly ConnectedItem[]): ConnectedItem[] {
  const rank: Record<VisibilityStatus, number> = { VISIBLE: 0, DRAFT: 1, EXCLUDED: 2, ARCHIVED: 3, OCCASION_ARCHIVED: 4, UNKNOWN: 5 };
  return [...items].sort((a, b) => rank[a.status] - rank[b.status] || a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}
