import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  BATCH_DISCOUNT,
  DEFAULT_VIDEO_CREDITS_MODEL,
  MODEL_PRICES,
  OUTPUT_TOKENS_PER_VIDEO,
  buildVideoCreditsReport,
  defaultReportPath,
  estimateTokens,
  estimateVideoCreditsCost,
  formatEstimate,
  isPathInside,
  parseVideoCreditsRunnerArgs,
  totalVideoCredits,
} from "../../modules/jobs/videoCreditsRunner";
import { extractVideoCredits, type VideoCreditsSource } from "../../modules/ai/gateway/extractVideoCredits";
import { FakeAIProvider } from "../../modules/ai/providers/fake/fakeAIProvider";

// Credits extraction, milestone 1: the pure parts of scripts/runVideoCreditsExtraction.ts, and a static guard on what the milestone may reach.

const root = path.resolve(__dirname, "../..");
const fixtures = JSON.parse(readFileSync(path.join(root, "tests/fixtures/realYouTubeVideos.json"), "utf8")) as { videos: VideoCreditsSource[] };
const canned = JSON.parse(readFileSync(path.join(root, "tests/fixtures/videoCreditsFakeResponses.json"), "utf8")) as Record<string, unknown>;

describe("parseVideoCreditsRunnerArgs", () => {
  it("defaults to the dry run, the Opus 5.5 estimate, no limit and the default report path", () => {
    expect(parseVideoCreditsRunnerArgs(["--videos", "v.json"])).toEqual({
      ok: true,
      args: { videosFile: "v.json", fakeResponsesFile: null, reportFile: null, model: DEFAULT_VIDEO_CREDITS_MODEL, limit: null },
    });
    expect(DEFAULT_VIDEO_CREDITS_MODEL).toBe("claude-opus-5-5");
  });

  it("refuses --execute: no real Anthropic call in milestone 1", () => {
    const r = parseVideoCreditsRunnerArgs(["--videos", "v.json", "--execute"]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("not enabled in milestone 1");
  });

  it("refuses a missing --videos, an unknown flag, a flag without a value, a bad limit and an unpriced model", () => {
    for (const argv of [[], ["--videos", "v.json", "--provider", "anthropic"], ["--videos"], ["--videos", "v.json", "--limit", "0"], ["--videos", "v.json", "--model", "gpt-x"]]) {
      expect(parseVideoCreditsRunnerArgs(argv).ok).toBe(false);
    }
  });

  it("accepts the optional flags", () => {
    expect(parseVideoCreditsRunnerArgs(["--videos", "v.json", "--fake-responses", "f.json", "--report", "r.json", "--model", "claude-sonnet-5-5", "--limit", "3"])).toEqual({
      ok: true,
      args: { videosFile: "v.json", fakeResponsesFile: "f.json", reportFile: "r.json", model: "claude-sonnet-5-5", limit: 3 },
    });
  });
});

describe("isPathInside (the guard that keeps every path in the repository)", () => {
  const repo = path.resolve(root);
  it("accepts paths inside the repository", () => {
    expect(isPathInside(repo, "tests/fixtures/realYouTubeVideos.json")).toBe(true);
    expect(isPathInside(repo, path.join(repo, "reports", "x.json"))).toBe(true);
  });
  it("refuses a sibling folder such as a secrets folder, a climb out with '..', and another drive or root", () => {
    expect(isPathInside(repo, path.join(path.dirname(repo), "secrets", "staging-sync.env"))).toBe(false);
    expect(isPathInside(repo, "../secrets/staging-loader.env")).toBe(false);
    expect(isPathInside(repo, "reports/../../outside.json")).toBe(false);
    expect(isPathInside(repo, path.parse(repo).root)).toBe(false);
  });
});

describe("the estimate", () => {
  it("counts only the videos that would be sent, and prices them from the table", () => {
    const estimate = estimateVideoCreditsCost(fixtures.videos, "claude-opus-5-5");
    expect(estimate.videosToSend).toBe(3); // 5 exported: one unlisted, one without a description
    const price = MODEL_PRICES["claude-opus-5-5"];
    const expected = (estimate.inputTokens * price.input + OUTPUT_TOKENS_PER_VIDEO.typical * 3 * price.output) / 1_000_000;
    expect(estimate.typical.cost).toBeCloseTo(expected, 10);
    expect(estimate.typical.batchCost).toBeCloseTo(expected * BATCH_DISCOUNT, 10);
    expect(estimate.high.cost).toBeGreaterThan(estimate.typical.cost);
    expect(estimate.inputTokens).toBeGreaterThan(estimate.fixedInputTokensPerVideo * 3);
  });

  it("uses a conservative 3 characters per token", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(2);
  });

  it("prints the model, the token counts and both standard and Batch API costs", () => {
    const text = formatEstimate(estimateVideoCreditsCost(fixtures.videos, "claude-sonnet-5-5")).join("\n");
    expect(text).toContain("claude-sonnet-5-5");
    expect(text).toContain("Videos that would be sent:  3");
    expect(text).toContain("Batch API");
    expect(text).toContain("no API call");
  });
});

