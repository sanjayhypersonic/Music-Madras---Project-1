import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  BASIS,
  buildReviewSheet,
  classifyGap,
  countTiers,
  csvCell,
  explicitRolePhrase,
  gapKinds,
  lineLabel,
  sheetToCsv,
  spellingVariantKey,
  toCsv,
  unmodelledHome,
  type CreditRow,
  type ReviewInputVideo,
} from "../../modules/jobs/videoCreditsReview";
import type { ReferenceVideo } from "../../modules/jobs/videoCreditsScore";
import type { VideoText } from "../../modules/mmke/provenance/verbatimEvidence";

// Phase B1: the editorial review sheet, built from FAKE data only (tests/fixtures/videoCreditsFake*.json plus inline fake videos).

const root = path.resolve(__dirname, "../..");
const fakeExport = JSON.parse(readFileSync(path.join(root, "tests/fixtures/videoCreditsFakeExport.json"), "utf8")) as { videos: VideoText[] };
const fakeProposals = JSON.parse(readFileSync(path.join(root, "tests/fixtures/videoCreditsFakeProposals.json"), "utf8")) as unknown[];

const nothing = { value: null, quote: null, field: null };
const placeholderVideo: VideoText = {
  youtubeVideoId: "FAKErev0006",
  title: "A Tamil Carol | தமிழ் கீதம் | Fake Choir",
  description: "Song: தமிழ் கீதம்\nTransliteration: Thamizh Geetham\nChoir: Fake Choir\nMusic & Composition: To be confirmed\nDate: 1 January 2025",
};
const placeholderProposal = {
  youtubeVideoId: "FAKErev0006",
  recordingKind: { value: "PERFORMANCE", quote: "Choir: Fake Choir", field: "description" },
  credits: [
    { role: "WORK", name: "தமிழ் கீதம்", workTitle: null, quote: "Song: தமிழ் கீதம்", field: "description" },
    { role: "CHOIR", name: "Fake Choir", workTitle: null, quote: "Choir: Fake Choir", field: "description" },
  ],
  performanceDate: { value: "2025", quote: "A Tamil Carol | தமிழ் கீதம் | Fake Choir", field: "title" },
  venueType: { ...nothing, fromName: false },
  suggestedTitle: { value: "தமிழ் கீதம்", quote: "Song: தமிழ் கீதம்", field: "description", alternateTitle: { value: "Thamizh Geetham", quote: "Transliteration: Thamizh Geetham", field: "description" } },
  gaps: [{ missing: "PLACEHOLDER: composer", reason: "The text says 'Music & Composition: To be confirmed'." }],
};
const titleDateVideo: VideoText = { ...placeholderVideo, youtubeVideoId: "FAKErev0007", title: "A Tamil Carol | Fake Choir | 01 Feb 2026" };
const titleDateProposal = {
  ...placeholderProposal,
  youtubeVideoId: "FAKErev0007",
  credits: [{ role: "CHOIR", name: "Fake Choir", workTitle: null, quote: "Choir: Fake Choir", field: "description" }],
  performanceDate: { value: "2026-02-01", quote: "01 Feb 2026", field: "title" },
  suggestedTitle: { ...nothing, alternateTitle: nothing },
  gaps: [{ missing: "CONFLICT: work title", reason: 'The title says "A Tamil Carol"; the description says "தமிழ் கீதம்".' }, { missing: "possible duplicate performance", reason: "Same as FAKErev0006." }],
};

const reference: ReferenceVideo[] = [
  {
    youtubeVideoId: "FAKEvid0002",
    facts: [
      { kind: "WORK", name: "Prelude", basis: "source-stated" },
      { kind: "CONDUCTOR", name: "Edith Editor", basis: "editor-supplied", note: "Known to the editor only." },
    ],
    contradictions: [{ kind: "WORK", name: "Finale", note: "Not performed (fake rule)." }],
    flags: [{ kind: "COMPOSER", workTitle: "Prelude", note: "Composer to research." }],
  },
];

