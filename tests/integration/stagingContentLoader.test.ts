import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../modules/db/client";
import { IMPORT_ACTOR_EMAIL, importYouTubeMirror, type MirrorFixtures } from "../../modules/db/repositories/stagingSeedRepository";
import { findRecordingLinkedToYouTubeVideo } from "../../modules/db/repositories/recordingIntakeRepository";
import { findPublishedRecordingBySlug, updateDraftRevisionContent } from "../../modules/db/repositories/recordingRepository";
import { findPublicVideoPagesByYouTubeVideoIds } from "../../modules/db/repositories/youtubeVideoPageRepository";
import { loadStagingContent, StagingContentRefused } from "../../modules/seed/loadStagingContent";
import { parseStagingContentSpec, type StagingContentSpec } from "../../modules/seed/stagingContentSpec";
import { REAL_FIXTURES, REAL_VIDEO, removeRealYouTubeFixtures } from "./helpers/realYouTubeFixtures";

// The staging content loader, run against the ISOLATED test database only (this suite is only ever run through vitest.integration.config.ts, which refuses any other
// database). The real fixtures and the real curated file are used; only the slugs and names are suffixed with a token so that nothing here can collide with, or be
// mistaken for, another suite's rows. Everything the suite creates is removed afterwards.

const T = 180000;
const TOKEN = randomUUID().slice(0, 8);
const root = path.resolve(__dirname, "../..");
const fixtures = REAL_FIXTURES as unknown as MirrorFixtures;

const parsed = parseStagingContentSpec(JSON.parse(readFileSync(path.join(root, "content/staging/first-recording.json"), "utf8")));
if (!parsed.ok) throw new Error(`The shipped content file is invalid: ${parsed.problems.join(" ")}`);
const spec: StagingContentSpec = {
  ...parsed.spec,
  composer: { ...parsed.spec.composer, slug: `${parsed.spec.composer.slug}-${TOKEN}`, name: `${parsed.spec.composer.name} ${TOKEN}` },
  work: { ...parsed.spec.work, slug: `${parsed.spec.work.slug}-${TOKEN}`, title: `${parsed.spec.work.title} ${TOKEN}` },
  programme: { ...parsed.spec.programme, slug: `${parsed.spec.programme.slug}-${TOKEN}`, title: `${parsed.spec.programme.title} ${TOKEN}` },
};
const ZEQ = REAL_VIDEO.DINGIRI;

async function internalVideoIds(): Promise<string[]> {
  return (await prisma.youTubeVideo.findMany({ where: { youtubeVideoId: { in: fixtures.videos.map((v) => v.youtubeVideoId) } }, select: { id: true } })).map((v) => v.id);
}

/** Everything the loader made for the spec, children first. The mirror rows and the import actor stay (removed in afterAll). */
async function wipeLoaded(): Promise<void> {
  const video = await prisma.youTubeVideo.findUnique({ where: { youtubeVideoId: ZEQ }, select: { id: true } });
  const linked = video ? await findRecordingLinkedToYouTubeVideo(video.id) : null;
  const composer = await prisma.composer.findUnique({ where: { slug: spec.composer.slug }, select: { id: true } });
  const work = await prisma.musicalWork.findUnique({ where: { slug: spec.work.slug }, select: { id: true } });
  const programme = await prisma.programme.findUnique({ where: { slug: spec.programme.slug }, select: { id: true, items: { select: { id: true } } } });
  const revisionIds = linked ? (await prisma.recordingRevision.findMany({ where: { recordingId: linked.recordingId }, select: { id: true } })).map((r) => r.id) : [];
  const mediaIds = (await prisma.mediaResource.findMany({ where: { recordingRevisionId: { in: revisionIds } }, select: { id: true } })).map((m) => m.id);
  const ids = [linked?.recordingId, composer?.id, work?.id, programme?.id, ...(programme?.items.map((i) => i.id) ?? []), ...revisionIds, ...mediaIds].filter((x): x is string => Boolean(x));
  await prisma.auditLogEntry.deleteMany({ where: { entityId: { in: ids } } });
  if (linked) await prisma.recording.deleteMany({ where: { id: linked.recordingId } });
  if (programme) await prisma.programme.deleteMany({ where: { id: programme.id } });
  if (work) await prisma.musicalWork.deleteMany({ where: { id: work.id } });
  if (composer) await prisma.composer.deleteMany({ where: { id: composer.id } });
}

