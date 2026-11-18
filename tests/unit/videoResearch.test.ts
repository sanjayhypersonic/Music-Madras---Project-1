import { describe, expect, it } from "vitest";
import { CREDITS_HEADER, NAMES_HEADER, toCsv } from "../../modules/jobs/videoCreditsReview";
import { csvRecords, resolveApprovedFacts } from "../../modules/jobs/videoCreditsApproved";
import { CLAIMS_HEADER, buildClaimRows, buildResearchBrief, claimRowsToCsv, parseResearchProposals, resolveSourceStrength } from "../../modules/jobs/videoResearch";
import { assessClaimSheet, buildProseDraft } from "../../modules/jobs/videoDescribeDraft";

// Research-assisted descriptions (R-32): the claims sheet's deterministic checks and one draft. FAKE data only: invented ids, names and URLs.

const ID = "fakeSingle1";
const row = (r: Record<string, string>) => {
  const full: Record<string, string> = { youtubeVideoId: ID, youtubeUrl: `https://www.youtube.com/watch?v=${ID}`, youtubeTitle: "t", proposedRecordingTitle: "A Fake Advent Carol", basis: "2 stated in description", tier: "GREEN", decision: "accept", ...r };
  return CREDITS_HEADER.map((h) => full[h] ?? "");
};
const [video] = resolveApprovedFacts({
  creditsCsv: toCsv(CREDITS_HEADER, [
    row({ kind: "work", name: "A Fake Advent Carol" }),
    row({ kind: "composer", name: "Ann Example", workTitle: "A Fake Advent Carol" }),
    row({ kind: "choir/ensemble", name: "Fake Chapel Choir", roleLabel: 'CHOIR (label "Choir")' }),
  ]),
  namesCsv: toCsv(NAMES_HEADER, [["work", "A Fake Advent Carol"], ["composer", "Ann Example"], ["choir/ensemble", "Fake Chapel Choir"]].map(([role, name]) => [role, name, 1, name, ID, "accept", ""])),
}).videos;

const claim = (over: Record<string, unknown>) => ({ youtubeVideoId: ID, subject: { kind: "publisher", workTitle: "A Fake Advent Carol", value: "Example Press" }, claim: "The carol was published by Example Press in 1998.", sourceUrl: "https://examplepress.test/carols/advent", sourceTitle: "Example Press: A Fake Advent Carol", excerpt: "A Fake Advent Carol, Example Press, 1998", sourceStrength: "catalogue/publisher", ...over });

const proposals = parseResearchProposals({
  kind: "video-research-proposals",
  version: 1,
  claims: [
    claim({}),
    claim({ subject: { kind: "composer", workTitle: "A Fake Advent Carol", value: "Ann Example" }, claim: "Hymnary.org credits the music to Ann Example.", sourceUrl: "https://hymnary.org/text/a_fake_advent_carol", excerpt: "Music: Ann Example", sourceStrength: "catalogue/publisher" }),
    claim({ subject: { kind: "composer", workTitle: "A Fake Advent Carol", value: "Bob Other" }, claim: "A newspaper credits the music to Bob Other.", sourceUrl: "https://news.example.test/a", excerpt: "music by Bob Other", sourceStrength: "news" }),
    claim({ subject: { kind: "background", value: null }, claim: "The carol is sung in Advent.", sourceUrl: "https://en.wikipedia.org/wiki/Fake", excerpt: "sung in Advent" }),
    claim({ subject: { kind: "lyricist", value: "Cy Words" }, claim: "Words by Cy Words.", sourceUrl: "https://fanblog.blogspot.com/x", excerpt: "the words are lovely", sourceStrength: "catalogue/publisher" }),
  ],
  notFound: [{ youtubeVideoId: ID, question: "Who arranged it?", searched: "publisher site, IMSLP" }],
});
const rows = buildClaimRows({ proposals: [{ file: "research-proposals-fake.json", ...proposals }], videos: [video] });

