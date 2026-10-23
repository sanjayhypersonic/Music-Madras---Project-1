// Recording draft-versus-published comparison — the PURE rules (Prisma-free, no I/O; ADR §3 boundary rule). Given a snapshot of the revision that is public now
// and a snapshot of the revision proposed for publication, say exactly what publishing would change. No scoring, no guessing: two values are the same or they
// are not, a list item is present on one side, the other or both, identified by its stable id (never by its label).
//
// First publication (no published revision) is a different question — "what will go live?" — so it is its own mode: nothing is "removed" or "changed", every
// non-empty value is NEW. The caller supplies the snapshots (modules/db/repositories/recordingRevisionComparisonRepository.ts reads them without writing).

export type ChangeKind = "UNCHANGED" | "CHANGED" | "ADDED" | "REMOVED";

export interface SnapshotItem {
  /** A stable identity (an entity id, or role + resource for media): two items are "the same" when their ids are equal. */
  id: string;
  label: string;
  /** Something about the item that can change while its identity stays the same (a media URL). Compared; shown as "was → now". */
  detail?: string | null;
  /** Context shown on the proposed side only and never compared (for example that a source is not yet approved, so the public page will not show it). */
  note?: string | null;
}

export interface RevisionSnapshot {
  revisionId: string;
  title: string | null;
  description: string | null;
  seoMetaTitle: string | null;
  seoMetaDescription: string | null;
  seoCanonicalPath: string | null;
  difficultyLevel: string | null;
  listeningGuide: string | null;
  analysis: string | null;
  programme: string | null;
  venue: string | null;
  performanceDate: string | null;
  /** In the order the revision gives them (the order is part of the content). */
  works: SnapshotItem[];
  performers: SnapshotItem[];
  choirs: SnapshotItem[];
  conductors: SnapshotItem[];
  media: SnapshotItem[];
  sources: SnapshotItem[];
  rights: SnapshotItem[];
  occasions: SnapshotItem[];
}

export interface FieldComparison {
  key: string;
  label: string;
  published: string | null;
  proposed: string | null;
  change: ChangeKind;
}

export interface ListItemComparison {
  id: string;
  label: string;
  change: ChangeKind;
  /** For CHANGED: the earlier and the new detail. */
  was?: string | null;
  now?: string | null;
  note?: string | null;
}

export interface ListComparison {
  key: string;
  label: string;
  items: ListItemComparison[];
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  /** The same items in a different order (only reported for lists where order is content). */
  reordered: boolean;
}

export interface ComparisonSummary {
  changedFields: number;
  addedItems: number;
  removedItems: number;
  changedItems: number;
  reorderedLists: number;
  hasChanges: boolean;
}

export interface RevisionComparison {
  mode: "FIRST_PUBLICATION" | "UPDATE";
  publishedRevisionId: string | null;
  proposedRevisionId: string;
  fields: FieldComparison[];
  lists: ListComparison[];
  summary: ComparisonSummary;
}

/** The comparison form of a text value: CRLF to LF, trimmed, and empty meaning "no value". */
export function normaliseValue(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = value.replace(/\r\n?/g, "\n").trim();
  return text.length === 0 ? null : text;
}

const FIELD_DEFINITIONS: ReadonlyArray<{ key: string; label: string; read: (s: RevisionSnapshot) => string | null }> = [
  { key: "title", label: "Title", read: (s) => s.title },
  { key: "description", label: "Description", read: (s) => s.description },
  { key: "programme", label: "Programme", read: (s) => s.programme },
  { key: "venue", label: "Venue", read: (s) => s.venue },
  { key: "performanceDate", label: "Performance date", read: (s) => s.performanceDate },
  { key: "difficultyLevel", label: "Difficulty level", read: (s) => s.difficultyLevel },
  { key: "listeningGuide", label: "Listening guide", read: (s) => s.listeningGuide },
  { key: "analysis", label: "Analysis", read: (s) => s.analysis },
  { key: "seoMetaTitle", label: "Search title (SEO)", read: (s) => s.seoMetaTitle },
  { key: "seoMetaDescription", label: "Search description (SEO)", read: (s) => s.seoMetaDescription },
  { key: "seoCanonicalPath", label: "Canonical path (SEO)", read: (s) => s.seoCanonicalPath },
];

const LIST_DEFINITIONS: ReadonlyArray<{ key: string; label: string; orderMatters: boolean; read: (s: RevisionSnapshot) => SnapshotItem[] }> = [
  { key: "works", label: "Musical works", orderMatters: true, read: (s) => s.works },
  { key: "performers", label: "Performers", orderMatters: false, read: (s) => s.performers },
  { key: "choirs", label: "Choirs", orderMatters: false, read: (s) => s.choirs },
  { key: "conductors", label: "Conductors", orderMatters: false, read: (s) => s.conductors },
  { key: "media", label: "Media", orderMatters: false, read: (s) => s.media },
  { key: "sources", label: "Sources", orderMatters: false, read: (s) => s.sources },
  { key: "rights", label: "Rights information", orderMatters: false, read: (s) => s.rights },
  { key: "occasions", label: "Occasions", orderMatters: false, read: (s) => s.occasions },
];

