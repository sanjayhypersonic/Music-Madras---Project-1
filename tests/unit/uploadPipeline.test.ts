import { describe, expect, it } from "vitest";
import { extractHashtags, sameStringList } from "../../modules/youtube/sync-engine/extractHashtags";
import { readPipelineConfig, type PipelineConfig } from "../../modules/pipeline/config";
import { CostMeter, costOf } from "../../modules/pipeline/cost";
import { queueDecision, sourceFingerprint } from "../../modules/pipeline/queue";
import { resolveEntities } from "../../modules/pipeline/resolve";
import { checkResearchClaims, type ResearchSubject } from "../../modules/pipeline/research";
import { buildMetaDescription, buildSeoTitle, sameAsFor, type DraftClaim } from "../../modules/pipeline/drafts";
import { GoogleAdsDemandProvider, QueryPatternDemandProvider, SearchConsoleDemandProvider, suggestQueries } from "../../modules/pipeline/searchDemand";
import { runPipeline } from "../../modules/pipeline/run";
import { approveBundle, canBulkApprove, rejectBundle, type ApprovalDeps, type BundleForApproval } from "../../modules/pipeline/approve";
import { aliasesFromReviewNames } from "../../modules/pipeline/aliasSeed";
import { DINGIRI_DINGALAE_RECONCILIATION, planWorkReconciliation } from "../../modules/pipeline/reconcile";
import { assessEvidence } from "../../modules/mmke/guardrails/sources";
import { interpretAnthropicResearchContent } from "../../modules/ai/providers/anthropic/anthropicProvider";
import { videoSkipReason } from "../../modules/ai/gateway/extractVideoCredits";
import { validateVideoCreditsOutput } from "../../modules/ai/structuredOutput/validateVideoCreditsOutput";
import { NAMES_HEADER, toCsv } from "../../modules/jobs/videoCreditsReview";
import { FAKE_DESCRIPTION, FAKE_TITLE, FakePorts, extractionOutput, fakeProvider } from "../fixtures/pipelineFake";

// R-34, the upload-to-draft pipeline: every stage on FAKE data, with the fake AI provider and in-memory ports. No database, no network.

const NOW = new Date("2026-11-18T12:00:00.000Z");
const config = (over: Partial<PipelineConfig> = {}): PipelineConfig => ({ ...readPipelineConfig({ PIPELINE_ENABLED: "true", PIPELINE_DRY_RUN: "false" }), maxEntitiesResearchedPerVideo: 10, ...over });
const checked = () => {
  const r = validateVideoCreditsOutput(extractionOutput, { youtubeVideoId: "fakeVideo01", title: FAKE_TITLE, description: FAKE_DESCRIPTION });
  if (!r.ok) throw new Error(r.problems.join(" "));
  return r;
};

describe("ingest", () => {
  it("stores hashtags from the title and description (not numbers), and compares lists by value", () => {
    expect(extractHashtags("Carol #Advent", "Text #FakeChoir #advent #1 and#not")).toEqual(["Advent", "FakeChoir"]);
    expect(sameStringList(["a"], ["a"])).toBe(true);
    expect(sameStringList(["a"], ["b"])).toBe(false);
  });

  it("is off by default, and a dry run until PIPELINE_DRY_RUN=false; the cost cap defaults to $2", () => {
    expect(readPipelineConfig({})).toMatchObject({ enabled: false, dryRun: true, maxUsdPerRun: 2 });
    expect(readPipelineConfig({ PIPELINE_ENABLED: "yes" }).enabled).toBe(false);
    expect(readPipelineConfig({ PIPELINE_ENABLED: "true", PIPELINE_DRY_RUN: "false", MAX_USD_PER_RUN: "0.5" })).toMatchObject({ enabled: true, dryRun: false, maxUsdPerRun: 0.5 });
  });

  it("queues new videos once, re-queues changed ones, and never re-queues an approved or published one", () => {
    const fp = sourceFingerprint("t", "d", ["x"]);
    expect(queueDecision(null, fp)).toBe("QUEUE");
    expect(queueDecision({ status: "AWAITING_APPROVAL", sourceFingerprint: fp }, fp)).toBe("SKIP");
    expect(queueDecision({ status: "AWAITING_APPROVAL", sourceFingerprint: "old" }, fp)).toBe("REQUEUE");
    expect(queueDecision({ status: "PUBLISHED", sourceFingerprint: "old" }, fp)).toBe("SKIP");
    expect(queueDecision({ status: "REJECTED", sourceFingerprint: "old" }, fp)).toBe("REQUEUE");
  });

  it("extracts title-only videos only when asked", () => {
    const v = { youtubeVideoId: "x", title: "A Carol", description: "", privacyStatus: "public" };
    expect(videoSkipReason(v)).toBe("NO_DESCRIPTION");
    expect(videoSkipReason(v, { allowTitleOnly: true })).toBeNull();
  });
});