const videos: ReviewInputVideo[] = [
  ...fakeProposals
    .filter((p): p is { youtubeVideoId: string } => typeof p === "object" && p !== null && typeof (p as { youtubeVideoId?: unknown }).youtubeVideoId === "string")
    .filter((p, i, all) => fakeExport.videos.some((v) => v.youtubeVideoId === p.youtubeVideoId) && all.findIndex((q) => q.youtubeVideoId === p.youtubeVideoId) === i)
    .map((p) => ({ proposalsFile: "fake-proposals.json", video: fakeExport.videos.find((v) => v.youtubeVideoId === p.youtubeVideoId)!, proposal: p })),
  { proposalsFile: "fake-inline.json", video: placeholderVideo, proposal: placeholderProposal },
  { proposalsFile: "fake-inline.json", video: titleDateVideo, proposal: titleDateProposal },
];
const sheet = buildReviewSheet({ videos, reference });
const rowsOf = (id: string) => sheet.credits.filter((r) => r.youtubeVideoId === id);
const find = (id: string, kind: string, name = ""): CreditRow => {
  const row = rowsOf(id).find((r) => r.kind === kind && r.name === name);
  if (!row) throw new Error(`no ${kind} ${name} row for ${id}`);
  return row;
};

describe("helpers", () => {
  it("reads line labels and explicit role phrases", () => {
    expect(lineLabel("🎶 Conductor: Jacob George")).toBe("Conductor");
    expect(lineLabel("Composition & Choral Arrangement: Jim Billy")).toBe("Composition & Choral Arrangement");
    expect(lineLabel("1. Mozart (Don Giovanni): Là chi darem la mano")).toBeNull();
    expect(lineLabel("Performed by the Example Choir.")).toBeNull();
    expect(explicitRolePhrase("The carol features music by Augustine Paul, with the choir conducted by Jacob George.")).toBe("music by");
    expect(explicitRolePhrase("Performed by the Example Choir.")).toBeNull();
  });

  it("classifies gaps: explicit prefixes, old-style wording, placeholders, duplicates; a name without a role is not a conflict", () => {
    expect(classifyGap("CONFLICT: work title", "x")).toBe("CONFLICT");
    expect(classifyGap("PLACEHOLDER: conductor", "x")).toBe("PLACEHOLDER");
    expect(classifyGap("possible duplicate performance", "x")).toBe("DUPLICATE");
    expect(classifyGap("work title", "The title says 'Call Him Lord'; the description says 'I call him Lord'.")).toBe("CONFLICT");
    expect(classifyGap("conductor", "The text says 'Conductor: [Please confirm]'.")).toBe("PLACEHOLDER");
    expect(classifyGap("composer", "The text says 'To be confirmed'.")).toBe("PLACEHOLDER");
    expect(classifyGap("conductor", "The title lists Alvin Arumugam but no text states his role.")).toBe("OTHER");
    expect(classifyGap("performers", "The title lists X and Y without stating their roles; the description has only lyrics.")).toBe("OTHER");
  });

  it("maps a gap's subject to the rows it is about", () => {
    expect(gapKinds("CONFLICT: composer name spelling")).toEqual(["composer"]);
    expect(gapKinds("composer, lyricist, arranger")).toEqual(["composer", "lyricist", "arranger"]);
    expect(gapKinds("CONFLICT: transliteration")).toEqual(["work"]);
  });

  it("names schema homes for unmodelled labels", () => {
    expect(unmodelledHome("Institution")).toMatch(/^Venue\.organisationId/);
    expect(unmodelledHome("Language")).toBe("MusicalWork.language");
    expect(unmodelledHome("PRESENTER")).toBe("none");
  });

  it("treats an alias or a leading 'The' as the same spelling, but not different letters or letter case", () => {
    expect(spellingVariantKey("Madras Christian College (MCC)")).toBe(spellingVariantKey("Madras Christian College"));
    expect(spellingVariantKey("The Chennai Chorale")).toBe(spellingVariantKey("Chennai Chorale"));
    expect(spellingVariantKey("Ebenezer Arunkumar")).not.toBe(spellingVariantKey("Ebenezer ArunKumar"));
  });
});

