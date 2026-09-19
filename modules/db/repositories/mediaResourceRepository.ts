import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import type { MediaProvider, MediaResource, MediaRole } from "@prisma/client";

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

export async function attachMediaToRevision(input: AttachMediaToRevisionInput): Promise<MediaResource> {
  const media = await prisma.mediaResource.create({
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

  await writeAuditLog({
    actorId: input.actorId,
    action: "MEDIA_ATTACHED_TO_RECORDING_REVISION",
    entityType: "RecordingRevision",
    entityId: input.recordingRevisionId,
    afterSnapshot: media,
  });

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

export function listMediaForRevision(recordingRevisionId: string): Promise<MediaResource[]> {
  return prisma.mediaResource.findMany({
    where: { recordingRevisionId },
    include: { youtubeVideo: true, rightsInformation: true },
  });
}