describe("cost", () => {
  it("prices tokens and searches, and refuses a call that would go over the cap", () => {
    expect(costOf({ model: "claude-sonnet-5-5", inputTokens: 1_000_000, outputTokens: 100_000, webSearchRequests: 3 })).toBeCloseTo(2 + 1 + 0.03);
    const meter = new CostMeter(0.05, "claude-sonnet-5-5");
    meter.charge({ model: "claude-sonnet-5-5", inputTokens: 10_000, outputTokens: 1_000 });
    expect(meter.summary()).toMatchObject({ calls: 1, inputTokens: 10_000, costUsd: 0.03 });
    expect(meter.wouldExceed({ inputTokens: 10_000, outputTokens: 1_000 })).toBe(true);
  });
});

describe("entity resolution", () => {
  it("maps exact normalised names and approved aliases, creates the rest, and lists ambiguity and near-misses as exceptions", () => {
    const r = resolveEntities(
      checked(),
      {
        COMPOSER: [{ id: "c1", name: "ann example" }],
        WORK: [{ id: "w1", name: "Come Now Fake Child (old)", composerName: "Ann Example", alternateTitles: ["Come Now, Fake Child"] }],
        CHOIR: [{ id: "ch1", name: "The Fake Chapel Choir" }],
        CONDUCTOR: [{ id: "k1", name: "Ben Sample" }, { id: "k2", name: "Ben  Sample" }],
        VENUE: [{ id: "v9", name: "Fake Chapel Hall" }],
      },
      [{ kind: "VENUE", aliasKey: "fake chapel", canonicalName: "Fake Chapel Hall", entityId: null }]
    );
    const by = (role: string) => r.entities.find((e) => e.role === role)!;
    expect(by("COMPOSER")).toMatchObject({ status: "MAPPED", entityId: "c1" });
    expect(by("WORK")).toMatchObject({ status: "MAPPED", entityId: "w1" }); // through its alternate title, within its composer
    expect(by("VENUE")).toMatchObject({ status: "MAPPED", entityId: "v9", aliasApplied: true, canonicalName: "Fake Chapel Hall" });
    expect(by("CHOIR")).toMatchObject({ status: "EXCEPTION" }); // near-miss: "The Fake Chapel Choir"
    expect(by("CONDUCTOR")).toMatchObject({ status: "EXCEPTION" }); // two records with the same normalised name
    expect(by("ARRANGER")).toMatchObject({ status: "NEW", kind: "PERSON" });
    expect(r.exceptions).toHaveLength(2);
  });

  it("links a second video to the composer and venue the first one created (no new entity, no research)", () => {
    const afterFirstApproval = { COMPOSER: [{ id: "c-ann", name: "Ann Example" }], VENUE: [{ id: "v-fake", name: "Fake Chapel" }], CHOIR: [{ id: "ch-fake", name: "Fake Chapel Choir" }] };
    const r = resolveEntities(checked(), afterFirstApproval, []);
    expect(r.entities.filter((e) => e.status === "MAPPED").map((e) => `${e.role}:${e.entityId}`).sort()).toEqual(["CHOIR:ch-fake", "COMPOSER:c-ann", "VENUE:v-fake"]);
    expect(r.entities.find((e) => e.role === "WORK")!.status).toBe("NEW"); // a different work by the same composer is new
  });
});

