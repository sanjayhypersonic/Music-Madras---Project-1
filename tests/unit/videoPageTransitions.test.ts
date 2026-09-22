import { describe, expect, it } from "vitest";
import { canPublishVideoPage, canUnpublishVideoPage, isValidVideoPageTransition } from "../../modules/publishing/videoPageTransitions";

describe("videoPageTransitions", () => {
  it("DRAFT -> PUBLISHED is valid", () => {
    expect(isValidVideoPageTransition("DRAFT", "PUBLISHED")).toBe(true);
  });

  it("PUBLISHED -> DRAFT is valid (unpublishing)", () => {
    expect(isValidVideoPageTransition("PUBLISHED", "DRAFT")).toBe(true);
  });

  it("DRAFT -> DRAFT is rejected", () => {
    expect(isValidVideoPageTransition("DRAFT", "DRAFT")).toBe(false);
  });

  it("PUBLISHED -> PUBLISHED is rejected", () => {
    expect(isValidVideoPageTransition("PUBLISHED", "PUBLISHED")).toBe(false);
  });

  it("canPublishVideoPage is true for an active draft", () => {
    expect(canPublishVideoPage({ status: "DRAFT", archivedAt: null })).toBe(true);
  });

  it("canPublishVideoPage is false for an already-published page", () => {
    expect(canPublishVideoPage({ status: "PUBLISHED", archivedAt: null })).toBe(false);
  });

  it("canPublishVideoPage is false for an archived draft", () => {
    expect(canPublishVideoPage({ status: "DRAFT", archivedAt: new Date() })).toBe(false);
  });

  it("canUnpublishVideoPage is true for an active published page", () => {
    expect(canUnpublishVideoPage({ status: "PUBLISHED", archivedAt: null })).toBe(true);
  });

  it("canUnpublishVideoPage is false for a draft", () => {
    expect(canUnpublishVideoPage({ status: "DRAFT", archivedAt: null })).toBe(false);
  });

  it("canUnpublishVideoPage is false for an archived published page", () => {
    expect(canUnpublishVideoPage({ status: "PUBLISHED", archivedAt: new Date() })).toBe(false);
  });
});
