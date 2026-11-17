import { describe, expect, it } from "vitest";
import { CREDITS_HEADER, NAMES_HEADER, toCsv } from "../../modules/jobs/videoCreditsReview";
import { resolveApprovedFacts } from "../../modules/jobs/videoCreditsApproved";
import { draftDescription } from "../../modules/jobs/videoCreditsDescribe";

// Description drafts (Phase B2): one happy path with FAKE data. Only approved facts appear; the undecided performer does not.

const ID = "fakeSingle1";
const row = (r: Record<string, string>) => {
  const full: Record<string, string> = { youtubeVideoId: ID, youtubeUrl: `https://www.youtube.com/watch?v=${ID}`, youtubeTitle: "t", proposedRecordingTitle: "A Fake Advent Carol", basis: "2 stated in description", tier: "GREEN", decision: "accept", ...r };
  return CREDITS_HEADER.map((h) => full[h] ?? "");
};

describe("draftDescription", () => {
  it("fills the editorial template with approved facts only, in the standard's order", () => {
    const creditsCsv = toCsv(CREDITS_HEADER, [
      row({ kind: "work", name: "A Fake Advent Carol" }),
      row({ kind: "composer", name: "Ann Example", workTitle: "A Fake Advent Carol" }),
      row({ kind: "lyricist", name: "Ann Example", workTitle: "A Fake Advent Carol" }),
      row({ kind: "arranger", name: "Cara Placeholder", workTitle: "A Fake Advent Carol" }),
      row({ kind: "choir/ensemble", name: "Fake Chapel Choir", roleLabel: 'CHOIR (label "Choir")' }),
      row({ kind: "conductor", name: "Ben Sample" }),
      row({ kind: "venue", name: "Fake Chapel" }),
      row({ kind: "performanceDate", name: "2025-12-12", tier: "AMBER" }),
      row({ kind: "institution", name: "Fake College (FC)", roleLabel: "UNMODELLED INSTITUTION", tier: "AMBER" }),
      row({ kind: "presenter", name: "Music Madras", roleLabel: "UNMODELLED PRESENTER", tier: "AMBER" }),
      row({ kind: "performer", name: "Dev Soloist", roleLabel: 'PERFORMER (label "Soprano")', decision: "" }),
    ]);
    const namesCsv = toCsv(NAMES_HEADER, [
      ["work", "A Fake Advent Carol"], ["composer", "Ann Example"], ["lyricist", "Ann Example"], ["arranger", "Cara Placeholder"], ["choir/ensemble", "Fake Chapel Choir"],
      ["conductor", "Ben Sample"], ["venue", "Fake Chapel"], ["institution", "Fake College (FC)"], ["presenter", "Music Madras"],
    ].map(([role, name]) => [role, name, 1, name, ID, "accept", ""]));
    const [video] = resolveApprovedFacts({ creditsCsv, namesCsv }).videos;

    expect(draftDescription(video).draft).toBe(
      [
        "A Fake Advent Carol — performed by the Fake Chapel Choir, Fake College (FC) at Fake Chapel on 12 December 2025.",
        "The words and music are by Ann Example, with an arrangement by Cara Placeholder, conducted by Ben Sample.",
        "This performance is part of the Music Madras archive. It was recorded and presented by Music Madras.",
        [
          "Performance Details",
          "🎵 Work: A Fake Advent Carol",
          "✍️ Words and music: Ann Example",
          "🎹 Arrangement: Cara Placeholder",
          "👥 Choir: Fake Chapel Choir, Fake College (FC)",
          "🎶 Conductor: Ben Sample",
          "📍 Venue: Fake Chapel",
          "📅 Date: 12 December 2025",
          "🎥 Recorded and presented by: Music Madras",
        ].join("\n"),
        "Explore more performances in the Music Madras archive, and subscribe for new recordings.",
      ].join("\n\n")
    );
  });
});