describe("research claims (gates 1 and 2)", () => {
  const subject: ResearchSubject = { key: "VIDEO", kind: "VIDEO", name: "Come Now, Fake Child", role: "musical work", workTitle: "Come Now, Fake Child", videoTitle: FAKE_TITLE };
  const research = {
    passages: [
      { text: "x", citations: [{ url: "https://examplepress.test/c", title: "Example Press", citedText: "Come Now, Fake Child. Words and music: Ann Example. Example Press, 1998." }] },
      { text: "y", citations: [{ url: "https://en.wikipedia.org/wiki/Fake", title: "Fake - Wikipedia", citedText: "published by Example Press" }] },
      { text: "z", citations: [{ url: "https://news.example.test/a", title: "News", citedText: "music by Hal Other" }] },
    ],
  };
  const run = (claims: unknown[]) => checkResearchClaims({ subject, output: { claims, notFound: [] }, research, video: { title: FAKE_TITLE, description: FAKE_DESCRIPTION }, checked: checked(), retrievedAt: NOW });

  it("takes the URL and excerpt from the citation, refuses invented citations and values the page does not state", () => {
    const r = run([
      { citation: "P1.C1", subjectKind: "publisher", workTitle: null, value: "Example Press", statement: "It was published by Example Press.", sourceKind: "publisher" },
      { citation: "P7.C1", subjectKind: "publisher", workTitle: null, value: "X Press", statement: "It was published by X Press.", sourceKind: "publisher" },
      { citation: "P1.C1", subjectKind: "publisher", workTitle: null, value: "Other Press", statement: "It was published by Other Press.", sourceKind: "publisher" },
      { citation: "P1.C1", subjectKind: "background", workTitle: null, value: null, statement: "A timeless carol.", sourceKind: "publisher" },
    ]);
    expect(r.claims).toEqual([expect.objectContaining({ sourceUrl: "https://examplepress.test/c", excerpt: expect.stringContaining("Example Press"), sourceTier: "A", videoRelation: "NOT_STATED", status: "PROPOSED" })]);
    expect(r.rejected.map((x) => x.reason)).toEqual([expect.stringMatching(/did not return/), expect.stringMatching(/not in the cited text/), expect.stringMatching(/banned wording/)]);
  });

  it("keeps Wikipedia as tier X, and marks a claim that contradicts the video's credit as CONFLICT (never resolved)", () => {
    const r = run([
      { citation: "P2.C1", subjectKind: "publisher", workTitle: null, value: "Example Press", statement: "It was published by Example Press.", sourceKind: "hymnal index or reference work" },
      { citation: "P3.C1", subjectKind: "composer", workTitle: "Come Now, Fake Child", value: "Hal Other", statement: "The music is by Hal Other.", sourceKind: "national newspaper" },
    ]);
    expect(r.claims.map((c) => [c.sourceTier, c.videoRelation, c.status])).toEqual([["X", "NOT_STATED", "PROPOSED"], ["B", "CONFLICTS", "CONFLICT"]]);
  });

  it("applies the credit rule: tier A, two independent B, or the video's text plus one B", () => {
    const b = (url: string) => ({ url, tier: "B" as const, excerpt: `music by Ann Example ${url}`, approved: true });
    expect(assessEvidence("composer", [b("https://one.test/a")]).sufficient).toBe(false);
    expect(assessEvidence("composer", [b("https://one.test/a")], { videoTextSupports: true }).sufficient).toBe(true);
    expect(assessEvidence("composer", [b("https://one.test/a"), b("https://two.test/b")]).sufficient).toBe(true);
  });

  it("reads web-search responses: cited passages and results, ignoring an error result", () => {
    const r = interpretAnthropicResearchContent([
      { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://a.test", title: "A" }] },
      { type: "web_search_tool_result", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } },
      { type: "text", text: "Published in 1998.", citations: [{ type: "web_search_result_location", url: "https://a.test", title: "A", cited_text: "Example Press, 1998", encrypted_index: "x" }] },
    ]);
    expect(r).toEqual({ passages: [{ text: "Published in 1998.", citations: [{ url: "https://a.test", title: "A", citedText: "Example Press, 1998" }] }], searchResults: [{ url: "https://a.test", title: "A" }] });
  });
});

