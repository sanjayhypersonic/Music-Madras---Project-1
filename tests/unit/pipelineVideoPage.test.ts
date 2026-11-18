import { describe, expect, it } from "vitest";
import { planVideoPage, PIPELINE_VIDEO_PAGE_REASON, type VideoPageFacts } from "../../modules/pipeline/videoPage";
import { approveBundle, type ApprovalDeps, type BundleForApproval } from "../../modules/pipeline/approve";
import { readPipelineConfig } from "../../modules/pipeline/config";
import { runPipeline } from "../../modules/pipeline/run";
import { describePublishRefusal } from "../../modules/publishing/publishRefusal";
import { FakePorts, fakeProvider } from "../fixtures/pipelineFake";

// R-34: one-click approval puts the VIDEO PAGE live only for a public, observed, unheld video, in the same transaction as the Recording.
// FAKE data and fake dependencies only.

const NOW = new Date("2026-11-18T12:00:00.000Z");
const PUBLIC: Omit<VideoPageFacts, "plannerHeld"> = { privacyStatus: "public", observabilityState: "OBSERVED", videoHold: null, recordingHold: null, page: null };
const plan = (over: Partial<VideoPageFacts> = {}, enabled = true) => planVideoPage({ ...PUBLIC, plannerHeld: false, ...over }, { enabled });

describe("the video-page rule", () => {
  it("publishes a public, observed, unheld video's page (creating it when there is none)", () => {
    expect(plan()).toMatchObject({ action: "PUBLISH", createPage: true });
    expect(plan({ page: { status: "DRAFT", archivedAt: null } })).toMatchObject({ action: "PUBLISH", createPage: false });
    expect(plan({ page: { status: "PUBLISHED", archivedAt: null } })).toMatchObject({ action: "ALREADY_LIVE" });
  });

  it("leaves unlisted and private videos alone, with the reason", () => {
    expect(plan({ privacyStatus: "unlisted" })).toEqual({ action: "LEAVE", reason: expect.stringMatching(/unlisted on YouTube: its page stays pending.*unlisted-video review/) });
    expect(plan({ privacyStatus: "private" })).toEqual({ action: "LEAVE", reason: expect.stringMatching(/private on YouTube/) });
    expect(plan({ observabilityState: "NOT_OBSERVED" })).toMatchObject({ action: "LEAVE" });
  });

  it("respects every hold, the planner, an archived page and the switch", () => {
    expect(plan({ videoHold: "RIGHTS" }).reason).toMatch(/rights hold/);
    expect(plan({ recordingHold: "PRIVACY" }).reason).toMatch(/Recording has a privacy hold/);
    expect(plan({ plannerHeld: true }).reason).toMatch(/held out by the planner/);
    expect(plan({ page: { status: "DRAFT", archivedAt: NOW } }).reason).toMatch(/archived/);
    expect(plan({}, false).reason).toMatch(/PIPELINE_APPROVE_PUBLIC_VIDEO_PAGE is off/);
  });

  it("is on by default and can be switched off", () => {
    expect(readPipelineConfig({}).approvePublicVideoPage).toBe(true);
    expect(readPipelineConfig({ PIPELINE_APPROVE_PUBLIC_VIDEO_PAGE: "false" }).approvePublicVideoPage).toBe(false);
  });

  it("explains a rolled-back publication", () => {
    expect(describePublishRefusal("COMPANION_REFUSED")).toMatch(/not published, because the video page .* could not be published\. Nothing was changed/);
  });
});

