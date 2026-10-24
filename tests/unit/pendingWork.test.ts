import { describe, expect, it } from "vitest";
import { listPendingWork, pendingKind, type PendingCandidate } from "../../modules/publishing/pendingWork";

const r = (id: string, status: PendingCandidate["status"], draft: string | null = null): PendingCandidate => ({ id, status, currentDraftRevisionId: draft });

describe("pending editorial work", () => {
  it("classifies each lifecycle state", () => {
    expect(pendingKind(r("a", "IN_REVIEW", "d"))).toBe("AWAITING_REVIEW");
    expect(pendingKind(r("a", "DRAFT", "d"))).toBe("DRAFT");
    expect(pendingKind(r("a", "DRAFT"))).toBe("NOT_PUBLIC");
    expect(pendingKind(r("a", "PUBLISHED", "d"))).toBe("PENDING_CHANGES");
  });

  it("a live recording with nothing pending, and an archived one, are not pending work", () => {
    expect(pendingKind(r("a", "PUBLISHED"))).toBeNull();
    expect(pendingKind(r("a", "ARCHIVED"))).toBeNull();
    expect(pendingKind(r("a", "ARCHIVED", "d"))).toBeNull();
  });

  it("puts recordings awaiting review first and keeps the given order within a kind", () => {
    const list = [r("pub-pending", "PUBLISHED", "x"), r("draft-1", "DRAFT", "x"), r("review-1", "IN_REVIEW", "x"), r("live", "PUBLISHED"), r("draft-2", "DRAFT", "y"), r("review-2", "IN_REVIEW", "y"), r("unpub", "DRAFT")];
    expect(listPendingWork(list).map((x) => x.item.id)).toEqual(["review-1", "review-2", "draft-1", "draft-2", "pub-pending", "unpub"]);
  });
});