async function counts() {
  const ids = await internalVideoIds();
  return {
    videos: await prisma.youTubeVideo.count({ where: { id: { in: ids } } }),
    playlists: await prisma.youTubePlaylist.count({ where: { youtubePlaylistId: { in: fixtures.playlists.map((p) => p.youtubePlaylistId) } } }),
    memberships: await prisma.youTubePlaylistItem.count({ where: { youtubeVideoId: { in: ids } } }),
    composers: await prisma.composer.count({ where: { slug: spec.composer.slug } }),
    works: await prisma.musicalWork.count({ where: { slug: spec.work.slug } }),
    programmes: await prisma.programme.count({ where: { slug: spec.programme.slug } }),
    programmeItems: await prisma.programmeItem.count({ where: { programme: { slug: spec.programme.slug } } }),
    recordings: await prisma.mediaResource.count({ where: { youtubeVideo: { youtubeVideoId: ZEQ }, recordingRevisionId: { not: null }, role: "PRIMARY_VIDEO" } }),
    revisionWorks: await prisma.recordingRevisionWork.count({ where: { musicalWork: { slug: spec.work.slug } } }),
    venues: await prisma.venue.count(),
    performances: await prisma.performance.count(),
    actors: await prisma.studioUser.count({ where: { email: IMPORT_ACTOR_EMAIL } }),
  };
}

async function recordingState() {
  const video = await prisma.youTubeVideo.findUniqueOrThrow({ where: { youtubeVideoId: ZEQ }, select: { id: true } });
  const linked = await findRecordingLinkedToYouTubeVideo(video.id);
  if (!linked) return null;
  const recording = await prisma.recording.findUniqueOrThrow({
    where: { id: linked.recordingId },
    include: { currentDraftRevision: { include: { works: true, mediaResources: true } }, _count: { select: { revisions: true } } },
  });
  return recording;
}

let venuesBefore = 0;
let performancesBefore = 0;

beforeAll(async () => {
  await removeRealYouTubeFixtures(); // a known start: no mirror rows
  venuesBefore = await prisma.venue.count();
  performancesBefore = await prisma.performance.count();
}, T);

afterAll(async () => {
  await wipeLoaded();
  const actor = await prisma.studioUser.findUnique({ where: { email: IMPORT_ACTOR_EMAIL }, select: { id: true } });
  if (actor) {
    await prisma.auditLogEntry.deleteMany({ where: { actorId: actor.id } });
    await prisma.studioUser.deleteMany({ where: { id: actor.id } });
  }
  await removeRealYouTubeFixtures();
}, T);