describe("one-click approval", () => {
  async function bundle(): Promise<BundleForApproval> {
    const ports = new FakePorts();
    await runPipeline({ ports, provider: fakeProvider(), demand: [], config: { ...readPipelineConfig({ PIPELINE_ENABLED: "true", PIPELINE_DRY_RUN: "false" }), maxEntitiesResearchedPerVideo: 10 }, now: NOW });
    const row = ports.rows.get("pv-row-1")!;
    const claims = (await ports.loadClaims(row.id)) as BundleForApproval["claims"];
    return { id: row.id, status: row.status, flags: row.flags, youtubeVideoRowId: "row-1", youtubeVideoId: row.youtubeVideoId, youtubeTitle: row.title, description: row.description, publishedAt: row.publishedAt, extraction: row.extraction!, resolution: row.resolution!, draft: row.draft as BundleForApproval["draft"], claims };
  }

  /** Fake dependencies; `publish` records what it was asked to put live and answers as told. */
  function deps(b: BundleForApproval, facts: Omit<VideoPageFacts, "plannerHeld">, answer: Awaited<ReturnType<ApprovalDeps["publish"]>> = { ok: true }) {
    const calls: Array<Parameters<ApprovalDeps["publish"]>[0]> = [];
    const audits: Array<Record<string, unknown>> = [];
    const marks: string[] = [];
    const d: ApprovalDeps = {
      loadBundle: async () => b,
      executePlans: async () => ({ actorCreated: false, steps: [] }),
      findRecordingForVideo: async () => ({ recordingId: "rec-1" }),
      linkContributorsAndPeople: async () => [],
      fillRecordingSeo: async () => "filled",
      publishEntityCopies: async () => [],
      decideClaims: async () => undefined,
      loadVideoPageFacts: async () => facts,
      publish: async (i) => (calls.push(i), answer),
      markDecision: async (_id, p) => void marks.push(p.status),
      audit: async (e) => void audits.push(e.afterSnapshot),
      listPublishedCopySummaries: async () => [],
    };
    return { d, calls, audits, marks };
  }
  const decideConflicts = (b: BundleForApproval) => Object.fromEntries(b.claims.filter((c) => c.status === "CONFLICT").map((c) => [c.dbId, "reject" as const]));

  it("PUBLIC: the video page goes live with the Recording, in one publication, as the approving editor, with the pipeline reason", async () => {
    const b = await bundle();
    const { d, calls, audits, marks } = deps(b, PUBLIC);
    const result = await approveBundle({ id: b.id, actorId: "owner", edits: { claimDecisions: decideConflicts(b) }, now: NOW }, d);
    expect(calls).toEqual([{ recordingId: "rec-1", actorId: "owner", videoPage: { youtubeVideoRowId: "row-1", createPage: true, reason: PIPELINE_VIDEO_PAGE_REASON } }]);
    expect(result).toMatchObject({ ok: true, status: "PUBLISHED", videoPage: { outcome: "PUBLISHED" } });
    expect(marks).toEqual(["PUBLISHED"]);
    expect(audits[0]).toMatchObject({ videoPage: "PUBLISHED" });
  });

  it("UNLISTED: the Recording is published, the video page is never touched, and the note says why", async () => {
    const b = await bundle();
    const { d, calls } = deps(b, { ...PUBLIC, privacyStatus: "unlisted", page: { status: "DRAFT", archivedAt: null } });
    const result = await approveBundle({ id: b.id, actorId: "owner", edits: { claimDecisions: decideConflicts(b) }, now: NOW }, d);
    expect(calls[0].videoPage).toBeNull();
    expect(result).toMatchObject({ ok: true, status: "PUBLISHED", videoPage: { outcome: "LEFT", reason: expect.stringMatching(/unlisted/) } });
    if (result.ok) expect(result.notes.join(" ")).toMatch(/video page: left: the video is unlisted on YouTube/);
  });

  it("HELD: a hold on the video or its Recording keeps the video page as it is", async () => {
    const b = await bundle();
    for (const facts of [{ ...PUBLIC, videoHold: "COPYRIGHT" }, { ...PUBLIC, recordingHold: "RIGHTS" }]) {
      const { d, calls } = deps(b, facts);
      const result = await approveBundle({ id: b.id, actorId: "owner", edits: { claimDecisions: decideConflicts(b) }, now: NOW }, d);
      expect(calls[0].videoPage).toBeNull();
      expect(result).toMatchObject({ ok: true, videoPage: { outcome: "LEFT", reason: expect.stringMatching(/hold/) } });
    }
  });

  it("SWITCHED OFF: the video page is left, whatever the video", async () => {
    const b = await bundle();
    const { d, calls } = deps(b, PUBLIC);
    await approveBundle({ id: b.id, actorId: "owner", edits: { claimDecisions: decideConflicts(b) }, now: NOW, approvePublicVideoPage: false }, d);
    expect(calls[0].videoPage).toBeNull();
  });

  it("FAILURE: when the video page cannot be published, nothing goes live (the publication rolled back) and the bundle stays APPROVED", async () => {
    const b = await bundle();
    const { d, marks } = deps(b, PUBLIC, { ok: false, reason: "COMPANION_REFUSED", missingCategories: [], detail: "a rights hold was placed on the video" });
    const result = await approveBundle({ id: b.id, actorId: "owner", edits: { claimDecisions: decideConflicts(b) }, now: NOW }, d);
    expect(result).toMatchObject({ ok: true, status: "APPROVED", videoPage: { outcome: "NOT_PUBLISHED" } });
    if (result.ok) expect(result.notes.join(" ")).toMatch(/nothing was published: COMPANION_REFUSED \(a rights hold was placed on the video\)/);
    expect(marks).toEqual(["APPROVED"]);
  });

  it("a Recording that is not ready publishes nothing, the video page included", async () => {
    const b = await bundle();
    const { d } = deps(b, PUBLIC, { ok: false, reason: "NOT_READY", missingCategories: ["performance"] });
    expect(await approveBundle({ id: b.id, actorId: "owner", edits: { claimDecisions: decideConflicts(b) }, now: NOW }, d)).toMatchObject({ ok: true, status: "APPROVED", videoPage: { outcome: "NOT_PUBLISHED" } });
  });
});
