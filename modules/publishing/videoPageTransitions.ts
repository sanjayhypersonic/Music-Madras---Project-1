// Pure state-machine rules for YouTubeVideoPage.status (Phase 6G-1B,
// pre-flight §4/§7). Mirrors modules/publishing/revisionTransitions.ts's
// shape: no database, no framework, shared by the repository and its
// tests. Deliberately two states only (DRAFT/PUBLISHED), matching
// CollectionStatus rather than Recording's three-state model — a
// YouTubeVideoPage is a thin wrapper, not richly-authored content, so
// "unpublish" is a legal, ordinary action (unlike RecordingRevision,
// where PUBLISHED never legally reverts to DRAFT). Archival is the
// existing archivedAt convention, not a third status value; an archived
// page must not be published or unpublished until it is unarchived.

export type VideoPageStatusValue = "DRAFT" | "PUBLISHED";

const VALID_TRANSITIONS: Record<VideoPageStatusValue, VideoPageStatusValue[]> = {
  DRAFT: ["PUBLISHED"],
  PUBLISHED: ["DRAFT"],
};

export function isValidVideoPageTransition(from: VideoPageStatusValue, to: VideoPageStatusValue): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export interface VideoPageState {
  status: VideoPageStatusValue;
  archivedAt: Date | null;
}

export function canPublishVideoPage(state: VideoPageState): boolean {
  return state.archivedAt === null && isValidVideoPageTransition(state.status, "PUBLISHED");
}

export function canUnpublishVideoPage(state: VideoPageState): boolean {
  return state.archivedAt === null && isValidVideoPageTransition(state.status, "DRAFT");
}
