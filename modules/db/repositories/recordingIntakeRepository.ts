import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import { slugify } from "../../mmke/slug/slugify";
import { createDraftRecording } from "./recordingRepository";
import type { RecordingWithRevisions } from "./recordingRepository";
import { attachMediaToRevision } from "./mediaResourceRepository";
import type { MediaResource, ObservabilityState, Prisma, RecordingAggregateStatus } from "@prisma/client";

// Phase 6I-1 — Recording intake from a synced YouTube video
// (docs/content-intelligence-architecture.md, Phase 6I-1 section).
//
// YouTubeVideo is a synchronized external/distribution mirror; Recording is
// the canonical Music Madras archival object. They are never merged. The
// only relationship is the one the schema already defines:
//
//   YouTubeVideo <- MediaResource(youtubeVideoId, role PRIMARY_VIDEO)
//                <- RecordingRevision <- Recording
//
// This module creates exactly that, explicitly, for one chosen video. It
// invents no metadata: nothing is inferred from the video's title or
// description (no Composer/Work/Programme/Performance/Venue/participant is
// created or matched), the YouTube description is NOT copied into the
// revision (RecordingContext already reads it live through the linked
// YouTubeVideo), and nothing is published. Every step reuses the existing
// lifecycle functions (createDraftRecording, attachMediaToRevision) inside
// one transaction, so an intake either fully succeeds or leaves nothing.

export interface LinkedRecordingSummary {
  recordingId: string;
  slug: string;
  status: RecordingAggregateStatus;
  /** The linked revision's title, or null if it has none yet. */
  title: string | null;
}

export type CreateRecordingFromYouTubeVideoResult =
  | { ok: true; recording: RecordingWithRevisions; mediaResource: MediaResource }
  | { ok: false; reason: "VIDEO_NOT_FOUND" }
  | { ok: false; reason: "VIDEO_NOT_AVAILABLE"; observabilityState: ObservabilityState }
  | { ok: false; reason: "ALREADY_LINKED"; existing: LinkedRecordingSummary };

type Client = Prisma.TransactionClient | typeof prisma;

async function findLinkedRecordingWith(client: Client, youtubeVideoId: string): Promise<LinkedRecordingSummary | null> {
  // ANY revision of ANY Recording that links this video counts — draft,
  // published, superseded, or archived — so a video can never accumulate a
  // second canonical Recording by accident.
  const media = await client.mediaResource.findFirst({
    where: { provider: "YOUTUBE", youtubeVideoId, recordingRevisionId: { not: null } },
    orderBy: { createdAt: "asc" },
    select: {
      recordingRevision: {
        select: { title: true, recording: { select: { id: true, slug: true, status: true } } },
      },
    },
  });
  if (!media?.recordingRevision) return null;
  const { recording, title } = media.recordingRevision;
  return { recordingId: recording.id, slug: recording.slug, status: recording.status, title };
}

/** The Recording (if any) that already links this synced video, keyed by the internal YouTubeVideo.id. */
export function findRecordingLinkedToYouTubeVideo(youtubeVideoId: string): Promise<LinkedRecordingSummary | null> {
  return findLinkedRecordingWith(prisma, youtubeVideoId);
}

/** Batched version for the Studio video catalogue list — one query, not one per row. */
export async function listRecordingLinksForYouTubeVideos(youtubeVideoIds: string[]): Promise<Map<string, LinkedRecordingSummary>> {
  const links = new Map<string, LinkedRecordingSummary>();
  if (youtubeVideoIds.length === 0) return links;

  const rows = await prisma.mediaResource.findMany({
    where: { provider: "YOUTUBE", youtubeVideoId: { in: youtubeVideoIds }, recordingRevisionId: { not: null } },
    orderBy: { createdAt: "asc" },
    select: {
      youtubeVideoId: true,
      recordingRevision: {
        select: { title: true, recording: { select: { id: true, slug: true, status: true } } },
      },
    },
  });
  for (const row of rows) {
    if (!row.youtubeVideoId || !row.recordingRevision || links.has(row.youtubeVideoId)) continue;
    const { recording, title } = row.recordingRevision;
    links.set(row.youtubeVideoId, { recordingId: recording.id, slug: recording.slug, status: recording.status, title });
  }
  return links;
}

/**
 * Creates a DRAFT Recording from one synced YouTubeVideo (`youtubeVideoId`
 * here is the internal YouTubeVideo.id, not YouTube's own id).
 *
 * Duplicate protection is application-level, per this codebase's convention
 * (no new unique constraint): inside the same transaction, a per-video
 * Postgres advisory lock serializes concurrent intakes of the same video, so
 * a double-click or two editors acting at once cannot both pass the
 * "already linked?" check. A video that is not currently OBSERVED (absent
 * from the latest sync, i.e. possibly removed) is refused rather than linked.
 */
export async function createRecordingFromYouTubeVideo(input: {
  youtubeVideoId: string;
  actorId: string;
}): Promise<CreateRecordingFromYouTubeVideoResult> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.youtubeVideoId}))`;

      const video = await tx.youTubeVideo.findUnique({
        where: { id: input.youtubeVideoId },
        select: { id: true, youtubeVideoId: true, title: true, observabilityState: true },
      });
      if (!video) {
        return { ok: false, reason: "VIDEO_NOT_FOUND" } as const;
      }
      if (video.observabilityState !== "OBSERVED") {
        return { ok: false, reason: "VIDEO_NOT_AVAILABLE", observabilityState: video.observabilityState } as const;
      }

      const existing = await findLinkedRecordingWith(tx, video.id);
      if (existing) {
        return { ok: false, reason: "ALREADY_LINKED", existing } as const;
      }

      // The YouTube title is only an editable DRAFT working title — it is
      // never asserted to be the canonical musical-work title.
      const title = video.title?.trim() || undefined;
      const slugBase = slugify(title ?? "").slice(0, 80).replace(/-+$/g, "") || "youtube-video";
      const slug = `${slugBase}-${video.id.slice(0, 8)}`;

      const recording = await createDraftRecording({ slug, title, actorId: input.actorId }, tx);
      const draftRevisionId = recording.currentDraftRevision!.id;

      const mediaResource = await attachMediaToRevision(
        {
          recordingRevisionId: draftRevisionId,
          provider: "YOUTUBE",
          role: "PRIMARY_VIDEO",
          url: `https://www.youtube.com/watch?v=${video.youtubeVideoId}`,
          providerResourceId: video.youtubeVideoId,
          youtubeVideoId: video.id,
          actorId: input.actorId,
        },
        tx
      );

      await writeAuditLog(
        {
          actorId: input.actorId,
          action: "RECORDING_CREATED_FROM_YOUTUBE_VIDEO",
          entityType: "Recording",
          entityId: recording.id,
          afterSnapshot: {
            youtubeVideoId: video.id,
            externalYoutubeVideoId: video.youtubeVideoId,
            recordingRevisionId: draftRevisionId,
            mediaResourceId: mediaResource.id,
          },
        },
        tx
      );

      return { ok: true, recording, mediaResource } as const;
    },
    // Several sequential writes over a network DB: the 5s Prisma default has
    // been observed to be exceeded under elevated Neon latency.
    { timeout: 30000, maxWait: 10000 }
  );
}
