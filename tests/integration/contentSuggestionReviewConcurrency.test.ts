import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

// Must be at the true top level — vi.mock is hoisted above every import.
const mockGetCurrentStudioSession = vi.fn();
vi.mock("../../modules/auth/authService", () => ({
  getCurrentStudioSession: () => mockGetCurrentStudioSession(),
}));

import { prisma } from "../../modules/db/client";
import { createDraftRecording } from "../../modules/db/repositories/recordingRepository";
import {
  approveContentSuggestion,
  completeGenerationRequest,
  createGenerationRequest,
  createSuggestion,
  rejectContentSuggestion,
  requestContentSuggestionChanges,
  submitSuggestionForReview,
} from "../../modules/db/repositories/contentSuggestionRepository";
import { approveAction, rejectAction, requestChangesAction, submitForReviewAction } from "../../app/(studio)/studio/(protected)/content-suggestions/[id]/actions";

// Phase 6J-5 — two reviewers must never both succeed in moving the same suggestion out of the same
// state. The review decision is an atomic compare-and-set on the status the reviewer saw; the loser is
// refused cleanly and the refusal is audited (CONTENT_SUGGESTION_TRANSITION_REFUSED).

const T = 120000;
const TOKEN = randomUUID().slice(0, 8);
const users = {} as Record<"A" | "B" | "C" | "CONTRIBUTOR", string>;
let recordingId: string;
const suggestionIds: string[] = [];
const requestIds: string[] = [];

async function newSuggestion(status: "DRAFT_READY" | "EDITOR_REVIEW" = "EDITOR_REVIEW") {
  const request = await createGenerationRequest({
    targetEntityType: "RECORDING",
    targetEntityId: recordingId,
    suggestionType: "EDITORIAL_PROSE",
    contextFingerprint: `fp-${randomUUID()}`,
    provider: "fake",
    promptVersion: "test",
    requestedById: users.A,
  });
  requestIds.push(request.id);
  await completeGenerationRequest(request.id, { status: "SUCCEEDED" });
  const suggestion = await createSuggestion({
    generationRequestId: request.id,
    suggestionType: "EDITORIAL_PROSE",
    targetEntityType: "RECORDING",
    targetEntityId: recordingId,
    targetField: "description",
    proposedContent: "A proposal.",
    evidenceRefs: [{ sourceType: "CANONICAL_MMKE", entityType: "Composer", entityId: randomUUID(), field: "composers" }],
  });
  suggestionIds.push(suggestion.id);
  if (status === "EDITOR_REVIEW") await submitSuggestionForReview(suggestion.id, users.A);
  return suggestion.id;
}
const row = (id: string) => prisma.contentSuggestion.findUniqueOrThrow({ where: { id } });
async function audit(id: string) {
  return prisma.auditLogEntry.findMany({ where: { entityType: "ContentSuggestion", entityId: id }, orderBy: { timestamp: "asc" } });
}
const DECISIONS = ["CONTENT_SUGGESTION_APPROVED", "CONTENT_SUGGESTION_REJECTED", "CONTENT_SUGGESTION_CHANGES_REQUESTED"];
const form = (fields: Record<string, string> = {}) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};
async function redirectOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    const digest = (err as { digest?: unknown }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) return decodeURIComponent(digest.split(";").slice(2, -2).join(";").replace(/\+/g, " "));
    throw err;
  }
  throw new Error("The action did not redirect");
}

beforeAll(async () => {
  for (const key of ["A", "B", "C"] as const) {
    users[key] = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `p6j5-${key.toLowerCase()}-${TOKEN}@musicmadras.test`, name: `P6J5 ${key}`, role: "REVIEWER", status: "ACTIVE" } })).id;
  }
  users.CONTRIBUTOR = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `p6j5-contrib-${TOKEN}@musicmadras.test`, name: "P6J5 contributor", role: "CONTRIBUTOR", status: "ACTIVE" } })).id;
  recordingId = (await createDraftRecording({ slug: `p6j5-concurrency-${TOKEN}`, actorId: users.A, title: "Concurrency fixture" })).id;
}, T);

afterAll(async () => {
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityId: { in: [...suggestionIds, ...requestIds, recordingId] } }, { actorId: { in: Object.values(users) } }] } });
  await prisma.contentSuggestion.deleteMany({ where: { id: { in: suggestionIds } } });
  await prisma.contentGenerationRequest.deleteMany({ where: { id: { in: requestIds } } });
  await prisma.recording.deleteMany({ where: { id: recordingId } });
  await prisma.studioUser.deleteMany({ where: { id: { in: Object.values(users) } } });
}, T);

