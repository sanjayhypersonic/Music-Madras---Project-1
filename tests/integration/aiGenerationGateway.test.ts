import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../modules/db/client";
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import { archiveRecording, attachWorkToRevision, createDraftRecording, publishCurrentDraft } from "../../modules/db/repositories/recordingRepository";
import { getRecordingContext } from "../../modules/db/repositories/recordingContextRepository";
import { computeContextFingerprint } from "../../modules/mmke/contentIntelligence/computeContextFingerprint";
import { generateRecordingEditorialSuggestion } from "../../modules/ai/gateway/generateRecordingEditorialSuggestion";
import { FakeAIProvider } from "../../modules/ai/providers/fake/fakeAIProvider";
import { AnthropicProvider } from "../../modules/ai/providers/anthropic/anthropicProvider";

// Phase 6H-5 — proves the AI Generation Gateway end to end against the real
// database, using the deterministic FakeAIProvider exclusively (no network
// call, no external credential). Follows the same disposable
// test-prefixed fixture pattern as tests/integration/contentSuggestionRepository.test.ts.

const TEST_TAG = "phase6h5";
const TEST_EMAIL = `${TEST_TAG}-integration-test@musicmadras.test`;

function uniqueSlug(base: string): string {
  return `${TEST_TAG}-${base}-${randomUUID().slice(0, 8)}`;
}

async function createTestUser() {
  return prisma.studioUser.create({
    data: { id: randomUUID(), email: `${randomUUID()}-${TEST_EMAIL}`, name: "Phase 6H-5 Test User", role: "EDITOR", status: "ACTIVE" },
  });
}

interface Fixture {
  user: { id: string };
  composer: { id: string };
  work: { id: string };
  recordingId: string;
}

async function createPublishedRecordingFixture(): Promise<Fixture> {
  const user = await createTestUser();
  const composer = await createComposer({ slug: uniqueSlug("composer"), name: `Test Composer ${randomUUID().slice(0, 8)}`, actorId: user.id });
  const work = await createMusicalWork({ slug: uniqueSlug("work"), title: "Test Work", composerId: composer.id, actorId: user.id });
  const draft = await createDraftRecording({ slug: uniqueSlug("recording"), actorId: user.id, title: "Test Recording" });
  await attachWorkToRevision(draft.currentDraftRevision!.id, work.id, user.id);
  const published = await publishCurrentDraft(draft.id, user.id);
  return { user, composer, work, recordingId: published.id };
}

async function cleanupFixture(fixture: Fixture) {
  // AuditLogEntry.entityId has no foreign key to ContentSuggestion/
  // ContentGenerationRequest (a generic string reference, like every other
  // audit target) — deleting those rows does NOT cascade-delete their audit
  // entries, so they must be removed explicitly first, or they orphan
  // permanently (caught during Phase 6H-6 manual QA).
  const suggestionIds = (await prisma.contentSuggestion.findMany({ where: { targetEntityId: fixture.recordingId }, select: { id: true } })).map((s) => s.id);
  const generationRequestIds = (await prisma.contentGenerationRequest.findMany({ where: { targetEntityId: fixture.recordingId }, select: { id: true } })).map(
    (r) => r.id
  );
  if (suggestionIds.length > 0) {
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "ContentSuggestion", entityId: { in: suggestionIds } } });
  }
  if (generationRequestIds.length > 0) {
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "ContentGenerationRequest", entityId: { in: generationRequestIds } } });
  }
  await prisma.contentSuggestion.deleteMany({ where: { targetEntityId: fixture.recordingId } });
  await prisma.contentGenerationRequest.deleteMany({ where: { targetEntityId: fixture.recordingId } });

  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Recording", entityId: fixture.recordingId } });
  const revisions = await prisma.recordingRevision.findMany({ where: { recordingId: fixture.recordingId }, select: { id: true } });
  if (revisions.length > 0) {
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "RecordingRevision", entityId: { in: revisions.map((r) => r.id) } } });
  }
  await prisma.recording.delete({ where: { id: fixture.recordingId } });

  const works = await prisma.musicalWork.findMany({ where: { composerId: fixture.composer.id }, select: { id: true } });
  if (works.length > 0) {
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "MusicalWork", entityId: { in: works.map((w) => w.id) } } });
    await prisma.musicalWork.deleteMany({ where: { composerId: fixture.composer.id } });
  }
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Composer", entityId: fixture.composer.id } });
  await prisma.composer.delete({ where: { id: fixture.composer.id } });

  await prisma.studioUser.deleteMany({ where: { id: fixture.user.id } });
}

describe("A. Successful generation", () => {
  it("produces an EDITORIAL_PROSE ContentSuggestion whose evidence resolves against the real context, and records the correct context fingerprint", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      const contextResult = await getRecordingContext(fixture.recordingId);
      expect(contextResult.ok).toBe(true);
      if (!contextResult.ok) return;
      const expectedFingerprint = computeContextFingerprint(contextResult.context);

      const fakeProvider = new FakeAIProvider({
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

      const result = await generateRecordingEditorialSuggestion({ recordingId: fixture.recordingId, requestedById: fixture.user.id, provider: fakeProvider });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.generationRequest.status).toBe("SUCCEEDED");
      expect(result.generationRequest.contextFingerprint).toBe(expectedFingerprint);
      expect(result.generationRequest.provider).toBe("fake");
      expect(result.generationRequest.promptVersion).toBe("recording-editorial-v2");
      expect(result.suggestion.suggestionType).toBe("EDITORIAL_PROSE");
      expect(result.suggestion.status).toBe("DRAFT_READY");
      expect(result.suggestion.targetField).toBe("educationalListeningGuide");
      expect(result.suggestion.evidenceRefs).toEqual(
        expect.arrayContaining([expect.objectContaining({ entityId: fixture.work.id }), expect.objectContaining({ entityId: fixture.composer.id })])
      );
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("produces an INFORMATION_GAP ContentSuggestion when the model reports insufficient context", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      const fakeProvider = new FakeAIProvider(); // default SUCCESS output is an INFORMATION_GAP
      const result = await generateRecordingEditorialSuggestion({ recordingId: fixture.recordingId, requestedById: fixture.user.id, provider: fakeProvider });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.suggestion.suggestionType).toBe("INFORMATION_GAP");
      expect(result.suggestion.targetField).toBeNull();
      expect(JSON.parse(result.suggestion.proposedContent)).toHaveProperty("missingField");
    } finally {
      await cleanupFixture(fixture);
    }
  });
});