describe("1. a first load into an empty database", () => {
  it("imports the five videos, two playlists and three memberships, and the catalogue records the spec states", async () => {
    const report = await loadStagingContent(spec, fixtures);
    expect(report.mirror).toEqual({ videosCreated: 5, videosExisting: 0, playlistsCreated: 2, playlistsExisting: 0, membershipsCreated: 3 });
    expect(report.actorCreated).toBe(true);
    expect(report.steps.filter((s) => ["Composer", "MusicalWork", "Programme", "ProgrammeItem", "Recording"].includes(s.entity)).map((s) => `${s.entity}:${s.outcome}`)).toEqual([
      "Composer:CREATED", "MusicalWork:CREATED", "Programme:CREATED", "ProgrammeItem:CREATED", "Recording:CREATED",
    ]);
    const c = await counts();
    expect(c).toMatchObject({ videos: 5, playlists: 2, memberships: 3, composers: 1, works: 1, programmes: 1, programmeItems: 1, recordings: 1, revisionWorks: 1, actors: 1 });
  }, T);

  it("preserves the source identifiers and metadata exactly as exported", async () => {
    for (const v of fixtures.videos) {
      const row = await prisma.youTubeVideo.findUniqueOrThrow({ where: { youtubeVideoId: v.youtubeVideoId } });
      expect([row.title, row.description, row.privacyStatus, row.durationSeconds, row.channelId, row.observabilityState]).toEqual([v.title, v.description, v.privacyStatus, v.durationSeconds, v.channelId, "OBSERVED"]);
    }
    for (const p of fixtures.playlists) {
      const row = await prisma.youTubePlaylist.findUniqueOrThrow({ where: { youtubePlaylistId: p.youtubePlaylistId } });
      expect([row.title, row.privacyStatus]).toEqual([p.title, p.privacyStatus]);
    }
  });

  it("creates the Recording as an unpublished DRAFT linked to its video, with its title, work and a creation audit entry", async () => {
    const recording = await recordingState();
    expect(recording).not.toBeNull();
    expect(recording!.status).toBe("DRAFT");
    expect(recording!.currentPublishedRevisionId).toBeNull();
    expect(recording!._count.revisions).toBe(1);
    const draft = recording!.currentDraftRevision!;
    expect(draft.revisionStatus).toBe("DRAFT");
    expect(draft.title).toBe(spec.recording.title);
    expect(draft.performanceId).toBeNull(); // the sources do not state the venue type, so there is no Venue and no Performance
    expect(draft.works).toHaveLength(1);
    expect(draft.mediaResources).toHaveLength(1);
    expect(draft.mediaResources[0]).toMatchObject({ provider: "YOUTUBE", role: "PRIMARY_VIDEO" });
    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Recording", entityId: recording!.id, action: "RECORDING_CREATED_FROM_YOUTUBE_VIDEO" } });
    expect(audit).toHaveLength(1);
    expect(await findPublishedRecordingBySlug(recording!.slug)).toBeNull(); // not on the public site
  });

  it("creates the work under the composer, a programme with that one work, and the non-login import actor", async () => {
    const work = await prisma.musicalWork.findUniqueOrThrow({ where: { slug: spec.work.slug }, include: { composer: true } });
    expect(work.title).toBe(spec.work.title);
    expect(work.composer.slug).toBe(spec.composer.slug);
    const programme = await prisma.programme.findUniqueOrThrow({ where: { slug: spec.programme.slug }, include: { items: true } });
    expect(programme.items.map((i) => i.musicalWorkId)).toEqual([work.id]);
    const actor = await prisma.studioUser.findUniqueOrThrow({ where: { email: IMPORT_ACTOR_EMAIL } });
    expect(actor).toMatchObject({ passwordHash: null, status: "DISABLED", role: "CONTRIBUTOR" });
    expect(work.createdById).toBe(actor.id);
  });

  it("creates no Venue and no Performance, because the venue type is not stated in the sources", async () => {
    expect(await prisma.venue.count()).toBe(venuesBefore);
    expect(await prisma.performance.count()).toBe(performancesBefore);
  });
});

describe("2. nothing becomes public", () => {
  it("leaves the unlisted video unlisted, unapproved and without any page", async () => {
    const unlisted = await prisma.youTubeVideo.findUniqueOrThrow({ where: { youtubeVideoId: REAL_VIDEO.UNLISTED } });
    expect(unlisted.privacyStatus).toBe("unlisted");
    expect(await prisma.youTubeVideoPage.count({ where: { youtubeVideoId: unlisted.id } })).toBe(0);
    expect(await prisma.videoExposureApproval.count({ where: { videoPage: { youtubeVideoId: unlisted.id } } })).toBe(0);
    expect(await findPublicVideoPagesByYouTubeVideoIds([unlisted.id])).toEqual([]);
  });

  it("creates no video page, exposure approval, review or featured pin for any of the five videos", async () => {
    const ids = await internalVideoIds();
    expect(await prisma.youTubeVideoPage.count({ where: { youtubeVideoId: { in: ids } } })).toBe(0);
    expect(await prisma.videoExposureApproval.count({ where: { videoPage: { youtubeVideoId: { in: ids } } } })).toBe(0);
    expect(await prisma.videoExposureReview.count({ where: { youtubeVideoId: { in: ids } } })).toBe(0);
    expect(await findPublicVideoPagesByYouTubeVideoIds(ids)).toEqual([]);
  });

  it("refuses a spec that would start a Recording from the unlisted video, and writes nothing for it", async () => {
    const before = await counts();
    const bad: StagingContentSpec = { ...spec, recording: { ...spec.recording, youtubeVideoId: REAL_VIDEO.UNLISTED } };
    await expect(loadStagingContent(bad, fixtures)).rejects.toThrow(StagingContentRefused);
    await expect(loadStagingContent(bad, fixtures)).rejects.toThrow(/unlisted/);
    expect(await counts()).toEqual(before);
  });

  it("refuses a spec whose quoted fact is not in its source video, and writes nothing", async () => {
    const before = await counts();
    const bad: StagingContentSpec = { ...spec, composer: { ...spec.composer, evidence: { ...spec.composer.evidence, quote: "composed by a person the video never names" } } };
    await expect(loadStagingContent(bad, fixtures)).rejects.toThrow(StagingContentRefused);
    expect(await counts()).toEqual(before);
  });
});

