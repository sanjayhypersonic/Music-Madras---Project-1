import { describe, expect, it } from "vitest";
import { evaluatePlaylistQuality, type PlaylistQualityConfig, type PlaylistQualityFacts } from "../../modules/mmke/playlists/playlistQuality";
import { comparable, distinctMeaningfulNotes, placeholderReason, sameText } from "../../modules/mmke/playlists/textQuality";

// Lifecycle hardening, F13 — the publication rubric beyond "something was typed". It refuses what is DEMONSTRABLY empty or redundant, explains each
// failure in terms an editor can act on, and does not use word counts or claim that anything a page says is true. Synthetic values only.

const config: PlaylistQualityConfig = { requireSummary: true, minEligibleVideos: 3, requireSeoDescription: true, minContextInputs: 2 };
const good: PlaylistQualityFacts = {
  title: "Advent carols at the cathedral",
  summary: "Carols that open the annual Advent service.",
  seoDescription: "Watch the carols that open the annual Advent service at the cathedral.",
  eligibleMemberCount: 3,
  totalMemberCount: 3,
  contextTexts: ["They open the annual Advent service held at the cathedral hall.", "The junior choir sings the first two carols each year."],
  titleTakenByAnotherPage: false,
};
const result = (over: Partial<PlaylistQualityFacts> = {}, cfg: PlaylistQualityConfig = config) => evaluatePlaylistQuality({ ...good, ...over }, cfg);
const failing = (over: Partial<PlaylistQualityFacts> = {}, cfg: PlaylistQualityConfig = config) => result(over, cfg).failing.map((c) => c.key);
const detail = (key: string, over: Partial<PlaylistQualityFacts> = {}) => result(over).criteria.find((c) => c.key === key)!.detail;

describe("realistic content passes (including short and non-English text: there is no word count)", () => {
  it("passes a plainly good page", () => {
    expect(result().passed).toBe(true);
  });

  it("a one-line summary and a short search description pass if they are real", () => {
    expect(result({ summary: "Advent carols.", seoDescription: "Carols for Advent at the cathedral." }).passed).toBe(true);
  });

  it("text in another script passes: nothing is judged by length or language", () => {
    expect(result({ title: "ஆகமன் கீதங்கள்", summary: "ஆண்டுதோறும் நடைபெறும் ஆகமன் வழிபாட்டில் பாடப்படும் பாடல்கள்.", seoDescription: "ஆகமன் வழிபாட்டுப் பாடல்களைக் கேளுங்கள்.", contextTexts: ["வழிபாட்டின் தொடக்கத்தில் பாடப்படுகின்றன.", "இளையோர் பாடகர் குழு முதல் இரண்டு பாடல்களைப் பாடுகிறது."] }).passed).toBe(true);
  });

  it("two genuinely different notes that share some words both count", () => {
    expect(result({ contextTexts: ["The carols open the service.", "The carols close the service."] }).passed).toBe(true);
  });
});

