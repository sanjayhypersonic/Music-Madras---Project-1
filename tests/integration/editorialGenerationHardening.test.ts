import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../modules/db/client";
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import { attachWorkToRevision, createDraftRecording, forkDraftFromPublished, publishCurrentDraft } from "../../modules/db/repositories/recordingRepository";
import { getRecordingContext } from "../../modules/db/repositories/recordingContextRepository";
import { checkContentSuggestionFreshness } from "../../modules/db/repositories/contentSuggestionRepository";
import { generateRecordingEditorialSuggestion } from "../../modules/ai/gateway/generateRecordingEditorialSuggestion";
import { FakeAIProvider } from "../../modules/ai/providers/fake/fakeAIProvider";
import { RECORDING_EDITORIAL_PROMPT_V3 } from "../../modules/ai/prompts/recordingEditorial/recordingEditorialPromptV3";

// Phase 6H-7 — hardening tests for the truthfulness/trust boundary. These
// exercise scenarios genuinely NOT covered by 6H-5/6H-6's own test files:
// a provider attempting to escape the EDITORIAL_PROSE/INFORMATION_GAP
// contract, evidence fabrication against another Recording's real ids,
// stale detection for an EDITORIAL_PROSE (not just INFORMATION_GAP)
// suggestion, an explicit "generation never self-approves" invariant, and
// a genuinely minimal/empty context. FakeAIProvider exclusively — no
// network, no credential.

const TEST_TAG = "phase6h7";
const TEST_EMAIL = `${TEST_TAG}-integration-test@musicmadras.test`;

function uniqueSlug(base: string): string {
  return `${TEST_TAG}-${base}-${randomUUID().slice(0, 8)}`;
}

async function createTestUser() {
  return prisma.studioUser.create({
    data: { id: randomUUID(), email: `${randomUUID()}-${TEST_EMAIL}`, name: "Phase 6H-7 Test User", role: "EDITOR", status: "ACTIVE" },
  });
}

interface Fixture {
  user: { id: string };
  composer: { id: string; name: string };
  work: { id: string };
  recordingId: string;
}

async function createPublishedRecordingFixture(): Promise<Fixture> {
  const user = await createTestUser();
  // A unique name per call — some tests in this file create more than one
  // fixture at once (e.g. cross-Recording evidence-fabrication tests), and
  // createComposer guards against a duplicate name globally, not just by slug.
  const composer = await createComposer({ slug: uniqueSlug("composer"), name: `Test Composer ${randomUUID().slice(0, 8)}`, actorId: user.id });
  const work = await createMusicalWork({ slug: uniqueSlug("work"), title: "Test Work", composerId: composer.id, actorId: user.id });
  const draft = await createDraftRecording({ slug: uniqueSlug("recording"), actorId: user.id, title: "Test Recording" });
  await attachWorkToRevision(draft.currentDraftRevision!.id, work.id, user.id);
  const published = await publishCurrentDraft(draft.id, user.id);
  return { user, composer, work, recordingId: published.id };
}

/** A minimal published Recording with NO attached work at all — the sparsest legitimate context. */
async function createMinimalPublishedRecordingFixture(): Promise<{ user: { id: string }; recordingId: string }> {
  const user = await createTestUser();
  const draft = await createDraftRecording({ slug: uniqueSlug("recording-minimal"), actorId: user.id, title: "Minimal Recording" });
  const published = await publishCurrentDraft(draft.id, user.id);
  return { user, recordingId: published.id };
}

async function cleanupRecordingAndAudit(recordingId: string) {
  const suggestionIds = (await prisma.contentSuggestion.findMany({ where: { targetEntityId: recordingId }, select: { id: true } })).map((s) => s.id);
  const generationRequestIds = (await prisma.contentGenerationRequest.findMany({ where: { targetEntityId: recordingId }, select: { id: true } })).map((r) => r.id);
  if (suggestionIds.length > 0) {
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "ContentSuggestion", entityId: { in: suggestionIds } } });
  }
  if (generationRequestIds.length > 0) {
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "ContentGenerationRequest", entityId: { in: generationRequestIds } } });
  }
  await prisma.contentSuggestion.deleteMany({ where: { targetEntityId: recordingId } });
  await prisma.contentGenerationRequest.deleteMany({ where: { targetEntityId: recordingId } });

  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Recording", entityId: recordingId } });
  const revisions = await prisma.recordingRevision.findMany({ where: { recordingId }, select: { id: true } });
  if (revisions.length > 0) {
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "RecordingRevision", entityId: { in: revisions.map((r) => r.id) } } });
  }
  await prisma.recording.delete({ where: { id: recordingId } });
}