describe("3. a repeat run", () => {
  it("creates nothing twice and reports everything as already present", async () => {
    const before = await counts();
    const recordingBefore = await recordingState();
    const report = await loadStagingContent(spec, fixtures);
    expect(report.mirror).toEqual({ videosCreated: 0, videosExisting: 5, playlistsCreated: 0, playlistsExisting: 2, membershipsCreated: 0 });
    expect(report.actorCreated).toBe(false);
    expect(report.steps.every((s) => s.outcome === "EXISTING" || s.outcome === "SKIPPED")).toBe(true);
    expect(await counts()).toEqual(before);
    const recordingAfter = await recordingState();
    expect(recordingAfter!.id).toBe(recordingBefore!.id);
    expect(recordingAfter!.currentDraftRevision!.updatedAt).toEqual(recordingBefore!.currentDraftRevision!.updatedAt);
    expect(recordingAfter!._count.revisions).toBe(1);
  }, T);
});

describe("4. existing curated data is never overwritten", () => {
  it("keeps edited video metadata, a curated composer and work, and an editor's own Recording title", async () => {
    const video = await prisma.youTubeVideo.findUniqueOrThrow({ where: { youtubeVideoId: ZEQ } });
    await prisma.youTubeVideo.update({ where: { id: video.id }, data: { title: "Edited after a later sync", description: "Edited description." } });
    await prisma.composer.update({ where: { slug: spec.composer.slug }, data: { biography: "A curated biography.", name: `Curated name ${TOKEN}` } });
    await prisma.musicalWork.update({ where: { slug: spec.work.slug }, data: { notes: "A curated note.", title: `Curated title ${TOKEN}` } });
    await prisma.programme.update({ where: { slug: spec.programme.slug }, data: { notes: "Curated programme note." } });
    const recording = (await recordingState())!;
    await updateDraftRevisionContent(recording.id, recording.currentDraftRevision!.updatedAt, recording.createdById, { title: `Editor title ${TOKEN}`, description: "Editor description." });
    const before = await counts();

    const report = await loadStagingContent(spec, fixtures);
    expect(report.mirror.videosCreated).toBe(0);
    expect(await counts()).toEqual(before);

    const after = await prisma.youTubeVideo.findUniqueOrThrow({ where: { id: video.id } });
    expect([after.title, after.description]).toEqual(["Edited after a later sync", "Edited description."]);
    const composer = await prisma.composer.findUniqueOrThrow({ where: { slug: spec.composer.slug } });
    expect([composer.biography, composer.name]).toEqual(["A curated biography.", `Curated name ${TOKEN}`]);
    const work = await prisma.musicalWork.findUniqueOrThrow({ where: { slug: spec.work.slug } });
    expect([work.notes, work.title]).toEqual(["A curated note.", `Curated title ${TOKEN}`]);
    expect((await prisma.programme.findUniqueOrThrow({ where: { slug: spec.programme.slug } })).notes).toBe("Curated programme note.");
    const draft = (await recordingState())!.currentDraftRevision!;
    expect([draft.title, draft.description]).toEqual([`Editor title ${TOKEN}`, "Editor description."]);
    expect(report.steps.find((s) => s.entity === "RecordingRevision.title")?.outcome).toBe("EXISTING");
  }, T);

  it("leaves a Recording that is no longer a draft completely untouched", async () => {
    const recording = (await recordingState())!;
    await prisma.recording.update({ where: { id: recording.id }, data: { status: "ARCHIVED", currentDraftRevisionId: null } });
    const before = await prisma.recordingRevision.findMany({ where: { recordingId: recording.id }, orderBy: { revisionNumber: "asc" } });
    const report = await loadStagingContent(spec, fixtures);
    expect(report.steps.find((s) => s.entity === "RecordingRevision")?.outcome).toBe("SKIPPED");
    const after = await prisma.recordingRevision.findMany({ where: { recordingId: recording.id }, orderBy: { revisionNumber: "asc" } });
    expect(after).toEqual(before);
    expect((await prisma.recording.findUniqueOrThrow({ where: { id: recording.id } })).status).toBe("ARCHIVED");
  }, T);
});

