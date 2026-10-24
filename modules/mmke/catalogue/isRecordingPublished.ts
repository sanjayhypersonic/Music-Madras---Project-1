import type { RecordingAggregateStatus } from "@prisma/client";

// Phase 6G-5A — the single source of truth for "is this Recording
// publicly published," mirroring modules/mmke/catalogue/isYouTubeVideoPagePublic's
// role for YouTubeVideoPage: a pure, Prisma-free predicate that every
// public-read query re-evaluates, rather than each call site writing its
// own slightly different where-clause. Before this phase,
// findPublishedRecordingBySlug only checked `currentPublishedRevisionId`
// and entityRelationshipsRepository.ts's resolveRelatedContent separately
// also checked `status`, so the two could disagree — most concretely, an
// ARCHIVED Recording (which never has currentPublishedRevisionId cleared,
// by design — see recordingRepository.ts's archiveRecording) would have
// passed the old findPublishedRecordingBySlug check while correctly
// failing resolveRelatedContent's. Both now defer to this function.
//
// The rule is deliberately just these two Recording-level fields — not a
// second join back to RecordingRevision.revisionStatus — because
// publishCurrentDraft is the only place currentPublishedRevisionId is
// ever set, and it always sets the pointed-to revision's own
// revisionStatus to PUBLISHED in the same transaction, so the two can
// never legitimately disagree.

export interface RecordingPublicationStateInput {
  status: RecordingAggregateStatus;
  currentPublishedRevisionId: string | null;
}

export function isRecordingPublished(recording: RecordingPublicationStateInput): boolean {
  return recording.status === "PUBLISHED" && recording.currentPublishedRevisionId !== null;
}

// Recording-level HOLD (project register R-20). "Published" (above) stays the PUBLICATION state: it is what Studio's workflow, the editorial queues and the
// AI context mean by it, and a hold never changes it. "Publicly visible" is what every PUBLIC surface (the Recording page, archive search, the sitemap, related
// content, collections, guides, occasions, the video page's recording link) must ask: published AND not held. `holdReason` is required (not optional) on
// purpose, so a query that forgot to select it fails to compile instead of silently showing a held Recording.
export interface RecordingPublicVisibilityInput extends RecordingPublicationStateInput {
  holdReason: string | null;
}

export function isRecordingPubliclyVisible(recording: RecordingPublicVisibilityInput): boolean {
  return isRecordingPublished(recording) && recording.holdReason === null;
}
