import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../modules/db/client";
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import {
  archiveRecording,
  attachWorkToRevision,
  createDraftRecording,
  forkDraftFromPublished,
  publishCurrentDraft,
} from "../../modules/db/repositories/recordingRepository";
import { getRecordingContext } from "../../modules/db/repositories/recordingContextRepository";
import { computeContextFingerprint } from "../../modules/mmke/contentIntelligence/computeContextFingerprint";
import {
  UnsupportedContentSuggestionEntityTypeError,
} from "../../modules/mmke/contentIntelligence/contentSuggestionEntityType";
import {
  approveContentSuggestion,
  checkContentSuggestionFreshness,
  completeGenerationRequest,
  createGenerationRequest,
  createSuggestion,
  findContentSuggestionById,
  findGenerationRequestById,
  markGenerationRequestGenerating,
  rejectContentSuggestion,
  requestContentSuggestionChanges,
  submitSuggestionForReview,
} from "../../modules/db/repositories/contentSuggestionRepository";
import { can } from "../../modules/auth/policy";

// Phase 6H-4 — proves the Content Suggestion persistence layer end to end
// against the real database: generation-request lifecycle, suggestion
// lifecycle, evidence, staleness detection, canonical MMKE immutability,
// and original-content preservation. Follows the same disposable
// test-prefixed fixture pattern as tests/integration/recordingContextRepository.test.ts.

const TEST_TAG = "phase6h4";
const TEST_EMAIL = `${TEST_TAG}-integration-test@musicmadras.test`;

function uniqueSlug(base: string): string {
  return `${TEST_TAG}-${base}-${randomUUID().slice(0, 8)}`;
}

async function createTestUser() {
  return prisma.studioUser.create({
    data: { id: randomUUID(), email: `${randomUUID()}-${TEST_EMAIL}`, name: "Phase 6H-4 Test User", role: "EDITOR", status: "ACTIVE" },
  });
}

interface Fixture {
  user: { id: string };
  composer: { id: string };
  work: { id: string };
  recordingId: string;
}

/** A minimal published Recording — a direct work attachment, no Performance needed for these tests. */
async function createPublishedRecordingFixture(): Promise<Fixture> {
  const user = await createTestUser();
  const composer = await createComposer({ slug: uniqueSlug("composer"), name: `Test Composer ${randomUUID().slice(0, 8)}`, actorId: user.id });
  const work = await createMusicalWork({ slug: uniqueSlug("work"), title: "Test Work", composerId: composer.id, actorId: user.id });
  const draft = await createDraftRecording({ slug: uniqueSlug("recording"), actorId: user.id, title: "Test Recording" });
  await attachWorkToRevision(draft.currentDraftRevision!.id, work.id, user.id);
  const published = await publishCurrentDraft(draft.id, user.id);
  return { user, composer, work, recordingId: published.id };
}

/**
 * Deletes every MusicalWork under the fixture's Composer (not just the one
 * the fixture itself tracked) — a test may attach an extra work mid-test
 * (e.g. the staleness test below), and this must never leave it orphaned
 * blocking a later test's createComposer duplicate-name guard.
 */