describe("B. Provider and validation failures", () => {
  it("leaves the ContentGenerationRequest FAILED and creates no suggestion when the provider itself fails", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      const fakeProvider = new FakeAIProvider({ mode: "PROVIDER_ERROR" });
      const result = await generateRecordingEditorialSuggestion({ recordingId: fixture.recordingId, requestedById: fixture.user.id, provider: fakeProvider });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.generationRequest?.status).toBe("FAILED");
      expect(result.generationRequest?.errorDetails).toContain("PROVIDER_ERROR");

      const suggestions = await prisma.contentSuggestion.findMany({ where: { targetEntityId: fixture.recordingId } });
      expect(suggestions).toHaveLength(0);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("marks the request FAILED, not SUCCEEDED, when the provider returns malformed structured output", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      const fakeProvider = new FakeAIProvider({ mode: "MALFORMED_OUTPUT" });
      const result = await generateRecordingEditorialSuggestion({ recordingId: fixture.recordingId, requestedById: fixture.user.id, provider: fakeProvider });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.generationRequest?.status).toBe("FAILED");

      const suggestions = await prisma.contentSuggestion.findMany({ where: { targetEntityId: fixture.recordingId } });
      expect(suggestions).toHaveLength(0);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("reports RECORDING_CONTEXT_UNAVAILABLE, with no ContentGenerationRequest created, for an archived recording", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      await archiveRecording(fixture.recordingId, fixture.user.id);
      const fakeProvider = new FakeAIProvider();
      const result = await generateRecordingEditorialSuggestion({ recordingId: fixture.recordingId, requestedById: fixture.user.id, provider: fakeProvider });

      expect(result).toEqual(expect.objectContaining({ ok: false, generationRequest: null, reason: "RECORDING_CONTEXT_UNAVAILABLE", contextReason: "ARCHIVED" }));

      const requests = await prisma.contentGenerationRequest.findMany({ where: { targetEntityId: fixture.recordingId } });
      expect(requests).toHaveLength(0);
    } finally {
      await cleanupFixture(fixture);
    }
  });
});

describe("C. Idempotency", () => {
  it("creates exactly one ContentGenerationRequest per gateway call, regardless of the provider's outcome", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      await generateRecordingEditorialSuggestion({ recordingId: fixture.recordingId, requestedById: fixture.user.id, provider: new FakeAIProvider({ mode: "PROVIDER_ERROR" }) });
      const requests = await prisma.contentGenerationRequest.findMany({ where: { targetEntityId: fixture.recordingId } });
      expect(requests).toHaveLength(1);
    } finally {
      await cleanupFixture(fixture);
    }
  });
});

describe("D. Provider switching — the gateway is unaware which provider it calls", () => {
  it("routes through identical gateway logic for FakeAIProvider and an unconfigured AnthropicProvider, both via the same AIProvider interface", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      const fakeResult = await generateRecordingEditorialSuggestion({ recordingId: fixture.recordingId, requestedById: fixture.user.id, provider: new FakeAIProvider() });
      expect(fakeResult.ok).toBe(true);

      const anthropicResult = await generateRecordingEditorialSuggestion({
        recordingId: fixture.recordingId,
        requestedById: fixture.user.id,
        provider: new AnthropicProvider({}), // no apiKey — safely unconfigured, never a network call
      });
      expect(anthropicResult.ok).toBe(false);
      if (anthropicResult.ok) return;
      expect(anthropicResult.generationRequest?.errorDetails).toContain("CONFIGURATION");

      const requests = await prisma.contentGenerationRequest.findMany({ where: { targetEntityId: fixture.recordingId }, orderBy: { requestedAt: "asc" } });
      expect(requests.map((r) => r.provider)).toEqual(["fake", "anthropic"]);
    } finally {
      await cleanupFixture(fixture);
    }
  });
});

describe("E. Canonical MMKE immutability", () => {
  it("never changes the Recording or its revisions across a full successful generation", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      const recordingBefore = await prisma.recording.findUnique({ where: { id: fixture.recordingId } });
      const revisionsBefore = await prisma.recordingRevision.findMany({ where: { recordingId: fixture.recordingId } });

      await generateRecordingEditorialSuggestion({ recordingId: fixture.recordingId, requestedById: fixture.user.id, provider: new FakeAIProvider() });

      const recordingAfter = await prisma.recording.findUnique({ where: { id: fixture.recordingId } });
      const revisionsAfter = await prisma.recordingRevision.findMany({ where: { recordingId: fixture.recordingId } });

      expect(recordingAfter).toEqual(recordingBefore);
      expect(revisionsAfter).toEqual(revisionsBefore);
    } finally {
      await cleanupFixture(fixture);
    }
  });
});