describe("drafts and search demand", () => {
  it("fits SEO titles to 60 and meta descriptions to 155 characters at word boundaries", () => {
    expect(buildSeoTitle("Come Now, Fake Child", "Fake Chapel Choir")).toBe("Come Now, Fake Child | Fake Chapel Choir | Music Madras");
    expect(buildSeoTitle("A Very Long Title That Keeps Going And Going Past Sixty Characters Easily", "Choir").length).toBeLessThanOrEqual(60);
    expect(buildMetaDescription(["A".repeat(100) + ".", "B".repeat(80) + "."]).length).toBeLessThanOrEqual(155);
  });

  it("takes sameAs only from ACCEPTED tier A/B claims", () => {
    const c = (status: DraftClaim["status"], tier: DraftClaim["sourceTier"], url: string): DraftClaim => ({ id: "R1", subjectKey: "VIDEO", subjectKind: "publisher", value: "x", statement: "x", excerpt: "x", sourceUrl: url, sourceTitle: null, sourceTier: tier, videoRelation: "NOT_STATED", status });
    expect(sameAsFor("VIDEO", [c("ACCEPTED", "A", "https://a.test"), c("PROPOSED", "A", "https://p.test"), c("ACCEPTED", "X", "https://w.test"), c("ACCEPTED", "B", "https://b.test")])).toEqual(["https://a.test", "https://b.test"]);
  });

  it("suggests query patterns; the Search Console and Google Ads adapters are stubs", async () => {
    expect((await suggestQueries([new QueryPatternDemandProvider(), new SearchConsoleDemandProvider(), new GoogleAdsDemandProvider()], { kind: "COMPOSER", name: "Ann Example" })).map((q) => q.query)).toEqual(["ann example", "ann example biography", "ann example composer", "ann example works"]);
    expect(new SearchConsoleDemandProvider().isConfigured()).toBe(false);
  });
});

describe("the orchestrator", () => {
  it("DRY RUN: reports what it would do, calls no provider and writes nothing", async () => {
    const calls: string[] = [];
    const ports = new FakePorts();
    const report = await runPipeline({ ports, provider: fakeProvider(calls), demand: [new QueryPatternDemandProvider()], config: config({ dryRun: true }), now: NOW });
    expect(report.wouldDo).toEqual(["queue fakeVideo01"]);
    expect(calls).toEqual([]);
    expect(ports.writes).toEqual([]);
  });

  it("takes a new upload through every stage to AWAITING_APPROVAL, with flags, and is idempotent", async () => {
    const calls: string[] = [];
    const ports = new FakePorts();
    const report = await runPipeline({ ports, provider: fakeProvider(calls), demand: [new QueryPatternDemandProvider()], config: config(), now: NOW });
    expect(report.queued).toBe(1);
    expect(report.advanced.map((a) => a.to)).toEqual(["EXTRACTED", "RESOLVED", "RESEARCHED", "AWAITING_APPROVAL"]);
    const row = ports.rows.get("pv-row-1")!;
    expect(row.status).toBe("AWAITING_APPROVAL");
    expect(calls.filter((c) => c.startsWith("research:"))).toEqual(["research:Come Now, Fake Child", "research:Ann Example", "research:Cara Placeholder", "research:Fake Chapel Choir", "research:Ben Sample", "research:Fake Chapel"]);
    const claims = ports.claims.get("pv-row-1")!;
    expect(claims.find((c) => c.value === "Hal Other")).toMatchObject({ status: "CONFLICT", sourceTier: "B" });
    expect(claims.find((c) => c.value === "Fakeville")).toMatchObject({ sourceTier: "C" });
    expect(row.flags.join("\n")).toMatch(/conflict: R\d+ \(composer "Hal Other"\)/);
    expect(report.usage.webSearches).toBe(12);
    // a second run with the same text queues and advances nothing
    const again = await runPipeline({ ports, provider: fakeProvider(), demand: [], config: config(), now: NOW });
    expect([again.queued, again.requeued, again.advanced.length]).toEqual([0, 0, 0]);
  });

  it("skips research for an entity that already has approved research", async () => {
    const calls: string[] = [];
    const ports = new FakePorts();
    ports.approvedResearch.add("CHOIR:Fake Chapel Choir");
    await runPipeline({ ports, provider: fakeProvider(calls), demand: [], config: config(), now: NOW });
    expect(calls).not.toContain("research:Fake Chapel Choir");
  });

  it("stops at the cost cap instead of exceeding it, and resumes from the saved stage", async () => {
    const ports = new FakePorts();
    const provider = fakeProvider();
    // $0.10 covers the extraction estimate ($0.052) but not one research subject's (about $0.20).
    const stopped = await runPipeline({ ports, provider, demand: [], config: config({ maxUsdPerRun: 0.1, model: "claude-sonnet-5-5" }), now: NOW });
    expect(stopped.stoppedReason).toBe("COST_CAP");
    expect(ports.rows.get("pv-row-1")!.status).toBe("RESOLVED"); // extraction and resolution saved; research waits for the next run
  });
});

