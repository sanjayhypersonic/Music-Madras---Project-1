import { describe, expect, it } from "vitest";
import { buildEvidence, type EvidenceFacts } from "../../modules/mmke/playlists/playlistEvidence";
import { evaluatePlaylistQuality, normaliseTitle, type PlaylistQualityConfig, type PlaylistQualityFacts } from "../../modules/mmke/playlists/playlistQuality";
import { normalisePlaylistFields, validatePlaylistFieldLimits } from "../../modules/mmke/playlists/playlistFields";
import { PlaylistAiOutputError, validateInterviewOutput } from "../../modules/ai/structuredOutput/validatePlaylistOutput";

// Phase 6K-5 / 6K-4 — playlist evidence, the quality rubric, and validation of untrusted assistant output. Synthetic values only.

const facts: EvidenceFacts = {
  playlistTitle: "Advent Carols",
  members: [
    { title: "Once in Royal David’s City", publishedAt: new Date("2021-12-19T00:00:00Z"), curatorNote: null },
    { title: "O Come, O Come, Emmanuel", publishedAt: new Date("2022-12-18T00:00:00Z"), curatorNote: "Sung by the junior choir." },
  ],
  inputs: [{ question: "Why were these carols chosen?", body: "They open the annual Advent service held at the cathedral hall." }],
};
const evidence = buildEvidence(facts);

describe("buildEvidence", () => {
  it("lists exactly the title, the visible videos (title, date, editor's note) and the supplied context — with stable ids", () => {
    expect(evidence.items.map((i) => i.id)).toEqual(["playlist", "video-1", "video-2", "context-1"]);
    expect(evidence.items[2].text).toContain("Sung by the junior choir.");
    expect(evidence.items[3].text).toContain("annual Advent service");
  });

  it("never includes a YouTube description (they are uploader-written and untrusted)", () => {
    expect(Object.keys(facts.members[0])).not.toContain("description");
  });

  it("has a fingerprint that changes with the evidence and is otherwise stable", () => {
    expect(buildEvidence(facts).fingerprint).toBe(evidence.fingerprint);
    expect(buildEvidence({ ...facts, inputs: [] }).fingerprint).not.toBe(evidence.fingerprint);
    expect(buildEvidence({ ...facts, members: facts.members.slice(0, 1) }).fingerprint).not.toBe(evidence.fingerprint);
    expect(buildEvidence({ ...facts, playlistTitle: "Other" }).fingerprint).not.toBe(evidence.fingerprint);
  });
});

describe("validateInterviewOutput", () => {
  const ok = { outputType: "QUESTION", question: "Which choir performed these carols?", reason: "The choir is not named." };

  it("accepts exactly one well-formed question", () => {
    expect(validateInterviewOutput(ok, [])).toMatchObject({ kind: "QUESTION", question: "Which choir performed these carols?" });
  });

  it("accepts ENOUGH_CONTEXT and asks nothing", () => {
    expect(validateInterviewOutput({ outputType: "ENOUGH_CONTEXT", question: null, reason: "Covered." }, [])).toEqual({ kind: "ENOUGH_CONTEXT", reason: "Covered." });
  });

  it.each([
    ["not an object", "hello"],
    ["unknown type", { outputType: "STATEMENT", question: "Hmm?", reason: "" }],
    ["no question text", { outputType: "QUESTION", question: null, reason: "" }],
    ["empty", { outputType: "QUESTION", question: "   ", reason: "" }],
    ["not a question", { ...ok, question: "Tell me about the choir." }],
    ["two questions", { ...ok, question: "Who sang? When was it?" }],
    ["too long", { ...ok, question: `${"a".repeat(300)}?` }],
    ["a link", { ...ok, question: "Is this the video at https://example.test/x?" }],
    ["markup", { ...ok, question: "What is <b>this</b>?" }],
  ])("rejects %s", (_name, output) => {
    expect(() => validateInterviewOutput(output, [])).toThrow(PlaylistAiOutputError);
  });

  it("rejects a question that was already asked (ignoring case and punctuation)", () => {
    expect(() => validateInterviewOutput(ok, ["which choir performed these CAROLS"])).toThrow(/already been asked/);
  });
});

