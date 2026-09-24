import { describe, expect, it } from "vitest";
import { isRecordingPublished } from "../../modules/mmke/catalogue/isRecordingPublished";
import type { RecordingAggregateStatus } from "@prisma/client";

describe("isRecordingPublished", () => {
  it("PUBLISHED with a currentPublishedRevisionId is public", () => {
    expect(isRecordingPublished({ status: "PUBLISHED", currentPublishedRevisionId: "rev-1" })).toBe(true);
  });

  it("DRAFT is never public, even if currentPublishedRevisionId is somehow set", () => {
    expect(isRecordingPublished({ status: "DRAFT", currentPublishedRevisionId: "rev-1" })).toBe(false);
  });

  it("IN_REVIEW is never public, even if currentPublishedRevisionId is somehow set", () => {
    expect(isRecordingPublished({ status: "IN_REVIEW", currentPublishedRevisionId: "rev-1" })).toBe(false);
  });

  it("ARCHIVED is never public, even though archiveRecording never clears currentPublishedRevisionId", () => {
    expect(isRecordingPublished({ status: "ARCHIVED", currentPublishedRevisionId: "rev-1" })).toBe(false);
  });

  it("PUBLISHED with a null currentPublishedRevisionId is not public (should be unreachable in practice, but the predicate must not trust status alone)", () => {
    expect(isRecordingPublished({ status: "PUBLISHED", currentPublishedRevisionId: null })).toBe(false);
  });

  it("every non-PUBLISHED status with a null currentPublishedRevisionId is not public", () => {
    const statuses: RecordingAggregateStatus[] = ["DRAFT", "IN_REVIEW", "ARCHIVED"];
    for (const status of statuses) {
      expect(isRecordingPublished({ status, currentPublishedRevisionId: null })).toBe(false);
    }
  });
});
