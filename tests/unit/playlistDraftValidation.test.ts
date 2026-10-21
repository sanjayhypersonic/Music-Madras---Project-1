import { describe, expect, it } from "vitest";
import { buildEvidence, type EvidenceFacts } from "../../modules/mmke/playlists/playlistEvidence";
import {
  DRAFT_CHECKS_DO_NOT_ESTABLISH,
  DRAFT_CHECKS_ESTABLISH,
  PlaylistAiOutputError,
  validateDraftOutput,
  type DraftSentence,
} from "../../modules/ai/structuredOutput/validatePlaylistOutput";

// F5 — the draft checks. Every demonstrated hole from the audit is a rejection below, plus claim-to-text correspondence and quotation checks.
// Synthetic values only.

const facts: EvidenceFacts = {
  playlistTitle: "Advent Carols",
  members: [
    { title: "Once in Royal David’s City", publishedAt: new Date("2021-12-19T00:00:00Z"), curatorNote: null },
    { title: "O Come, O Come, Emmanuel", publishedAt: new Date("2022-12-18T00:00:00Z"), curatorNote: "Sung by the junior choir." },
  ],
  inputs: [{ question: "Why were these carols chosen?", body: "They open the annual Advent service held at the cathedral hall." }],
};
const evidence = buildEvidence(facts); // ids: playlist, video-1, video-2, context-1

const s = (text: string, evidenceIds: string[], quotes: string[], newParagraph = false): DraftSentence => ({ text, evidenceIds, quotes, newParagraph });
const draft = (sentences: unknown, target: "SUMMARY" | "BODY" = "SUMMARY") => validateDraftOutput({ outputType: "DRAFT", sentences, missing: null }, evidence, target);
const GOOD = s("The carols open the annual Advent service held at the cathedral hall.", ["context-1"], ["open the annual Advent service"]);

describe("a grounded draft", () => {
  it("is accepted as 'needs human verification' — never as verified — and its text is assembled from its checked sentences", () => {
    const result = draft([GOOD]);
    expect(result).toMatchObject({ kind: "DRAFT", text: GOOD.text, verification: "NEEDS_HUMAN_VERIFICATION" });
    expect(JSON.stringify(result)).not.toMatch(/"verification":"VERIFIED"/);
    if (result.kind === "DRAFT") expect(result.sentences).toEqual([GOOD]);
  });

  it("accepts the evidence's own words in other forms (plural, tense, possessive, typographic apostrophes, a month implied by an evidence date)", () => {
    expect(draft([s("A carol opens the annual Advent service.", ["context-1"], ["open the annual Advent service"])]).kind).toBe("DRAFT");
    expect(draft([s("This playlist includes Once in Royal David's City.", ["video-1"], ["Once in Royal David’s City"])]).kind).toBe("DRAFT");
    expect(draft([s("Published in December 2021.", ["video-1"], ["published 2021-12-19"])]).kind).toBe("DRAFT");
    expect(draft([s("Sung by the junior choir.", ["video-2"], ["Sung by the junior choir"])]).kind).toBe("DRAFT");
  });

  it("assembles an introduction from sentences, with paragraphs where the sentences say so; a summary stays one paragraph", () => {
    const second = s("Sung by the junior choir.", ["video-2"], ["Sung by the junior choir"], true);
    const body = draft([GOOD, second], "BODY");
    expect(body.kind === "DRAFT" && body.text).toBe(`${GOOD.text}\n\n${second.text}`);
    expect(() => draft([GOOD, second], "SUMMARY")).toThrow(/single paragraph/);
    const joined = draft([GOOD, s("Sung by the junior choir.", ["video-2"], ["Sung by the junior choir"])]);
    expect(joined.kind === "DRAFT" && joined.text).toBe(`${GOOD.text} Sung by the junior choir.`);
  });

  it("states honestly what the checks do and do not establish", () => {
    expect(DRAFT_CHECKS_ESTABLISH).toMatch(/quotes the evidence/);
    expect(DRAFT_CHECKS_DO_NOT_ESTABLISH).toMatch(/cannot tell whether a sentence says something the evidence does not say/);
  });
});

