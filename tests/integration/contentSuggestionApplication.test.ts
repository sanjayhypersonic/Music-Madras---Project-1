import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

// Must be at the true top level — vi.mock is hoisted above every import.
const mockGetCurrentStudioSession = vi.fn();
const { mockCan } = vi.hoisted(() => ({ mockCan: vi.fn() }));
vi.mock("../../modules/auth/authService", () => ({
  getCurrentStudioSession: () => mockGetCurrentStudioSession(),
}));
// Real `can` by default; one test overrides it once to prove the action honors
// a permission DENIAL (every defined Studio role holds RECORDING_WRITE).
vi.mock("../../modules/auth/policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../modules/auth/policy")>();
  mockCan.mockImplementation(actual.can);
  return { ...actual, can: mockCan };
});

import { prisma } from "../../modules/db/client";
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import { attachWorkToRevision, forkDraftFromPublished, publishCurrentDraft } from "../../modules/db/repositories/recordingRepository";
import { createRecordingFromYouTubeVideo } from "../../modules/db/repositories/recordingIntakeRepository";
import { generateRecordingEditorialSuggestion } from "../../modules/ai/gateway/generateRecordingEditorialSuggestion";
import { FakeAIProvider } from "../../modules/ai/providers/fake/fakeAIProvider";
import {
  approveContentSuggestion,
  rejectContentSuggestion,
  requestContentSuggestionChanges,
  submitSuggestionForReview,
} from "../../modules/db/repositories/contentSuggestionRepository";
import { applyApprovedContentSuggestion, findContentSuggestionApplication } from "../../modules/db/repositories/contentSuggestionApplicationRepository";
import { describeApplyRefusalForEditor } from "../../modules/mmke/contentIntelligence/applyContentSuggestionRefusal";
import { approveSource, attachSourceToEntity, createSource } from "../../modules/db/repositories/sourceRepository";
import { createCitation } from "../../modules/db/repositories/citationRepository";
import { findPublishedRecordingSlugForYouTubeVideo } from "../../modules/db/repositories/mediaResourceRepository";
import { getPublicRecordingPageData } from "../../modules/db/repositories/entityRelationshipsRepository";
import { listPublicRecordingSitemapEntries } from "../../modules/db/repositories/sitemapRepository";
import { searchRecordings } from "../../modules/db/repositories/archiveSearchRepository";
import { applyToRecordingDraftAction } from "../../app/(studio)/studio/(protected)/content-suggestions/[id]/actions";

// Phase 6I-2 — applying an APPROVED ContentSuggestion to a Recording draft.
// Real database, disposable fixtures only. The fixture follows the real path
// end to end: a synced YouTube video -> 6I-1 intake -> Work attached ->
// published -> suggestion generated (FakeAIProvider only; no real provider, no
// network) -> reviewed -> approved. Assertions are scoped to each test's own
// records, never global row counts, because other integration files run in
// parallel against the same database.

const TAG = "phase6i2";
const T = 120000;

interface Fixture {
  user: { id: string };
  video: { id: string; youtubeVideoId: string };
  composer: { id: string };
  work: { id: string };
  recording: { id: string; slug: string };
  publishedRevisionId: string;
}

let userIds: string[] = [];
let videoIds: string[] = [];
let composerIds: string[] = [];
let recordingIds: string[] = [];
let sourceIds: string[] = [];

async function createUser(role: "EDITOR" | "CONTRIBUTOR" = "EDITOR") {
  const user = await prisma.studioUser.create({
    data: { id: randomUUID(), email: `${randomUUID()}-${TAG}-integration-test@musicmadras.test`, name: "Phase 6I-2 Test User", role, status: "ACTIVE" },
  });
  userIds.push(user.id);
  return user;
}

/** published Recording (works + PRIMARY_VIDEO on the published revision), reached through the real 6I-1 intake. */
async function createPublishedRecording(): Promise<Fixture> {
  const user = await createUser();
  const token = randomUUID().slice(0, 8);
  const video = await prisma.youTubeVideo.create({
    data: {
      youtubeVideoId: `${TAG}-${token}`,
      title: `Phase6i2 Concert ${token}`,
      description: `Recorded live.\n#choir #${token}`,
      privacyStatus: "public",
      observabilityState: "OBSERVED",
    },
  });
  videoIds.push(video.id);

  const intake = await createRecordingFromYouTubeVideo({ youtubeVideoId: video.id, actorId: user.id });
  if (!intake.ok) throw new Error("intake failed");
  recordingIds.push(intake.recording.id);

  const composer = await createComposer({ slug: `${TAG}-composer-${token}`, name: `Test Composer ${token}`, actorId: user.id });
  composerIds.push(composer.id);
  const work = await createMusicalWork({ slug: `${TAG}-work-${token}`, title: `Test Work ${token}`, composerId: composer.id, actorId: user.id });
  await attachWorkToRevision(intake.recording.currentDraftRevision!.id, work.id, user.id);
  const published = await publishCurrentDraft(intake.recording.id, user.id);

  return {
    user,
    video,
    composer,
    work,
    recording: { id: published.id, slug: published.slug },
    publishedRevisionId: published.currentPublishedRevisionId!,
  };
}

