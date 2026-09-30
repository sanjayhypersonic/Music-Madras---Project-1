import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { randomUUID } from "crypto";

// Must be at the true top level (before any import that transitively
// resolves modules/auth/authService) — vi.mock is hoisted above all
// imports, so the mock variable it references must also be declared here.
const mockGetCurrentStudioSession = vi.fn();
vi.mock("../../modules/auth/authService", () => ({
  getCurrentStudioSession: () => mockGetCurrentStudioSession(),
}));

import { prisma } from "../../modules/db/client";
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import { attachWorkToRevision, createDraftRecording, forkDraftFromPublished, publishCurrentDraft } from "../../modules/db/repositories/recordingRepository";
import { generateRecordingEditorialSuggestion } from "../../modules/ai/gateway/generateRecordingEditorialSuggestion";
import { checkContentSuggestionFreshness, findContentSuggestionById } from "../../modules/db/repositories/contentSuggestionRepository";
import { FakeAIProvider } from "../../modules/ai/providers/fake/fakeAIProvider";
import { generateEditorialSuggestionAction } from "../../app/(studio)/studio/(protected)/content-suggestions/generateAction";
import { resetConfiguredAIProviderForTests } from "../../modules/ai/provider/aiProviderRegistry";

// Phase 6H-6 — the workflow-level scenarios not already covered by
// tests/integration/aiGenerationGateway.test.ts (6H-5): duplicate/concurrent
// generation, freshness after a real context change, and the Server
// Action's authentication gate. Uses FakeAIProvider exclusively.

const TEST_TAG = "phase6h6";
const TEST_EMAIL = `${TEST_TAG}-integration-test@musicmadras.test`;

function uniqueSlug(base: string): string {
  return `${TEST_TAG}-${base}-${randomUUID().slice(0, 8)}`;
}

async function createTestUser() {
  return prisma.studioUser.create({
    data: { id: randomUUID(), email: `${randomUUID()}-${TEST_EMAIL}`, name: "Phase 6H-6 Test User", role: "EDITOR", status: "ACTIVE" },
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
  const composer = await createComposer({ slug: uniqueSlug("composer"), name: "Test Composer", actorId: user.id });
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
  // permanently (caught during this phase's own manual QA).
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

describe("A. Duplicate / concurrent generation", () => {
  it("refuses a second generation while one is PENDING or GENERATING, without creating a second ContentGenerationRequest", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      // Simulate an active (never-completed) request, as if a prior call is
      // still in flight or its server process crashed mid-generation.
      const activeRequest = await prisma.contentGenerationRequest.create({
        data: {
          targetEntityType: "RECORDING",
          targetEntityId: fixture.recordingId,
          suggestionType: "EDITORIAL_PROSE",
          status: "GENERATING",
          requestedById: fixture.user.id,
        },
      });

      const result = await generateRecordingEditorialSuggestion({ recordingId: fixture.recordingId, requestedById: fixture.user.id, provider: new FakeAIProvider() });

      expect(result).toEqual({ ok: false, generationRequest: null, reason: "GENERATION_ALREADY_IN_PROGRESS" });

      const requests = await prisma.contentGenerationRequest.findMany({ where: { targetEntityId: fixture.recordingId } });
      expect(requests).toHaveLength(1);
      expect(requests[0].id).toBe(activeRequest.id);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("allows a second, intentional generation once the first has reached a terminal state", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      const first = await generateRecordingEditorialSuggestion({ recordingId: fixture.recordingId, requestedById: fixture.user.id, provider: new FakeAIProvider() });
      expect(first.ok).toBe(true);

      const second = await generateRecordingEditorialSuggestion({ recordingId: fixture.recordingId, requestedById: fixture.user.id, provider: new FakeAIProvider() });
      expect(second.ok).toBe(true);

      const requests = await prisma.contentGenerationRequest.findMany({ where: { targetEntityId: fixture.recordingId } });
      expect(requests).toHaveLength(2);
      expect(new Set(requests.map((r) => r.id)).size).toBe(2);
    } finally {
      await cleanupFixture(fixture);
    }
  });
});

describe("B. Freshness after a real canonical context change", () => {
  it("generates CURRENT, then becomes STALE after the canonical context changes — the original suggestion is never mutated", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      const generated = await generateRecordingEditorialSuggestion({ recordingId: fixture.recordingId, requestedById: fixture.user.id, provider: new FakeAIProvider() });
      expect(generated.ok).toBe(true);
      if (!generated.ok) return;

      expect(await checkContentSuggestionFreshness(generated.suggestion.id)).toBe("CURRENT");

      const secondWork = await createMusicalWork({ slug: uniqueSlug("work-2"), title: "Second Work", composerId: fixture.composer.id, actorId: fixture.user.id });
      const forked = await forkDraftFromPublished(fixture.recordingId, fixture.user.id);
      await attachWorkToRevision(forked.id, secondWork.id, fixture.user.id);
      await publishCurrentDraft(fixture.recordingId, fixture.user.id);

      expect(await checkContentSuggestionFreshness(generated.suggestion.id)).toBe("STALE");

      const reloaded = await findContentSuggestionById(generated.suggestion.id);
      expect(reloaded?.proposedContent).toBe(generated.suggestion.proposedContent);
      expect(reloaded?.status).toBe(generated.suggestion.status);

      // secondWork is cleaned up by cleanupFixture below (it queries every
      // MusicalWork under fixture.composer, not just the originally-tracked
      // one) — deleting it here directly would violate its FK from the
      // still-existing RecordingRevisionWork row until the Recording itself
      // is deleted first.
    } finally {
      await cleanupFixture(fixture);
    }
  });
});