describe("review transitions are atomic compare-and-set", () => {
  it("two simultaneous approvals: exactly one wins, the other is refused and audited", async () => {
    for (let round = 0; round < 6; round++) {
      const id = await newSuggestion();
      const results = await Promise.allSettled([approveContentSuggestion(id, users.A, { reviewNote: "A" }), approveContentSuggestion(id, users.B, { reviewNote: "B" })]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

      const final = await row(id);
      expect(final.status).toBe("APPROVED");
      const winner = (results.findIndex((r) => r.status === "fulfilled") === 0 ? users.A : users.B);
      expect(final.reviewedById).toBe(winner); // one coherent decision — never a mix of the two reviewers' fields
      expect(final.reviewNote).toBe(winner === users.A ? "A" : "B");

      const entries = await audit(id);
      expect(entries.filter((e) => e.action === "CONTENT_SUGGESTION_APPROVED")).toHaveLength(1);
      const refused = entries.filter((e) => e.action === "CONTENT_SUGGESTION_TRANSITION_REFUSED");
      expect(refused).toHaveLength(1);
      expect(refused[0].afterSnapshot).toMatchObject({ attempted: "APPROVED" });
      expect(refused[0].actorId).toBe(winner === users.A ? users.B : users.A);
    }
  }, T);

  it("many simultaneous approvals still produce exactly one approval", async () => {
    const id = await newSuggestion();
    const results = await Promise.allSettled([users.A, users.B, users.C, users.A, users.B, users.C].map((u) => approveContentSuggestion(id, u)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const entries = await audit(id);
    expect(entries.filter((e) => DECISIONS.includes(e.action))).toHaveLength(1);
    expect(entries.filter((e) => e.action === "CONTENT_SUGGESTION_TRANSITION_REFUSED")).toHaveLength(5);
  }, T);

  it("approve vs reject: exactly one decision, and the stored decision matches the one that was audited", async () => {
    for (let round = 0; round < 6; round++) {
      const id = await newSuggestion();
      const results = await Promise.allSettled([approveContentSuggestion(id, users.A), rejectContentSuggestion(id, users.B, { reason: "INCORRECT", reviewNote: "no" })]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const final = await row(id);
      const decisions = (await audit(id)).filter((e) => DECISIONS.includes(e.action));
      expect(decisions).toHaveLength(1);
      if (final.status === "APPROVED") {
        expect(decisions[0].action).toBe("CONTENT_SUGGESTION_APPROVED");
        expect(final.reviewedById).toBe(users.A);
        expect(final.reviewDecision).toBe("ACCEPT");
      } else {
        expect(final.status).toBe("REJECTED");
        expect(decisions[0].action).toBe("CONTENT_SUGGESTION_REJECTED");
        expect(final.reviewedById).toBe(users.B);
        expect(final.reviewDecision).toBe("REJECT_INCORRECT");
        expect(final.finalContent).toBeNull(); // nothing from the losing approval leaked in
      }
    }
  }, T);

  it("approve vs request-changes: exactly one decision", async () => {
    for (let round = 0; round < 6; round++) {
      const id = await newSuggestion();
      const results = await Promise.allSettled([approveContentSuggestion(id, users.A), requestContentSuggestionChanges(id, users.B, "Please add the venue.")]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const final = await row(id);
      expect(["APPROVED", "CHANGES_REQUESTED"]).toContain(final.status);
      expect((await audit(id)).filter((e) => DECISIONS.includes(e.action))).toHaveLength(1);
      expect(final.reviewedById).toBe(final.status === "APPROVED" ? users.A : users.B);
    }
  }, T);

  it("a stale reviewer action (the page showed EDITOR_REVIEW, someone already decided) is refused and audited", async () => {
    const id = await newSuggestion();
    await rejectContentSuggestion(id, users.B, { reason: "OTHER", reviewNote: "decided first" });
    await expect(approveContentSuggestion(id, users.A)).rejects.toThrow(/cannot be approved from its current status \(REJECTED\)/);
    const final = await row(id);
    expect(final).toMatchObject({ status: "REJECTED", reviewedById: users.B, reviewDecision: "REJECT_OTHER" });
    const refused = (await audit(id)).filter((e) => e.action === "CONTENT_SUGGESTION_TRANSITION_REFUSED");
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ actorId: users.A });
    expect(refused[0].beforeSnapshot).toMatchObject({ status: "REJECTED" });
    expect(refused[0].afterSnapshot).toMatchObject({ attempted: "APPROVED", reason: "INVALID_STATE" });
  }, T);

  it("an already-terminal suggestion accepts no further decision of any kind", async () => {
    const approved = await newSuggestion();
    await approveContentSuggestion(approved, users.A);
    await expect(approveContentSuggestion(approved, users.B)).rejects.toThrow();
    await expect(rejectContentSuggestion(approved, users.B, { reason: "OTHER" })).rejects.toThrow();
    await expect(requestContentSuggestionChanges(approved, users.B, "x")).rejects.toThrow();
    await expect(submitSuggestionForReview(approved, users.B)).rejects.toThrow();
    expect(await row(approved)).toMatchObject({ status: "APPROVED", reviewedById: users.A });

    const rejected = await newSuggestion();
    await rejectContentSuggestion(rejected, users.A, { reason: "UNSUPPORTED" });
    await expect(approveContentSuggestion(rejected, users.B)).rejects.toThrow();
    expect((await row(rejected)).status).toBe("REJECTED");
    expect((await audit(rejected)).filter((e) => e.action === "CONTENT_SUGGESTION_TRANSITION_REFUSED")).toHaveLength(1);
  }, T);

  it("two simultaneous submissions into review: one moves it, the other is refused", async () => {
    const id = await newSuggestion("DRAFT_READY");
    const results = await Promise.allSettled([submitSuggestionForReview(id, users.A), submitSuggestionForReview(id, users.B)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await row(id)).status).toBe("EDITOR_REVIEW");
    expect((await audit(id)).filter((e) => e.action === "CONTENT_SUGGESTION_SUBMITTED_FOR_REVIEW")).toHaveLength(1);
  }, T);

  it("a refused transition does not touch the loser's would-be fields (no partial write)", async () => {
    const id = await newSuggestion();
    await requestContentSuggestionChanges(id, users.A, "First note");
    const before = await row(id);
    await expect(rejectContentSuggestion(id, users.B, { reason: "INCORRECT", reviewNote: "Second note" })).rejects.toThrow(); // not a legal move from CHANGES_REQUESTED
    await expect(approveContentSuggestion(id, users.C, { finalContent: "Sneaky rewrite", reviewNote: "Third note" })).rejects.toThrow();
    expect(await row(id)).toMatchObject({ status: "CHANGES_REQUESTED", reviewNote: "First note", reviewedById: users.A, finalContent: null, reviewDecision: before.reviewDecision });
  }, T);
});

describe("the Studio actions report a lost race cleanly and keep RBAC", () => {
  it("the second reviewer's action redirects with a message instead of throwing", async () => {
    const id = await newSuggestion();
    mockGetCurrentStudioSession.mockResolvedValue({ user: { id: users.A, role: "REVIEWER", status: "ACTIVE" } });
    await redirectOf(() => approveAction(id, form({ reviewNote: "approved" })));

    mockGetCurrentStudioSession.mockResolvedValue({ user: { id: users.B, role: "REVIEWER", status: "ACTIVE" } });
    expect(await redirectOf(() => rejectAction(id, form({ reason: "INCORRECT" })))).toMatch(/\?error=.*cannot be rejected/);
    expect(await redirectOf(() => requestChangesAction(id, form({ reviewNote: "n" })))).toMatch(/\?error=.*Changes cannot be requested/);
    expect(await redirectOf(() => submitForReviewAction(id))).toMatch(/\?error=/);
    expect(await row(id)).toMatchObject({ status: "APPROVED", reviewedById: users.A });
  }, T);

  it("a Contributor still cannot decide, and no refusal audit is written for a permission failure", async () => {
    const id = await newSuggestion();
    mockGetCurrentStudioSession.mockResolvedValue({ user: { id: users.CONTRIBUTOR, role: "CONTRIBUTOR", status: "ACTIVE" } });
    expect(await redirectOf(() => approveAction(id, form()))).toMatch(/permission/);
    expect(await redirectOf(() => rejectAction(id, form({ reason: "OTHER" })))).toMatch(/permission/);
    mockGetCurrentStudioSession.mockResolvedValue(null);
    expect(await redirectOf(() => approveAction(id, form()))).toMatch(/permission/);
    expect((await row(id)).status).toBe("EDITOR_REVIEW");
    expect((await audit(id)).some((e) => e.action === "CONTENT_SUGGESTION_TRANSITION_REFUSED")).toBe(false);
  }, T);
});
