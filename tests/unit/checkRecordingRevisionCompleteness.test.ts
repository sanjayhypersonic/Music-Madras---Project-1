import { describe, expect, it } from "vitest";
import {
  checkRecordingRevisionCompleteness,
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
