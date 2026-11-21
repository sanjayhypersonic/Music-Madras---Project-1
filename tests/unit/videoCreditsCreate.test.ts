import { describe, expect, it } from "vitest";
import { CREDITS_HEADER, NAMES_HEADER, VIDEOS_HEADER, toCsv } from "../../modules/jobs/videoCreditsReview";
import { parseCsv, resolveApprovedFacts, unguardCell } from "../../modules/jobs/videoCreditsApproved";
import { parseCreditsCreateArgs, planVideo, planVideos } from "../../modules/jobs/videoCreditsCreate";

// Credits create (Phase B2): the mapping from reviewed sheets to a plan, and every refusal. FAKE data only: invented video ids and names.

type Row = Partial<Record<(typeof CREDITS_HEADER)[number], string>>;
const VID = "fakeVideo01";
const MEDLEY = "fakeMedley1";
const TAMIL = "fakeTamil01";

function credit(r: Row): string[] {
  const id = r.youtubeVideoId ?? VID;
  const full: Record<string, string> = { youtubeVideoId: id, youtubeUrl: `https://www.youtube.com/watch?v=${id}`, youtubeTitle: "Fake title | Fake Choir", proposedRecordingTitle: "", originalLanguageTitle: "", transliteration: "", kind: "", name: "", roleLabel: "", workTitle: "", sourceField: "description", quote: "", basis: "2 stated in description", venueTypeBasis: "", isReference: "false", schemaHome: "", missingInformationAndQuestion: "", tier: "GREEN", decision: "accept", editedName: "", notes: "", ...r };
  return CREDITS_HEADER.map((h) => full[h]);
}
const creditsCsv = (rows: Row[]) => toCsv(CREDITS_HEADER, rows.map(credit));
const namesCsv = (rows: Array<[role: string, name: string, decision: string, canonical?: string, spellings?: string]>) =>
  toCsv(NAMES_HEADER, rows.map(([role, name, decision, canonical, spellings]) => [role, name, 1, spellings ?? name, VID, decision, canonical ?? ""]));

const singleWork: Row[] = [
  { kind: "work", name: "A Fake Carol", roleLabel: 'WORK (label "Carol")', proposedRecordingTitle: "A Fake Carol" },
  { kind: "composer", name: "Ann Example", roleLabel: '"music by"', workTitle: "A Fake Carol" },
  { kind: "choir/ensemble", name: "Fake Chapel Choir", roleLabel: 'CHOIR (label "Choir")' },
  { kind: "choir/ensemble", name: "Fake Orchestra", roleLabel: 'ENSEMBLE (label "Orchestra")' },
  { kind: "conductor", name: "Ben Sample", roleLabel: "CONDUCTOR (editor-supplied)", sourceField: "editor", basis: "4 editor-supplied", tier: "AMBER" },
  { kind: "venue", name: "Fake Chapel", roleLabel: 'VENUE (label "Venue")' },
  { kind: "venueType", name: "CHURCH", basis: "5 AI-inferred or unresolved", venueTypeBasis: "inferred from name", tier: "AMBER" },
  { kind: "performanceDate", name: "2025-12-12", roleLabel: "Date", tier: "AMBER" },
  { kind: "institution", name: "Fake College", roleLabel: "UNMODELLED INSTITUTION", tier: "AMBER" },
  { kind: "arranger", name: "Cara Placeholder", roleLabel: 'ARRANGER (label "Arrangement")', workTitle: "A Fake Carol" },
  { kind: "performer", name: "Dev Soloist", roleLabel: 'PERFORMER (label "Soprano")', decision: "" },
];
const singleNames = namesCsv([
  ["work", "A Fake Carol", "accept"],
  ["composer", "Ann Example", "accept"],
  ["choir/ensemble", "Fake Chapel Choir", "accept"],
  ["choir/ensemble", "Fake Orchestra", "accept"],
  ["conductor", "Ben Sample", "accept"],
  ["venue", "Fake Chapel", "accept"],
  ["institution", "Fake College", "accept"],
  ["arranger", "Cara Placeholder", "accept"],
]);