async function cleanupFixture(fixture: Fixture) {
  await cleanupRecordingAndAudit(fixture.recordingId);

  const works = await prisma.musicalWork.findMany({ where: { composerId: fixture.composer.id }, select: { id: true } });
  if (works.length > 0) {
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "MusicalWork", entityId: { in: works.map((w) => w.id) } } });
    await prisma.musicalWork.deleteMany({ where: { composerId: fixture.composer.id } });
  }
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Composer", entityId: fixture.composer.id } });
  await prisma.composer.delete({ where: { id: fixture.composer.id } });

  await prisma.studioUser.deleteMany({ where: { id: fixture.user.id } });
}

describe("A. EDITORIAL_PROSE contract enforcement", () => {
  it("persists a valid SUGGESTION as EDITORIAL_PROSE, using prompt version v2", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      const provider = new FakeAIProvider({
        mode: "SUCCESS",
        output: {
          outputType: "SUGGESTION",
          proposedContent: "This recording features Test Work by Test Composer.",
          targetField: "educationalListeningGuide",
          evidenceEntityIds: [fixture.work.id, fixture.composer.id],
          missingField: null,
          whyItMatters: null,
          requestedAction: null,
        },
      });

      const result = await generateRecordingEditorialSuggestion({ recordingId: fixture.recordingId, requestedById: fixture.user.id, provider });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.generationRequest.promptVersion).toBe(RECORDING_EDITORIAL_PROMPT_V3);
      expect(result.generationRequest.suggestionType).toBe("EDITORIAL_PROSE");
      expect(result.suggestion.suggestionType).toBe("EDITORIAL_PROSE");
      // N: generation never self-approves.
      expect(result.suggestion.status).toBe("DRAFT_READY");
      expect(result.suggestion.status).not.toBe("APPROVED");
      expect(result.suggestion.reviewedById).toBeNull();
      expect(result.suggestion.reviewDecision).toBeNull();
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("rejects an out-of-contract outputType end to end — no ContentSuggestion of any type is ever created", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      // A malfunctioning or adversarial provider attempting to escape the
      // SUGGESTION|INFORMATION_GAP contract entirely.
      const provider = new FakeAIProvider({
        mode: "SUCCESS",
        output: {
          outputType: "SEO_METADATA",
          proposedContent: "A suggested title.",
          targetField: null,
          evidenceEntityIds: [],
          missingField: null,
          whyItMatters: null,
          requestedAction: null,
        },
      });

      const result = await generateRecordingEditorialSuggestion({ recordingId: fixture.recordingId, requestedById: fixture.user.id, provider });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.generationRequest?.status).toBe("FAILED");

      const suggestions = await prisma.contentSuggestion.findMany({ where: { targetEntityId: fixture.recordingId } });
      expect(suggestions).toHaveLength(0);
    } finally {
      await cleanupFixture(fixture);
    }
  });
});

