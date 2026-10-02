import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import { isRecordingPublished } from "../../mmke/catalogue/isRecordingPublished";
import type { MediaProvider, MediaResource, MediaRole, Prisma } from "@prisma/client";

// MediaResource attachment (ADR §4/§18, brief §10) — every attachment goes
// through an explicit FK to the entity it belongs to, and, for
// YouTube-provided media, a real FK to YouTubeVideo rather than a bare
// string (Phase 2 fix — see docs/phase-2-mmke-domain.md).

export interface AttachMediaToRevisionInput {
  recordingRevisionId: string;
  provider: MediaProvider;
  role: MediaRole;
  url?: string;
  providerResourceId?: string;
  youtubeVideoId?: string;
  rightsInformationId?: string;
  actorId: string;
}

export async function attachMediaToRevision(
  input: AttachMediaToRevisionInput,
  /** Phase 6I-1 — optional caller-owned transaction (see createDraftRecording). Omitted by every existing caller. */
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<MediaResource> {
  const media = await client.mediaResource.create({
    data: {
      recordingRevisionId: input.recordingRevisionId,
      provider: input.provider,
      role: input.role,
      url: input.url,
      providerResourceId: input.providerResourceId,
      youtubeVideoId: input.youtubeVideoId,
      rightsInformationId: input.rightsInformationId,
    },
  });

  await writeAuditLog(
    {
      actorId: input.actorId,
      action: "MEDIA_ATTACHED_TO_RECORDING_REVISION",
      entityType: "RecordingRevision",
      entityId: input.recordingRevisionId,
      afterSnapshot: media,
    },
    client
  );

  return media;
}

export async function attachRightsToMedia(
  mediaResourceId: string,
  rightsInformationId: string,
  actorId: string
): Promise<MediaResource> {
  const media = await prisma.mediaResource.update({
    where: { id: mediaResourceId },
    data: { rightsInformationId },
  });

  await writeAuditLog({
    actorId,
    action: "RIGHTS_ATTACHED_TO_MEDIA_RESOURCE",
    entityType: "MediaResource",
    entityId: mediaResourceId,
    afterSnapshot: { rightsInformationId },
  });

  return media;
}

export function listMediaForRevision(recordingRevisionId: string) {
  return prisma.mediaResource.findMany({
    where: { recordingRevisionId },
    include: { youtubeVideo: true, rightsInformation: true },
  });
}

/**
 * Phase 6G-11 — the reverse of the Recording -> Video lookup every entity
 * page already does (recording.currentPublishedRevision.mediaResources).
 * Given an internal YouTubeVideo.id, returns the slug of the Recording
 * this video canonically belongs to, but ONLY when the MediaResource's
 * recordingRevision is that Recording's CURRENT PUBLISHED revision (never
 * a stale draft) and the Recording itself is published (isRecordingPublished,
 * Phase 6G-5A — never a second, independently invented rule). No title,
 * description, or keyword matching of any kind — a video with no such
 * canonical FK chain simply returns null, no matter what it's titled.
 */
export async function findPublishedRecordingSlugForYouTubeVideo(youtubeVideoId: string): Promise<string | null> {
  const mediaResources = await prisma.mediaResource.findMany({
    where: { provider: "YOUTUBE", youtubeVideoId, recordingRevisionId: { not: null } },
    select: { recordingRevisionId: true },
  });
  if (mediaResources.length === 0) return null;

  const candidateRevisionIds = mediaResources.map((media) => media.recordingRevisionId as string);

  const recording = await prisma.recording.findFirst({
    where: { currentPublishedRevisionId: { in: candidateRevisionIds } },
    select: { slug: true, status: true, currentPublishedRevisionId: true },
  });
  if (!recording || !isRecordingPublished(recording)) return null;

  return recording.slug;
}