describe("approval", () => {
  async function bundle(): Promise<{ b: BundleForApproval; ports: FakePorts }> {
    const ports = new FakePorts();
    await runPipeline({ ports, provider: fakeProvider(), demand: [new QueryPatternDemandProvider()], config: config(), now: NOW });
    const row = ports.rows.get("pv-row-1")!;
    const claims = (await ports.loadClaims(row.id)) as BundleForApproval["claims"];
    return { ports, b: { id: row.id, status: row.status, flags: row.flags, youtubeVideoRowId: "row-1", youtubeVideoId: row.youtubeVideoId, youtubeTitle: row.title, description: row.description, publishedAt: row.publishedAt, extraction: row.extraction!, resolution: row.resolution!, draft: row.draft as BundleForApproval["draft"], claims } };
  }
  const deps = (b: BundleForApproval, log: string[]): ApprovalDeps => ({
    loadBundle: async () => b,
    executePlans: async (plans) => (log.push(`execute:${plans[0].recording?.title}`), { actorCreated: false, steps: [] }),
    findRecordingForVideo: async () => ({ recordingId: "rec-1" }),
    linkContributorsAndPeople: async () => (log.push("link"), ["arranger Cara Placeholder linked"]),
    fillRecordingSeo: async (i) => (log.push(`seo:${i.seoTitle}`), "filled"),
    publishEntityCopies: async (i) => (log.push(`copies:${i.pages.length}`), []),
    decideClaims: async (i) => void log.push(`claims:+${i.accepted.length}/-${i.rejected.length}`),
    publish: async () => (log.push("publish"), { ok: true }),
    markDecision: async (_id, p) => void log.push(`mark:${p.status}`),
    audit: async (e) => void log.push(`audit:${e.action}`),
    listPublishedCopySummaries: async () => [],
  });

  it("refuses bulk approval of a flagged bundle, and approval while a conflict is undecided", async () => {
    const { b } = await bundle();
    expect(canBulkApprove(b)).toBe(false);
    const log: string[] = [];
    expect(await approveBundle({ id: b.id, actorId: "owner", bulk: true, now: NOW }, deps(b, log))).toMatchObject({ ok: false, reason: "FLAGGED_FOR_BULK" });
    expect(await approveBundle({ id: b.id, actorId: "owner", now: NOW }, deps(b, log))).toMatchObject({ ok: false, reason: "CONFLICTS_UNDECIDED" });
    expect(log).toEqual([]);
  });

  it("approves: decides claims, creates through the existing tool, links, fills SEO, publishes, audits", async () => {
    const { b } = await bundle();
    const conflict = b.claims.find((c) => c.status === "CONFLICT")!;
    const log: string[] = [];
    const result = await approveBundle({ id: b.id, actorId: "owner", edits: { claimDecisions: { [conflict.dbId]: "reject" }, seoTitle: "Come Now, Fake Child | Music Madras" }, now: NOW }, deps(b, log));
    expect(result).toMatchObject({ ok: true, status: "PUBLISHED", recordingId: "rec-1" });
    expect(log).toEqual([`claims:+${b.claims.length - 1}/-1`, "execute:Come Now, Fake Child", "link", "seo:Come Now, Fake Child | Music Madras", `copies:${b.draft.entities.length}`, "publish", "mark:PUBLISHED", "audit:PIPELINE_BUNDLE_APPROVED"]);
  });

  it("rejects: nothing is created", async () => {
    const { b } = await bundle();
    const log: string[] = [];
    expect(await rejectBundle({ id: b.id, actorId: "owner", note: "not ours", now: NOW }, deps(b, log))).toEqual({ ok: true });
    expect(log).toEqual([`claims:+0/-${b.claims.length}`, "mark:REJECTED", "audit:PIPELINE_BUNDLE_REJECTED"]);
  });
});

