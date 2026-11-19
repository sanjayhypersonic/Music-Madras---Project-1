import { describe, expect, it } from "vitest";
import { describeRunReport, parseRunArgs, scopePorts, selectRunTargets, type VideoRunFacts } from "../../modules/pipeline/select";
import { readPipelineConfig } from "../../modules/pipeline/config";
import { runPipeline } from "../../modules/pipeline/run";
import { QueryPatternDemandProvider } from "../../modules/pipeline/searchDemand";
import { FAKE_DESCRIPTION, FAKE_TITLE, FakePorts, fakeProvider } from "../fixtures/pipelineFake";

// npm run pipeline:run (R-34): argument rules, the refusal of held-out and already approved videos, the scope guard, and a run of exactly the
// chosen video through the orchestrator. FAKE provider and in-memory ports only.

const NOW = new Date("2026-11-18T12:00:00.000Z");
const facts = (over: Partial<VideoRunFacts> & { youtubeVideoId: string }): VideoRunFacts => ({ inCatalogue: true, privacyStatus: "public", observabilityState: "OBSERVED", bundleStatus: null, bundleHeldReasons: [], videoHoldReason: null, recordingHoldReason: null, recordingStatus: null, ...over });

describe("pipeline:run arguments", () => {
  it("needs --only or --limit, and --execute needs the typed staging target", () => {
    expect(parseRunArgs([])).toMatchObject({ ok: false });
    expect(parseRunArgs(["--only", "short"])).toMatchObject({ ok: false });
    expect(parseRunArgs(["--limit", "0"])).toMatchObject({ ok: false });
    expect(parseRunArgs(["--only", "fakeVideo01", "--execute"])).toMatchObject({ ok: false, error: expect.stringMatching(/--confirm-host/) });
    expect(parseRunArgs(["--only", "fakeVideo01,fakeVideo01,fakeVideo02", "--confirm-host", "h:5432/music_madras_staging", "--execute"])).toEqual({
      ok: true,
      args: { only: ["fakeVideo01", "fakeVideo02"], limit: null, execute: true, confirmHost: "h:5432/music_madras_staging" },
    });
  });
});

describe("which videos may run", () => {
  it("refuses held-out and already approved videos, with the reason, and never runs them", () => {
    const all = [
      facts({ youtubeVideoId: "okVideo0001" }),
      facts({ youtubeVideoId: "videoHold01", videoHoldReason: "RIGHTS" }),
      facts({ youtubeVideoId: "recHold0001", recordingHoldReason: "PRIVACY" }),
      facts({ youtubeVideoId: "planHeld001", bundleStatus: "RESEARCHED", bundleHeldReasons: ['work "X" has no editor-approved composer'] }),
      facts({ youtubeVideoId: "approved001", bundleStatus: "APPROVED" }),
      facts({ youtubeVideoId: "published01", bundleStatus: "PUBLISHED" }),
      facts({ youtubeVideoId: "recPublish1", recordingStatus: "PUBLISHED" }),
      facts({ youtubeVideoId: "private0001", privacyStatus: "private" }),
      facts({ youtubeVideoId: "okVideo0002", bundleStatus: "QUEUED" }),
    ];
    const { selected, refused } = selectRunTargets(all, { only: [...all.map((f) => f.youtubeVideoId), "missing0001"], limit: null });
    expect(selected).toEqual(["okVideo0001", "okVideo0002"]);
    expect(Object.fromEntries(refused.map((r) => [r.youtubeVideoId, r.reason]))).toEqual({
      videoHold01: "held out: the video has a rights hold",
      recHold0001: "held out: its Recording has a privacy hold",
      planHeld001: 'held out by the planner: work "X" has no editor-approved composer',
      approved001: "already approved (bundle APPROVED)",
      published01: "already approved (bundle PUBLISHED)",
      recPublish1: "already approved (its Recording is published)",
      private0001: "stored as private, not public",
      missing0001: "not in the synchronised catalogue (run the YouTube sync first)",
    });
  });

  it("with --limit, takes the first N runnable queued videos", () => {
    const queued = [facts({ youtubeVideoId: "queued00001", bundleStatus: "QUEUED" }), facts({ youtubeVideoId: "held0000001", bundleStatus: "QUEUED", videoHoldReason: "OTHER" }), facts({ youtubeVideoId: "queued00002", bundleStatus: "EXTRACTED" }), facts({ youtubeVideoId: "queued00003", bundleStatus: "QUEUED" })];
    expect(selectRunTargets(queued, { only: null, limit: 2 }).selected).toEqual(["queued00001", "queued00002"]);
  });
});