describe("obvious placeholders and empty text are refused, with a reason the editor can act on", () => {
  it.each([".", "...", "—", "123", "!!!", "x", "xxx", "aaaa", "test", "Test", "TBD", "n/a", "N/A", "lorem ipsum dolor sit amet", "Untitled", "New playlist", "asdf", "todo", "test test test", "ok ok ok ok"])("%s is not a summary", (text) => {
    expect(failing({ summary: text })).toEqual(["SUMMARY"]);
    expect(detail("SUMMARY", { summary: text })).toMatch(/does not say anything yet \(/);
  });

  it("a placeholder is not a search description or a title either", () => {
    expect(failing({ seoDescription: "tbd" })).toEqual(["SEARCH_DESCRIPTION"]);
    expect(failing({ title: "test", summary: "A different summary of the page." })).toEqual(["TITLE"]);
    expect(detail("TITLE", { title: "untitled" })).toMatch(/real title/);
    expect(failing({ title: "   " })).toContain("TITLE");
  });

  it("an empty summary is still refused with the original, specific advice", () => {
    expect(detail("SUMMARY", { summary: "  " })).toMatch(/Add a short summary/);
  });
});

describe("redundant text is refused", () => {
  it("a summary that only repeats the title (ignoring case, punctuation and spacing)", () => {
    expect(failing({ summary: "ADVENT  carols at the cathedral!" })).toEqual(["SUMMARY"]);
    expect(detail("SUMMARY", { summary: "advent carols at the cathedral" })).toMatch(/only repeats the title/);
  });

  it("a search description that only repeats the title or the summary", () => {
    expect(detail("SEARCH_DESCRIPTION", { seoDescription: "Advent carols at the cathedral" })).toMatch(/only repeats the title/);
    expect(detail("SEARCH_DESCRIPTION", { seoDescription: "carols that open the annual advent service" })).toMatch(/only repeats the summary/);
    expect(failing({ seoDescription: "Advent carols at the cathedral." })).toEqual(["SEARCH_DESCRIPTION"]);
  });

  it("a summary that merely resembles the title but says more is fine", () => {
    expect(result({ summary: "Advent carols at the cathedral, sung by the junior choir." }).passed).toBe(true);
  });
});

describe("context notes must be distinct and meaningful to count", () => {
  it("duplicate notes count once, so two copies of one note do not meet a minimum of two", () => {
    const one = "They open the annual Advent service held at the cathedral hall.";
    expect(failing({ contextTexts: [one, one] })).toEqual(["HUMAN_CONTEXT"]);
    expect(failing({ contextTexts: [one, `  ${one.toUpperCase()}  `] })).toEqual(["HUMAN_CONTEXT"]);
    expect(detail("HUMAN_CONTEXT", { contextTexts: [one, one] })).toMatch(/1 piece of distinct context recorded; 2 needed.*1 note was not counted/);
  });

  it("a note that merely contains another (or is contained in it) adds nothing", () => {
    expect(failing({ contextTexts: ["They open the annual Advent service.", "They open the annual Advent service held at the cathedral hall."] })).toEqual(["HUMAN_CONTEXT"]);
  });

  it("placeholder notes are not counted", () => {
    expect(failing({ contextTexts: ["x", "test"] })).toEqual(["HUMAN_CONTEXT"]);
    expect(failing({ contextTexts: ["The carols open the annual service.", "tbd"] })).toEqual(["HUMAN_CONTEXT"]);
  });

  it("a stray short word inside a longer note does not make a note a duplicate (containment needs a real statement)", () => {
    expect(failing({ contextTexts: ["Advent", "The carols open the annual service."] })).toEqual([]);
  });

  it("the check is off when the threshold is 0, and not judged when the context is unknown (a page published before it was recorded)", () => {
    expect(failing({ contextTexts: [] }, { ...config, minContextInputs: 0 })).toEqual([]);
    expect(failing({ contextTexts: null })).toEqual([]);
  });

  it("fails clearly when there is too little context, naming the numbers", () => {
    expect(detail("HUMAN_CONTEXT", { contextTexts: ["The carols open the service."] })).toMatch(/1 piece of distinct context recorded; 2 needed/);
  });
});

describe("what the rubric does not claim", () => {
  it("passes a page whose text is fluent nonsense: it cannot judge truth or prose, and says its criteria are structural", () => {
    expect(result({ summary: "Colourless green carols sleep furiously at the cathedral." }).passed).toBe(true);
  });

  it("keeps its other criteria: videos the Museum can show, a title another LIVE page uses, and the advisory about hidden members", () => {
    expect(failing({ eligibleMemberCount: 1 })).toEqual(["MIN_VIDEOS"]);
    expect(failing({ titleTakenByAnotherPage: true })).toEqual(["UNIQUE_TITLE"]);
    expect(detail("UNIQUE_TITLE", { titleTakenByAnotherPage: true })).toMatch(/Another published playlist page/);
    expect(result({ totalMemberCount: 5 }).criteria.find((c) => c.key === "HIDDEN_MEMBERS")).toMatchObject({ status: "ADVISORY" });
  });
});

describe("textQuality helpers", () => {
  it("comparable() ignores case, punctuation and spacing in any script, keeping combining marks", () => {
    expect(comparable("  Hello,   WORLD! ")).toBe("hello world");
    expect(comparable("கால்")).toBe("கால்");
  });

  it("sameText() is true only for non-empty texts that match once normalised", () => {
    expect(sameText("A b", "a   B.")).toBe(true);
    expect(sameText("", "")).toBe(false);
    expect(sameText("a", "b")).toBe(false);
  });

  it("placeholderReason() explains itself", () => {
    expect(placeholderReason("")).toMatch(/no letters or numbers/);
    expect(placeholderReason("12345")).toMatch(/no letters/);
    expect(placeholderReason("tbd")).toMatch(/placeholder/);
    expect(placeholderReason("zzzz")).toMatch(/one character repeated/);
    expect(placeholderReason("la la la")).toMatch(/one word repeated/);
    expect(placeholderReason("A real sentence about carols.")).toBeNull();
  });

  it("distinctMeaningfulNotes() keeps the first of two clashing notes and reports why the other was not counted", () => {
    const { counted, ignored } = distinctMeaningfulNotes(["Sung by the junior choir each year.", "sung by the junior choir each year", "tbd"]);
    expect(counted).toEqual(["Sung by the junior choir each year."]);
    expect(ignored).toEqual([{ index: 1, reason: "it repeats another note" }, { index: 2, reason: "it is a placeholder" }]);
  });
});
