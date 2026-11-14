import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  MANUAL_PROVIDER,
  buildVideoCreditsCheckReport,
  checkVideoCreditsProposals,
  defaultCheckReportPath,
  formatCheckSummary,
  parseExportFile,
  parseVideoCreditsCheckArgs,
  summariseByRole,
  uniqueProposedNames,
  type VideoCreditsCheckResult,
} from "../../modules/jobs/videoCreditsCheck";
import type { ExportedVideo } from "../../modules/jobs/videoCreditsExport";

// Credits extraction, route 2: the offline checker, against FAKE data only (tests/fixtures/videoCreditsFake*.json: invented videos and names).

const root = path.resolve(__dirname, "../..");
const fakeExport = JSON.parse(readFileSync(path.join(root, "tests/fixtures/videoCreditsFakeExport.json"), "utf8"));
const fakeProposals = JSON.parse(readFileSync(path.join(root, "tests/fixtures/videoCreditsFakeProposals.json"), "utf8")) as unknown[];

const videos = (() => {
  const parsed = parseExportFile(fakeExport);
  if (!parsed.ok) throw new Error(parsed.problems.join(" "));
  return parsed.videos;
})();

const run = (proposals: unknown = fakeProposals): VideoCreditsCheckResult => {
  const r = checkVideoCreditsProposals(videos, proposals);
  if (!r.ok) throw new Error(r.error);
  return r.result;
};
const extracted = (result: VideoCreditsCheckResult, id: string) => {
  const o = result.outcomes.find((x) => x.youtubeVideoId === id);
  if (!o || o.status !== "EXTRACTED") throw new Error(`${id} was not checked`);
  return o.result;
};

describe("parseVideoCreditsCheckArgs", () => {
  it("needs --export and --proposals, and takes an optional --report", () => {
    expect(parseVideoCreditsCheckArgs(["--export", "e.json"]).ok).toBe(false);
    expect(parseVideoCreditsCheckArgs(["--export", "e.json", "--proposals", "p.json", "--execute"]).ok).toBe(false);
    expect(parseVideoCreditsCheckArgs(["--export", "e.json", "--proposals", "p.json", "--report", "r.json"])).toEqual({
      ok: true,
      args: { exportFile: "e.json", proposalsFile: "p.json", reportFile: "r.json" },
    });
  });
});

describe("parseExportFile", () => {
  it("reads the export's videos", () => {
    expect(videos.map((v) => v.youtubeVideoId)).toEqual(["FAKEvid0001", "FAKEvid0002", "FAKEvid0003", "FAKEvid0004", "FAKEvid0005"]);
  });

  it("refuses a file without a videos list, a video without an id, and a video listed twice", () => {
    expect(parseExportFile([]).ok).toBe(false);
    expect(parseExportFile({ videos: [{ title: "x", description: "y" }] }).ok).toBe(false);
    const twice = parseExportFile({ videos: [{ youtubeVideoId: "a", title: null, description: "d" }, { youtubeVideoId: "a", title: null, description: "d" }] });
    expect(twice.ok === false && twice.problems[0]).toContain("appears twice");
  });
});

describe("checkVideoCreditsProposals", () => {
  const result = run();

  it("applies the validators to the export's text: quote verbatim, name inside the quote (case matters), hashtags refused", () => {
    const one = extracted(result, "FAKEvid0001");
    expect(one.accepted.map((c) => `${c.role}:${c.name}`)).toEqual(["WORK:An Example Carol", "COMPOSER:Jane Placeholder", "CHOIR:The Example Choir", "CONDUCTOR:John Sample", "VENUE:St. Nowhere Church"]);
    expect(one.rejected.map((r) => `${r.credit.name}:${r.reason}`)).toEqual(["john sample:NAME_NOT_IN_QUOTE", "#ExampleChoir:NAME_INVALID"]);
    expect(one.venueType).toMatchObject({ status: "ACCEPTED", value: "CHURCH" });
    expect(one.performanceDate).toMatchObject({ status: "ACCEPTED", value: "2024-03-03" });
  });

  it("rejects a quotation the export does not contain, and accepts a stated concert hall", () => {
    const two = extracted(result, "FAKEvid0002");
    expect(two.rejected).toEqual([expect.objectContaining({ reason: "QUOTE_NOT_FOUND", credit: expect.objectContaining({ name: "Interlude" }) })]);
    expect(two.venueType).toMatchObject({ status: "ACCEPTED", value: "CONCERT_HALL" });
  });

  it("records a malformed proposal as INVALID_OUTPUT, never as credits", () => {
    expect(result.outcomes.find((o) => o.youtubeVideoId === "FAKEvid0005")).toMatchObject({ status: "INVALID_OUTPUT", provider: MANUAL_PROVIDER });
  });

  it("rejects proposals for videos not in the export, a second proposal for a video, a non-object and a missing id", () => {
    expect(result.proposalRejections).toEqual([
      { index: 4, youtubeVideoId: "FAKEvid9999", reason: "VIDEO_NOT_IN_EXPORT" },
      { index: 5, youtubeVideoId: "FAKEvid0002", reason: "DUPLICATE_PROPOSAL" },
      { index: 6, youtubeVideoId: null, reason: "NOT_AN_OBJECT" },
      { index: 7, youtubeVideoId: null, reason: "MISSING_VIDEO_ID" },
    ]);
    expect(result.outcomes.filter((o) => o.youtubeVideoId === "FAKEvid0002")).toHaveLength(1);
  });

  it("lists export videos that got no proposal", () => {
    expect(result.videosWithoutProposal).toEqual(["FAKEvid0003"]);
  });

  it("refuses a proposals file that is not an array", () => {
    expect(checkVideoCreditsProposals(videos, { proposals: [] })).toEqual({ ok: false, error: "The proposals file must be a JSON array with one object per video." });
  });

  it("checks against the export's text, not the proposal's: a quote that matches nothing in the export fails even if the proposal says otherwise", () => {
    const forged = { ...(fakeProposals[2] as object), credits: [{ role: "CHOIR", name: "Forged Choir", workTitle: null, quote: "Choir: Forged Choir", field: "description" }] };
    expect(extracted(run([forged]), "FAKEvid0004").rejected[0].reason).toBe("QUOTE_NOT_FOUND");
  });
});

