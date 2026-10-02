import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../modules/db/client";
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import {
  attachWorkToRevision,
  createDraftRecording,
  forkDraftFromPublished,
  getRecordingRevisionCompletenessReport,
  publishCurrentDraft,
  unpublishRecording,
  updateDraftRevisionContent,
} from "../../modules/db/repositories/recordingRepository";
import { attachMediaToRevision, attachRightsToMedia, findPublishedRecordingSlugForYouTubeVideo } from "../../modules/db/repositories/mediaResourceRepository";
import { createRightsInformation } from "../../modules/db/repositories/rightsInformationRepository";
import { getPublicRecordingPageData } from "../../modules/db/repositories/entityRelationshipsRepository";
import { isReadyToPublish } from "../../modules/mmke/completeness/checkRecordingRevisionCompleteness";

// Phase 6I-2 — forkDraftFromPublished must carry a published revision's
// relationships forward (Works, MediaResources incl. the YouTube link and
// rights link) and must not take a live Recording offline. Real database,
// unique disposable fixtures only.

const TAG = "phase6i2fork";
const T = 120000;

let userIds: string[] = [];
let videoIds: string[] = [];
let composerIds: string[] = [];
let recordingIds: string[] = [];
let rightsIds: string[] = [];

async function createUser() {
  const user = await prisma.studioUser.create({
    data: { id: randomUUID(), email: `${randomUUID()}-${TAG}-integration-test@musicmadras.test`, name: "Phase 6I-2 Fork Test User", role: "EDITOR", status: "ACTIVE" },
  });
  userIds.push(user.id);
  return user;
}

async function createPublishedRecordingWithRelationships() {
  const user = await createUser();
  const token = randomUUID().slice(0, 8);
  const composer = await createComposer({ slug: `${TAG}-composer-${token}`, name: `Test Composer ${token}`, actorId: user.id });
  composerIds.push(composer.id);
  const workA = await createMusicalWork({ slug: `${TAG}-work-a-${token}`, title: `Work A ${token}`, composerId: composer.id, actorId: user.id });
  const workB = await createMusicalWork({ slug: `${TAG}-work-b-${token}`, title: `Work B ${token}`, composerId: composer.id, actorId: user.id });
  const video = await prisma.youTubeVideo.create({
    data: { youtubeVideoId: `${TAG}-${token}`, title: `Fork Test Video ${token}`, description: "A description.", privacyStatus: "public", observabilityState: "OBSERVED" },
  });
  videoIds.push(video.id);
  const rights = await createRightsInformation({ holder: `${TAG} holder ${token}`, actorId: user.id });
  rightsIds.push(rights.id);

  const draft = await createDraftRecording({ slug: `${TAG}-recording-${token}`, actorId: user.id, title: `Fork Recording ${token}`, description: "Published description." });
  recordingIds.push(draft.id);
  const revisionId = draft.currentDraftRevision!.id;
  await attachWorkToRevision(revisionId, workA.id, user.id);
  await attachWorkToRevision(revisionId, workB.id, user.id);
  const primary = await attachMediaToRevision({
    recordingRevisionId: revisionId,
    provider: "YOUTUBE",
    role: "PRIMARY_VIDEO",
    url: `https://www.youtube.com/watch?v=${video.youtubeVideoId}`,
    providerResourceId: video.youtubeVideoId,
    youtubeVideoId: video.id,
    actorId: user.id,
  });
  await attachRightsToMedia(primary.id, rights.id, user.id);
  await attachMediaToRevision({ recordingRevisionId: revisionId, provider: "UPLOAD", role: "THUMBNAIL", url: "https://example.org/thumb.png", actorId: user.id });
  const published = await publishCurrentDraft(draft.id, user.id);

  return { user, video, rights, workA, workB, recording: { id: published.id, slug: published.slug }, publishedRevisionId: published.currentPublishedRevisionId! };
}