describe("B. Evidence integrity — fabrication and cross-target references are rejected", () => {
  it("rejects evidence ids that belong to a completely different Recording's real entities", async () => {
    const fixtureA = await createPublishedRecordingFixture();
    const fixtureB = await createPublishedRecordingFixture();
    try {
      // The model cites fixtureB's real composer/work ids while generating
      // for fixtureA — those ids are real, just not part of fixtureA's own
      // supplied context, so they must still be rejected as evidence.
      const provider = new FakeAIProvider({
        mode: "SUCCESS",
        output: {
          outputType: "SUGGESTION",
          proposedContent: "A claim citing evidence from a different recording entirely.",
          targetField: "description",
          evidenceEntityIds: [fixtureB.work.id, fixtureB.composer.id],
          missingField: null,
          whyItMatters: null,
          requestedAction: null,
        },
      });

      const result = await generateRecordingEditorialSuggestion({ recordingId: fixtureA.recordingId, requestedById: fixtureA.user.id, provider });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.generationRequest?.status).toBe("FAILED");

      const suggestions = await prisma.contentSuggestion.findMany({ where: { targetEntityId: fixtureA.recordingId } });
      expect(suggestions).toHaveLength(0);
    } finally {
      await cleanupFixture(fixtureA);
      await cleanupFixture(fixtureB);
    }
  });

  it("silently drops a fabricated evidence id while keeping the genuinely valid ones, never trusting the invented one", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      const provider = new FakeAIProvider({
        mode: "SUCCESS",
        output: {
          outputType: "SUGGESTION",
          proposedContent: "A claim with one real and one fabricated evidence id.",
          targetField: "description",
          evidenceEntityIds: [fixture.work.id, "completely-fabricated-id-not-in-any-context"],
          missingField: null,
          whyItMatters: null,
          requestedAction: null,
        },
      });

      const result = await generateRecordingEditorialSuggestion({ recordingId: fixture.recordingId, requestedById: fixture.user.id, provider });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.suggestion.evidenceRefs).toHaveLength(1);
      expect((result.suggestion.evidenceRefs as { entityId: string }[])[0].entityId).toBe(fixture.work.id);
    } finally {
      await cleanupFixture(fixture);
    }
  });
});

describe("C. Minimal/empty context — no fabricated completeness", () => {
  it("handles a Recording with no attached work and no performance safely, without inventing content", async () => {
    const minimal = await createMinimalPublishedRecordingFixture();
    try {
      const contextResult = await getRecordingContext(minimal.recordingId);
      expect(contextResult.ok).toBe(true);
      if (!contextResult.ok) return;
      expect(contextResult.context.works).toHaveLength(0);
      expect(contextResult.context.performance).toBeNull();

      // The default FakeAIProvider SUCCESS output is itself an
      // INFORMATION_GAP — the correct, honest response to a context this
      // sparse, not a coincidence of the fixture.
      const result = await generateRecordingEditorialSuggestion({ recordingId: minimal.recordingId, requestedById: minimal.user.id, provider: new FakeAIProvider() });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.suggestion.suggestionType).toBe("INFORMATION_GAP");
      expect(result.suggestion.evidenceRefs).toEqual([]);
    } finally {
      await cleanupRecordingAndAudit(minimal.recordingId);
      await prisma.studioUser.deleteMany({ where: { id: minimal.user.id } });
    }
  });
});

describe("D. Source-tier distinction is preserved, never merged", () => {
  it("keeps YouTube-sourced text and canonical facts as separate, distinctly-tagged context sections", async () => {
    const fixture = await createPublishedRecordingFixture();
    const video = await prisma.youTubeVideo.create({
      data: {
        youtubeVideoId: uniqueSlug("video"),
        title: "A Concert Recording",
        description: "Recorded live — performed by the Test Ensemble under a different conductor than any canonical record shows.",
        channelId: `${TEST_TAG}-channel`,
        privacyStatus: "public",
        observabilityState: "OBSERVED",
      },
    });
    try {
      const { seedMediaOnRevision } = await import("./helpers/seedRevisionRows");
      const revision = await prisma.recording.findUnique({ where: { id: fixture.recordingId }, select: { currentPublishedRevisionId: true } });
      await seedMediaOnRevision({
        recordingRevisionId: revision!.currentPublishedRevisionId!,
        provider: "YOUTUBE",
        role: "PRIMARY_VIDEO",
        youtubeVideoId: video.id,
        actorId: fixture.user.id,
      });

      const contextResult = await getRecordingContext(fixture.recordingId);
      expect(contextResult.ok).toBe(true);
      if (!contextResult.ok) return;

      // The YouTube description is preserved verbatim, distinctly, and is
      // never merged into or used to overwrite any canonical field (e.g.
      // the composer's own name/biography, or the work's own notes) — the
      // two remain separately inspectable sections of the same context.
      expect(contextResult.context.media[0].description).toBe(
        "Recorded live — performed by the Test Ensemble under a different conductor than any canonical record shows."
      );
      expect(contextResult.context.works[0].composer.name).toBe(fixture.composer.name);
      expect(contextResult.context.works[0].composer.name).not.toContain("Test Ensemble");
    } finally {
      await prisma.mediaResource.deleteMany({ where: { youtubeVideoId: video.id } });
      await prisma.youTubeVideo.delete({ where: { id: video.id } });
      await cleanupFixture(fixture);
    }
  });
});

