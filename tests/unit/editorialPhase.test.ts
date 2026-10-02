import { describe, expect, it } from "vitest";
import { computeEditorialPhase } from "../../modules/publishing/editorialPhase";

describe("computeEditorialPhase", () => {
  it("is ARCHIVED regardless of anything else", () => {
    expect(
      computeEditorialPhase({
        aggregateStatus: "ARCHIVED",
        hasPublishedRevision: true,
        draftReadiness: "PUBLISHABLE",
        draftHasAnyContent: true,
      })
    ).toBe("ARCHIVED");
  });

  it("a freshly created draft with no content is DRAFT", () => {
    expect(
      computeEditorialPhase({
        aggregateStatus: "DRAFT",
        hasPublishedRevision: false,
        draftReadiness: "INCOMPLETE",
        draftHasAnyContent: false,
      })
    ).toBe("DRAFT");
  });

  it("a draft with some content but not yet submitted is ENRICHMENT", () => {
    expect(
      computeEditorialPhase({
        aggregateStatus: "DRAFT",
        hasPublishedRevision: false,
        draftReadiness: "INCOMPLETE",
        draftHasAnyContent: true,
      })
    ).toBe("ENRICHMENT");
  });

  it("a never-published recording in review, still missing required fields, is EDITORIAL_REVIEW", () => {
    expect(
      computeEditorialPhase({
        aggregateStatus: "IN_REVIEW",
        hasPublishedRevision: false,
        draftReadiness: "READY_FOR_REVIEW",
        draftHasAnyContent: true,
      })
    ).toBe("EDITORIAL_REVIEW");
  });

  it("a never-published recording in review with every required field complete is APPROVED", () => {
    expect(
      computeEditorialPhase({
        aggregateStatus: "IN_REVIEW",
        hasPublishedRevision: false,
        draftReadiness: "PUBLISHABLE",
        draftHasAnyContent: true,
      })
    ).toBe("APPROVED");
  });

  it("a published recording with a newly forked draft is UPDATED, not EDITORIAL_REVIEW", () => {
    expect(
      computeEditorialPhase({
        aggregateStatus: "IN_REVIEW",
        hasPublishedRevision: true,
        draftReadiness: "INCOMPLETE",
        draftHasAnyContent: true,
      })
    ).toBe("UPDATED");
  });

  it("a published recording with no open draft is simply PUBLISHED", () => {
    expect(
      computeEditorialPhase({
        aggregateStatus: "PUBLISHED",
        hasPublishedRevision: true,
        draftReadiness: null,
        draftHasAnyContent: false,
      })
    ).toBe("PUBLISHED");
  });

  // Phase 6I-2: forkDraftFromPublished now keeps a live Recording PUBLISHED
  // while its new draft is open, so PUBLISHED + an open draft is a pending update.
  it("a PUBLISHED recording that has an open draft is UPDATED (it stays live while being edited)", () => {
    expect(
      computeEditorialPhase({
        aggregateStatus: "PUBLISHED",
        hasPublishedRevision: true,
        draftReadiness: "PUBLISHABLE",
        draftHasAnyContent: true,
        hasOpenDraft: true,
      })
    ).toBe("UPDATED");
  });

  it("hasOpenDraft defaults to false, so existing callers that omit it still get PUBLISHED", () => {
    expect(
      computeEditorialPhase({ aggregateStatus: "PUBLISHED", hasPublishedRevision: true, draftReadiness: null, draftHasAnyContent: false })
    ).toBe("PUBLISHED");
  });
});