function compareField(key: string, label: string, published: string | null, proposed: string | null, firstPublication: boolean): FieldComparison {
  const was = firstPublication ? null : normaliseValue(published);
  const now = normaliseValue(proposed);
  const change: ChangeKind = was === now ? "UNCHANGED" : was === null ? "ADDED" : now === null ? "REMOVED" : "CHANGED";
  return { key, label, published: was, proposed: now, change };
}

function compareList(key: string, label: string, orderMatters: boolean, published: SnapshotItem[], proposed: SnapshotItem[], firstPublication: boolean): ListComparison {
  const before = firstPublication ? [] : published;
  const beforeById = new Map(before.map((item) => [item.id, item]));
  const afterById = new Map(proposed.map((item) => [item.id, item]));
  const items: ListItemComparison[] = [];

  for (const item of proposed) {
    const earlier = beforeById.get(item.id);
    if (!earlier) items.push({ id: item.id, label: item.label, change: "ADDED", note: item.note ?? null });
    else if ((earlier.detail ?? null) !== (item.detail ?? null)) items.push({ id: item.id, label: item.label, change: "CHANGED", was: earlier.detail ?? null, now: item.detail ?? null, note: item.note ?? null });
    else items.push({ id: item.id, label: item.label, change: "UNCHANGED", note: item.note ?? null });
  }
  for (const item of before) if (!afterById.has(item.id)) items.push({ id: item.id, label: item.label, change: "REMOVED" });

  const sharedBefore = before.filter((i) => afterById.has(i.id)).map((i) => i.id);
  const sharedAfter = proposed.filter((i) => beforeById.has(i.id)).map((i) => i.id);
  const reordered = orderMatters && !firstPublication && sharedBefore.length > 1 && sharedBefore.join("\u0000") !== sharedAfter.join("\u0000");

  const count = (change: ChangeKind) => items.filter((i) => i.change === change).length;
  return { key, label, items, added: count("ADDED"), removed: count("REMOVED"), changed: count("CHANGED"), unchanged: count("UNCHANGED"), reordered };
}

/**
 * What publishing `proposed` would change relative to `published` (the revision that is public now). Pass `published: null` for a first publication.
 * Pure: the same two snapshots always give the same comparison.
 */
export function compareRevisions(published: RevisionSnapshot | null, proposed: RevisionSnapshot): RevisionComparison {
  const firstPublication = published === null;
  const empty: RevisionSnapshot = proposed; // never read when firstPublication (values are ignored), only to satisfy the types
  const base = published ?? empty;

  const fields = FIELD_DEFINITIONS.map((d) => compareField(d.key, d.label, d.read(base), d.read(proposed), firstPublication));
  const lists = LIST_DEFINITIONS.map((d) => compareList(d.key, d.label, d.orderMatters, d.read(base), d.read(proposed), firstPublication));

  const summary: ComparisonSummary = {
    changedFields: fields.filter((f) => f.change !== "UNCHANGED").length,
    addedItems: lists.reduce((n, l) => n + l.added, 0),
    removedItems: lists.reduce((n, l) => n + l.removed, 0),
    changedItems: lists.reduce((n, l) => n + l.changed, 0),
    reorderedLists: lists.filter((l) => l.reordered).length,
    hasChanges: false,
  };
  summary.hasChanges = summary.changedFields + summary.addedItems + summary.removedItems + summary.changedItems + summary.reorderedLists > 0;

  return {
    mode: firstPublication ? "FIRST_PUBLICATION" : "UPDATE",
    publishedRevisionId: published?.revisionId ?? null,
    proposedRevisionId: proposed.revisionId,
    fields,
    lists,
    summary,
  };
}

/** A short sentence for the top of the preview. */
export function describeSummary(comparison: RevisionComparison): string {
  const { summary } = comparison;
  if (comparison.mode === "FIRST_PUBLICATION") {
    const filled = comparison.fields.filter((f) => f.proposed !== null).length;
    const items = summary.addedItems;
    return `First publication: nothing is public yet. Publishing makes ${filled} filled-in field${filled === 1 ? "" : "s"} and ${items} linked item${items === 1 ? "" : "s"} public.`;
  }
  if (!summary.hasChanges) return "This draft is identical to the published version: publishing would change nothing visitors see.";
  const parts: string[] = [];
  if (summary.changedFields) parts.push(`${summary.changedFields} field${summary.changedFields === 1 ? "" : "s"} changed`);
  if (summary.addedItems) parts.push(`${summary.addedItems} item${summary.addedItems === 1 ? "" : "s"} added`);
  if (summary.removedItems) parts.push(`${summary.removedItems} item${summary.removedItems === 1 ? "" : "s"} removed`);
  if (summary.changedItems) parts.push(`${summary.changedItems} item${summary.changedItems === 1 ? "" : "s"} changed`);
  if (summary.reorderedLists) parts.push(`${summary.reorderedLists} list${summary.reorderedLists === 1 ? "" : "s"} reordered`);
  return `Publishing will change what visitors see: ${parts.join(", ")}.`;
}