async function cleanup() {
  if (recordingIds.length > 0) {
    const revisions = await prisma.recordingRevision.findMany({ where: { recordingId: { in: recordingIds } }, select: { id: true } });
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "Recording", entityId: { in: recordingIds } } });
    if (revisions.length > 0) await prisma.auditLogEntry.deleteMany({ where: { entityType: "RecordingRevision", entityId: { in: revisions.map((r) => r.id) } } });
    await prisma.recording.deleteMany({ where: { id: { in: recordingIds } } });
  }
  if (rightsIds.length > 0) {
    await prisma.auditLogEntry.deleteMany({ where: { entityType: { in: ["RightsInformation", "MediaResource"] }, entityId: { in: rightsIds } } });
    await prisma.rightsInformation.deleteMany({ where: { id: { in: rightsIds } } });
  }
  if (composerIds.length > 0) {
    const works = await prisma.musicalWork.findMany({ where: { composerId: { in: composerIds } }, select: { id: true } });
    if (works.length > 0) {
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "MusicalWork", entityId: { in: works.map((w) => w.id) } } });
      await prisma.musicalWork.deleteMany({ where: { composerId: { in: composerIds } } });
    }
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "Composer", entityId: { in: composerIds } } });
    await prisma.composer.deleteMany({ where: { id: { in: composerIds } } });
  }
  if (videoIds.length > 0) await prisma.youTubeVideo.deleteMany({ where: { id: { in: videoIds } } });
  if (userIds.length > 0) await prisma.studioUser.deleteMany({ where: { id: { in: userIds } } });
  userIds = [];
  videoIds = [];
  composerIds = [];
  recordingIds = [];
  rightsIds = [];
}

afterEach(cleanup);

describe("forkDraftFromPublished — relationship preservation", () => {
  it("carries every Work (with its order) and every MediaResource (role, provider, url, YouTube link, rights link) into the new draft", async () => {
    const f = await createPublishedRecordingWithRelationships();
    const publishedWorks = await prisma.recordingRevisionWork.findMany({ where: { revisionId: f.publishedRevisionId }, orderBy: { order: "asc" } });
    const publishedMedia = await prisma.mediaResource.findMany({ where: { recordingRevisionId: f.publishedRevisionId }, orderBy: { role: "asc" } });
    expect(publishedWorks).toHaveLength(2);
    expect(publishedMedia).toHaveLength(2);

    const draft = await forkDraftFromPublished(f.recording.id, f.user.id);

    const draftWorks = await prisma.recordingRevisionWork.findMany({ where: { revisionId: draft.id }, orderBy: { order: "asc" } });
    expect(draftWorks.map((w) => [w.musicalWorkId, w.order, w.catalogueNumberOverride])).toEqual(
      publishedWorks.map((w) => [w.musicalWorkId, w.order, w.catalogueNumberOverride])
    );

    const draftMedia = await prisma.mediaResource.findMany({ where: { recordingRevisionId: draft.id }, orderBy: { role: "asc" } });
    expect(draftMedia).toHaveLength(2);
    draftMedia.forEach((media, i) => {
      const source = publishedMedia[i];
      expect(media.id).not.toBe(source.id); // distinct rows — editing the draft's media can never alter the published revision's
      expect([media.role, media.provider, media.url, media.providerResourceId, media.youtubeVideoId, media.rightsInformationId]).toEqual([
        source.role,
        source.provider,
        source.url,
        source.providerResourceId,
        source.youtubeVideoId,
        source.rightsInformationId,
      ]);
    });
    const primary = draftMedia.find((m) => m.role === "PRIMARY_VIDEO")!;
    expect(primary.youtubeVideoId).toBe(f.video.id);
    expect(primary.rightsInformationId).toBe(f.rights.id);
  }, T);

  it("leaves the published revision and its relationships untouched", async () => {
    const f = await createPublishedRecordingWithRelationships();
    const before = await prisma.recordingRevision.findUniqueOrThrow({ where: { id: f.publishedRevisionId } });

    const draft = await forkDraftFromPublished(f.recording.id, f.user.id);
    // Remove media from the DRAFT only — the published revision must keep its own.
    await prisma.mediaResource.deleteMany({ where: { recordingRevisionId: draft.id } });

    expect(await prisma.recordingRevision.findUniqueOrThrow({ where: { id: f.publishedRevisionId } })).toEqual(before);
    expect(await prisma.mediaResource.count({ where: { recordingRevisionId: f.publishedRevisionId } })).toBe(2);
    expect(await prisma.recordingRevisionWork.count({ where: { revisionId: f.publishedRevisionId } })).toBe(2);
  }, T);

  it("yields a draft that already passes the completeness gate (Works and Media are REQUIRED) without any manual re-attachment", async () => {
    const f = await createPublishedRecordingWithRelationships();
    const draft = await forkDraftFromPublished(f.recording.id, f.user.id);

    const report = await getRecordingRevisionCompletenessReport(draft.id);
    expect(report).not.toBeNull();
    expect(isReadyToPublish(report!.report)).toBe(true);
  }, T);

  it("records how many relationships were carried forward in the audit entry", async () => {
    const f = await createPublishedRecordingWithRelationships();
    const draft = await forkDraftFromPublished(f.recording.id, f.user.id);

    const entry = await prisma.auditLogEntry.findFirstOrThrow({ where: { entityType: "Recording", entityId: f.recording.id, action: "RECORDING_DRAFT_FORKED_FROM_PUBLISHED" } });
    expect(entry.afterSnapshot).toMatchObject({ newDraftRevisionId: draft.id, copiedWorkCount: 2, copiedMediaCount: 2 });
  }, T);
});

