import { describe, expect, it } from "vitest";
import { fieldText, normaliseEvidenceText, quoteOccursIn, verifyEvidence, type VideoText } from "../../modules/mmke/provenance/verbatimEvidence";
import { verifyEvidence as verifyStagingEvidence, type StagingContentSpec } from "../../modules/seed/stagingContentSpec";

// The shared verbatim-quotation check (moved out of the staging loader so the video-credits extraction uses exactly the same rule).

const video: VideoText = {
  youtubeVideoId: "vid1",
  title: "Dingiri Dingalae | SASO",
  description: "​Choir: The Chennai Chorale\n​Conductor:   Alvin Arumugam\nthe traditional melody",
};

describe("normaliseEvidenceText", () => {
  it("removes the five zero-width characters and collapses white space", () => {
    expect(normaliseEvidenceText("​a‌ b‍\n\n c⁠﻿ ")).toBe("a b c");
  });
});

describe("quoteOccursIn", () => {
  it("finds a quotation across invisible characters and different white space", () => {
    expect(quoteOccursIn(video.description ?? "", "Choir: The Chennai Chorale")).toBe(true);
    expect(quoteOccursIn(video.description ?? "", "Conductor: Alvin Arumugam")).toBe(true);
  });

  it("is case-sensitive and forgives nothing else (spelling, punctuation)", () => {
    expect(quoteOccursIn(video.description ?? "", "choir: the chennai chorale")).toBe(false);
    expect(quoteOccursIn(video.description ?? "", "Choir - The Chennai Chorale")).toBe(false);
    expect(quoteOccursIn(video.description ?? "", "Choir: The Madras Chorale")).toBe(false);
  });

  it("never accepts an empty or blank quotation", () => {
    expect(quoteOccursIn("anything", "")).toBe(false);
    expect(quoteOccursIn("anything", " ​ ")).toBe(false);
  });
});

describe("fieldText", () => {
  it("reads the cited field and treats a missing one as empty", () => {
    expect(fieldText(video, "title")).toBe("Dingiri Dingalae | SASO");
    expect(fieldText({ youtubeVideoId: "x", title: null, description: null }, "description")).toBe("");
  });
});

describe("verifyEvidence (shared)", () => {
  it("reports an unknown video and a quotation that does not occur, with the staging loader's wording", () => {
    expect(
      verifyEvidence(
        [
          { where: "a", evidence: { youtubeVideoId: "vid1", field: "title", quote: "Dingiri Dingalae" } },
          { where: "b", evidence: { youtubeVideoId: "nope", field: "title", quote: "x" } },
          { where: "c", evidence: { youtubeVideoId: "vid1", field: "title", quote: "Choir: The Chennai Chorale" } },
        ],
        [video]
      )
    ).toEqual(['b: cites video nope, which is not in the fixtures.', 'c: the quotation "Choir: The Chennai Chorale" does not occur in the title of vid1.']);
  });
});

describe("the staging loader still uses the same rule", () => {
  const spec = (quote: string, recordingVideo = "vid1"): StagingContentSpec => {
    const evidence = { youtubeVideoId: "vid1", field: "description" as const, quote };
    return {
      version: 1,
      recording: { youtubeVideoId: recordingVideo, title: "T", titleEvidence: { youtubeVideoId: "vid1", field: "title", quote: "Dingiri Dingalae" } },
      composer: { slug: "c", name: "C", evidence },
      work: { slug: "w", title: "W", evidence },
      programme: { slug: "p", title: "P", evidence },
      venue: { slug: "v", name: "V", city: "Chennai", country: "India", type: null, evidence: [evidence] },
      omissions: [],
    };
  };
  const fixtures = [{ ...video, privacyStatus: "public" }];

  it("accepts quotations that occur, across invisible characters", () => {
    expect(verifyStagingEvidence(spec("Choir: The Chennai Chorale"), fixtures)).toEqual([]);
  });

  it("refuses a quotation that does not occur, once per fact that cites it, and a Recording video that is missing", () => {
    const problems = verifyStagingEvidence(spec("Choir: The Madras Chorale", "missing"), fixtures);
    expect(problems).toHaveLength(5);
    expect(problems[0]).toBe('composer: the quotation "Choir: The Madras Chorale" does not occur in the description of vid1.');
    expect(problems[4]).toBe("recording: video missing is not in the fixtures.");
  });
});