describe("5. a partial failure leaves nothing inconsistent, and a re-run completes the load", () => {
  it("rolls the whole YouTube mirror import back when one record is invalid", async () => {
    const first = { ...fixtures.videos[0], youtubeVideoId: `atomic1-${TOKEN}`, playlistMemberships: [] };
    const broken = { ...fixtures.videos[1], youtubeVideoId: `atomic2-${TOKEN}`, playlistMemberships: [], durationSeconds: "not a number" as unknown as number };
    await expect(importYouTubeMirror({ videos: [first, broken], playlists: [] })).rejects.toThrow();
    expect(await prisma.youTubeVideo.count({ where: { youtubeVideoId: { in: [first.youtubeVideoId, broken.youtubeVideoId] } } })).toBe(0);
  }, T);

  it("a failure while creating the work leaves no Recording and no half-built work", async () => {
    await wipeLoaded();
    await expect(loadStagingContent(spec, fixtures, { createMusicalWork: async () => { throw new Error("injected failure"); } })).rejects.toThrow("injected failure");
    const c = await counts();
    expect(c).toMatchObject({ composers: 1, works: 0, programmes: 0, programmeItems: 0, recordings: 0, revisionWorks: 0 });
    expect(await recordingState()).toBeNull();
  }, T);

  it("a failure while attaching the work leaves an ordinary DRAFT with its video and title, and no orphan work link", async () => {
    await expect(loadStagingContent(spec, fixtures, { attachWorkToRevision: async () => { throw new Error("injected failure"); } })).rejects.toThrow("injected failure");
    const recording = (await recordingState())!;
    expect(recording.status).toBe("DRAFT");
    expect(recording.currentPublishedRevisionId).toBeNull();
    expect(recording.currentDraftRevision!.title).toBe(spec.recording.title);
    expect(recording.currentDraftRevision!.mediaResources).toHaveLength(1);
    expect(recording.currentDraftRevision!.works).toHaveLength(0);
    expect((await counts()).recordings).toBe(1);
  }, T);

  it("the next run completes the same draft: still exactly one Recording, now with its work", async () => {
    const draftBefore = (await recordingState())!;
    const report = await loadStagingContent(spec, fixtures);
    expect(report.steps.find((s) => s.entity === "Recording")?.outcome).toBe("EXISTING");
    expect(report.steps.find((s) => s.entity === "RecordingRevision.work")?.outcome).toBe("FILLED");
    const recording = (await recordingState())!;
    expect(recording.id).toBe(draftBefore.id);
    expect(recording.status).toBe("DRAFT");
    expect(recording.currentDraftRevision!.works).toHaveLength(1);
    expect(await counts()).toMatchObject({ composers: 1, works: 1, programmes: 1, programmeItems: 1, recordings: 1, revisionWorks: 1, actors: 1 });
  }, T);
});

