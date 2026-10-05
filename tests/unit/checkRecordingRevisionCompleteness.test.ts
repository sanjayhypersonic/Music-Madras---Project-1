import { describe, expect, it } from "vitest";
import {
  checkRecordingRevisionCompleteness,
  computeRecordingReadiness,
  isReadyToPublish,
  type RecordingRevisionCompletenessInput,
} from "../../modules/mmke/completeness/checkRecordingRevisionCompleteness";

const completeInput: RecordingRevisionCompletenessInput = {
  title: "Toccata and Fugue in D minor",
  linkedWorkCount: 1,
  hasPerformance: true,
  hasVenue: true,
  participantCount: 2,
  hasPrimaryVideo: true,
  hasEducationalContent: true,
  hasSeoMetaTitle: true,
};

describe("checkRecordingRevisionCompleteness", () => {
  it("marks every category COMPLETE when all inputs are satisfied", () => {
    const report = checkRecordingRevisionCompleteness(completeInput);
    expect(report.every((item) => item.status === "COMPLETE")).toBe(true);
  });

  it("flags a missing title as REQUIRED and MISSING", () => {
    const report = checkRecordingRevisionCompleteness({ ...completeInput, title: null });
    const identity = report.find((item) => item.category === "Identity");
    expect(identity?.level).toBe("REQUIRED");
    expect(identity?.status).toBe("MISSING");
  });

  it("flags zero linked works as REQUIRED and MISSING", () => {
    const report = checkRecordingRevisionCompleteness({ ...completeInput, linkedWorkCount: 0 });
    const works = report.find((item) => item.category === "Musical Works");
    expect(works?.status).toBe("MISSING");
  });

  it("treats missing Performance/Venue/Performers/SEO as RECOMMENDED, not REQUIRED", () => {
    const report = checkRecordingRevisionCompleteness({
      ...completeInput,
      hasPerformance: false,
      hasVenue: false,
      participantCount: 0,
      hasSeoMetaTitle: false,
    });
    for (const category of ["Performance", "Venue", "Performers", "SEO"]) {
      const item = report.find((entry) => entry.category === category);
      expect(item?.level).toBe("RECOMMENDED");
      expect(item?.status).toBe("MISSING");
    }
  });

  it("treats missing Educational Content as OPTIONAL", () => {
    const report = checkRecordingRevisionCompleteness({
      ...completeInput,
      hasEducationalContent: false,
    });
    const educational = report.find((item) => item.category === "Educational Content");
    expect(educational?.level).toBe("OPTIONAL");
  });
});

describe("the Media row (Phase 6J-4: its detail describes the current state, not a static requirement)", () => {
  const media = (hasPrimaryVideo: boolean) => checkRecordingRevisionCompleteness({ ...completeInput, hasPrimaryVideo }).find((item) => item.category === "Media")!;

  it("COMPLETE: says the primary video is attached and no longer says it is required", () => {
    expect(media(true)).toEqual({ category: "Media", level: "REQUIRED", status: "COMPLETE", detail: "Primary video attached" });
    expect(media(true).detail).not.toMatch(/required/i);
  });

  it("MISSING: states the requirement", () => {
    expect(media(false)).toEqual({ category: "Media", level: "REQUIRED", status: "MISSING", detail: "A primary video media resource is required before publishing" });
  });

  it("no COMPLETE row ever carries wording that says something is still required or missing", () => {
    const report = checkRecordingRevisionCompleteness(completeInput);
    for (const item of report.filter((i) => i.status === "COMPLETE")) expect(item.detail ?? "", item.category).not.toMatch(/required before|missing/i);
  });
});

describe("isReadyToPublish", () => {
  it("is true when every REQUIRED category is COMPLETE, even if RECOMMENDED/OPTIONAL ones are MISSING", () => {
    const report = checkRecordingRevisionCompleteness({
      ...completeInput,
      hasPerformance: false,
      hasVenue: false,
      participantCount: 0,
      hasSeoMetaTitle: false,
      hasEducationalContent: false,
    });
    expect(isReadyToPublish(report)).toBe(true);
  });

  it("is false when any REQUIRED category is MISSING", () => {
    const report = checkRecordingRevisionCompleteness({ ...completeInput, hasPrimaryVideo: false });
    expect(isReadyToPublish(report)).toBe(false);
  });
});

describe("computeRecordingReadiness (brief §12 — named categories, not a percentage)", () => {
  it("is INCOMPLETE when a REQUIRED category is missing, regardless of everything else", () => {
    const report = checkRecordingRevisionCompleteness({ ...completeInput, linkedWorkCount: 0 });
    expect(computeRecordingReadiness(report)).toBe("INCOMPLETE");
  });

  it("is READY_FOR_REVIEW when all REQUIRED are complete but a RECOMMENDED one is missing", () => {
    const report = checkRecordingRevisionCompleteness({ ...completeInput, hasVenue: false });
    expect(computeRecordingReadiness(report)).toBe("READY_FOR_REVIEW");
  });

  it("is PUBLISHABLE when every REQUIRED and RECOMMENDED category is complete", () => {
    const report = checkRecordingRevisionCompleteness(completeInput);
    expect(computeRecordingReadiness(report)).toBe("PUBLISHABLE");
  });

  it("is still PUBLISHABLE when only the OPTIONAL category is missing", () => {
    const report = checkRecordingRevisionCompleteness({ ...completeInput, hasEducationalContent: false });
    expect(computeRecordingReadiness(report)).toBe("PUBLISHABLE");
  });
});