describe("E. Stale-context detection for an EDITORIAL_PROSE suggestion specifically", () => {
  it("reports CURRENT immediately, then STALE after a canonical change — the approved-shape suggestion itself is never mutated", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      const provider = new FakeAIProvider({
        mode: "SUCCESS",
        output: {
          outputType: "SUGGESTION",
          proposedContent: "This recording features Test Work by Test Composer.",
          targetField: "educationalListeningGuide",
          evidenceEntityIds: [fixture.work.id],
          missingField: null,
          whyItMatters: null,
          requestedAction: null,
        },
      });

      const generated = await generateRecordingEditorialSuggestion({ recordingId: fixture.recordingId, requestedById: fixture.user.id, provider });
      expect(generated.ok).toBe(true);
      if (!generated.ok) return;
      expect(generated.suggestion.suggestionType).toBe("EDITORIAL_PROSE");
      expect(await checkContentSuggestionFreshness(generated.suggestion.id)).toBe("CURRENT");

      const secondWork = await createMusicalWork({ slug: uniqueSlug("work-2"), title: "Second Work", composerId: fixture.composer.id, actorId: fixture.user.id });
      const forked = await forkDraftFromPublished(fixture.recordingId, fixture.user.id);
      await attachWorkToRevision(forked.id, secondWork.id, fixture.user.id);
      await publishCurrentDraft(fixture.recordingId, fixture.user.id);

      expect(await checkContentSuggestionFreshness(generated.suggestion.id)).toBe("STALE");

      const reloaded = await prisma.contentSuggestion.findUnique({ where: { id: generated.suggestion.id } });
      expect(reloaded?.proposedContent).toBe(generated.suggestion.proposedContent);
      expect(reloaded?.status).toBe("DRAFT_READY");
    } finally {
      await cleanupFixture(fixture);
    }
  });
});

describe("F. Canonical MMKE immutability across the hardened paths", () => {
  it("never changes the Recording or its revisions across a valid generation, a rejected generation, and an evidence-fabrication attempt", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      const recordingBefore = await prisma.recording.findUnique({ where: { id: fixture.recordingId } });
      const revisionsBefore = await prisma.recordingRevision.findMany({ where: { recordingId: fixture.recordingId } });
      const composerBefore = await prisma.composer.findUnique({ where: { id: fixture.composer.id } });

      await generateRecordingEditorialSuggestion({
        recordingId: fixture.recordingId,
        requestedById: fixture.user.id,
        provider: new FakeAIProvider({
          mode: "SUCCESS",
          output: {
            outputType: "SUGGESTION",
            proposedContent: "Valid content.",
            targetField: "description",
            evidenceEntityIds: [fixture.work.id],
            missingField: null,
            whyItMatters: null,
            requestedAction: null,
          },
        }),
      });
      await generateRecordingEditorialSuggestion({ recordingId: fixture.recordingId, requestedById: fixture.user.id, provider: new FakeAIProvider({ mode: "PROVIDER_ERROR" }) });
      await generateRecordingEditorialSuggestion({
        recordingId: fixture.recordingId,
        requestedById: fixture.user.id,
        provider: new FakeAIProvider({
          mode: "SUCCESS",
          output: {
            outputType: "SUGGESTION",
            proposedContent: "Attempted fabrication.",
            targetField: "description",
            evidenceEntityIds: ["fabricated-id"],
            missingField: null,
            whyItMatters: null,
            requestedAction: null,
          },
        }),
      });

      const recordingAfter = await prisma.recording.findUnique({ where: { id: fixture.recordingId } });
      const revisionsAfter = await prisma.recordingRevision.findMany({ where: { recordingId: fixture.recordingId } });
      const composerAfter = await prisma.composer.findUnique({ where: { id: fixture.composer.id } });

      expect(recordingAfter).toEqual(recordingBefore);
      expect(revisionsAfter).toEqual(revisionsBefore);
      expect(composerAfter).toEqual(composerBefore);
    } finally {
      await cleanupFixture(fixture);
    }
  });
});