describe("running exactly the chosen videos (fake provider)", () => {
  const twoVideos = () =>
    new FakePorts({
      videos: [
        { youtubeVideoRowId: "row-1", youtubeVideoId: "fakeVideo01", title: FAKE_TITLE, description: FAKE_DESCRIPTION, tags: [], existing: null },
        { youtubeVideoRowId: "row-2", youtubeVideoId: "fakeVideo02", title: FAKE_TITLE, description: FAKE_DESCRIPTION, tags: [], existing: null },
      ],
    });
  const config = (dryRun: boolean) => ({ ...readPipelineConfig({ PIPELINE_EXTRACT_MODE: "api", PIPELINE_RESEARCH_MODE: "api", PIPELINE_ENABLED: "true", PIPELINE_DRY_RUN: dryRun ? "true" : "false" }), dryRun, maxVideosPerRun: 1, maxQueuePerRun: 1, maxEntitiesResearchedPerVideo: 10 });

  it("advances only the selected video, leaves the other untouched, and prints stages, tokens, searches and cost", async () => {
    // These in-memory ports are NOT scoped in their queries (the Prisma ports are), so they return every video; the wrapper alone must keep the
    // run to the chosen one.
    const ports = twoVideos();
    const report = await runPipeline({ ports: scopePorts(ports, ["fakeVideo02"]), provider: fakeProvider(), demand: [new QueryPatternDemandProvider()], config: { ...config(false), maxQueuePerRun: 10 }, now: NOW });
    expect([...ports.rows.keys()]).toEqual(["pv-row-2"]);
    expect(ports.rows.get("pv-row-2")!.status).toBe("AWAITING_APPROVAL");
    const lines = describeRunReport(report, ["fakeVideo02"]);
    expect(lines[0]).toBe("  fakeVideo02: QUEUED -> EXTRACTED -> RESOLVED -> RESEARCHED -> AWAITING_APPROVAL");
    expect(lines.at(-1)).toMatch(/^ {2}Usage: \d+ AI call\(s\), \d+ input \+ \d+ output tokens, 12 web search\(es\), \$0\.1200 of the \$2\.00 cap$/);
  });

  it("dry run: calls nothing and writes nothing", async () => {
    const ports = twoVideos();
    const calls: string[] = [];
    const report = await runPipeline({ ports: scopePorts(ports, ["fakeVideo01"]), provider: fakeProvider(calls), demand: [], config: config(true), now: NOW });
    expect(calls).toEqual([]);
    expect(ports.writes).toEqual([]);
    expect(describeRunReport(report, ["fakeVideo01"])).toEqual(["  fakeVideo01: no stage advanced", "  would: queue fakeVideo01", "  Usage: 0 AI call(s), 0 input + 0 output tokens, 0 web search(es), $0.0000 of the $2.00 cap (dry run: nothing was called or written)"]);
  });

  it("the scope guard refuses to queue a video outside the selection, whatever the underlying ports return", async () => {
    const scoped = scopePorts(twoVideos(), ["fakeVideo01"]);
    expect((await scoped.listQueueCandidates(10)).map((c) => c.youtubeVideoId)).toEqual(["fakeVideo01"]);
    await expect(scoped.enqueue({ youtubeVideoRowId: "row-2", youtubeVideoId: "fakeVideo02", title: null, description: null, tags: [], existing: null }, "fp", false)).rejects.toThrow(/outside this run's selection/);
  });
});