async function generateSuggestion(fixture: Fixture, targetField: string, content: string) {
  const result = await generateRecordingEditorialSuggestion({
    recordingId: fixture.recording.id,
    requestedById: fixture.user.id,
    provider: new FakeAIProvider({
      mode: "SUCCESS",
      output: { outputType: "SUGGESTION", proposedContent: content, targetField, evidenceEntityIds: [fixture.work.id], missingField: null, whyItMatters: null, requestedAction: null },
    }),
  });
  if (!result.ok) throw new Error(`generation failed: ${result.reason}`);
  return result.suggestion;
}

async function generateApproved(fixture: Fixture, targetField: string, content: string, finalContent?: string) {
  const suggestion = await generateSuggestion(fixture, targetField, content);
  await submitSuggestionForReview(suggestion.id, fixture.user.id);
  return approveContentSuggestion(suggestion.id, fixture.user.id, { finalContent: finalContent ?? null });
}

async function cleanup() {
  if (recordingIds.length > 0) {
    const suggestionIdsToDelete = (await prisma.contentSuggestion.findMany({ where: { targetEntityId: { in: recordingIds } }, select: { id: true } })).map((s) => s.id);
    const requestIds = (await prisma.contentGenerationRequest.findMany({ where: { targetEntityId: { in: recordingIds } }, select: { id: true } })).map((r) => r.id);
    if (suggestionIdsToDelete.length > 0) await prisma.auditLogEntry.deleteMany({ where: { entityType: "ContentSuggestion", entityId: { in: suggestionIdsToDelete } } });
    if (requestIds.length > 0) await prisma.auditLogEntry.deleteMany({ where: { entityType: "ContentGenerationRequest", entityId: { in: requestIds } } });
    await prisma.contentSuggestion.deleteMany({ where: { targetEntityId: { in: recordingIds } } });
    await prisma.contentGenerationRequest.deleteMany({ where: { targetEntityId: { in: recordingIds } } });

    const revisions = await prisma.recordingRevision.findMany({ where: { recordingId: { in: recordingIds } }, select: { id: true } });
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "Recording", entityId: { in: recordingIds } } });
    if (revisions.length > 0) await prisma.auditLogEntry.deleteMany({ where: { entityType: "RecordingRevision", entityId: { in: revisions.map((r) => r.id) } } });
    await prisma.recording.deleteMany({ where: { id: { in: recordingIds } } });
  }
  for (const sourceId of sourceIds) {
    await prisma.citation.deleteMany({ where: { sourceId } });
    await prisma.entitySource.deleteMany({ where: { sourceId } });
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "Source", entityId: sourceId } });
    await prisma.source.delete({ where: { id: sourceId } }).catch(() => {});
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
  sourceIds = [];
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

async function runAction(suggestionId: string): Promise<string> {
  try {
    await applyToRecordingDraftAction(suggestionId);
  } catch (err) {
    return extractRedirectPath(err);
  }
  throw new Error("Action did not redirect");
}

afterEach(cleanup);

const GUIDE = "educationalListeningGuide";

