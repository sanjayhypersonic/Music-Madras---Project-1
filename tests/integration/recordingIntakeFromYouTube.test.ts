import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

// Must be at the true top level — vi.mock is hoisted above every import.
const mockGetCurrentStudioSession = vi.fn();
const { mockCan } = vi.hoisted(() => ({ mockCan: vi.fn() }));
vi.mock("../../modules/auth/authService", () => ({
  getCurrentStudioSession: () => mockGetCurrentStudioSession(),
}));
// Real `can` by default; a single test overrides it once to prove the action
// honors a permission DENIAL (every defined Studio role holds RECORDING_WRITE,
// so no real role can exercise that branch).
vi.mock("../../modules/auth/policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../modules/auth/policy")>();
  mockCan.mockImplementation(actual.can);
  return { ...actual, can: mockCan };
});

import { prisma } from "../../modules/db/client";
import { createDraftRecording, findPublishedRecordingBySlug, listRecordingsForStudio } from "../../modules/db/repositories/recordingRepository";
import {
  createRecordingFromYouTubeVideo,
  findRecordingLinkedToYouTubeVideo,
  listRecordingLinksForYouTubeVideos,
} from "../../modules/db/repositories/recordingIntakeRepository";
import { listYouTubeVideosForStudioCatalogue } from "../../modules/db/repositories/youtubeVideoRepository";
import { findPublishedRecordingSlugForYouTubeVideo } from "../../modules/db/repositories/mediaResourceRepository";
import { getRecordingContext } from "../../modules/db/repositories/recordingContextRepository";
import { getPublicRecordingPageData } from "../../modules/db/repositories/entityRelationshipsRepository";
import { listPublicRecordingSitemapEntries } from "../../modules/db/repositories/sitemapRepository";
import { computeContextFingerprint } from "../../modules/mmke/contentIntelligence/computeContextFingerprint";
import { slugify } from "../../modules/mmke/slug/slugify";
import { createRecordingFromVideoAction } from "../../app/(studio)/studio/(protected)/catalogue/videos/[videoId]/actions";

// Phase 6I-1 — Recording intake from a synced YouTube video. Real database,
// disposable fixtures only. Every YouTubeVideo here is a throwaway row this
// file creates itself — the real synced catalogue is never touched. Scoped
// assertions (by the test's own user / the new Recording) are used instead of
// global row counts, because vitest runs other integration files in parallel
// against the same database.

const TAG = "phase6i1";
const T = 60000;

let userIds: string[] = [];
let videoIds: string[] = [];
let extraRecordingIds: string[] = [];

async function createUser(role: "EDITOR" | "CONTRIBUTOR" = "EDITOR") {
  const user = await prisma.studioUser.create({
    data: { id: randomUUID(), email: `${randomUUID()}-${TAG}-integration-test@musicmadras.test`, name: "Phase 6I-1 Test User", role, status: "ACTIVE" },
  });
  userIds.push(user.id);
  return user;
}

async function createVideo(overrides: { title?: string | null; observabilityState?: "OBSERVED" | "NOT_OBSERVED" } = {}) {
  const token = randomUUID().slice(0, 8);
  const video = await prisma.youTubeVideo.create({
    data: {
      youtubeVideoId: `${TAG}-${token}`,
      title: `Phase6i1 Test Concert ${token}`,
      description: `Recorded live at the test hall.\n#choir #${token}`,
      privacyStatus: "public",
      observabilityState: "OBSERVED",
      publishedAt: new Date("2025-03-01"),
      durationSeconds: 754,
      ...overrides,
    },
  });
  videoIds.push(video.id);
  return video;
}