describe("tiers and basis", () => {
  it("GREEN for a labelled line in the description; AMBER for prose; RED for a credit the checker rejected", () => {
    expect(find("FAKEvid0001", "conductor", "John Sample")).toMatchObject({ tier: "GREEN", basis: BASIS.DESCRIPTION, sourceField: "description" });
    expect(find("FAKEvid0001", "conductor", "John Sample").roleLabel).toBe('CONDUCTOR (label "Conductor")');
    expect(find("FAKEvid0002", "choir/ensemble", "Sampletown Orchestra").tier).toBe("AMBER");
    expect(find("FAKEvid0001", "performer", "#ExampleChoir")).toMatchObject({ tier: "RED" });
    expect(find("FAKEvid0001", "performer", "#ExampleChoir").questions.join(" ")).toContain("NAME_INVALID");
  });

  it("a venue type from the venue's own name is basis 5, 'inferred from name', AMBER", () => {
    expect(find("FAKEvid0001", "venueType", "CHURCH")).toMatchObject({ basis: BASIS.INFERRED, venueTypeBasis: "inferred from name", tier: "AMBER", schemaHome: "Venue.type" });
  });

  it("a performance date is AMBER, and RED when it comes only from the title", () => {
    expect(find("FAKEvid0001", "performanceDate", "2024-03-03").tier).toBe("AMBER");
    expect(find("FAKErev0007", "performanceDate", "2026-02-01")).toMatchObject({ tier: "RED", basis: BASIS.TITLE });
  });

  it("an UNMODELLED item is AMBER, including a presenter the checker detected", () => {
    expect(find("FAKEvid0001", "presenter", "Sample Media")).toMatchObject({ tier: "AMBER", schemaHome: "none" });
    expect(find("FAKEvid0002", "presenter", "Fake Presenter Trust").roleLabel).toContain("detected by the checker");
  });

  it("a placeholder becomes a nameless RED open question, never a composer row", () => {
    const q = rowsOf("FAKErev0006").filter((r) => r.kind === "open question");
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ name: "", tier: "RED", roleLabel: "composer" });
    expect(rowsOf("FAKErev0006").some((r) => r.kind === "composer")).toBe(false);
    expect(sheet.credits.filter((r) => r.kind === "open question" && r.name !== "")).toEqual([]);
  });

  it("a CONFLICT makes the rows it is about RED; a duplicate becomes a RED open question", () => {
    const vid7 = rowsOf("FAKErev0007");
    expect(vid7.find((r) => r.kind === "open question" && r.roleLabel === "work title")?.tier).toBe("RED");
    expect(vid7.find((r) => r.kind === "open question" && r.questions[0].startsWith("DUPLICATE"))?.tier).toBe("RED");
  });

  it("names spelled differently elsewhere are RED (letter case counts; a leading 'The' alone does not)", () => {
    expect(find("FAKEvid0001", "choir/ensemble", "The Example Choir").tier).toBe("RED");
    expect(find("FAKEvid0004", "choir/ensemble", "the example choir").questions.join(" ")).toContain("Spelled differently elsewhere");
  });

  it("a malformed proposal is one RED open question", () => {
    expect(rowsOf("FAKEvid0005")).toEqual([expect.objectContaining({ kind: "open question", tier: "RED", name: "" })]);
  });

  it("keeps the original-script title and its transliteration in their own columns", () => {
    expect(find("FAKErev0006", "work", "தமிழ் கீதம்")).toMatchObject({ proposedRecordingTitle: "தமிழ் கீதம்", originalLanguageTitle: "தமிழ் கீதம்", transliteration: "Thamizh Geetham" });
  });
});

describe("reference videos", () => {
  it("are marked isReference, get the editor-supplied rows with basis 4, the editor's flags, and RED for ruled-out proposals", () => {
    const rows = rowsOf("FAKEvid0002");
    expect(rows.every((r) => r.isReference)).toBe(true);
    expect(find("FAKEvid0002", "conductor", "Edith Editor")).toMatchObject({ basis: BASIS.EDITOR, sourceField: "editor", tier: "AMBER" });
    expect(find("FAKEvid0002", "work", "Finale")).toMatchObject({ tier: "RED" });
    expect(rows.find((r) => r.kind === "open question" && r.questions[0].startsWith("Editor flag"))?.tier).toBe("AMBER");
    expect(rowsOf("FAKEvid0001").some((r) => r.isReference)).toBe(false);
  });
});