describe("the reviewed sheets are read back exactly", () => {
  it("parses the review sheet's own CSV (BOM, CRLF, quotes, commas) and undoes the formula guard", () => {
    const text = toCsv(["a", "b"], [["-vgQs9QTWhw", 'He said "hi", twice'], ["பாலன் பிறந்த ராவில்", ""]]);
    const rows = parseCsv(text);
    expect(rows).toEqual([["a", "b"], ["'-vgQs9QTWhw", 'He said "hi", twice'], ["பாலன் பிறந்த ராவில்", ""]]);
    expect(unguardCell(rows[1][0])).toBe("-vgQs9QTWhw");
    expect(unguardCell("'plain")).toBe("'plain");
  });

  it("refuses a sheet without the decision columns", () => {
    const result = resolveApprovedFacts({ creditsCsv: "youtubeVideoId,kind\r\nx,work\r\n", namesCsv: singleNames });
    expect(result.videos).toEqual([]);
    expect(result.problems[0]).toMatch(/review-credits\.csv lacks the column\(s\)/);
  });
});

describe("planning one approved single-work video", () => {
  const [video] = resolveApprovedFacts({ creditsCsv: creditsCsv(singleWork), namesCsv: singleNames }).videos;
  const plan = planVideo(video);

  it("plans a DRAFT Recording, the work with its approved composer, the venue, a dated performance and its participants", () => {
    expect(plan.heldReasons).toEqual([]);
    expect(plan.recording).toMatchObject({ title: "A Fake Carol", plannedSlug: "a-fake-carol", slug: { year: "2025" } });
    expect(plan.works).toEqual([{ title: "A Fake Carol", alternateTitles: [], basis: "2 stated in description", composer: { name: "Ann Example", basis: "2 stated in description", sheetRow: 2 }, sheetRow: 1 }]);
    expect(plan.programme).toEqual({ title: "A Fake Carol" });
    expect(plan.performance).toEqual({ date: "2025-12-12" });
    expect(plan.choirs.map((c) => c.name)).toEqual(["Fake Chapel Choir"]);
    expect(plan.performers).toEqual([]); // no decision: ignored
    expect(plan.ignored).toBe(1);
  });

  it("keeps an inferred venue type inferred, and an editor-supplied conductor at basis 4", () => {
    expect(plan.venue).toEqual({ name: "Fake Chapel", type: "CHURCH", typeBasis: "inferred from name (editor-accepted)", basis: "2 stated in description" });
    expect(plan.conductors).toEqual([{ name: "Ben Sample", basis: "4 editor-supplied", sheetRow: 5 }]);
  });

  it("sends facts with no schema home to the sidecar instead of distorting a field", () => {
    expect(plan.sidecar.map((s) => `${s.label}:${s.name}`).sort()).toEqual(["ARRANGER:Cara Placeholder", "ENSEMBLE:Fake Orchestra", "INSTITUTION:Fake College"]);
  });
});