async function cleanupFixture(fixture: Fixture) {
  // AuditLogEntry.entityId has no foreign key to ContentSuggestion/
  // ContentGenerationRequest (a generic string reference, like every other
  // audit target) — deleting those rows does NOT cascade-delete their audit
  // entries, so they must be removed explicitly before the rows themselves,
  // or they orphan permanently (caught during Phase 6H-6 manual QA).
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

async function createFixtureRequest(fixture: Fixture, overrides: { contextFingerprint?: string | null } = {}) {
  return createGenerationRequest({
    targetEntityType: "RECORDING",
    targetEntityId: fixture.recordingId,
    suggestionType: "EDITORIAL_PROSE",
    contextFingerprint: overrides.contextFingerprint ?? null,
    requestedById: fixture.user.id,
  });
}

describe("A. ContentGenerationRequest lifecycle", () => {
  it("creates a request as PENDING, audit-logged, and rejects an unsupported target entity type", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      const request = await createFixtureRequest(fixture);
      expect(request.status).toBe("PENDING");
      expect(request.targetEntityType).toBe("RECORDING");

      const auditEntries = await prisma.auditLogEntry.findMany({ where: { entityType: "ContentGenerationRequest", entityId: request.id } });
      expect(auditEntries.map((e) => e.action)).toContain("CONTENT_GENERATION_REQUESTED");

      await expect(
        createGenerationRequest({
          targetEntityType: "COMPOSER",
          targetEntityId: fixture.composer.id,
          suggestionType: "EDITORIAL_PROSE",
          requestedById: fixture.user.id,
        })
      ).rejects.toThrow(UnsupportedContentSuggestionEntityTypeError);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("moves PENDING -> GENERATING -> SUCCEEDED, each step audited", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      const request = await createFixtureRequest(fixture);
      const generating = await markGenerationRequestGenerating(request.id);
      expect(generating.status).toBe("GENERATING");

      const succeeded = await completeGenerationRequest(request.id, { status: "SUCCEEDED" });
      expect(succeeded.status).toBe("SUCCEEDED");
      expect(succeeded.completedAt).not.toBeNull();

      const actions = (await prisma.auditLogEntry.findMany({ where: { entityType: "ContentGenerationRequest", entityId: request.id } })).map((e) => e.action);
      expect(actions).toEqual(expect.arrayContaining(["CONTENT_GENERATION_REQUESTED", "CONTENT_GENERATION_STARTED", "CONTENT_GENERATION_SUCCEEDED"]));
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("rejects starting generation twice", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      const request = await createFixtureRequest(fixture);
      await markGenerationRequestGenerating(request.id);
      await expect(markGenerationRequestGenerating(request.id)).rejects.toThrow();
    } finally {
      await cleanupFixture(fixture);
    }
  });
});

describe("B. ContentSuggestion creation and evidence", () => {
  it("creates a suggestion attributed to no human actor, distinct from the human generation request", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      const request = await createFixtureRequest(fixture);
      const suggestion = await createSuggestion({
        generationRequestId: request.id,
        suggestionType: "EDITORIAL_PROSE",
        targetEntityType: "RECORDING",
        targetEntityId: fixture.recordingId,
        targetField: "educationalListeningGuide",
        proposedContent: "This recording features a Test Work by Test Composer.",
        evidenceRefs: [{ sourceType: "CANONICAL_MMKE", entityType: "Recording", entityId: fixture.recordingId, field: "works" }],
      });

      expect(suggestion.status).toBe("DRAFT_READY");
      expect(suggestion.proposedContent).toBe("This recording features a Test Work by Test Composer.");
      expect(suggestion.evidenceRefs).toEqual([{ sourceType: "CANONICAL_MMKE", entityType: "Recording", entityId: fixture.recordingId, field: "works" }]);

      const requestAudit = (await prisma.auditLogEntry.findMany({ where: { entityType: "ContentGenerationRequest", entityId: request.id } })).find(
        (e) => e.action === "CONTENT_GENERATION_REQUESTED"
      );
      const suggestionAudit = (await prisma.auditLogEntry.findMany({ where: { entityType: "ContentSuggestion", entityId: suggestion.id } })).find(
        (e) => e.action === "CONTENT_SUGGESTION_CREATED"
      );
      expect(requestAudit?.actorId).toBe(fixture.user.id);
      expect(suggestionAudit?.actorId).toBeNull();
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("rejects creating a suggestion against a nonexistent generation request", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      await expect(
        createSuggestion({
          generationRequestId: randomUUID(),
          suggestionType: "EDITORIAL_PROSE",
          targetEntityType: "RECORDING",
          targetEntityId: fixture.recordingId,
          proposedContent: "Should not be created.",
          evidenceRefs: [],
        })
      ).rejects.toThrow();
    } finally {
      await cleanupFixture(fixture);
    }
  });
});