describe("C. Server Action authentication/authorization gate", () => {
  function extractRedirectPath(err: unknown): string {
    if (typeof err === "object" && err !== null && "digest" in err) {
      const digest = (err as { digest: unknown }).digest;
      if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
        return digest.split(";").slice(2, -2).join(";");
      }
    }
    throw err;
  }

  // The Server Action always uses the configuration-selected provider
  // (never a test-injected one, matching production reality) — set
  // AI_PROVIDER=fake so this test never depends on a real Anthropic
  // credential, exactly like every other automated test in this suite.
  const originalAiProvider = process.env.AI_PROVIDER;

  beforeEach(() => {
    mockGetCurrentStudioSession.mockReset();
    process.env.AI_PROVIDER = "fake";
    resetConfiguredAIProviderForTests();
  });

  afterEach(() => {
    if (originalAiProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = originalAiProvider;
    resetConfiguredAIProviderForTests();
  });

  it("refuses generation and creates no database rows when there is no authenticated session", async () => {
    mockGetCurrentStudioSession.mockResolvedValue(null);
    const fixture = await createPublishedRecordingFixture();
    try {
      const formData = new FormData();
      formData.set("recordingId", fixture.recordingId);

      let redirectPath = "";
      try {
        await generateEditorialSuggestionAction(formData);
      } catch (err) {
        redirectPath = extractRedirectPath(err);
      }

      expect(redirectPath).toContain("/studio/content-suggestions");
      expect(redirectPath).toContain("error=");
      expect(decodeURIComponent(redirectPath)).toContain("permission");

      const requests = await prisma.contentGenerationRequest.findMany({ where: { targetEntityId: fixture.recordingId } });
      expect(requests).toHaveLength(0);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("proceeds and redirects to the new suggestion when the session holds RECORDING_WRITE (every real Studio role does)", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      mockGetCurrentStudioSession.mockResolvedValue({ user: { id: fixture.user.id, role: "CONTRIBUTOR" } });

      const formData = new FormData();
      formData.set("recordingId", fixture.recordingId);

      let redirectPath = "";
      try {
        await generateEditorialSuggestionAction(formData);
      } catch (err) {
        redirectPath = extractRedirectPath(err);
      }

      expect(redirectPath.startsWith("/studio/content-suggestions/")).toBe(true);
      expect(redirectPath).not.toContain("error=");

      const suggestions = await prisma.contentSuggestion.findMany({ where: { targetEntityId: fixture.recordingId } });
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].status).toBe("DRAFT_READY");
    } finally {
      await cleanupFixture(fixture);
    }
  });
});