async function cleanup() {
  const recordingIds = new Set(extraRecordingIds);
  if (videoIds.length > 0) {
    const media = await prisma.mediaResource.findMany({
      where: { youtubeVideoId: { in: videoIds } },
      select: { recordingRevision: { select: { recordingId: true } } },
    });
    for (const m of media) if (m.recordingRevision) recordingIds.add(m.recordingRevision.recordingId);
  }
  for (const recordingId of recordingIds) {
    const revisions = await prisma.recordingRevision.findMany({ where: { recordingId }, select: { id: true } });
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "Recording", entityId: recordingId } });
    if (revisions.length > 0) {
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "RecordingRevision", entityId: { in: revisions.map((r) => r.id) } } });
    }
    await prisma.recording.delete({ where: { id: recordingId } }).catch(() => {});
  }
  if (videoIds.length > 0) await prisma.youTubeVideo.deleteMany({ where: { id: { in: videoIds } } });
  if (userIds.length > 0) await prisma.studioUser.deleteMany({ where: { id: { in: userIds } } });
  userIds = [];
  videoIds = [];
  extraRecordingIds = [];
}

function extractRedirectPath(err: unknown): string {
  if (typeof err === "object" && err !== null && "digest" in err) {
    const digest = (err as { digest: unknown }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
      return digest.split(";").slice(2, -2).join(";");
    }
  }
  throw err;
}

async function runAction(videoId: string): Promise<string> {
  try {
    await createRecordingFromVideoAction(videoId);
  } catch (err) {
    return extractRedirectPath(err);
  }
  throw new Error("Action did not redirect");
}

afterEach(cleanup);