describe("evaluatePlaylistQuality", () => {
  const config: PlaylistQualityConfig = { requireSummary: true, minEligibleVideos: 3, requireSeoDescription: true, minContextInputs: 2 };
  const good: PlaylistQualityFacts = { title: "Advent", summary: "What it is.", seoDescription: "Search text.", eligibleMemberCount: 3, totalMemberCount: 3, contextTexts: ["They open the annual service.", "Sung by the junior choir."], titleTakenByAnotherPage: false };

  it("passes only when every required check passes, and explains each one", () => {
    const result = evaluatePlaylistQuality(good, config);
    expect(result.passed).toBe(true);
    expect(result.failing).toEqual([]);
    expect(result.criteria.map((c) => c.key)).toEqual(["TITLE", "UNIQUE_TITLE", "SUMMARY", "MIN_VIDEOS", "HUMAN_CONTEXT", "SEARCH_DESCRIPTION"]);
  });

  it("is not a word count: a one-word summary passes, an empty one fails", () => {
    expect(evaluatePlaylistQuality({ ...good, summary: "Carols." }, config).passed).toBe(true);
    expect(evaluatePlaylistQuality({ ...good, summary: "   " }, config).failing.map((c) => c.key)).toEqual(["SUMMARY"]);
  });

  it("each failure names what to do, with the numbers", () => {
    const result = evaluatePlaylistQuality({ ...good, eligibleMemberCount: 1, contextTexts: [], title: "", titleTakenByAnotherPage: true, seoDescription: null }, config);
    expect(result.passed).toBe(false);
    expect(result.failing.map((c) => c.key).sort()).toEqual(["HUMAN_CONTEXT", "MIN_VIDEOS", "SEARCH_DESCRIPTION", "TITLE", "UNIQUE_TITLE"]);
    expect(result.failing.find((c) => c.key === "MIN_VIDEOS")!.detail).toMatch(/Only 1 video can be shown; 3 are needed/);
    expect(result.failing.find((c) => c.key === "HUMAN_CONTEXT")!.detail).toMatch(/0 pieces.*2 needed/);
  });

  it("thresholds and switches come from configuration", () => {
    const relaxed: PlaylistQualityConfig = { requireSummary: false, minEligibleVideos: 1, requireSeoDescription: false, minContextInputs: 0 };
    const thin: PlaylistQualityFacts = { ...good, summary: null, seoDescription: null, eligibleMemberCount: 1, totalMemberCount: 1, contextTexts: [] };
    const result = evaluatePlaylistQuality(thin, relaxed);
    expect(result.passed).toBe(true);
    expect(result.criteria.map((c) => c.key)).toEqual(["TITLE", "UNIQUE_TITLE", "MIN_VIDEOS"]); // switched-off checks are not even listed
    expect(evaluatePlaylistQuality(thin, { ...relaxed, minEligibleVideos: 2 }).passed).toBe(false);
  });

  it("members that are not shown are advisory only — they never block publication", () => {
    const result = evaluatePlaylistQuality({ ...good, totalMemberCount: 5 }, config);
    expect(result.passed).toBe(true);
    expect(result.criteria.find((c) => c.key === "HIDDEN_MEMBERS")).toMatchObject({ status: "ADVISORY" });
  });

  it("the fingerprint identifies the set of failing checks and nothing else", () => {
    const a = evaluatePlaylistQuality({ ...good, summary: null }, config);
    const b = evaluatePlaylistQuality({ ...good, summary: null, title: "A different title" }, config);
    const c = evaluatePlaylistQuality({ ...good, summary: null, seoDescription: null }, config);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).not.toBe(c.fingerprint);
  });

  it("normaliseTitle ignores case and spacing", () => {
    expect(normaliseTitle("  Advent   Carols ")).toBe(normaliseTitle("advent carols"));
  });
});

describe("playlist field rules", () => {
  it("normalises whitespace and blank optionals, and enforces data-integrity limits", () => {
    expect(normalisePlaylistFields({ title: "  Advent \n  Carols ", summary: "  ", body: null })).toEqual({ title: "Advent Carols", summary: null, body: null, seoTitle: null, seoDescription: null });
    expect(validatePlaylistFieldLimits(normalisePlaylistFields({ title: "" }))).toEqual(["A title is required."]);
    expect(validatePlaylistFieldLimits(normalisePlaylistFields({ title: "a".repeat(161), summary: "b".repeat(1001), body: "c".repeat(12001), seoTitle: "d".repeat(121), seoDescription: "e".repeat(321) }))).toHaveLength(5);
  });
});