describe("totals and report", () => {
  it("summarises outcomes and builds a report that carries no description text", async () => {
    const provider = new FakeAIProvider({ respond: (r) => canned[r.targetEntityId] });
    const outcomes = await Promise.all(fixtures.videos.map((v) => extractVideoCredits(v, provider)));
    const totals = totalVideoCredits(outcomes);
    expect(totals).toMatchObject({ videos: 5, extracted: 3, skipped: { NOT_PUBLIC: 1, NO_DESCRIPTION: 1 }, providerFailed: 0, invalidOutput: 0 });
    expect(totals.rejectionReasons["credit:NAME_NOT_IN_QUOTE"]).toBe(2);
    expect(totals.rejectionReasons["venueType:VENUE_TYPE_NOT_STATED"]).toBe(1);

    const generatedAt = new Date("2026-11-14T10:00:00.000Z");
    const args = { videosFile: "tests/fixtures/realYouTubeVideos.json", fakeResponsesFile: null, reportFile: null, model: "claude-opus-5-5", limit: null };
    const report = buildVideoCreditsReport({ generatedAt, args, estimate: estimateVideoCreditsCost(fixtures.videos, args.model), outcomes });
    expect(report).toMatchObject({ kind: "video-credits-dry-run", provider: "fake", promptVersion: "video-credits-v1", generatedAt: "2026-11-14T10:00:00.000Z" });
    expect(JSON.stringify(report)).not.toContain("Ulagam pora pokka paaru"); // lyrics from a description are not copied into the report
    expect(defaultReportPath(generatedAt)).toBe(path.join("reports", "video-credits", "video-credits-2026-11-14T10-00-00-000Z.json"));
  });
});

describe("static guard: milestone 1 cannot reach a database, environment files or the real Anthropic API", () => {
  const files = [
    "scripts/runVideoCreditsExtraction.ts",
    "modules/jobs/videoCreditsRunner.ts",
    "modules/ai/gateway/extractVideoCredits.ts",
    "modules/ai/structuredOutput/validateVideoCreditsOutput.ts",
    "modules/ai/prompts/videoCredits/videoCreditsPromptV1.ts",
    "modules/mmke/provenance/verbatimEvidence.ts",
    "modules/ai/providers/fake/fakeAIProvider.ts",
  ];
  const forbidden = [/modules\/db\//, /\.\.\/db\//, /@prisma\//, /from "dotenv/, /dotenv\/config/, /@anthropic-ai\/sdk/, /anthropicProvider/, /aiProviderRegistry/, /process\.env/, /secrets/i];

  it.each(files)("%s imports nothing that could", (file) => {
    const source = readFileSync(path.join(root, file), "utf8");
    const imports = source.split(/\r?\n/).filter((l) => /^\s*import\b|require\(/.test(l)).join("\n");
    for (const pattern of forbidden) expect(imports, `${file}: ${pattern}`).not.toMatch(pattern);
    expect(source, `${file}: process.env`).not.toMatch(/process\.env/);
  });

  it("the script writes exactly one file (the report) and constructs only the fake provider", () => {
    const source = readFileSync(path.join(root, "scripts/runVideoCreditsExtraction.ts"), "utf8");
    expect(source.match(/writeFileSync\(/g)).toHaveLength(1);
    expect(source).toContain("new FakeAIProvider(");
    expect(source).not.toMatch(/new AnthropicProvider|createAIProvider|getConfiguredAIProvider/);
  });
});
