import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  fileTimestamp,
  formatSummary,
  formatVideoScore,
  matchKey,
  pairedExport,
  parseReference,
  parseScoreArgs,
  proposedFacts,
  scoreVideo,
  summariseScores,
  type ProposedFact,
  type ReferenceVideo,
} from "../../modules/jobs/videoCreditsScore";
import { validateVideoCreditsOutput } from "../../modules/ai/structuredOutput/validateVideoCreditsOutput";
import type { VideoText } from "../../modules/mmke/provenance/verbatimEvidence";

// Phase B0: the scorer that compares accepted credit proposals with an editor's reference. FAKE videos, names and places only (apart from the
// shape check of the real reference fixture).

const root = path.resolve(__dirname, "../..");

const reference: ReferenceVideo = {
  youtubeVideoId: "FAKEscore01",
  facts: [
    { kind: "WORK", name: "An Example Carol", basis: "source-stated" },
    { kind: "COMPOSER", name: "Jane Placeholder", workTitle: "An Example Carol", basis: "source-stated" },
    { kind: "ARRANGER", name: "Sam Arranger", workTitle: "An Example Carol", basis: "source-stated" },
    { kind: "CHOIR", name: "St. Nowhere Men's Choir", basis: "source-stated" },
    { kind: "INSTITUTION", name: "Example College", basis: "source-stated" },
    { kind: "CONDUCTOR", name: "Lead Person", basis: "editor-supplied", note: "Known to the editor." },
    { kind: "PERFORMANCE_DATE", name: "2025-12-12", basis: "source-stated" },
  ],
  contradictions: [
    { kind: "ARRANGER", name: "Sam Wrongname", note: "Title error." },
    { kind: "COMPOSER", name: null, workTitle: "Another Carol", note: "No composer is stated for Another Carol." },
  ],
  flags: [{ kind: "COMPOSER", workTitle: "Another Carol", note: "Research." }],
};

const p = (kind: string, name: string, workTitle: string | null = null): ProposedFact => ({ kind, name, workTitle });

describe("parseScoreArgs, fileTimestamp, pairedExport", () => {
  it("takes several proposals files, a reference and (with one proposals file) an export", () => {
    expect(parseScoreArgs(["--proposals", "a.json", "b.json"])).toEqual({ ok: true, args: { proposals: ["a.json", "b.json"], reference: "tests/fixtures/videoCreditsReference.json", exportFile: null } });
    expect(parseScoreArgs(["--proposals", "a.json", "--reference", "r.json", "--export", "e.json"])).toEqual({ ok: true, args: { proposals: ["a.json"], reference: "r.json", exportFile: "e.json" } });
    expect(parseScoreArgs([]).ok).toBe(false);
    expect(parseScoreArgs(["--proposals", "a.json", "b.json", "--export", "e.json"]).ok).toBe(false);
    expect(parseScoreArgs(["--proposals", "a.json", "--write"]).ok).toBe(false);
  });

  it("pairs a proposals file with the export of the same timestamp", () => {
    expect(fileTimestamp("proposals-v2-2026-11-16T17-40-47-761Z.json")).toBe("2026-11-16T17-40-47-761Z");
    expect(fileTimestamp("notes.json")).toBeNull();
    const files = ["export-o0000-n20-2026-11-16T16-40-51-325Z.json", "export-o0000-n20-2026-11-16T17-40-47-761Z.json", "check-2026-11-16T17-40-47-761Z.json"];
    expect(pairedExport("proposals-v2-2026-11-16T17-40-47-761Z.json", files)).toBe("export-o0000-n20-2026-11-16T17-40-47-761Z.json");
    expect(pairedExport("proposals-v2-2026-11-17T00-00-00-000Z.json", files)).toBeNull();
  });
});

describe("matchKey", () => {
  it("ignores letter case, punctuation and parenthetical aliases, but never confuses scripts", () => {
    expect(matchKey("ECI Hope Cathedral Mens Choir")).toBe(matchKey("ECI Hope Cathedral Men's Choir"));
    expect(matchKey("Madras Christian College (MCC)")).toBe(matchKey("Madras Christian College"));
    expect(matchKey("G. R. Woodward")).toBe(matchKey("g r woodward"));
    expect(matchKey("பாலன் பிறந்த ராவில்")).not.toBe(matchKey("Paalan Pirandha Raavil"));
    expect(matchKey("பாலன் பிறந்த ராவில்").length).toBeGreaterThan(0);
  });
});

