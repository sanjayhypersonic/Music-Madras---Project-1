import { prisma } from "../client";

// The database operations of the STAGING CONTENT LOADER (modules/seed/loadStagingContent.ts) that no other repository offers. Everything else the loader does goes
// through the existing repositories and lifecycle services (composer, work, venue, programme, performance, recording intake and revision editing).
//
// Rules this file keeps:
//   - the YouTube mirror import is ONE transaction (all of it or none of it), idempotent, and never changes an existing row (`update: {}`): a video, playlist or
//     membership that is already there is left exactly as it is, including anything curated or synchronised later;
//   - it creates no video page, no exposure approval and no review: a mirrored video is not public, and an unlisted one stays unlisted and unapproved;
//   - the import actor is a NON-LOGIN user (no password hash, DISABLED, lowest-privilege role, an undeliverable .invalid address): it exists only so that the
//     rows it creates have a truthful author in the audit trail. An existing user with that address is never modified.

export const IMPORT_ACTOR_EMAIL = "content-import@staging.musicmadras.invalid";
export const IMPORT_ACTOR_NAME = "Content import (system, no sign-in)";

export interface MirrorVideoInput {
  youtubeVideoId: string;
  title: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  durationSeconds: number | null;
  channelId: string | null;
  privacyStatus: string | null;
  embeddable: boolean | null;
  observabilityState: "OBSERVED";
  playlistMemberships: { youtubePlaylistId: string; position: number }[];
}
export interface MirrorPlaylistInput {
  youtubePlaylistId: string;
  title: string | null;
  description: string | null;
  channelId: string | null;
  thumbnailUrl: string | null;
  privacyStatus: string | null;
  publishedAt: string | null;
}
export interface MirrorFixtures {
  videos: MirrorVideoInput[];
  playlists: MirrorPlaylistInput[];
}

/** What the DATABASE holds for a mirrored video now (never what a fixture says): the authority for every decision the loader takes about it. */
export interface MirroredVideoState {
  id: string;
  privacyStatus: string | null;
  observabilityState: string;
}

export interface MirrorImportResult {
  /** Internal YouTubeVideo.id by YouTube video id. */
  videoIds: Map<string, string>;
  /** The stored privacy and observability of each video after the import, by YouTube video id. An existing row keeps its stored values. */
  videoStates: Map<string, MirroredVideoState>;
  videosCreated: number;
  videosExisting: number;
  playlistsCreated: number;
  playlistsExisting: number;
  membershipsCreated: number;
}

export async function importYouTubeMirror(fixtures: MirrorFixtures): Promise<MirrorImportResult> {
  return prisma.$transaction(
    async (tx) => {
      const result: MirrorImportResult = { videoIds: new Map(), videoStates: new Map(), videosCreated: 0, videosExisting: 0, playlistsCreated: 0, playlistsExisting: 0, membershipsCreated: 0 };
      const playlistIds = new Map<string, string>();
      for (const p of fixtures.playlists) {
        const existing = await tx.youTubePlaylist.findUnique({ where: { youtubePlaylistId: p.youtubePlaylistId }, select: { id: true } });
        const row = await tx.youTubePlaylist.upsert({
          where: { youtubePlaylistId: p.youtubePlaylistId },
          update: {},
          create: { ...p, publishedAt: p.publishedAt ? new Date(p.publishedAt) : null, observabilityState: "OBSERVED" },
        });
        playlistIds.set(p.youtubePlaylistId, row.id);
        if (existing) result.playlistsExisting += 1;
        else result.playlistsCreated += 1;
      }
      for (const v of fixtures.videos) {
        const { playlistMemberships, ...fields } = v;
        const existing = await tx.youTubeVideo.findUnique({ where: { youtubeVideoId: v.youtubeVideoId }, select: { id: true } });
        const row = await tx.youTubeVideo.upsert({
          where: { youtubeVideoId: v.youtubeVideoId },
          update: {},
          create: { ...fields, publishedAt: v.publishedAt ? new Date(v.publishedAt) : null },
        });
        result.videoIds.set(v.youtubeVideoId, row.id);
        result.videoStates.set(v.youtubeVideoId, { id: row.id, privacyStatus: row.privacyStatus, observabilityState: row.observabilityState });
        if (existing) result.videosExisting += 1;
        else result.videosCreated += 1;
        for (const m of playlistMemberships) {
          const playlistId = playlistIds.get(m.youtubePlaylistId);
          if (!playlistId) continue; // a membership of a playlist outside the fixtures is not imported
          const key = { playlistId_youtubeVideoId: { playlistId, youtubeVideoId: row.id } };
          const had = await tx.youTubePlaylistItem.findUnique({ where: key, select: { id: true } });
          await tx.youTubePlaylistItem.upsert({ where: key, update: {}, create: { playlistId, youtubeVideoId: row.id, position: m.position, observabilityState: "OBSERVED" } });
          if (!had) result.membershipsCreated += 1;
        }
      }
      return result;
    },
    { timeout: 60_000, maxWait: 15_000 }
  );
}

/** The stored state of the given videos (by YouTube video id) when the mirror was filled by the real YouTube sync instead of this loader. Absent videos are absent from the map. */
export async function findMirroredVideoStates(youtubeVideoIds: string[]): Promise<Map<string, MirroredVideoState>> {
  const rows = await prisma.youTubeVideo.findMany({
    where: { youtubeVideoId: { in: youtubeVideoIds } },
    select: { id: true, youtubeVideoId: true, privacyStatus: true, observabilityState: true },
  });
  return new Map(rows.map((r) => [r.youtubeVideoId, { id: r.id, privacyStatus: r.privacyStatus, observabilityState: r.observabilityState }]));
}

/** The non-login author of imported rows. Created once; an existing user with the address is returned untouched. */
export async function ensureImportActor(): Promise<{ id: string; created: boolean }> {
  const existing = await prisma.studioUser.findUnique({ where: { email: IMPORT_ACTOR_EMAIL }, select: { id: true } });
  if (existing) return { id: existing.id, created: false };
  const created = await prisma.studioUser.create({ data: { email: IMPORT_ACTOR_EMAIL, name: IMPORT_ACTOR_NAME, role: "CONTRIBUTOR", status: "DISABLED" }, select: { id: true } });
  return { id: created.id, created: true };
}

export interface DraftFillState {
  recordingId: string;
  status: string;
  revisionId: string | null;
  revisionUpdatedAt: Date | null;
  title: string | null;
  performanceId: string | null;
  workCount: number;
}

/** What a Recording's open draft already holds, so the loader fills only what is EMPTY. */
export async function getDraftFillState(recordingId: string): Promise<DraftFillState | null> {
  const recording = await prisma.recording.findUnique({
    where: { id: recordingId },
    select: { id: true, status: true, currentDraftRevision: { select: { id: true, updatedAt: true, title: true, performanceId: true, _count: { select: { works: true } } } } },
  });
  if (!recording) return null;
  const draft = recording.currentDraftRevision;
  return {
    recordingId: recording.id,
    status: recording.status,
    revisionId: draft?.id ?? null,
    revisionUpdatedAt: draft?.updatedAt ?? null,
    title: draft?.title ?? null,
    performanceId: draft?.performanceId ?? null,
    workCount: draft?._count.works ?? 0,
  };
}

export function findProgrammeBySlug(slug: string) {
  return prisma.programme.findUnique({ where: { slug } });
}

export function findPerformanceByProgrammeAndVenue(programmeId: string, venueId: string): Promise<{ id: string } | null> {
  return prisma.performance.findFirst({ where: { programmeId, venueId }, select: { id: true }, orderBy: { createdAt: "asc" } });
}