describe("the research claims sheet", () => {
  it("writes a brief from approved credits, with a question per work", () => {
    const brief = buildResearchBrief([video], new Date("2026-11-18T00:00:00Z"));
    expect(brief.videos[0].approvedCredits.map((c) => c.name)).toEqual(["A Fake Advent Carol", "Ann Example", "Fake Chapel Choir"]);
    expect(brief.videos[0].questions[0]).toMatch(/publisher, a catalogue \(IMSLP\) or a hymnal index/);
  });

  it("fixes or caps source strength by domain, and keeps Wikipedia as a pointer only", () => {
    expect(resolveSourceStrength("https://imslp.org/wiki/X", "fan site").strength).toBe("catalogue/publisher");
    expect(resolveSourceStrength("https://www.youtube.com/watch?v=x", "catalogue/publisher").strength).toBe("fan site");
    expect(resolveSourceStrength("https://ta.wikipedia.org/wiki/X", "news")).toMatchObject({ strength: "reference work", pointerOnly: true });
    expect(resolveSourceStrength("https://unknown.example.test", undefined).strength).toBe("unverified");
  });

  it("compares each claim with the video's approved credits, shows conflicts without resolving them, and flags weak claims", () => {
    const by = (kind: string, value: string) => rows.find((r) => r.subjectKind === kind && r.claimValue === value)!;
    expect(by("publisher", "Example Press")).toMatchObject({ videoTextRelation: "not stated in the video's approved credits", flags: [], basisTier: "5 AI-suggested (research)" });
    expect(by("composer", "Ann Example")).toMatchObject({ videoTextRelation: "matches the video", sourceStrength: "reference work" });
    expect(by("composer", "Bob Other")).toMatchObject({ conflict: true, videoTextRelation: "CONFLICTS with the video (video: Ann Example; source: Bob Other)" });
    expect(rows.find((r) => r.sourceDomain === "en.wikipedia.org")!.flags.join(" ")).toMatch(/pointer only/);
    expect(by("lyricist", "Cy Words")).toMatchObject({ sourceStrength: "fan site" });
    expect(by("lyricist", "Cy Words").flags.join(" ")).toMatch(/not in the excerpt/);
    expect(rows.find((r) => r.subjectKind === "research gap")!.claim).toBe("No source found: Who arranged it?");
  });
});

describe("prose drafts use accepted claims only", () => {
  it("uses approved claims only, tiers them, cites corroboration, and blocks flagged claims and conflicts instead of resolving them", () => {
    // The editor's decisions, written into the sheet the way a spreadsheet would. Every accepted row names its approver.
    const table = csvRecords(claimRowsToCsv(rows, new Map(), new Date("2026-11-18T12:00:00Z")), CLAIMS_HEADER, "research-claims.csv");
    if (!table.ok) throw new Error(table.problem);
    expect(table.rows.map((r) => [r.claimValue || r.subjectKind, r.sourceTier, r.status])).toEqual([
      ["Example Press", "A", "proposed"],
      ["Ann Example", "B", "conflict"], // two live composer claims disagree: both are marked, neither is chosen
      ["Bob Other", "B", "conflict"],
      ["background", "X", "proposed"],
      ["Cy Words", "C", "proposed"],
      ["research gap", "", ""],
    ]);
    const decide: Record<string, [string, string]> = { "Example Press": ["accept", ""], "Ann Example": ["accept", ""], "Bob Other": ["accept", "Newspaper disagrees; checking the score."], "Cy Words": ["accept", ""] };
    const value = (r: Record<string, string>, h: string) => {
      const d = decide[r.claimValue] ?? (r.sourceDomain.endsWith("wikipedia.org") ? ["accept", ""] : undefined);
      return h === "decision" ? d?.[0] ?? "" : h === "editorNotes" ? d?.[1] ?? "" : h === "approver" ? (d ? "Editor One" : "") : r[h];
    };
    const now = new Date("2026-11-18T12:00:00Z");
    const first = assessClaimSheet(toCsv(CLAIMS_HEADER, table.rows.map((r) => CLAIMS_HEADER.map((h) => value(r, h)))), now);
    // While Bob Other's claim is live, Ann Example's matching claim is blocked too: the conflict is shown, not settled.
    expect(first.usable.map((c) => c.value)).toEqual(["Example Press"]);
    expect(first.blocked.map((b) => b.reason).join(" ")).toMatch(/unresolved conflict on composer/);
    expect(first.blocked.map((b) => b.reason).join(" ")).toMatch(/unresolved conflict with the video's approved credits/);
    expect(first.blocked.map((b) => b.reason).join(" ")).toMatch(/flagged/);

    // The editor rejects the newspaper's claim: only then does the other side become usable (weak: one tier-B source for a credit).
    decide["Bob Other"] = ["reject", "The score credits Ann Example."];
    const sheet = toCsv(CLAIMS_HEADER, table.rows.map((r) => CLAIMS_HEADER.map((h) => value(r, h))));
    const { usable, blocked } = assessClaimSheet(sheet, now);
    expect(usable.map((c) => [c.value, c.sourceTier, c.weak])).toEqual([["Example Press", "A", false], ["Ann Example", "B", true]]);

    const draft = buildProseDraft(video, usable, { blocked });
    expect(draft.draft).toContain("The carol was published by Example Press in 1998 [1].");
    expect(draft.draft).not.toContain("Bob Other"); // a conflict is never written while unresolved
    expect(draft.draft).toContain("The music is by Ann Example."); // the approved credit stays
    expect(draft.draft).not.toContain("Hymnary.org credits"); // corroboration is cited, not repeated
    expect(draft.citations[2]).toMatch(/^\[2\] .*hymnary\.org.*WEAK: attributed; corroborates the video's credit/);
    expect(draft.notes.filter((n) => n.startsWith("GUARDRAIL"))).toEqual([]);
    expect(draft.draft).not.toMatch(/Advent\./); // the Wikipedia claim was refused
  });
});