describe("A. Only an APPROVED suggestion can be applied", () => {
  it("applies an approved suggestion (forking a draft from the published revision)", async () => {
    const f = await createPublishedRecording();
    const suggestion = await generateApproved(f, GUIDE, "A careful listening guide.");

    const result = await applyApprovedContentSuggestion({ suggestionId: suggestion.id, actorId: f.user.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.targetField).toBe(GUIDE);
    expect(result.forkedDraft).toBe(true);
  }, T);

  it("applies to the existing draft when one is already open (no second draft is forked)", async () => {
    const f = await createPublishedRecording();
    const draft = await forkDraftFromPublished(f.recording.id, f.user.id);
    const suggestion = await generateApproved(f, GUIDE, "Content for the open draft.");

    const result = await applyApprovedContentSuggestion({ suggestionId: suggestion.id, actorId: f.user.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.forkedDraft).toBe(false);
    expect(result.recordingRevisionId).toBe(draft.id);
    expect(await prisma.recordingRevision.count({ where: { recordingId: f.recording.id } })).toBe(2);
  }, T);

  it.each([
    ["DRAFT_READY", async () => {}],
    [
      "EDITOR_REVIEW",
      async (id: string, actor: string) => {
        await submitSuggestionForReview(id, actor);
      },
    ],
    [
      "REJECTED",
      async (id: string, actor: string) => {
        await submitSuggestionForReview(id, actor);
        await rejectContentSuggestion(id, actor, { reason: "OTHER" });
      },
    ],
    [
      "CHANGES_REQUESTED",
      async (id: string, actor: string) => {
        await submitSuggestionForReview(id, actor);
        await requestContentSuggestionChanges(id, actor, "Please reword.");
      },
    ],
  ])("refuses a %s suggestion, changing nothing", async (status, moveTo) => {
    const f = await createPublishedRecording();
    const suggestion = await generateSuggestion(f, GUIDE, "Not approved content.");
    await moveTo(suggestion.id, f.user.id);
    expect((await prisma.contentSuggestion.findUniqueOrThrow({ where: { id: suggestion.id } })).status).toBe(status);

    const result = await applyApprovedContentSuggestion({ suggestionId: suggestion.id, actorId: f.user.id });
    expect(result).toEqual({ ok: false, reason: "NOT_APPROVED" });

    const recording = await prisma.recording.findUniqueOrThrow({ where: { id: f.recording.id } });
    expect(recording.currentDraftRevisionId).toBeNull();
    expect(await prisma.auditLogEntry.count({ where: { entityType: "ContentSuggestion", entityId: suggestion.id, action: "CONTENT_SUGGESTION_APPLIED" } })).toBe(0);
  }, T);

  it("refuses an approved suggestion that does not target an applicable editorial field (an INFORMATION_GAP)", async () => {
    const f = await createPublishedRecording();
    const gap = await generateRecordingEditorialSuggestion({
      recordingId: f.recording.id,
      requestedById: f.user.id,
      provider: new FakeAIProvider(), // default output is an INFORMATION_GAP
    });
    if (!gap.ok) throw new Error("generation failed");
    await submitSuggestionForReview(gap.suggestion.id, f.user.id);
    await approveContentSuggestion(gap.suggestion.id, f.user.id);

    expect(await applyApprovedContentSuggestion({ suggestionId: gap.suggestion.id, actorId: f.user.id })).toEqual({ ok: false, reason: "UNSUPPORTED_TARGET" });
    expect((await prisma.recording.findUniqueOrThrow({ where: { id: f.recording.id } })).currentDraftRevisionId).toBeNull();
  }, T);

  it("refuses an unknown suggestion id", async () => {
    const f = await createPublishedRecording();
    expect(await applyApprovedContentSuggestion({ suggestionId: randomUUID(), actorId: f.user.id })).toEqual({ ok: false, reason: "SUGGESTION_NOT_FOUND" });
  }, T);
});

describe("B. What is written", () => {
  it("applies finalContent when the editor edited, and leaves proposedContent untouched on the suggestion", async () => {
    const f = await createPublishedRecording();
    const suggestion = await generateApproved(f, GUIDE, "Original AI wording.", "The editor's own wording.");

    const result = await applyApprovedContentSuggestion({ suggestionId: suggestion.id, actorId: f.user.id });
    if (!result.ok) throw new Error(`apply refused: ${result.reason}`);
    expect(result.contentSource).toBe("finalContent");

    const revision = await prisma.recordingRevision.findUniqueOrThrow({ where: { id: result.recordingRevisionId } });
    expect(revision.educationalListeningGuide).toBe("The editor's own wording.");
    const after = await prisma.contentSuggestion.findUniqueOrThrow({ where: { id: suggestion.id } });
    expect(after.proposedContent).toBe("Original AI wording.");
    expect(after.status).toBe("APPROVED");
  }, T);

  it("applies proposedContent when there is no finalContent", async () => {
    const f = await createPublishedRecording();
    const suggestion = await generateApproved(f, "description", "Proposed description text.");

    const result = await applyApprovedContentSuggestion({ suggestionId: suggestion.id, actorId: f.user.id });
    if (!result.ok) throw new Error(`apply refused: ${result.reason}`);
    expect(result.contentSource).toBe("proposedContent");
    expect((await prisma.recordingRevision.findUniqueOrThrow({ where: { id: result.recordingRevisionId } })).description).toBe("Proposed description text.");
  }, T);

  it.each(["description", "educationalListeningGuide", "educationalAnalysis", "seoMetaTitle", "seoMetaDescription"] as const)(
    "changes only %s — every other editorial column, the Recording, its Works and its media stay identical to the published revision",
    async (field) => {
      const f = await createPublishedRecording();
      const publishedBefore = await prisma.recordingRevision.findUniqueOrThrow({ where: { id: f.publishedRevisionId } });
      const recordingBefore = await prisma.recording.findUniqueOrThrow({ where: { id: f.recording.id } });
      const suggestion = await generateApproved(f, field, `Applied ${field} text.`);

      const result = await applyApprovedContentSuggestion({ suggestionId: suggestion.id, actorId: f.user.id });
      if (!result.ok) throw new Error(`apply refused: ${result.reason}`);

      const draft = await prisma.recordingRevision.findUniqueOrThrow({ where: { id: result.recordingRevisionId } });
      const editorial = ["title", "description", "performanceId", "seoMetaTitle", "seoMetaDescription", "seoCanonicalPath", "educationalDifficultyLevel", "educationalListeningGuide", "educationalAnalysis"] as const;
      for (const column of editorial) {
        if (column === field) expect(draft[column]).toBe(`Applied ${field} text.`);
        else expect(draft[column]).toBe(publishedBefore[column]);
      }

      const recordingAfter = await prisma.recording.findUniqueOrThrow({ where: { id: f.recording.id } });
      expect(recordingAfter.slug).toBe(recordingBefore.slug);
      expect(recordingAfter.createdById).toBe(recordingBefore.createdById);
      expect(recordingAfter.currentPublishedRevisionId).toBe(f.publishedRevisionId);
    },
    T
  );
});

describe("C. Staleness gate — stale AI content is never applied", () => {
  async function expectRefusedAndUntouched(f: Fixture, suggestionId: string, reason: string) {
    const generationRequestsBefore = await prisma.contentGenerationRequest.count({ where: { targetEntityId: f.recording.id } });
    const before = await prisma.contentSuggestion.findUniqueOrThrow({ where: { id: suggestionId } });

    const result = await applyApprovedContentSuggestion({ suggestionId, actorId: f.user.id });
    expect(result).toEqual({ ok: false, reason });

    const recording = await prisma.recording.findUniqueOrThrow({ where: { id: f.recording.id } });
    expect(recording.currentDraftRevisionId).toBeNull(); // nothing forked
    expect(recording.currentPublishedRevisionId).toBe(f.publishedRevisionId); // nothing published
    expect(await prisma.contentGenerationRequest.count({ where: { targetEntityId: f.recording.id } })).toBe(generationRequestsBefore); // nothing regenerated
    const after = await prisma.contentSuggestion.findUniqueOrThrow({ where: { id: suggestionId } });
    expect(after.status).toBe("APPROVED"); // review state untouched
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(await prisma.auditLogEntry.count({ where: { entityType: "ContentSuggestion", entityId: suggestionId, action: "CONTENT_SUGGESTION_APPLIED" } })).toBe(0);
    expect(await prisma.auditLogEntry.count({ where: { entityType: "ContentSuggestion", entityId: suggestionId, action: "CONTENT_SUGGESTION_APPLY_REFUSED" } })).toBeGreaterThan(0);
  }

  it("applies while the context is unchanged (the current fingerprint matches the generation fingerprint)", async () => {
    const f = await createPublishedRecording();
    const suggestion = await generateApproved(f, GUIDE, "Fresh content.");
    expect((await applyApprovedContentSuggestion({ suggestionId: suggestion.id, actorId: f.user.id })).ok).toBe(true);
  }, T);

  it("refuses when the Recording's canonical context changed after generation", async () => {
    const f = await createPublishedRecording();
    const suggestion = await generateApproved(f, GUIDE, "Content generated before a change.");
    await prisma.recordingRevision.update({ where: { id: f.publishedRevisionId }, data: { description: "Changed after generation." } });

    await expectRefusedAndUntouched(f, suggestion.id, "CONTENT_SUGGESTION_STALE");
  }, T);

  it("refuses when the synced YouTube description changed after generation", async () => {
    const f = await createPublishedRecording();
    const suggestion = await generateApproved(f, GUIDE, "Content generated before the video changed.");
    await prisma.youTubeVideo.update({ where: { id: f.video.id }, data: { description: "A different description on YouTube now." } });

    await expectRefusedAndUntouched(f, suggestion.id, "CONTENT_SUGGESTION_STALE");
  }, T);

  it("refuses when an approved external Citation changed after generation", async () => {
    const f = await createPublishedRecording();
    const source = await createSource({ title: `${TAG} source ${randomUUID().slice(0, 8)}`, actorId: f.user.id });
    sourceIds.push(source.id);
    await attachSourceToEntity({ entityType: "WORK", entityId: f.work.id, sourceId: source.id, actorId: f.user.id });
    await approveSource(source.id, f.user.id);
    const citation = await createCitation({ text: "Original evidence text.", sourceId: source.id, actorId: f.user.id });

    const suggestion = await generateApproved(f, GUIDE, "Content grounded in the original citation.");
    await prisma.citation.update({ where: { id: citation.id }, data: { text: "Evidence text that changed since." } });

    await expectRefusedAndUntouched(f, suggestion.id, "CONTENT_SUGGESTION_STALE");
  }, T);

  it("refuses when freshness cannot be verified (no fingerprint was recorded)", async () => {
    const f = await createPublishedRecording();
    const suggestion = await generateApproved(f, GUIDE, "Content with no recorded fingerprint.");
    await prisma.contentGenerationRequest.update({ where: { id: suggestion.generationRequestId }, data: { contextFingerprint: null } });

    await expectRefusedAndUntouched(f, suggestion.id, "FRESHNESS_UNKNOWN");
  }, T);

  it("refuses safely, creating no malformed revision, when the Recording has neither a draft nor a published revision", async () => {
    const f = await createPublishedRecording();
    const suggestion = await generateApproved(f, GUIDE, "Content for a recording that loses its revision pointers.");
    await prisma.recording.update({ where: { id: f.recording.id }, data: { currentPublishedRevisionId: null, currentDraftRevisionId: null } });
    const revisionsBefore = await prisma.recordingRevision.count({ where: { recordingId: f.recording.id } });

    const result = await applyApprovedContentSuggestion({ suggestionId: suggestion.id, actorId: f.user.id });
    expect(result.ok).toBe(false);
    expect(await prisma.recordingRevision.count({ where: { recordingId: f.recording.id } })).toBe(revisionsBefore);
    expect((await prisma.recording.findUniqueOrThrow({ where: { id: f.recording.id } })).currentDraftRevisionId).toBeNull();
  }, T);
});

describe("D. Fork preservation and publication safety", () => {
  it("creates a draft that carries the Works, the PRIMARY_VIDEO and its YouTube link forward, with the published revision untouched", async () => {
    const f = await createPublishedRecording();
    const publishedBefore = await prisma.recordingRevision.findUniqueOrThrow({ where: { id: f.publishedRevisionId } });
    const publishedWorks = await prisma.recordingRevisionWork.findMany({ where: { revisionId: f.publishedRevisionId }, orderBy: { order: "asc" } });
    const publishedMedia = await prisma.mediaResource.findMany({ where: { recordingRevisionId: f.publishedRevisionId } });
    expect(publishedWorks).toHaveLength(1);
    expect(publishedMedia).toHaveLength(1);

    const suggestion = await generateApproved(f, GUIDE, "Draft-bound listening guide.");
    const result = await applyApprovedContentSuggestion({ suggestionId: suggestion.id, actorId: f.user.id });
    if (!result.ok) throw new Error(`apply refused: ${result.reason}`);
    expect(result.forkedDraft).toBe(true);
    expect(result.recordingRevisionId).not.toBe(f.publishedRevisionId);

    const draftWorks = await prisma.recordingRevisionWork.findMany({ where: { revisionId: result.recordingRevisionId }, orderBy: { order: "asc" } });
    expect(draftWorks.map((w) => [w.musicalWorkId, w.order])).toEqual(publishedWorks.map((w) => [w.musicalWorkId, w.order]));

    const draftMedia = await prisma.mediaResource.findMany({ where: { recordingRevisionId: result.recordingRevisionId } });
    expect(draftMedia).toHaveLength(1);
    expect(draftMedia[0].role).toBe("PRIMARY_VIDEO");
    expect(draftMedia[0].provider).toBe("YOUTUBE");
    expect(draftMedia[0].youtubeVideoId).toBe(f.video.id);
    expect(draftMedia[0].providerResourceId).toBe(f.video.youtubeVideoId);
    expect(draftMedia[0].url).toBe(publishedMedia[0].url);

    const publishedAfter = await prisma.recordingRevision.findUniqueOrThrow({ where: { id: f.publishedRevisionId } });
    expect(publishedAfter).toEqual(publishedBefore);
    expect(await prisma.mediaResource.count({ where: { recordingRevisionId: f.publishedRevisionId } })).toBe(1);
    expect(await prisma.recordingRevisionWork.count({ where: { revisionId: f.publishedRevisionId } })).toBe(1);
  }, T);

  it("never publishes: the Recording stays PUBLISHED on the same published revision, with the new draft open", async () => {
    const f = await createPublishedRecording();
    const suggestion = await generateApproved(f, GUIDE, "Content for the draft only.");
    const result = await applyApprovedContentSuggestion({ suggestionId: suggestion.id, actorId: f.user.id });
    if (!result.ok) throw new Error(`apply refused: ${result.reason}`);

    const recording = await prisma.recording.findUniqueOrThrow({ where: { id: f.recording.id } });
    expect(recording.status).toBe("PUBLISHED");
    expect(recording.currentPublishedRevisionId).toBe(f.publishedRevisionId);
    expect(recording.currentDraftRevisionId).toBe(result.recordingRevisionId);
    expect(await prisma.auditLogEntry.count({ where: { entityType: "Recording", entityId: f.recording.id, action: "RECORDING_PUBLISHED" } })).toBe(1); // only the original publish
  }, T);

  it("leaves the public surfaces unchanged until the draft is published through the normal workflow, then reflects it with the YouTube link intact", async () => {
    const f = await createPublishedRecording();
    const token = randomUUID().slice(0, 8);
    const appliedText = `Applied-only-in-draft ${token}`;

    const beforePage = await getPublicRecordingPageData(f.recording.slug);
    expect(beforePage).not.toBeNull();
    const sitemapBefore = (await listPublicRecordingSitemapEntries()).filter((e) => e.slug === f.recording.slug);
    expect(sitemapBefore).toHaveLength(1);

    const suggestion = await generateApproved(f, GUIDE, appliedText);
    const result = await applyApprovedContentSuggestion({ suggestionId: suggestion.id, actorId: f.user.id });
    if (!result.ok) throw new Error(`apply refused: ${result.reason}`);

    // Before publication: the live page still serves the old revision.
    const duringPage = await getPublicRecordingPageData(f.recording.slug);
    expect(duringPage).not.toBeNull();
    expect(duringPage?.educationalListeningGuide).toBe(beforePage?.educationalListeningGuide);
    expect(JSON.stringify(duringPage)).not.toContain(appliedText);
    expect((await listPublicRecordingSitemapEntries()).filter((e) => e.slug === f.recording.slug)).toHaveLength(1);
    // Archive search: the draft-only text is not discoverable, and the Recording is still listed exactly once by its (unchanged) title.
    expect((await searchRecordings(token)).items).toHaveLength(0);
    const title = (await prisma.recordingRevision.findUniqueOrThrow({ where: { id: f.publishedRevisionId } })).title!;
    expect((await searchRecordings(title)).items.filter((r) => r.slug === f.recording.slug)).toHaveLength(1);

    // Publish through the normal, existing workflow.
    await publishCurrentDraft(f.recording.id, f.user.id);

    const afterPage = await getPublicRecordingPageData(f.recording.slug);
    expect(afterPage?.educationalListeningGuide).toBe(appliedText);
    expect(await findPublishedRecordingSlugForYouTubeVideo(f.video.id)).toBe(f.recording.slug); // the YouTube link survived the edit
  }, T);

  it("after publishing, other approved suggestions for the same Recording become stale (the context now contains the new prose) and cannot be applied", async () => {
    const f = await createPublishedRecording();
    const first = await generateApproved(f, GUIDE, "First applied guide.");
    const second = await generateApproved(f, "seoMetaTitle", "A second, separate suggestion.");

    const applied = await applyApprovedContentSuggestion({ suggestionId: first.id, actorId: f.user.id });
    expect(applied.ok).toBe(true);
    // Still current before publication: the PUBLISHED context has not changed yet.
    expect((await applyApprovedContentSuggestion({ suggestionId: second.id, actorId: f.user.id })).ok).toBe(true);

    const third = await generateApproved(f, "seoMetaDescription", "A third suggestion generated pre-publish.");
    await publishCurrentDraft(f.recording.id, f.user.id);
    expect(await applyApprovedContentSuggestion({ suggestionId: third.id, actorId: f.user.id })).toEqual({ ok: false, reason: "CONTENT_SUGGESTION_STALE" });
  }, T);
});

describe("E. Duplicate application", () => {
  it("blocks applying the same suggestion twice and does not touch the draft again", async () => {
    const f = await createPublishedRecording();
    const suggestion = await generateApproved(f, GUIDE, "Apply me once.");

    const first = await applyApprovedContentSuggestion({ suggestionId: suggestion.id, actorId: f.user.id });
    if (!first.ok) throw new Error(`apply refused: ${first.reason}`);
    const draftAfterFirst = await prisma.recordingRevision.findUniqueOrThrow({ where: { id: first.recordingRevisionId } });

    // Someone edits the draft afterwards; a second application must not clobber that.
    await prisma.recordingRevision.update({ where: { id: first.recordingRevisionId }, data: { educationalListeningGuide: "Edited by a human after applying." } });
    const second = await applyApprovedContentSuggestion({ suggestionId: suggestion.id, actorId: f.user.id });
    expect(second).toEqual({ ok: false, reason: "ALREADY_APPLIED" });

    const draftNow = await prisma.recordingRevision.findUniqueOrThrow({ where: { id: first.recordingRevisionId } });
    expect(draftNow.educationalListeningGuide).toBe("Edited by a human after applying.");
    expect(draftAfterFirst.educationalListeningGuide).toBe("Apply me once.");
    expect(await prisma.auditLogEntry.count({ where: { entityType: "ContentSuggestion", entityId: suggestion.id, action: "CONTENT_SUGGESTION_APPLIED" } })).toBe(1);
    expect(await findContentSuggestionApplication(suggestion.id)).not.toBeNull();
  }, T);

  it("two simultaneous applications of one suggestion produce exactly one application and one draft", async () => {
    const f = await createPublishedRecording();
    const suggestion = await generateApproved(f, GUIDE, "Race me.");

    const results = await Promise.all([
      applyApprovedContentSuggestion({ suggestionId: suggestion.id, actorId: f.user.id }),
      applyApprovedContentSuggestion({ suggestionId: suggestion.id, actorId: f.user.id }),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === "ALREADY_APPLIED")).toHaveLength(1);
    expect(await prisma.recordingRevision.count({ where: { recordingId: f.recording.id } })).toBe(2);
    expect(await prisma.auditLogEntry.count({ where: { entityType: "ContentSuggestion", entityId: suggestion.id, action: "CONTENT_SUGGESTION_APPLIED" } })).toBe(1);
  }, T);

  it("two different suggestions applied at once fork exactly one draft between them", async () => {
    const f = await createPublishedRecording();
    const a = await generateApproved(f, GUIDE, "Suggestion A.");
    const b = await generateApproved(f, "seoMetaTitle", "Suggestion B.");

    const results = await Promise.all([
      applyApprovedContentSuggestion({ suggestionId: a.id, actorId: f.user.id }),
      applyApprovedContentSuggestion({ suggestionId: b.id, actorId: f.user.id }),
    ]);

    expect(results.every((r) => r.ok)).toBe(true);
    expect(await prisma.recordingRevision.count({ where: { recordingId: f.recording.id } })).toBe(2);
    const draftId = (await prisma.recording.findUniqueOrThrow({ where: { id: f.recording.id } })).currentDraftRevisionId!;
    const draft = await prisma.recordingRevision.findUniqueOrThrow({ where: { id: draftId } });
    expect(draft.educationalListeningGuide).toBe("Suggestion A.");
    expect(draft.seoMetaTitle).toBe("Suggestion B.");
  }, T);

  // Phase 6J-10D: the apply transaction uses the shared edit-lock protocol, including its 5 s bounded wait.
  /** Holds the per-Recording edit lock (the key every lifecycle operation, save and apply uses) until released. */
  function holdEditLock(recordingId: string) {
    let release!: () => void;
    let acquired!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const got = new Promise<void>((resolve) => (acquired = resolve));
    const done = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`recording-edit:${recordingId}`}))`;
        acquired();
        await released;
      },
      { timeout: 60000, maxWait: 10000 }
    );
    return { got, release, done };
  }

  it("waits for the edit lock while another operation holds it, then applies normally", async () => {
    const f = await createPublishedRecording();
    const suggestion = await generateApproved(f, GUIDE, "Wait for me.");
    const holder = holdEditLock(f.recording.id);
    await holder.got;
    const apply = applyApprovedContentSuggestion({ suggestionId: suggestion.id, actorId: f.user.id });
    let settled = false;
    void apply.then(() => (settled = true), () => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(settled).toBe(false); // blocked on the lock, nothing applied yet
    expect(await prisma.recordingRevision.count({ where: { recordingId: f.recording.id } })).toBe(1);
    holder.release();
    await holder.done;
    const result = await apply;
    expect(result.ok).toBe(true);
    expect(await prisma.recordingRevision.count({ where: { recordingId: f.recording.id } })).toBe(2);
  }, T);

  it("returns the typed BUSY refusal (not a raw error) when the edit lock stays unavailable, and changes nothing", async () => {
    const f = await createPublishedRecording();
    const suggestion = await generateApproved(f, GUIDE, "Busy.");
    const holder = holdEditLock(f.recording.id);
    await holder.got;
    let result: Awaited<ReturnType<typeof applyApprovedContentSuggestion>>;
    try {
      result = await applyApprovedContentSuggestion({ suggestionId: suggestion.id, actorId: f.user.id });
    } finally {
      holder.release();
      await holder.done;
    }
    expect(result).toEqual({ ok: false, reason: "BUSY" });
    expect(describeApplyRefusalForEditor("BUSY")).toMatch(/being changed by someone else/);
    expect(await prisma.recordingRevision.count({ where: { recordingId: f.recording.id } })).toBe(1);
    expect(await prisma.auditLogEntry.count({ where: { entityType: "ContentSuggestion", entityId: suggestion.id, action: "CONTENT_SUGGESTION_APPLIED" } })).toBe(0);
    expect(await findContentSuggestionApplication(suggestion.id)).toBeNull();
    // the suggestion is still applicable once the Recording is free
    expect((await applyApprovedContentSuggestion({ suggestionId: suggestion.id, actorId: f.user.id })).ok).toBe(true);
  }, T);
});

describe("F. Audit", () => {
  it("records the suggestion, Recording, revision, field, actor, content source and context fingerprint — and what was replaced", async () => {
    const f = await createPublishedRecording();
    const suggestion = await generateApproved(f, GUIDE, "Audited content.");
    const generationRequest = await prisma.contentGenerationRequest.findUniqueOrThrow({ where: { id: suggestion.generationRequestId } });

    const result = await applyApprovedContentSuggestion({ suggestionId: suggestion.id, actorId: f.user.id });
    if (!result.ok) throw new Error(`apply refused: ${result.reason}`);

    const onSuggestion = await prisma.auditLogEntry.findFirstOrThrow({ where: { entityType: "ContentSuggestion", entityId: suggestion.id, action: "CONTENT_SUGGESTION_APPLIED" } });
    expect(onSuggestion.actorId).toBe(f.user.id);
    expect(onSuggestion.timestamp).toBeInstanceOf(Date);
    expect(onSuggestion.afterSnapshot).toMatchObject({
      recordingId: f.recording.id,
      recordingRevisionId: result.recordingRevisionId,
      targetField: GUIDE,
      contentSource: "proposedContent",
      forkedDraft: true,
      contextFingerprint: generationRequest.contextFingerprint,
    });

    const onRecording = await prisma.auditLogEntry.findFirstOrThrow({ where: { entityType: "Recording", entityId: f.recording.id, action: "RECORDING_DRAFT_CONTENT_APPLIED" } });
    expect(onRecording.actorId).toBe(f.user.id);
    expect(onRecording.beforeSnapshot).toMatchObject({ [GUIDE]: null });
    expect(onRecording.afterSnapshot).toMatchObject({ [GUIDE]: "Audited content.", recordingRevisionId: result.recordingRevisionId, contentSuggestionId: suggestion.id });

    const fork = await prisma.auditLogEntry.findFirstOrThrow({ where: { entityType: "Recording", entityId: f.recording.id, action: "RECORDING_DRAFT_FORKED_FROM_PUBLISHED" } });
    expect(fork.afterSnapshot).toMatchObject({ newDraftRevisionId: result.recordingRevisionId, copiedWorkCount: 1, copiedMediaCount: 1 });
  }, T);

  it("traces a stale refusal, naming the reason", async () => {
    const f = await createPublishedRecording();
    const suggestion = await generateApproved(f, GUIDE, "About to go stale.");
    await prisma.recordingRevision.update({ where: { id: f.publishedRevisionId }, data: { description: "Changed." } });

    await applyApprovedContentSuggestion({ suggestionId: suggestion.id, actorId: f.user.id });
    const refused = await prisma.auditLogEntry.findFirstOrThrow({ where: { entityType: "ContentSuggestion", entityId: suggestion.id, action: "CONTENT_SUGGESTION_APPLY_REFUSED" } });
    expect(refused.actorId).toBe(f.user.id);
    expect(refused.afterSnapshot).toMatchObject({ reason: "CONTENT_SUGGESTION_STALE" });
  }, T);
});

describe("G. Server Action: applyToRecordingDraftAction", () => {
  beforeEach(() => {
    mockGetCurrentStudioSession.mockReset();
    mockCan.mockClear();
  });

  it("refuses an unauthenticated caller and applies nothing", async () => {
    mockGetCurrentStudioSession.mockResolvedValue(null);
    const f = await createPublishedRecording();
    const suggestion = await generateApproved(f, GUIDE, "Unauthenticated attempt.");

    const redirectPath = await runAction(suggestion.id);
    expect(decodeURIComponent(redirectPath)).toContain("permission");
    expect((await prisma.recording.findUniqueOrThrow({ where: { id: f.recording.id } })).currentDraftRevisionId).toBeNull();
    expect(await findContentSuggestionApplication(suggestion.id)).toBeNull();
  }, T);

  it("honors a permission denial from the policy and applies nothing", async () => {
    const f = await createPublishedRecording();
    const suggestion = await generateApproved(f, GUIDE, "Unauthorized attempt.");
    mockGetCurrentStudioSession.mockResolvedValue({ user: { id: f.user.id, role: "EDITOR" } });
    mockCan.mockReturnValueOnce(false);

    const redirectPath = await runAction(suggestion.id);
    expect(decodeURIComponent(redirectPath)).toContain("permission");
    expect(await findContentSuggestionApplication(suggestion.id)).toBeNull();
  }, T);

  it("applies for an authorized Recording editor and redirects back to the suggestion", async () => {
    const f = await createPublishedRecording();
    const contributor = await createUser("CONTRIBUTOR"); // every Studio role, including CONTRIBUTOR, holds RECORDING_WRITE
    const suggestion = await generateApproved(f, GUIDE, "Authorized application.");
    mockGetCurrentStudioSession.mockResolvedValue({ user: { id: contributor.id, role: "CONTRIBUTOR" } });

    const redirectPath = await runAction(suggestion.id);
    expect(redirectPath).toBe(`/studio/content-suggestions/${suggestion.id}`);
    const application = await findContentSuggestionApplication(suggestion.id);
    expect(application).not.toBeNull();
    expect(application?.forkedDraft).toBe(true);
  }, T);

  it("reports a stale suggestion to the editor and does not apply it", async () => {
    const f = await createPublishedRecording();
    const suggestion = await generateApproved(f, GUIDE, "Stale by the time of the click.");
    await prisma.recordingRevision.update({ where: { id: f.publishedRevisionId }, data: { description: "Changed." } });
    mockGetCurrentStudioSession.mockResolvedValue({ user: { id: f.user.id, role: "EDITOR" } });

    const redirectPath = await runAction(suggestion.id);
    expect(decodeURIComponent(redirectPath)).toContain("outdated Recording context");
    expect(await findContentSuggestionApplication(suggestion.id)).toBeNull();
  }, T);
});
