// What the Studio dashboard lists as "needing attention", and in what order. PURE. A Recording waiting for an editorial decision comes first (that is what a
// reviewer or publisher is looking for), then drafts, then live Recordings with pending changes, then unpublished ones with no open draft. An archived
// Recording is never pending work, and a live one with nothing pending needs nothing.

export interface PendingCandidate {
  id: string;
  status: "DRAFT" | "IN_REVIEW" | "PUBLISHED" | "ARCHIVED";
  currentDraftRevisionId: string | null;
}

export type PendingKind = "AWAITING_REVIEW" | "DRAFT" | "PENDING_CHANGES" | "NOT_PUBLIC";

export function pendingKind(r: PendingCandidate): PendingKind | null {
  switch (r.status) {
    case "ARCHIVED":
      return null;
    case "IN_REVIEW":
      return "AWAITING_REVIEW";
    case "DRAFT":
      return r.currentDraftRevisionId !== null ? "DRAFT" : "NOT_PUBLIC"; // no open draft: unpublished (its last published version is kept as history)
    case "PUBLISHED":
      return r.currentDraftRevisionId !== null ? "PENDING_CHANGES" : null;
  }
}

const ORDER: Record<PendingKind, number> = { AWAITING_REVIEW: 0, DRAFT: 1, PENDING_CHANGES: 2, NOT_PUBLIC: 3 };

export function listPendingWork<T extends PendingCandidate>(recordings: readonly T[]): { item: T; kind: PendingKind }[] {
  return recordings
    .map((item) => ({ item, kind: pendingKind(item) }))
    .filter((x): x is { item: T; kind: PendingKind } => x.kind !== null)
    .sort((a, b) => ORDER[a.kind] - ORDER[b.kind]); // stable: within a kind the repository's order is kept
}

export const PENDING_LABEL: Record<PendingKind, string> = {
  AWAITING_REVIEW: "Awaiting editorial review",
  DRAFT: "Draft",
  PENDING_CHANGES: "Live, with pending changes",
  NOT_PUBLIC: "Not public, no open draft",
};
