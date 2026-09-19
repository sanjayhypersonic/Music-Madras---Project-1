import { prisma } from "../client";
import { computeDimensionsHash } from "../../analytics/youtube/computeDimensionsHash";
import type { YouTubeAnalyticsSyncRepositoryPort } from "../../analytics/youtube/runYouTubeAnalyticsSync";
import type { YouTubeAnalyticsObservationInput } from "../../analytics/youtube/youtubeAnalyticsTypes";
import type { Prisma } from "@prisma/client";

// Concrete implementation of YouTubeAnalyticsSyncRepositoryPort (brief
// §9-10) — the only file that translates between the plain
// YouTubeAnalyticsObservationInput shape (used throughout
// modules/analytics/youtube, which never imports Prisma) and the real
// Prisma model/enums.

export const youtubeAnalyticsRepository: YouTubeAnalyticsSyncRepositoryPort = {
  async upsertObservation(input: YouTubeAnalyticsObservationInput): Promise<void> {
    await upsertYouTubeAnalyticsObservation(input);
  },
};

export async function upsertYouTubeAnalyticsObservation(input: YouTubeAnalyticsObservationInput) {
  const dimensionsHash = computeDimensionsHash(input.dimensions);
  const youtubeVideoId = input.youtubeVideoId ?? null;
  const channelId = input.channelId ?? null;

  // See prisma/schema.prisma's comment on `targetKey`: Postgres does not
  // treat two NULLs as equal in a unique constraint, so the nullable
  // youtubeVideoId/channelId pair cannot be relied on for uniqueness —
  // this non-null computed key is what actually enforces idempotency.
  const targetKey = input.youtubeVideoId ?? input.channelId ?? "";

  return prisma.youTubeAnalyticsObservation.upsert({
    where: {
      // Matches the @@unique in prisma/schema.prisma exactly — this is
      // what makes re-running a sync for the same period a safe no-op
      // (idempotency, brief §10) rather than a duplicate row.
      scope_targetKey_metric_periodStart_periodEnd_dimensionsHash: {
        scope: input.scope,
        targetKey,
        metric: input.metric,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        dimensionsHash,
      },
    },
    create: {
      scope: input.scope,
      targetKey,
      youtubeVideoId,
      channelId,
      metric: input.metric,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      value: input.value,
      dimensions: (input.dimensions ?? undefined) as Prisma.InputJsonValue | undefined,
      dimensionsHash,
      syncJobRunId: input.syncJobRunId,
    },
    update: {
      value: input.value,
      syncedAt: new Date(),
      syncJobRunId: input.syncJobRunId,
    },
  });
}

export function listObservationsForVideo(youtubeVideoId: string) {
  return prisma.youTubeAnalyticsObservation.findMany({
    where: { youtubeVideoId },
    orderBy: { periodStart: "asc" },
  });
}

/**
 * Cross-platform identity (brief §11-12): joins a YouTube video's
 * synchronized analytics observations to the canonical Music Madras chain
 * it belongs to (YouTubeVideo -> MediaResource -> RecordingRevision ->
 * Works -> Composers, and -> Performance -> Programme/Venue), without
 * copying the catalogue into the analytics tables or making the YouTube
 * video ID the identity of the Recording. The Recording remains the
 * canonical Music Madras entity; this only resolves the reference.
 */
export async function getCrossPlatformContextForVideo(youtubeVideoId: string) {
  const video = await prisma.youTubeVideo.findUnique({
    where: { youtubeVideoId },
    include: {
      mediaResources: {
        include: {
          recordingRevision: {
            include: {
              recording: true,
              works: { include: { musicalWork: { include: { composer: true } } } },
              performance: { include: { programme: true, venue: true } },
            },
          },
        },
      },
    },
  });

  if (!video) {
    return null;
  }

  const recordingLinks = video.mediaResources
    .map((media) => media.recordingRevision)
    .filter((revision): revision is NonNullable<typeof revision> => revision !== null);

  const observations = await listObservationsForVideo(video.id);

  return { video, recordingLinks, observations };
}