describe("C. Review lifecycle", () => {
  async function createDraftSuggestion(fixture: Fixture) {
    const request = await createFixtureRequest(fixture);
    return createSuggestion({
      generationRequestId: request.id,
      suggestionType: "EDITORIAL_PROSE",
      targetEntityType: "RECORDING",
      targetEntityId: fixture.recordingId,
      proposedContent: "Original generated wording.",
      evidenceRefs: [],
    });
  }

  it("rejects approve/reject/request-changes before the suggestion has moved to EDITOR_REVIEW", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      const suggestion = await createDraftSuggestion(fixture);
      await expect(approveContentSuggestion(suggestion.id, fixture.user.id)).rejects.toThrow();
      await expect(rejectContentSuggestion(suggestion.id, fixture.user.id, { reason: "OTHER" })).rejects.toThrow();
      await expect(requestContentSuggestionChanges(suggestion.id, fixture.user.id, "note")).rejects.toThrow();
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("ACCEPT: approving without edits preserves proposedContent and leaves finalContent null", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      const suggestion = await createDraftSuggestion(fixture);
      await submitSuggestionForReview(suggestion.id, fixture.user.id);
      const approved = await approveContentSuggestion(suggestion.id, fixture.user.id, { reviewNote: "Looks good." });

      expect(approved.status).toBe("APPROVED");
      expect(approved.reviewDecision).toBe("ACCEPT");
      expect(approved.proposedContent).toBe("Original generated wording.");
      expect(approved.finalContent).toBeNull();
      expect(approved.reviewedById).toBe(fixture.user.id);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("EDIT_AND_ACCEPT: the editor's edit is preserved separately, and the original proposal is never overwritten", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      const suggestion = await createDraftSuggestion(fixture);
      await submitSuggestionForReview(suggestion.id, fixture.user.id);
      const approved = await approveContentSuggestion(suggestion.id, fixture.user.id, { finalContent: "Editor's rewritten wording." });

      expect(approved.reviewDecision).toBe("EDIT_AND_ACCEPT");
      expect(approved.proposedContent).toBe("Original generated wording.");
      expect(approved.finalContent).toBe("Editor's rewritten wording.");
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("REJECT: records the reason and reviewer, and leaves the archive unchanged", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      const before = await prisma.recording.findUnique({ where: { id: fixture.recordingId } });
      const suggestion = await createDraftSuggestion(fixture);
      await submitSuggestionForReview(suggestion.id, fixture.user.id);
      const rejected = await rejectContentSuggestion(suggestion.id, fixture.user.id, { reason: "UNSUPPORTED", reviewNote: "No evidence for this." });

      expect(rejected.status).toBe("REJECTED");
      expect(rejected.reviewDecision).toBe("REJECT_UNSUPPORTED");

      const after = await prisma.recording.findUnique({ where: { id: fixture.recordingId } });
      expect(after).toEqual(before);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("CHANGES_REQUESTED is a legitimate terminal state in this phase — no further transition exists yet", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      const suggestion = await createDraftSuggestion(fixture);
      await submitSuggestionForReview(suggestion.id, fixture.user.id);
      const changesRequested = await requestContentSuggestionChanges(suggestion.id, fixture.user.id, "Please add the venue.");

      expect(changesRequested.status).toBe("CHANGES_REQUESTED");
      expect(changesRequested.reviewNote).toBe("Please add the venue.");
      await expect(approveContentSuggestion(suggestion.id, fixture.user.id)).rejects.toThrow();
      await expect(rejectContentSuggestion(suggestion.id, fixture.user.id, { reason: "OTHER" })).rejects.toThrow();
    } finally {
      await cleanupFixture(fixture);
    }
  });
});

describe("D. Staleness detection", () => {
  it("reports UNKNOWN when no context fingerprint was recorded", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      const request = await createFixtureRequest(fixture); // contextFingerprint: null
      const suggestion = await createSuggestion({
        generationRequestId: request.id,
        suggestionType: "EDITORIAL_PROSE",
        targetEntityType: "RECORDING",
        targetEntityId: fixture.recordingId,
        proposedContent: "text",
        evidenceRefs: [],
      });
      expect(await checkContentSuggestionFreshness(suggestion.id)).toBe("UNKNOWN");
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("reports CURRENT immediately after generation, then STALE once the canonical context changes", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      const currentContext = await getRecordingContext(fixture.recordingId);
      expect(currentContext.ok).toBe(true);
      if (!currentContext.ok) return;
      const fingerprint = computeContextFingerprint(currentContext.context);

      const request = await createFixtureRequest(fixture, { contextFingerprint: fingerprint });
      const suggestion = await createSuggestion({
        generationRequestId: request.id,
        suggestionType: "EDITORIAL_PROSE",
        targetEntityType: "RECORDING",
        targetEntityId: fixture.recordingId,
        proposedContent: "text",
        evidenceRefs: [],
      });

      expect(await checkContentSuggestionFreshness(suggestion.id)).toBe("CURRENT");

      // Change the canonical context: attach a second work to a new published revision.
      const secondWork = await createMusicalWork({ slug: uniqueSlug("work-2"), title: "Second Work", composerId: fixture.composer.id, actorId: fixture.user.id });
      const forked = await forkDraftFromPublished(fixture.recordingId, fixture.user.id);
      await attachWorkToRevision(forked.id, secondWork.id, fixture.user.id);
      await publishCurrentDraft(fixture.recordingId, fixture.user.id);

      expect(await checkContentSuggestionFreshness(suggestion.id)).toBe("STALE");

      // The original suggestion itself is untouched by the context change.
      const reloaded = await findContentSuggestionById(suggestion.id);
      expect(reloaded?.status).toBe("DRAFT_READY");
      expect(reloaded?.proposedContent).toBe("text");
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("reports UNKNOWN once the target Recording has been archived", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      const currentContext = await getRecordingContext(fixture.recordingId);
      if (!currentContext.ok) return;
      const fingerprint = computeContextFingerprint(currentContext.context);
      const request = await createFixtureRequest(fixture, { contextFingerprint: fingerprint });
      const suggestion = await createSuggestion({
        generationRequestId: request.id,
        suggestionType: "EDITORIAL_PROSE",
        targetEntityType: "RECORDING",
        targetEntityId: fixture.recordingId,
        proposedContent: "text",
        evidenceRefs: [],
      });

      await archiveRecording(fixture.recordingId, fixture.user.id);
      expect(await checkContentSuggestionFreshness(suggestion.id)).toBe("UNKNOWN");
    } finally {
      await cleanupFixture(fixture);
    }
  });
});

describe("E. Canonical MMKE immutability across the full workflow", () => {
  it("creating, reviewing, approving, and rejecting suggestions never changes the Recording or its revisions", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      const recordingBefore = await prisma.recording.findUnique({ where: { id: fixture.recordingId } });
      const revisionsBefore = await prisma.recordingRevision.findMany({ where: { recordingId: fixture.recordingId } });

      const request = await createFixtureRequest(fixture);
      await markGenerationRequestGenerating(request.id);
      await completeGenerationRequest(request.id, { status: "SUCCEEDED" });
      const suggestion = await createSuggestion({
        generationRequestId: request.id,
        suggestionType: "EDITORIAL_PROSE",
        targetEntityType: "RECORDING",
        targetEntityId: fixture.recordingId,
        proposedContent: "text",
        evidenceRefs: [],
      });
      await submitSuggestionForReview(suggestion.id, fixture.user.id);
      await approveContentSuggestion(suggestion.id, fixture.user.id, { finalContent: "edited" });

      const recordingAfter = await prisma.recording.findUnique({ where: { id: fixture.recordingId } });
      const revisionsAfter = await prisma.recordingRevision.findMany({ where: { recordingId: fixture.recordingId } });

      expect(recordingAfter).toEqual(recordingBefore);
      expect(revisionsAfter).toEqual(revisionsBefore);
    } finally {
      await cleanupFixture(fixture);
    }
  });
});