describe("refusals", () => {
  const refusedFor = (rows: Row[], names = singleNames) => resolveApprovedFacts({ creditsCsv: creditsCsv(rows), namesCsv: names }).videos[0].refused.map((r) => r.reason);

  it("refuses a RED row without a note, a checker-rejected credit accepted as is, and an undecided name", () => {
    expect(refusedFor([{ kind: "composer", name: "Ann Example", tier: "RED" }])[0]).toMatch(/RED row needs a note/);
    expect(refusedFor([{ kind: "composer", name: "Ann Example", tier: "RED", notes: "checked", missingInformationAndQuestion: "Rejected by the checker: QUOTE_NOT_FOUND." }])[0]).toMatch(/checker rejected/);
    expect(refusedFor([{ kind: "conductor", name: "Unknown Person" }])[0]).toMatch(/not decided in review-names\.csv/);
    expect(refusedFor([{ kind: "composer", name: "Ann Example" }], namesCsv([["composer", "Ann Example", "reject"]]))[0]).toMatch(/rejected in review-names\.csv/);
    expect(refusedFor([{ kind: "composer", name: "Ann Example" }], namesCsv([["composer", "Ann Example", "accept", "", "Ann Example | Ann EXAMPLE"]]))[0]).toMatch(/several spellings/);
  });

  it("refuses a venue type outside the catalogue's values, and a missing type accepted without choosing one", () => {
    expect(refusedFor([{ kind: "venueType", name: "", venueTypeBasis: "missing", tier: "RED", notes: "x" }])[0]).toMatch(/choose one with edit/);
    expect(refusedFor([{ kind: "venueType", name: "", decision: "edit", editedName: "temple", tier: "RED", notes: "x" }])[0]).toMatch(/not a catalogue venue type/);
  });

  it("lets the editor choose a missing venue type with edit, recorded as editor-chosen at basis 4", () => {
    const rows = [...singleWork.filter((r) => r.kind !== "venueType"), { kind: "venueType" as const, name: "", venueTypeBasis: "missing", tier: "RED" as const, decision: "edit", editedName: "concert hall", notes: "from the programme" }];
    const plan = planVideo(resolveApprovedFacts({ creditsCsv: creditsCsv(rows), namesCsv: singleNames }).videos[0]);
    expect(plan.venue).toMatchObject({ type: "CONCERT_HALL", typeBasis: "editor-chosen" });
  });

  it("accepts an edit row with editedName INDOOR_AUDITORIUM (or 'Indoor Auditorium'), and lists it in the allowed values", () => {
    for (const editedName of ["INDOOR_AUDITORIUM", "Indoor Auditorium", "indoor-auditorium"]) {
      const rows = [...singleWork.filter((r) => r.kind !== "venueType"), { kind: "venueType" as const, name: "", venueTypeBasis: "missing", tier: "RED" as const, decision: "edit", editedName, notes: "the description says auditorium" }];
      const plan = planVideo(resolveApprovedFacts({ creditsCsv: creditsCsv(rows), namesCsv: singleNames }).videos[0]);
      expect(plan.venue).toMatchObject({ type: "INDOOR_AUDITORIUM", typeBasis: "editor-chosen" });
    }
    expect(refusedFor([{ kind: "venueType", name: "", decision: "edit", editedName: "auditorium", tier: "RED", notes: "x" }])[0]).toMatch(/CHURCH, CATHEDRAL, CONCERT_HALL, STUDIO, OUTDOOR or INDOOR_AUDITORIUM/);
  });

  it("plans no Venue or Performance without an approved type, and moves the participants to the sidecar", () => {
    const plan = planVideo(resolveApprovedFacts({ creditsCsv: creditsCsv(singleWork.filter((r) => r.kind !== "venueType")), namesCsv: singleNames }).videos[0]);
    expect(plan.heldReasons).toEqual([]);
    expect(plan.venue).toBeNull();
    expect(plan.performance).toBeNull();
    expect(plan.notes.join(" ")).toMatch(/Venue\.type is required/);
    expect(plan.sidecar.map((s) => s.label)).toEqual(expect.arrayContaining(["CHOIR", "CONDUCTOR", "DATE"]));
  });
});