describe("parseReference", () => {
  it("accepts the shipped reference: five videos, every fact with a known kind and a basis", () => {
    const parsed = parseReference(JSON.parse(readFileSync(path.join(root, "tests/fixtures/videoCreditsReference.json"), "utf8")));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.videos.map((v) => v.youtubeVideoId)).toEqual(["Vl8Xe2COp2c", "zRjM7rP7hpM", "S4aemnTWODM", "jiNrP52imwg", "rxGfBGWLnTI"]);
    expect(parsed.videos.flatMap((v) => v.facts).filter((f) => f.basis === "editor-supplied").map((f) => `${f.kind}:${f.name}`)).toEqual(["CONDUCTOR:Jim Billy"]);
  });

  it("refuses an unknown kind, a missing basis and a bad contradiction", () => {
    const bad = (video: object) => parseReference({ version: 1, videos: [{ youtubeVideoId: "x", facts: [], contradictions: [], flags: [], ...video }] });
    expect(bad({ facts: [{ kind: "PRODUCER", name: "X", basis: "source-stated" }] }).ok).toBe(false);
    expect(bad({ facts: [{ kind: "CHOIR", name: "X" }] }).ok).toBe(false);
    expect(bad({ contradictions: [{ kind: "CHOIR", name: 3, note: "n" }] }).ok).toBe(false);
    expect(parseReference({ version: 2, videos: [] }).ok).toBe(false);
  });
});

describe("scoreVideo", () => {
  it("sorts every fact into exactly one category", () => {
    const score = scoreVideo(reference, [
      p("WORK", "An Example Carol"),
      p("COMPOSER", "Jane Placeholder", "An Example Carol"),
      p("ARRANGER", "Sam Wrongname", "An Example Carol"),
      p("CHOIR", "St. Nowhere Mens Choir"),
      p("PERFORMANCE_DATE", "2025-12-11"),
      p("COMPOSER", "Someone", "Another Carol"),
      p("VENUE", "Some Hall"),
    ]);
    const by = (c: string) => score.rows.filter((r) => r.category === c).map((r) => `${r.kind}:${r.name}`);
    expect(by("MATCHED")).toEqual(["WORK:An Example Carol", "COMPOSER:Jane Placeholder", "CHOIR:St. Nowhere Men's Choir"]);
    expect(by("MISSED")).toEqual(["ARRANGER:Sam Arranger", "INSTITUTION:Example College", "PERFORMANCE_DATE:2025-12-12"]);
    expect(by("MISSED-EDITOR")).toEqual(["CONDUCTOR:Lead Person"]);
    expect(by("CONTRADICTS")).toEqual(["ARRANGER:Sam Wrongname", "PERFORMANCE_DATE:2025-12-11", "COMPOSER:Someone"]);
    expect(by("NOT-IN-REFERENCE")).toEqual(["VENUE:Some Hall"]);
    expect(score.matchedStated).toBe(3);
  });

  it("matches a credit only for the same work", () => {
    const score = scoreVideo(reference, [p("COMPOSER", "Jane Placeholder", "A Different Carol")]);
    expect(score.rows.find((r) => r.kind === "COMPOSER" && r.category === "MATCHED")).toBeUndefined();
    expect(score.rows.find((r) => r.name === "Jane Placeholder" && r.category === "NOT-IN-REFERENCE")).toBeDefined();
  });

  it("with no proposal, every source-stated fact is MISSED and every editor-supplied one MISSED-EDITOR", () => {
    expect(scoreVideo(reference, []).counts).toEqual({ MATCHED: 0, MISSED: 6, "MISSED-EDITOR": 1, CONTRADICTS: 0, "NOT-IN-REFERENCE": 0 });
  });
});