describe("standing decisions and reconciliation", () => {
  it("seeds aliases only from decided rows, and refuses a spelling decided two ways", () => {
    const csv = toCsv(NAMES_HEADER, [
      ["choir/ensemble", "Fake Combined Choir", 3, "Fake Combined Choir | Fake & Combined Choirs", "a b", "merge", "Fake Combined Church Choir"],
      ["performer", "Alan Fake", 1, "Alan Fake", "c", "accept", "Allan Fake"],
      ["performer", "Undecided Name", 1, "Undecided Name", "d", "", ""],
      ["venue", "Two Way", 1, "Two Way", "e", "accept", "Canon One"],
      ["venue", "Two  Way", 1, "Two  Way", "f", "accept", "Canon Two"],
    ]);
    const seed = aliasesFromReviewNames(csv);
    expect(seed.undecidedRows).toBe(1);
    expect(seed.aliases.map((a) => `${a.kind}:${a.alias}->${a.canonicalName}`).sort()).toEqual([
      "ARTIST:Alan Fake->Allan Fake",
      "CHOIR:Fake & Combined Choirs->Fake Combined Church Choir",
      "CHOIR:Fake Combined Choir->Fake Combined Church Choir",
      "ENSEMBLE:Fake & Combined Choirs->Fake Combined Church Choir",
      "ENSEMBLE:Fake Combined Choir->Fake Combined Church Choir",
      "PERSON:Alan Fake->Allan Fake",
    ]);
    expect(seed.conflicts).toHaveLength(1);
  });

  it("plans the Dingiri Dingalae reconciliation: Tamil title, the old title kept as an alternate, composer Vedha; refuses published content", () => {
    const state = { id: "w", slug: "dingiri-dingalae", title: "Dingiri Dingalae", alternateTitles: [], composerId: "c-trad", composerName: "Traditional", inPublishedContent: false };
    expect(planWorkReconciliation(DINGIRI_DINGALAE_RECONCILIATION, state, [{ id: "c-trad", name: "Traditional" }])).toEqual([
      { kind: "SET_TITLE", from: "Dingiri Dingalae", to: "டிங்கிரி டிங்காலே" },
      { kind: "ADD_ALTERNATE_TITLES", titles: ["Dingiri Dingalae"] },
      { kind: "SET_COMPOSER", from: "Traditional", to: "Vedha", composer: "CREATE" },
    ]);
    expect(planWorkReconciliation(DINGIRI_DINGALAE_RECONCILIATION, { ...state, title: "டிங்கிரி டிங்காலே", alternateTitles: ["Dingiri Dingalae"], composerName: "Vedha" }, [])).toEqual([{ kind: "NOTHING_TO_DO" }]);
    expect(planWorkReconciliation(DINGIRI_DINGALAE_RECONCILIATION, { ...state, inPublishedContent: true }, [])[0].kind).toBe("REFUSE");
  });
});