describe("video and name sheets", () => {
  it("summarises each video with its worst tier and open questions", () => {
    const v1 = sheet.videos.find((v) => v.youtubeVideoId === "FAKEvid0001")!;
    expect(v1).toMatchObject({ worstTier: "RED", credits: 5, isReference: false });
    expect(v1.green + v1.amber + v1.red).toBe(v1.rows);
    const tiers = countTiers(sheet);
    expect(tiers.videos.GREEN + tiers.videos.AMBER + tiers.videos.RED).toBe(sheet.videos.length);
    expect(tiers.rows.GREEN + tiers.rows.AMBER + tiers.rows.RED).toBe(sheet.credits.length);
  });

  it("lists each role + name once, with every spelling seen", () => {
    const choir = sheet.names.find((n) => n.role === "choir/ensemble" && /example choir/i.test(n.name))!;
    expect(choir.spellingsSeen.sort()).toEqual(["The Example Choir", "the example choir"]);
    expect(choir.videoCount).toBe(2);
    expect(sheet.names.find((n) => n.role === "conductor" && n.name === "John Sample")?.videoCount).toBe(2);
  });
});

describe("CSV", () => {
  it("starts with a UTF-8 BOM, uses CRLF, keeps Tamil, quotes commas and quotes, and defuses formulas", () => {
    const csv = toCsv(["a", "b"], [["தமிழ் கீதம்", 'x, "y"'], ["-vgQs9QTWhw", "=1+1"]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toBe('﻿a,b\r\nதமிழ் கீதம்,"x, ""y"""\r\n\'-vgQs9QTWhw,\'=1+1\r\n');
    expect(csvCell("@sum")).toBe("'@sum");
    expect(csvCell(" padded")).toBe('" padded"');
  });

  it("writes the three sheets with the documented headers and blank decision columns", () => {
    const out = sheetToCsv(sheet);
    expect(out.credits.split("\r\n")[0]).toBe(
      "﻿youtubeVideoId,youtubeUrl,youtubeTitle,proposedRecordingTitle,originalLanguageTitle,transliteration,kind,name,roleLabel,workTitle,sourceField,quote,basis,venueTypeBasis,isReference,schemaHome,missingInformationAndQuestion,tier,decision,editedName,notes"
    );
    expect(out.videos.split("\r\n")[0]).toContain("worstTier");
    expect(out.names.split("\r\n")[0]).toBe("﻿role,name,videoCount,spellingsSeen,youtubeVideoIds,decision,canonicalName");
    expect(out.names.split("\r\n").slice(1, -1).every((line) => line.endsWith(",,"))).toBe(true);
  });
});

describe("static guard: the review tool is local and read-only", () => {
  it.each(["scripts/buildVideoCreditsReview.ts", "modules/jobs/videoCreditsReview.ts"])("%s", (file) => {
    const code = readFileSync(path.join(root, file), "utf8");
    const imports = code.split(/\r?\n/).filter((l) => /^\s*import\b/.test(l)).join("\n");
    expect(imports).not.toMatch(/modules\/db|\.\.\/db\/|@prisma|dotenv|@anthropic-ai|anthropicProvider|aiProviderRegistry|http/);
    expect(code).not.toMatch(/process\.env|fetch\(/);
  });

  it("the module touches no files; the script writes only the three review CSV files", () => {
    expect(readFileSync(path.join(root, "modules/jobs/videoCreditsReview.ts"), "utf8")).not.toMatch(/from "fs"|writeFileSync|readFileSync/);
    const script = readFileSync(path.join(root, "scripts/buildVideoCreditsReview.ts"), "utf8");
    expect(script.match(/writeFileSync\(/g)).toHaveLength(3);
  });
});