describe("summariseScores", () => {
  it("computes recall over source-stated facts and precision over matched plus contradicting proposals", () => {
    const a = scoreVideo(reference, [p("WORK", "An Example Carol"), p("ARRANGER", "Sam Wrongname", "An Example Carol"), p("VENUE", "Some Hall")]);
    const summary = summariseScores([a]);
    expect(summary.matchedStated).toBe(1);
    expect(summary.recall).toBeCloseTo(1 / 6, 10);
    expect(summary.precision).toBeCloseTo(1 / 2, 10);
    expect(summariseScores([]).recall).toBeNull();
    const text = formatSummary(summary).join("\n");
    expect(text).toContain("Recall    = MATCHED source-stated / (MATCHED source-stated + MISSED) = 1 / 6");
    expect(text).toContain("Precision = MATCHED / (MATCHED + CONTRADICTS) = 1 / 2");
  });

  it("prints names and notes per category, plus flags", () => {
    const lines = formatVideoScore(scoreVideo(reference, [p("ARRANGER", "Sam Wrongname", "An Example Carol")]), "Fake title", "proposals.json").join("\n");
    expect(lines).toContain("## FAKEscore01  Fake title  [proposals.json]");
    expect(lines).toMatch(/CONTRADICTS\s+ARRANGER\s+Sam Wrongname.*Title error\./);
    expect(lines).toMatch(/FLAG\s+COMPOSER\s+Research\./);
  });
});

describe("proposedFacts (from a checked fake proposal)", () => {
  const video: VideoText = {
    youtubeVideoId: "FAKEscore02",
    title: "தமிழ் பாடல் | Thamizh Paadal",
    description: "Carol: தமிழ் பாடல்\nTransliteration: Thamizh Paadal\nConductor: Lead Person\nDate: 12 December 2025\nVenue: St. Example Chapel, Example College\nRecorded and presented by: Sample Media",
  };
  const nothing = { value: null, quote: null, field: null };
  const checked = validateVideoCreditsOutput(
    {
      recordingKind: { value: "UNCLEAR", quote: null, field: null },
      credits: [
        { role: "WORK", name: "தமிழ் பாடல்", workTitle: null, quote: "Carol: தமிழ் பாடல்", field: "description" },
        { role: "CONDUCTOR", name: "Lead Person", workTitle: null, quote: "Conductor: Lead Person", field: "description" },
        { role: "CHOIR", name: "Not In Text", workTitle: null, quote: "Choir: Not In Text", field: "description" },
      ],
      performanceDate: { value: "2025-12-12", quote: "Date: 12 December 2025", field: "description" },
      venueType: { ...nothing, fromName: false },
      suggestedTitle: { value: "தமிழ் பாடல்", quote: "Carol: தமிழ் பாடல்", field: "description", alternateTitle: { value: "Thamizh Paadal", quote: "Transliteration: Thamizh Paadal", field: "description" } },
      gaps: [
        { missing: 'UNMODELLED: Institution: Example College -- "Venue: St. Example Chapel, Example College"', reason: "r" },
        { missing: 'UNMODELLED: Tune: NOWHERE -- "Tune: NOWHERE"', reason: "r" },
      ],
    },
    video
  );

  it("turns accepted credits, date, titles and verified unmodelled entries into facts; rejected and unverified ones are left out", () => {
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(proposedFacts(checked).map((f) => `${f.kind}:${f.name}`)).toEqual([
      "WORK:தமிழ் பாடல்",
      "CONDUCTOR:Lead Person",
      "PERFORMANCE_DATE:2025-12-12",
      "RECORDING_TITLE:தமிழ் பாடல்",
      "ORIGINAL_LANGUAGE_TITLE:தமிழ் பாடல்",
      "TRANSLITERATION:Thamizh Paadal",
      "INSTITUTION:Example College",
      "PRESENTER:Sample Media",
    ]);
  });
});

describe("static guard: the scorer reads local files and writes nothing", () => {
  it.each(["scripts/scoreVideoCredits.ts", "modules/jobs/videoCreditsScore.ts"])("%s", (file) => {
    const code = readFileSync(path.join(root, file), "utf8");
    const imports = code.split(/\r?\n/).filter((l) => /^\s*import\b/.test(l)).join("\n");
    expect(imports).not.toMatch(/modules\/db|\.\.\/db\/|@prisma|dotenv|@anthropic-ai|anthropicProvider|aiProviderRegistry|http/);
    expect(code).not.toMatch(/process\.env|fetch\(|writeFileSync|appendFileSync/);
  });
});