describe("forkDraftFromPublished — public visibility during an edit", () => {
  it("keeps a PUBLISHED Recording PUBLISHED and publicly live, serving the published revision, while the draft is open and edited", async () => {
    const f = await createPublishedRecordingWithRelationships();
    const before = await getPublicRecordingPageData(f.recording.slug);
    expect(before?.description).toBe("Published description.");

    const draft = await forkDraftFromPublished(f.recording.id, f.user.id);
    await updateDraftRevisionContent(f.recording.id, draft.updatedAt, f.user.id, { description: "A draft-only description." });

    const recording = await prisma.recording.findUniqueOrThrow({ where: { id: f.recording.id } });
    expect(recording.status).toBe("PUBLISHED");
    expect(recording.currentPublishedRevisionId).toBe(f.publishedRevisionId);
    expect(recording.currentDraftRevisionId).toBe(draft.id);

    const during = await getPublicRecordingPageData(f.recording.slug);
    expect(during).not.toBeNull();
    expect(during?.description).toBe("Published description.");
    expect(await findPublishedRecordingSlugForYouTubeVideo(f.video.id)).toBe(f.recording.slug);
  }, T);

  it("after the normal publish step, the new revision is live with its Works and YouTube link, and the old one is superseded", async () => {
    const f = await createPublishedRecordingWithRelationships();
    const draft = await forkDraftFromPublished(f.recording.id, f.user.id);
    await updateDraftRevisionContent(f.recording.id, draft.updatedAt, f.user.id, { description: "Republished description." });
    await publishCurrentDraft(f.recording.id, f.user.id);

    const page = await getPublicRecordingPageData(f.recording.slug);
    expect(page?.description).toBe("Republished description.");
    expect(await findPublishedRecordingSlugForYouTubeVideo(f.video.id)).toBe(f.recording.slug);
    expect((await prisma.recordingRevision.findUniqueOrThrow({ where: { id: f.publishedRevisionId } })).revisionStatus).toBe("SUPERSEDED");
    expect(await prisma.recordingRevisionWork.count({ where: { revisionId: draft.id } })).toBe(2);
  }, T);

  it("still lands a NON-published Recording in IN_REVIEW (forking never makes a non-public Recording public)", async () => {
    const f = await createPublishedRecordingWithRelationships();
    await unpublishRecording(f.recording.id, f.user.id); // status DRAFT, published pointer retained

    const draft = await forkDraftFromPublished(f.recording.id, f.user.id);
    const recording = await prisma.recording.findUniqueOrThrow({ where: { id: f.recording.id } });
    expect(recording.status).toBe("IN_REVIEW");
    expect(await getPublicRecordingPageData(f.recording.slug)).toBeNull();
    expect(await prisma.recordingRevisionWork.count({ where: { revisionId: draft.id } })).toBe(2); // relationships carried regardless of status
  }, T);
});