describe("6. the stored state of the video decides, and a Recording started meanwhile is adopted", () => {
  const setVideo = (data: { privacyStatus?: string; observabilityState?: "OBSERVED" | "NOT_OBSERVED" }) => prisma.youTubeVideo.update({ where: { youtubeVideoId: ZEQ }, data });

  it("refuses when the database says the video is no longer public, whatever the fixture says, and writes nothing", async () => {
    await setVideo({ privacyStatus: "unlisted" });
    try {
      const before = await counts();
      await expect(loadStagingContent(spec, fixtures)).rejects.toThrow(/stored privacy of video zEQmnmwr5UE is unlisted, not public/);
      expect(await counts()).toEqual(before);
    } finally {
      await setVideo({ privacyStatus: "public" });
    }
  }, T);

  it("refuses when the video is not OBSERVED in the synchronized catalogue", async () => {
    await setVideo({ observabilityState: "NOT_OBSERVED" });
    try {
      await expect(loadStagingContent(spec, fixtures)).rejects.toThrow(/NOT_OBSERVED in the synchronized catalogue/);
    } finally {
      await setVideo({ observabilityState: "OBSERVED" });
    }
  }, T);

  it("adopts the Recording another run linked between the lookup and the intake, instead of failing or making a second one", async () => {
    const before = await recordingState();
    const report = await loadStagingContent(spec, fixtures, { findRecordingLinkedToYouTubeVideo: async () => null });
    const step = report.steps.find((s) => s.entity === "Recording");
    expect(step).toMatchObject({ outcome: "EXISTING", slug: before!.slug });
    expect(step?.detail).toMatch(/while this run was in progress/);
    expect((await counts()).recordings).toBe(1);
  }, T);
});

describe("7. --mirror existing: the mirror comes from the full YouTube sync and the loader imports nothing", () => {
  const videoFingerprint = async () => JSON.stringify((await prisma.youTubeVideo.findMany({ where: { id: { in: await internalVideoIds() } }, orderBy: { youtubeVideoId: "asc" } })).map((v) => [v.youtubeVideoId, v.updatedAt.toISOString(), v.title, v.privacyStatus, v.observabilityState]));

  it("refuses when the video is not in the database, and writes nothing at all", async () => {
    await wipeLoaded();
    await removeRealYouTubeFixtures();
    await expect(loadStagingContent(spec, fixtures, {}, { mirror: "existing" })).rejects.toThrow(/is not in the database\. Run the YouTube full sync first/);
    expect(await counts()).toMatchObject({ videos: 0, playlists: 0, memberships: 0, composers: 0, works: 0, programmes: 0, recordings: 0 });
  }, T);

  it("with the mirror present (as the sync leaves it) it creates the catalogue and the DRAFT, and leaves every mirror row exactly as it found it", async () => {
    await importYouTubeMirror(fixtures); // stands in for the full sync having filled the mirror
    const before = await videoFingerprint();
    const mirrorBefore = await counts();
    const report = await loadStagingContent(spec, fixtures, {}, { mirror: "existing" });
    expect(report.mirrorMode).toBe("existing");
    expect(report.mirror).toEqual({ videosCreated: 0, videosExisting: 0, playlistsCreated: 0, playlistsExisting: 0, membershipsCreated: 0 });
    expect(report.steps.find((s) => s.entity === "Recording")?.outcome).toBe("CREATED");
    expect(await videoFingerprint()).toBe(before);
    expect(await counts()).toMatchObject({ videos: mirrorBefore.videos, playlists: mirrorBefore.playlists, memberships: mirrorBefore.memberships, composers: 1, works: 1, programmes: 1, recordings: 1 });
    expect((await recordingState())!.status).toBe("DRAFT");
  }, T);

  it("refuses a video the sync has flagged NOT_OBSERVED", async () => {
    await prisma.youTubeVideo.update({ where: { youtubeVideoId: ZEQ }, data: { observabilityState: "NOT_OBSERVED" } });
    try {
      await expect(loadStagingContent(spec, fixtures, {}, { mirror: "existing" })).rejects.toThrow(/NOT_OBSERVED/);
    } finally {
      await prisma.youTubeVideo.update({ where: { youtubeVideoId: ZEQ }, data: { observabilityState: "OBSERVED" } });
    }
  }, T);
});