describe("unsupported claims are rejected — including every case demonstrated in the audit", () => {
  const cases: Array<[string, DraftSentence, RegExp]> = [
    ["a name at the START of a sentence", s("Thompson conducted the annual Advent service.", ["context-1"], ["the annual Advent service"]), /thompson/i],
    ["a name with diacritics", s("The annual Advent service featured Dvořák.", ["context-1"], ["the annual Advent service"]), /dvorak/i],
    ["a name in another script", s("The annual Advent service featured சங்கீதம்.", ["context-1"], ["the annual Advent service"]), /not in the evidence/],
    ["a number word", s("Twelve carols open the annual Advent service.", ["context-1"], ["open the annual Advent service"]), /twelve/i],
    ["an ordinal", s("The first carols open the annual Advent service.", ["context-1"], ["open the annual Advent service"]), /first/i],
    ["a vague quantity", s("Several carols open the annual Advent service.", ["context-1"], ["open the annual Advent service"]), /several/i],
    ["a single digit", s("3 carols open the annual Advent service.", ["context-1"], ["open the annual Advent service"]), /“3”/],
    ["a year that is not in the evidence", s("The carols open the 1987 Advent service.", ["context-1"], ["open the annual Advent service"]), /1987/],
    ["a lowercase invented claim", s("The carols open the annual Advent service for orphans.", ["context-1"], ["open the annual Advent service"]), /orphans/],
    ["an invented lowercase verb", s("Orphans from the cathedral hall sang the annual Advent service.", ["context-1"], ["the annual Advent service"]), /orphans|sang/],
    ["a negation that flips the meaning", s("The carols do not open the annual Advent service.", ["context-1"], ["open the annual Advent service"]), /“not”/],
    ["a superlative", s("The carols open the best annual Advent service.", ["context-1"], ["open the annual Advent service"]), /best/],
    ["a causal link", s("The carols open the annual Advent service because they were chosen.", ["context-1"], ["open the annual Advent service"]), /because/],
    ["a month the evidence's dates do not imply", s("Published in March 2021.", ["video-1"], ["published 2021-12-19"]), /march/i],
    ["words that exist only in evidence the sentence does not cite", s("Sung by the junior choir.", ["context-1"], ["open the annual Advent service"]), /junior|choir|sung/i],
  ];
  it.each(cases)("rejects %s", (_name, sentence, message) => {
    expect(() => draft([sentence])).toThrow(PlaylistAiOutputError);
    expect(() => draft([sentence])).toThrow(message);
  });

  it("names the offending words so the editor knows what to supply", () => {
    expect(() => draft([s("Thompson and Dvořák conducted the annual Advent service.", ["context-1"], ["the annual Advent service"])])).toThrow(/Sentence 1 uses “thompson”, “dvorak”, “conducted”/);
  });

  it("every sentence is checked on its own: a good first sentence does not excuse a bad second one", () => {
    expect(() => draft([GOOD, s("Thompson conducted the annual Advent service.", ["context-1"], ["the annual Advent service"])])).toThrow(/Sentence 2 uses “thompson”/);
  });
});