describe("medleys, missing composers and original-script titles", () => {
  const medleyRows: Row[] = [
    { youtubeVideoId: MEDLEY, kind: "work", name: "First Fake Carol", proposedRecordingTitle: "Fake Carol Medley" },
    { youtubeVideoId: MEDLEY, kind: "work", name: "Second Fake Carol", proposedRecordingTitle: "Fake Carol Medley" },
    { youtubeVideoId: MEDLEY, kind: "composer", name: "Eve Writer", workTitle: "Second Fake Carol", proposedRecordingTitle: "Fake Carol Medley" },
    { youtubeVideoId: MEDLEY, kind: "lyricist", name: "Finn Words", workTitle: "First Fake Carol", proposedRecordingTitle: "Fake Carol Medley" },
  ];
  const medleyNames = namesCsv([
    ["work", "First Fake Carol", "accept"],
    ["work", "Second Fake Carol", "accept"],
    ["composer", "Eve Writer", "accept"],
    ["composer", "Gus Maker", "accept"],
    ["lyricist", "Finn Words", "accept"],
  ]);

  it("holds out a whole video when one of its works has no approved composer, and never invents one", () => {
    const plan = planVideo(resolveApprovedFacts({ creditsCsv: creditsCsv(medleyRows), namesCsv: medleyNames }).videos[0]);
    expect(plan.heldReasons.join(" ")).toMatch(/"First Fake Carol" has no editor-approved composer/);
    expect(plan.recording).toBeNull();
    expect(plan.works).toEqual([]);
  });

  it("plans a medley as ONE Recording with its works in order once every work has a composer and the video title is approved", () => {
    const rows = [...medleyRows, { youtubeVideoId: MEDLEY, kind: "composer" as const, name: "Gus Maker", workTitle: "First Fake Carol", proposedRecordingTitle: "Fake Carol Medley" }];
    const withoutTitle = planVideo(resolveApprovedFacts({ creditsCsv: creditsCsv(rows), namesCsv: medleyNames }).videos[0]);
    expect(withoutTitle.heldReasons.join(" ")).toMatch(/no approved Recording title/);

    const videosCsv = toCsv(VIDEOS_HEADER, [[MEDLEY, `https://www.youtube.com/watch?v=${MEDLEY}`, "t", "Fake Carol Medley", "false", "p.json", "AMBER", 5, 0, 5, 0, 4, 0, "", "accept", ""]]);
    const plan = planVideo(resolveApprovedFacts({ creditsCsv: creditsCsv(rows), namesCsv: medleyNames, videosCsv }).videos[0]);
    expect(plan.heldReasons).toEqual([]);
    expect(plan.recording).toMatchObject({ title: "Fake Carol Medley", plannedSlug: "fake-carol-medley" });
    expect(plan.works.map((w) => `${w.title} / ${w.composer.name}`)).toEqual(["First Fake Carol / Gus Maker", "Second Fake Carol / Eve Writer"]);
  });

  it("keeps an original-script title as the title and its transliteration as an alternate title and slug source", () => {
    const tamil = "பாலன் பிறந்த ராவில்";
    const rows: Row[] = [
      { youtubeVideoId: TAMIL, kind: "work", name: tamil, originalLanguageTitle: tamil, transliteration: "Paalan Pirandha Raavil", proposedRecordingTitle: tamil },
      { youtubeVideoId: TAMIL, kind: "composer", name: "Hari Fake", workTitle: tamil, originalLanguageTitle: tamil, transliteration: "Paalan Pirandha Raavil", proposedRecordingTitle: tamil },
    ];
    const names = namesCsv([["work", tamil, "accept", "Paalan Pirandha Raavil"], ["composer", "Hari Fake", "accept"]]);
    const plan = planVideo(resolveApprovedFacts({ creditsCsv: creditsCsv(rows), namesCsv: names }).videos[0]);
    expect(plan.works[0]).toMatchObject({ title: tamil, alternateTitles: ["Paalan Pirandha Raavil"] });
    expect(plan.recording).toMatchObject({ title: tamil, plannedSlug: "paalan-pirandha-raavil" });
  });

  it("--only narrows the plan", () => {
    const facts = resolveApprovedFacts({ creditsCsv: creditsCsv([...singleWork, ...medleyRows]), namesCsv: singleNames }).videos;
    expect(planVideos(facts, [MEDLEY]).map((p) => p.youtubeVideoId)).toEqual([MEDLEY]);
  });
});

describe("arguments", () => {
  it("is a dry run by default, and --execute needs the typed staging target", () => {
    expect(parseCreditsCreateArgs([])).toEqual({ ok: true, args: { dir: "reports/video-credits", only: null, execute: false, confirmHost: null } });
    expect(parseCreditsCreateArgs(["--execute"])).toMatchObject({ ok: false, error: expect.stringMatching(/--confirm-host/) });
    expect(parseCreditsCreateArgs(["--only", "short"])).toMatchObject({ ok: false });
    expect(parseCreditsCreateArgs(["--only", `${VID},${MEDLEY}`])).toMatchObject({ ok: true, args: { only: [VID, MEDLEY] } });
  });
});