describe("summaries", () => {
  const result = run();

  it("counts accepted and rejected credits per role", () => {
    const byRole = summariseByRole(result.outcomes);
    expect(byRole.CONDUCTOR).toEqual({ accepted: 2, rejected: 1 });
    expect(byRole.WORK).toEqual({ accepted: 3, rejected: 1 });
    expect(byRole.PERFORMER).toEqual({ accepted: 0, rejected: 1 });
    expect(byRole.ARRANGER).toEqual({ accepted: 0, rejected: 0 });
  });

  it("lists unique accepted names per role, grouping only case and white-space variants", () => {
    const names = uniqueProposedNames(result.outcomes);
    expect(names.find((n) => n.role === "CONDUCTOR")).toEqual({ role: "CONDUCTOR", name: "John Sample", spellings: ["John Sample"], videoCount: 2, youtubeVideoIds: ["FAKEvid0001", "FAKEvid0002"] });
    expect(names.find((n) => n.role === "CHOIR")).toEqual({
      role: "CHOIR",
      name: "The Example Choir",
      spellings: ["The Example Choir", "the example choir"],
      videoCount: 2,
      youtubeVideoIds: ["FAKEvid0001", "FAKEvid0004"],
    });
    expect(names.find((n) => n.role === "COMPOSER" && n.name === "Placeholder")?.videoCount).toBe(1);
    expect(names.map((n) => n.name)).not.toContain("john sample");
    expect([...new Set(names.map((n) => n.role))]).toEqual(["COMPOSER", "WORK", "ENSEMBLE", "CHOIR", "CONDUCTOR", "VENUE"]);
  });

  it("builds a report with totals, roles, names, rejections and uncovered videos, and no description text", () => {
    const generatedAt = new Date("2026-11-14T10:00:00.000Z");
    const args = { exportFile: "tests/fixtures/videoCreditsFakeExport.json", proposalsFile: "tests/fixtures/videoCreditsFakeProposals.json", reportFile: null };
    const report = buildVideoCreditsCheckReport({ generatedAt, args, videosInExport: videos.length, proposals: fakeProposals.length, result });
    expect(report.totals).toMatchObject({ videos: 4, extracted: 3, invalidOutput: 1, creditsAccepted: 13, creditsRejected: 3, proposalsRejected: 4, videosWithoutProposal: 1 });
    expect(report).toMatchObject({ kind: "video-credits-check", provider: "manual", promptVersion: "video-credits-v1" });
    expect(JSON.stringify(report)).not.toContain("Ignore all previous instructions");
    const text = formatCheckSummary(report).join("\n");
    expect(text).toContain("spellings: The Example Choir | the example choir");
    expect(text).toContain("#4 FAKEvid9999  VIDEO_NOT_IN_EXPORT");
    expect(text).toContain("Videos in the export with no proposal: FAKEvid0003");
    expect(defaultCheckReportPath(generatedAt)).toBe(path.join("reports", "video-credits", "check-2026-11-14T10-00-00-000Z.json"));
  });
});

describe("static guard: the checker has no database, network or environment access", () => {
  it.each(["scripts/checkVideoCreditsProposals.ts", "modules/jobs/videoCreditsCheck.ts"])("%s", (file) => {
    const code = readFileSync(path.join(root, file), "utf8");
    const imports = code.split(/\r?\n/).filter((l) => /^\s*import\b/.test(l)).join("\n");
    expect(imports).not.toMatch(/modules\/db|\.\.\/db\/|@prisma|dotenv|@anthropic-ai|anthropicProvider|aiProviderRegistry|http|net\b/);
    expect(code).not.toMatch(/process\.env|fetch\(/);
  });

  it("the checker script writes exactly one file", () => {
    const code = readFileSync(path.join(root, "scripts/checkVideoCreditsProposals.ts"), "utf8");
    expect(code.match(/writeFileSync\(/g)).toHaveLength(1);
  });

  it("an export video without a proposal is typed like any other", () => {
    const v: ExportedVideo = videos[2];
    expect(v.playlistTitles).toEqual([]);
  });
});