describe("claim-to-text correspondence and the evidence behind each sentence", () => {
  it("a sentence that cites nothing, cites evidence that does not exist, or cites too much is rejected", () => {
    expect(() => draft([s(GOOD.text, [], ["open the annual Advent service"])])).toThrow(/cites no evidence/);
    expect(() => draft([s(GOOD.text, ["video-9"], ["open the annual Advent service"])])).toThrow(/does not exist/);
    expect(() => draft([s(GOOD.text, ["playlist", "video-1", "video-2", "context-1", "context-1", "x", "y", "z"], ["open the annual Advent service"])])).toThrow(/does not exist|more than/);
  });

  it("each sentence must quote its cited evidence verbatim: no quotation, a made-up one, one from evidence it did not cite, or one that is too short, is rejected", () => {
    expect(() => draft([s(GOOD.text, ["context-1"], [])])).toThrow(/must quote between 1 and 3/);
    expect(() => draft([s(GOOD.text, ["context-1"], ["open the annual Advent services"])])).toThrow(/not in the evidence it cites/); // one letter off
    expect(() => draft([s(GOOD.text, ["context-1"], ["Sung by the junior choir"])])).toThrow(/not in the evidence it cites/); // real, but from video-2, which was not cited
    expect(() => draft([s(GOOD.text, ["context-1"], ["hal"])])).toThrow(/not in the evidence it cites/); // shorter than the 4-character minimum
    expect(() => draft([s(GOOD.text, ["context-1"], ["a", "b", "c", "d"])])).toThrow(/must quote between 1 and 3/);
  });

  it("the quotations must bear on the sentence — padding a sentence with an unrelated quotation does not count", () => {
    expect(() => draft([s("The carols open the annual Advent service.", ["context-1"], ["cathedral hall"])])).toThrow(/quotes nothing that it actually says/);
  });

  it("an entry must be exactly ONE sentence and must end like one", () => {
    expect(() => draft([s("The carols open the annual Advent service. They are held at the cathedral hall.", ["context-1"], ["open the annual Advent service"])])).toThrow(/more than one sentence/);
    expect(() => draft([s("The carols open the annual Advent service", ["context-1"], ["open the annual Advent service"])])).toThrow(/does not end like a sentence/);
  });

  it("there is no way to slip text past the check: the old free-text shape, extra text, and wrong shapes are all rejected", () => {
    expect(() => validateDraftOutput({ outputType: "DRAFT", text: "Carols for the annual Advent service.", claims: [{ statement: "x", evidenceIds: ["context-1"] }], missing: null }, evidence, "SUMMARY")).toThrow(PlaylistAiOutputError);
    expect(() => draft([{ ...GOOD, text: 5 }])).toThrow(/expected shape/);
    expect(() => draft([{ ...GOOD, quotes: [5] }])).toThrow(/expected shape/);
    expect(() => draft([])).toThrow(/empty draft/);
    expect(() => draft("not an array")).toThrow(/expected shape/);
    expect(() => validateDraftOutput(null, evidence, "SUMMARY")).toThrow(PlaylistAiOutputError);
  });

  it("rejects links, markup, formatting and over-long entries", () => {
    for (const text of ["See https://example.test for more.", "Carols <b>here</b>.", "Visit www.example.test.", "Mail a@b.test.", "# The annual Advent service.", "* The annual Advent service."]) {
      expect(() => draft([s(text, ["context-1"], ["the annual Advent service"])]), text).toThrow(PlaylistAiOutputError);
    }
    expect(() => draft([s(`The annual Advent service ${"held at the cathedral hall ".repeat(20)}.`, ["context-1"], ["the annual Advent service"])])).toThrow(/longer than 400/);
    const many = Array.from({ length: 31 }, () => GOOD);
    expect(() => draft(many, "BODY")).toThrow(/more than 30 sentences/);
  });

  it("enforces the field length limits on the assembled text", () => {
    const sentence = s("The carols open the annual Advent service held at the cathedral hall at the annual Advent service held at the cathedral hall at the annual Advent service held at the cathedral hall.", ["context-1"], ["open the annual Advent service"]);
    expect(() => draft(Array.from({ length: 8 }, () => sentence), "SUMMARY")).toThrow(/longer than the 1000-character limit/);
  });

  it("an information gap is passed through as a gap, not a draft", () => {
    expect(validateDraftOutput({ outputType: "INFORMATION_GAP", sentences: [], missing: "Which ensemble performed?" }, evidence, "BODY")).toEqual({ kind: "INFORMATION_GAP", missing: "Which ensemble performed?" });
  });
});