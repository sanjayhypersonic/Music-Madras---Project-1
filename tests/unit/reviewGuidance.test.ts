import { describe, expect, it } from "vitest";
import { checkRecordingRevisionCompleteness } from "../../modules/mmke/completeness/checkRecordingRevisionCompleteness";
import { describeReviewGuidance, type GuidanceInput } from "../../modules/publishing/reviewGuidance";
import { REVIEW_NOTICES, reviewNoticeText } from "../../modules/publishing/reviewNotices";

const complete = checkRecordingRevisionCompleteness({ title: "T", linkedWorkCount: 1, hasPerformance: true, hasVenue: true, participantCount: 1, hasPrimaryVideo: true, hasSeoMetaTitle: true, hasEducationalContent: true });
const incomplete = checkRecordingRevisionCompleteness({ title: "T", linkedWorkCount: 0, hasPerformance: false, hasVenue: true, participantCount: 1, hasPrimaryVideo: false, hasSeoMetaTitle: true, hasEducationalContent: false });

const whoCan = { review: "Editors and Administrators", publish: "Administrators" };
const base: GuidanceInput = {
  status: "DRAFT",
  hasOpenDraft: true,
  hasPublishedRevision: false,
  report: incomplete,
  held: false,
  viewer: { canEdit: true, canSubmitForReview: false, canPublish: false },
  whoCan,
};
const actionOf = (g: ReturnType<typeof describeReviewGuidance>, key: string) => g.actions.find((a) => a.key === key);

describe("describeReviewGuidance", () => {
  it("names only the REQUIRED missing categories as blockers, each with its step", () => {
    const g = describeReviewGuidance(base);
    expect(g.blockers.map((b) => b.category)).toEqual(["Musical Works", "Media"]);
    expect(g.blockers.map((b) => b.step?.slug)).toEqual(["works", "media"]);
    // Performance is only RECOMMENDED: a suggestion, never a blocker.
    expect(g.suggestions.map((s) => s.category)).toEqual(["Performance"]);
    expect(g.summary).toMatch(/cannot be published yet: 2 required items are missing/);
  });

  it("blocks Publish with the reason, for any viewer, while a required category is missing", () => {
    for (const canPublish of [true, false]) {
      const g = describeReviewGuidance({ ...base, viewer: { canEdit: true, canSubmitForReview: true, canPublish } });
      expect(actionOf(g, "PUBLISH")).toMatchObject({ state: "BLOCKED" });
      expect(actionOf(g, "PUBLISH")?.reason).toMatch(/Musical Works and Media are provided/);
    }
  });

  it("a complete draft: a viewer who cannot publish is told who can; one who can publish is offered it", () => {
    const cannot = describeReviewGuidance({ ...base, report: complete });
    expect(cannot.blockers).toEqual([]);
    expect(actionOf(cannot, "PUBLISH")).toMatchObject({ state: "NEEDS_PERMISSION" });
    expect(actionOf(cannot, "PUBLISH")?.reason).toContain("Only Administrators can publish");
    const can = describeReviewGuidance({ ...base, report: complete, viewer: { canEdit: true, canSubmitForReview: true, canPublish: true } });
    expect(actionOf(can, "PUBLISH")).toMatchObject({ state: "AVAILABLE" });
  });

  it("submit for review: offered with permission, otherwise says who can; only for a DRAFT", () => {
    expect(actionOf(describeReviewGuidance({ ...base, viewer: { ...base.viewer, canSubmitForReview: true } }), "SUBMIT_FOR_REVIEW")).toMatchObject({ state: "AVAILABLE" });
    const denied = describeReviewGuidance(base);
    expect(actionOf(denied, "SUBMIT_FOR_REVIEW")).toMatchObject({ state: "NEEDS_PERMISSION" });
    expect(actionOf(denied, "SUBMIT_FOR_REVIEW")?.reason).toContain("Editors and Administrators");
    expect(actionOf(describeReviewGuidance({ ...base, status: "IN_REVIEW" }), "SUBMIT_FOR_REVIEW")).toBeUndefined();
  });

  it("a hold is never described as making a published recording public", () => {
    const g = describeReviewGuidance({ ...base, report: complete, held: true, viewer: { canEdit: true, canSubmitForReview: true, canPublish: true } });
    expect(g.summary).toMatch(/on hold/);
    expect(actionOf(g, "PUBLISH")?.reason).toMatch(/will not make it public until the hold is lifted/);
  });

  it("a published recording with no draft has no blockers and no Publish action; unpublish needs publish permission", () => {
    const published: GuidanceInput = { ...base, status: "PUBLISHED", hasOpenDraft: false, hasPublishedRevision: true, report: complete };
    const g = describeReviewGuidance(published);
    expect(g.blockers).toEqual([]);
    expect(actionOf(g, "PUBLISH")).toBeUndefined();
    expect(actionOf(g, "UNPUBLISH")).toMatchObject({ state: "NEEDS_PERMISSION" });
    expect(g.summary).toMatch(/no pending changes/);
    expect(actionOf(describeReviewGuidance({ ...published, viewer: { ...published.viewer, canPublish: true } }), "UNPUBLISH")).toMatchObject({ state: "AVAILABLE" });
  });

  it("an archived recording can only be restored (never published), and says so", () => {
    const g = describeReviewGuidance({ ...base, status: "ARCHIVED", hasOpenDraft: false, hasPublishedRevision: true, report: complete, viewer: { ...base.viewer, canPublish: true } });
    expect(actionOf(g, "PUBLISH")).toBeUndefined();
    expect(actionOf(g, "RESTORE")).toMatchObject({ state: "AVAILABLE" });
    expect(g.summary).toMatch(/archived and not public/);
  });

  it("an unpublished recording (no open draft, not public) says a new draft is needed", () => {
    const g = describeReviewGuidance({ ...base, status: "DRAFT", hasOpenDraft: false, hasPublishedRevision: true, report: complete });
    expect(g.summary).toMatch(/not public and has no open draft/);
    expect(g.blockers).toEqual([]);
  });
});

describe("review notices", () => {
  it("maps only known codes to fixed sentences", () => {
    for (const code of Object.keys(REVIEW_NOTICES)) expect(reviewNoticeText(code)).toBe(REVIEW_NOTICES[code as keyof typeof REVIEW_NOTICES]);
    expect(reviewNoticeText("PUBLISHED")).toMatch(/^Published/);
  });

  it("shows nothing for anything else, including prototype keys and injected text", () => {
    for (const bad of [undefined, null, "", "toString", "__proto__", "constructor", "<script>alert(1)</script>", "published", "Your account is locked, call 555"]) {
      expect(reviewNoticeText(bad as string)).toBeNull();
    }
  });
});