describe("F. RBAC boundary", () => {
  it("RECORDING_WRITE (view/request) is available to Contributor and above; EDITORIAL_REVIEW (review decisions) is not", () => {
    expect(can("CONTRIBUTOR", "RECORDING_WRITE")).toBe(true);
    expect(can("CONTRIBUTOR", "EDITORIAL_REVIEW")).toBe(false);
    expect(can("EDITOR", "RECORDING_WRITE")).toBe(true);
    expect(can("EDITOR", "EDITORIAL_REVIEW")).toBe(true);
    expect(can("REVIEWER", "EDITORIAL_REVIEW")).toBe(true);
    expect(can("ADMINISTRATOR", "EDITORIAL_REVIEW")).toBe(true);
  });
});

describe("G. Read helpers", () => {
  it("findGenerationRequestById and findContentSuggestionById include their StudioUser relations", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      const request = await createFixtureRequest(fixture);
      const suggestion = await createSuggestion({
        generationRequestId: request.id,
        suggestionType: "SEO_METADATA",
        targetEntityType: "RECORDING",
        targetEntityId: fixture.recordingId,
        proposedContent: "A suggested title.",
        evidenceRefs: [],
      });

      const loadedRequest = await findGenerationRequestById(request.id);
      expect(loadedRequest?.requestedBy.id).toBe(fixture.user.id);

      const loadedSuggestion = await findContentSuggestionById(suggestion.id);
      expect(loadedSuggestion?.generationRequest.id).toBe(request.id);
      expect(loadedSuggestion?.reviewedBy).toBeNull();
    } finally {
      await cleanupFixture(fixture);
    }
  });
});