describe("A. createRecordingFromYouTubeVideo — what is created", () => {
  it("creates a DRAFT Recording, its first draft revision, and a PRIMARY_VIDEO MediaResource linked to the synced video", async () => {
    const user = await createUser();
    const video = await createVideo();

    const result = await createRecordingFromYouTubeVideo({ youtubeVideoId: video.id, actorId: user.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const recording = await prisma.recording.findUniqueOrThrow({ where: { id: result.recording.id } });
    expect(recording.status).toBe("DRAFT");
    expect(recording.currentPublishedRevisionId).toBeNull();
    expect(recording.currentDraftRevisionId).not.toBeNull();

    const revision = await prisma.recordingRevision.findUniqueOrThrow({ where: { id: recording.currentDraftRevisionId! } });
    expect(revision.revisionStatus).toBe("DRAFT");
    expect(revision.revisionNumber).toBe(1);
    expect(revision.title).toBe(video.title); // the YouTube title is only the editable working title
    expect(revision.description).toBeNull(); // the YouTube description is NOT copied into the revision

    const media = await prisma.mediaResource.findMany({ where: { recordingRevisionId: revision.id } });
    expect(media).toHaveLength(1);
    expect(media[0].role).toBe("PRIMARY_VIDEO");
    expect(media[0].provider).toBe("YOUTUBE");
    expect(media[0].youtubeVideoId).toBe(video.id);
    expect(media[0].providerResourceId).toBe(video.youtubeVideoId);
    expect(media[0].url).toBe(`https://www.youtube.com/watch?v=${video.youtubeVideoId}`);
  }, T);

  it("makes the Recording immediately discoverable in the Studio recording catalogue", async () => {
    const user = await createUser();
    const video = await createVideo();
    const result = await createRecordingFromYouTubeVideo({ youtubeVideoId: video.id, actorId: user.id });
    if (!result.ok) throw new Error("intake failed");

    const studioList = await listRecordingsForStudio();
    expect(studioList.map((r) => r.id)).toContain(result.recording.id);
  }, T);

  it("falls back to a placeholder slug and leaves the title empty when the video has no title", async () => {
    const user = await createUser();
    const video = await createVideo({ title: null });
    const result = await createRecordingFromYouTubeVideo({ youtubeVideoId: video.id, actorId: user.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recording.slug.startsWith("youtube-video-")).toBe(true);
    expect(result.recording.currentDraftRevision?.title).toBeNull();
  }, T);

  it("does not write to the YouTubeVideo mirror", async () => {
    const user = await createUser();
    const video = await createVideo();
    const before = await prisma.youTubeVideo.findUniqueOrThrow({ where: { id: video.id } });
    await createRecordingFromYouTubeVideo({ youtubeVideoId: video.id, actorId: user.id });
    const after = await prisma.youTubeVideo.findUniqueOrThrow({ where: { id: video.id } });
    expect(after).toEqual(before);
  }, T);
});

describe("B. RecordingContext resolves the linked YouTube metadata", () => {
  it("surfaces the YouTube title and description verbatim through the existing link, with no RecordingContext change", async () => {
    const user = await createUser();
    const video = await createVideo();
    const result = await createRecordingFromYouTubeVideo({ youtubeVideoId: video.id, actorId: user.id });
    if (!result.ok) throw new Error("intake failed");

    const context = await getRecordingContext(result.recording.id, "DRAFT");
    expect(context.ok).toBe(true);
    if (!context.ok) return;

    expect(context.context.media).toHaveLength(1);
    expect(context.context.media[0].title).toBe(video.title);
    expect(context.context.media[0].description).toBe(video.description);
    expect(context.context.media[0].youtubeVideoId).toBe(video.youtubeVideoId);
    // Nothing was invented around it.
    expect(context.context.works).toHaveLength(0);
    expect(context.context.performance).toBeNull();
    expect(context.context.provenance.sources).toHaveLength(0);

    // A draft has no published revision, so PUBLISHED-mode context is correctly unavailable.
    const published = await getRecordingContext(result.recording.id, "PUBLISHED");
    expect(published).toEqual({ ok: false, reason: "NO_PUBLISHED_REVISION" });
  }, T);

  it("produces a deterministic context fingerprint for the new Recording", async () => {
    const user = await createUser();
    const video = await createVideo();
    const result = await createRecordingFromYouTubeVideo({ youtubeVideoId: video.id, actorId: user.id });
    if (!result.ok) throw new Error("intake failed");

    const first = await getRecordingContext(result.recording.id, "DRAFT");
    const second = await getRecordingContext(result.recording.id, "DRAFT");
    if (!first.ok || !second.ok) throw new Error("context unavailable");
    expect(computeContextFingerprint(first.context)).toBe(computeContextFingerprint(second.context));
  }, T);
});

describe("C. Duplicate protection", () => {
  it("refuses a second intake of the same video, returns the existing Recording, and leaves it unchanged", async () => {
    const user = await createUser();
    const video = await createVideo();
    const first = await createRecordingFromYouTubeVideo({ youtubeVideoId: video.id, actorId: user.id });
    if (!first.ok) throw new Error("intake failed");

    const before = await prisma.recording.findUniqueOrThrow({ where: { id: first.recording.id } });
    const second = await createRecordingFromYouTubeVideo({ youtubeVideoId: video.id, actorId: user.id });

    expect(second.ok).toBe(false);
    if (second.ok || second.reason !== "ALREADY_LINKED") throw new Error("expected ALREADY_LINKED");
    expect(second.existing.recordingId).toBe(first.recording.id);
    expect(second.existing.status).toBe("DRAFT");

    const after = await prisma.recording.findUniqueOrThrow({ where: { id: first.recording.id } });
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(await prisma.recordingRevision.count({ where: { recordingId: first.recording.id } })).toBe(1);
    expect(await prisma.mediaResource.count({ where: { youtubeVideoId: video.id } })).toBe(1);
    expect(await prisma.auditLogEntry.count({ where: { entityType: "Recording", entityId: first.recording.id, action: "RECORDING_CREATED_FROM_YOUTUBE_VIDEO" } })).toBe(1);
  }, T);

  it("two simultaneous intakes of the same video produce exactly one Recording", async () => {
    const user = await createUser();
    const video = await createVideo();

    const results = await Promise.all([
      createRecordingFromYouTubeVideo({ youtubeVideoId: video.id, actorId: user.id }),
      createRecordingFromYouTubeVideo({ youtubeVideoId: video.id, actorId: user.id }),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === "ALREADY_LINKED")).toHaveLength(1);
    expect(await prisma.mediaResource.count({ where: { youtubeVideoId: video.id } })).toBe(1);
  }, T);

  it("treats a video as linked even when its Recording is archived (never silently creates a second one)", async () => {
    const user = await createUser();
    const video = await createVideo();
    const first = await createRecordingFromYouTubeVideo({ youtubeVideoId: video.id, actorId: user.id });
    if (!first.ok) throw new Error("intake failed");
    await prisma.recording.update({ where: { id: first.recording.id }, data: { status: "ARCHIVED" } });

    const second = await createRecordingFromYouTubeVideo({ youtubeVideoId: video.id, actorId: user.id });
    expect(second.ok).toBe(false);
    if (!second.ok && second.reason === "ALREADY_LINKED") expect(second.existing.status).toBe("ARCHIVED");
  }, T);

  it("exposes the existing link to the Studio list/detail lookups", async () => {
    const user = await createUser();
    const linked = await createVideo();
    const unlinked = await createVideo();
    const result = await createRecordingFromYouTubeVideo({ youtubeVideoId: linked.id, actorId: user.id });
    if (!result.ok) throw new Error("intake failed");

    expect((await findRecordingLinkedToYouTubeVideo(linked.id))?.recordingId).toBe(result.recording.id);
    expect(await findRecordingLinkedToYouTubeVideo(unlinked.id)).toBeNull();

    const links = await listRecordingLinksForYouTubeVideos([linked.id, unlinked.id]);
    expect(links.get(linked.id)?.recordingId).toBe(result.recording.id);
    expect(links.has(unlinked.id)).toBe(false);
  }, T);
});

describe("D. Refusals", () => {
  it("refuses an unknown video id and creates nothing", async () => {
    const user = await createUser();
    const result = await createRecordingFromYouTubeVideo({ youtubeVideoId: randomUUID(), actorId: user.id });
    expect(result).toEqual({ ok: false, reason: "VIDEO_NOT_FOUND" });
  }, T);

  it("refuses a video that is no longer OBSERVED and creates nothing", async () => {
    const user = await createUser();
    const video = await createVideo({ observabilityState: "NOT_OBSERVED" });
    const result = await createRecordingFromYouTubeVideo({ youtubeVideoId: video.id, actorId: user.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("VIDEO_NOT_AVAILABLE");
    expect(await prisma.mediaResource.count({ where: { youtubeVideoId: video.id } })).toBe(0);
  }, T);

  it("is all-or-nothing: a failure mid-intake (slug conflict) leaves no media, no audit event, and no partial Recording", async () => {
    const user = await createUser();
    const video = await createVideo();
    // Pre-create a Recording occupying the exact slug intake would derive, so
    // createDraftRecording throws inside the intake transaction.
    const slug = `${slugify(video.title!).slice(0, 80).replace(/-+$/g, "")}-${video.id.slice(0, 8)}`;
    const blocker = await createDraftRecording({ slug, actorId: user.id, title: "Slug blocker" });
    extraRecordingIds.push(blocker.id);

    await expect(createRecordingFromYouTubeVideo({ youtubeVideoId: video.id, actorId: user.id })).rejects.toThrow();

    expect(await prisma.mediaResource.count({ where: { youtubeVideoId: video.id } })).toBe(0);
    expect(await prisma.auditLogEntry.count({ where: { action: "RECORDING_CREATED_FROM_YOUTUBE_VIDEO", actorId: user.id } })).toBe(0);
  }, T);
});

describe("E. Nothing is invented, generated, retrieved, or published", () => {
  it("creates no canonical entity, no participants, and no relationships — only the Recording, its revision, and the media link", async () => {
    const user = await createUser();
    const video = await createVideo();
    const result = await createRecordingFromYouTubeVideo({ youtubeVideoId: video.id, actorId: user.id });
    if (!result.ok) throw new Error("intake failed");

    const by = { createdById: user.id };
    expect(await prisma.composer.count({ where: by })).toBe(0);
    expect(await prisma.musicalWork.count({ where: by })).toBe(0);
    expect(await prisma.programme.count({ where: by })).toBe(0);
    expect(await prisma.performance.count({ where: by })).toBe(0);
    expect(await prisma.venue.count({ where: by })).toBe(0);
    expect(await prisma.artist.count({ where: by })).toBe(0);
    expect(await prisma.choir.count({ where: by })).toBe(0);
    expect(await prisma.conductor.count({ where: by })).toBe(0);
    expect(await prisma.organisation.count({ where: by })).toBe(0);

    const revisionId = result.recording.currentDraftRevision!.id;
    const revision = await prisma.recordingRevision.findUniqueOrThrow({ where: { id: revisionId } });
    expect(revision.performanceId).toBeNull();
    expect(await prisma.recordingRevisionWork.count({ where: { revisionId } })).toBe(0);
    expect(await prisma.entitySource.count({ where: { entityType: "RECORDING", entityId: result.recording.id } })).toBe(0);
  }, T);

  it("triggers no AI generation, no external retrieval, and no publication", async () => {
    const user = await createUser();
    const video = await createVideo();
    const result = await createRecordingFromYouTubeVideo({ youtubeVideoId: video.id, actorId: user.id });
    if (!result.ok) throw new Error("intake failed");

    expect(await prisma.contentGenerationRequest.count({ where: { targetEntityId: result.recording.id } })).toBe(0);
    expect(await prisma.contentSuggestion.count({ where: { targetEntityId: result.recording.id } })).toBe(0);

    const actions = (await prisma.auditLogEntry.findMany({ where: { actorId: user.id }, select: { action: true } })).map((a) => a.action);
    expect(actions.some((a) => a.startsWith("CONTENT_"))).toBe(false);
    expect(actions.some((a) => a.startsWith("EXTERNAL_SOURCE"))).toBe(false);
    expect(actions).not.toContain("RECORDING_PUBLISHED");

    const recording = await prisma.recording.findUniqueOrThrow({ where: { id: result.recording.id } });
    expect(recording.status).toBe("DRAFT");
    expect(recording.currentPublishedRevisionId).toBeNull();
  }, T);
});

describe("F. Audit", () => {
  it("writes RECORDING_CREATED_FROM_YOUTUBE_VIDEO identifying the Recording, the video, and the actor, alongside the reused lifecycle events", async () => {
    const user = await createUser();
    const video = await createVideo();
    const result = await createRecordingFromYouTubeVideo({ youtubeVideoId: video.id, actorId: user.id });
    if (!result.ok) throw new Error("intake failed");

    const entry = await prisma.auditLogEntry.findFirstOrThrow({
      where: { entityType: "Recording", entityId: result.recording.id, action: "RECORDING_CREATED_FROM_YOUTUBE_VIDEO" },
    });
    expect(entry.actorId).toBe(user.id);
    expect(entry.timestamp).toBeInstanceOf(Date);
    expect(entry.afterSnapshot).toMatchObject({
      youtubeVideoId: video.id,
      externalYoutubeVideoId: video.youtubeVideoId,
      mediaResourceId: result.mediaResource.id,
    });

    const draftEvent = await prisma.auditLogEntry.count({ where: { entityType: "Recording", entityId: result.recording.id, action: "RECORDING_DRAFT_CREATED" } });
    const mediaEvent = await prisma.auditLogEntry.count({
      where: { entityType: "RecordingRevision", entityId: result.recording.currentDraftRevision!.id, action: "MEDIA_ATTACHED_TO_RECORDING_REVISION" },
    });
    expect(draftEvent).toBe(1);
    expect(mediaEvent).toBe(1);
  }, T);
});

describe("G. The draft stays out of every public surface", () => {
  it("is not exposed by the public page data, the published lookup, the sitemap, or the video-to-recording resolver", async () => {
    const user = await createUser();
    const video = await createVideo();
    const result = await createRecordingFromYouTubeVideo({ youtubeVideoId: video.id, actorId: user.id });
    if (!result.ok) throw new Error("intake failed");
    const slug = result.recording.slug;

    expect(await getPublicRecordingPageData(slug)).toBeNull();
    expect(await findPublishedRecordingBySlug(slug)).toBeNull();
    expect((await listPublicRecordingSitemapEntries()).map((e) => e.slug)).not.toContain(slug);
    expect(await findPublishedRecordingSlugForYouTubeVideo(video.id)).toBeNull();
  }, T);
});

describe("H. Studio catalogue search", () => {
  it("filters the video catalogue by title fragment or YouTube id, and returns everything when empty", async () => {
    const token = randomUUID().slice(0, 8);
    const target = await createVideo({ title: `Phase6i1 Searchable ${token}` });
    const other = await createVideo();

    const byTitle = await listYouTubeVideosForStudioCatalogue(`searchable ${token}`);
    expect(byTitle.map((v) => v.id)).toEqual([target.id]);

    const byYoutubeId = await listYouTubeVideosForStudioCatalogue(other.youtubeVideoId);
    expect(byYoutubeId.map((v) => v.id)).toEqual([other.id]);

    const unfiltered = await listYouTubeVideosForStudioCatalogue();
    expect(unfiltered.map((v) => v.id)).toEqual(expect.arrayContaining([target.id, other.id]));
  }, T);
});

describe("I. Server Action: createRecordingFromVideoAction", () => {
  beforeEach(() => {
    mockGetCurrentStudioSession.mockReset();
    mockCan.mockClear();
  });

  it("refuses an unauthenticated caller and creates nothing", async () => {
    mockGetCurrentStudioSession.mockResolvedValue(null);
    const video = await createVideo();

    const redirectPath = await runAction(video.id);
    expect(decodeURIComponent(redirectPath)).toContain("permission");
    expect(await prisma.mediaResource.count({ where: { youtubeVideoId: video.id } })).toBe(0);
  }, T);

  it("honors a permission denial from the policy and creates nothing", async () => {
    const user = await createUser();
    const video = await createVideo();
    mockGetCurrentStudioSession.mockResolvedValue({ user: { id: user.id, role: "EDITOR" } });
    mockCan.mockReturnValueOnce(false);

    const redirectPath = await runAction(video.id);
    expect(decodeURIComponent(redirectPath)).toContain("permission");
    expect(await prisma.mediaResource.count({ where: { youtubeVideoId: video.id } })).toBe(0);
  }, T);

  it("creates the Recording for an authorized user and redirects to its media step, where the linked primary video is visible", async () => {
    const user = await createUser("CONTRIBUTOR"); // every Studio role, including CONTRIBUTOR, holds RECORDING_WRITE
    const video = await createVideo();
    mockGetCurrentStudioSession.mockResolvedValue({ user: { id: user.id, role: "CONTRIBUTOR" } });

    const redirectPath = await runAction(video.id);
    const linked = await findRecordingLinkedToYouTubeVideo(video.id);
    expect(linked).not.toBeNull();
    expect(redirectPath).toBe(`/studio/recordings/${linked!.recordingId}/media`);
    expect(linked!.status).toBe("DRAFT");
  }, T);

  it("blocks a repeated click with a clear message and does not create a second Recording", async () => {
    const user = await createUser();
    const video = await createVideo();
    mockGetCurrentStudioSession.mockResolvedValue({ user: { id: user.id, role: "EDITOR" } });

    await runAction(video.id);
    const second = await runAction(video.id);

    expect(second).toContain(`/studio/catalogue/videos/${video.id}`);
    expect(decodeURIComponent(second)).toContain("already linked to a Music Madras Recording");
    expect(await prisma.mediaResource.count({ where: { youtubeVideoId: video.id } })).toBe(1);
  }, T);
});
