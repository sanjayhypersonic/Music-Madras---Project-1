// Upload-to-draft pipeline (R-34): the ORCHESTRATOR. Pure orchestration over injected ports (database reads and writes, the AI provider, the
// search-demand providers), so every rule here is unit-tested with fakes. The composition root is modules/jobs/pipelineJob.ts.
//
// One run: (1) QUEUE new or changed public, observed videos; (2) ADVANCE at most maxVideosPerRun queued videos, each one stage at a time:
//   QUEUED -> extract (video-credits v2 through the AIProvider; title-only when the description is empty) -> EXTRACTED
//   EXTRACTED -> resolve (exact normalised names + approved aliases) -> RESOLVED
//   RESOLVED -> research (NEW entities and the video's work only; entities with approved research are skipped) -> RESEARCHED
//   RESEARCHED -> draft (video page + new entity pages, gate 3, flags) -> AWAITING_APPROVAL
// Every stage is saved before the next starts, so an interrupted run resumes where it stopped. A run never goes over MAX_USD_PER_RUN: before each
// paid call its conservative estimate is checked, and the run stops (STOPPED_COST_CAP) instead. A failed stage counts an attempt (FAILED after
// maxAttempts); its error KIND is recorded, never its message. DRY RUN (the default) reads only: it reports what it would queue and do and what
// that would cost, and calls no provider and writes nothing. Nothing here creates a catalogue record or publishes: that happens only when the
// owner approves a bundle (modules/pipeline/approve.ts).
//
// STAGE MODES (docs/upload-pipeline.md section 9; modules/pipeline/config.ts). Each paid stage is MANUAL by default and switches to API with one
// environment variable, so adding the provider key later changes nothing else:
//   PIPELINE_EXTRACT_MODE   manual | existing: a QUEUED video WAITS (no call, no attempt counted) until its extraction is imported with
//                           npm run pipeline:import (a pasted video-credits answer, or --reviewed for the reviewed credits files); api: the call above.
//   PIPELINE_RESEARCH_MODE  manual: RESOLVED -> RESEARCHED with no call; research is done per ENTITY outside the app (pipeline:entities,
//                           pipeline:packet, pipeline:import) and attached to every bundle that names the entity; api: the two-call research above.
//   PIPELINE_DRAFT_MODE     manual: the template draft (closed-world, gate 3), and the owner may import their own prose (video-draft); api: the
//                           provider writes the summary from the same data and contract, checked by the same validator; a refusal keeps the template.
// Whatever the mode, drafts use only claims already in the tables: an entity-first claim only once APPROVED. The draft stage never researches.

import type { AIProvider } from "../ai/provider/aiProvider";
import { extractVideoCredits } from "../ai/gateway/extractVideoCredits";
import type { CheckedVideoCredits } from "../ai/structuredOutput/validateVideoCreditsOutput";
import { planVideo } from "../jobs/videoCreditsCreate";
import type { PipelineConfig } from "./config";
import { CostMeter, ESTIMATES } from "./cost";
import { resolveEntities, type AliasDecision, type CatalogueIndex, type EntityKind, type Resolution } from "./resolve";
import { buildClaimsRequest, buildSearchRequest, checkResearchClaims, type ProposedPipelineClaim, type ResearchSubject } from "./research";
import { draftCredits, toVideoFacts } from "./facts";
import { assessDraftClaims, draftEntityPage, draftVideoPage, draftWordingProblems, nearDuplicateProblems, type DraftClaim, type PageDraft } from "./drafts";
import { suggestQueries, type DemandSubjectKind, type SearchDemandProvider } from "./searchDemand";
import { attachEntityClaims, bundleEntityKeys, type StoredEntityClaim } from "./entityClaims";
import { applyProse, buildProseRequest, checkPageProse, draftableClaims } from "./pageProse";
import { sourceFingerprint, queueDecision } from "./queue";

export type WorkStatus = "QUEUED" | "EXTRACTED" | "RESOLVED" | "RESEARCHED";

export interface PipelineVideoRow {
  id: string;
  youtubeVideoId: string;
  title: string | null;
  description: string | null;
  publishedAt: string | null;
  privacyStatus: string | null;
  observabilityState: string;
  status: WorkStatus | string;
  attempts: number;
  extraction: { checked: CheckedVideoCredits; titleOnly: boolean; model: string } | null;
  resolution: Resolution | null;
}

export interface QueueCandidate {
  youtubeVideoRowId: string;
  youtubeVideoId: string;
  title: string | null;
  description: string | null;
  tags: string[];
  existing: { id: string; status: string; sourceFingerprint: string } | null;
}

export interface StagePatch {
  status?: string;
  extraction?: unknown;
  resolution?: unknown;
  research?: unknown;
  draft?: unknown;
  flags?: string[];
  addCostUsd?: number;
  attempts?: number;
  lastErrorKind?: string | null;
}

export interface PipelinePorts {
  /** Public, OBSERVED videos with no pipeline row or whose row's fingerprint may differ (the decision is made here, by queueDecision). */
  listQueueCandidates(limit: number): Promise<QueueCandidate[]>;
  enqueue(candidate: QueueCandidate, fingerprint: string, requeue: boolean): Promise<void>;
  listWork(limit: number, maxAttempts: number): Promise<PipelineVideoRow[]>;
  saveStage(id: string, patch: StagePatch): Promise<void>;
  replaceClaims(id: string, claims: ProposedPipelineClaim[]): Promise<void>;
  /** The video's own claims (API research), numbered R1 … in creation order. */
  loadClaims(id: string): Promise<DraftClaim[]>;
  /** Entity-first claims (manual research) for these entity keys, in creation order. */
  loadEntityClaims(entityKeys: readonly string[]): Promise<StoredEntityClaim[]>;
  loadCatalogueIndex(): Promise<CatalogueIndex>;
  loadAliases(): Promise<AliasDecision[]>;
  hasApprovedResearch(kind: EntityKind, name: string): Promise<boolean>;
  listPublishedCopySummaries(): Promise<Array<{ id: string; summary: string; name: string }>>;
}

export interface RunReport {
  dryRun: boolean;
  queued: number;
  requeued: number;
  considered: number;
  advanced: Array<{ id: string; youtubeVideoId: string; from: string; to: string }>;
  failures: Array<{ id: string; youtubeVideoId: string; stage: string; kind: string }>;
  wouldDo: string[];
  /** Videos waiting for work done outside the app (manual or existing mode). */
  waiting: string[];
  stoppedReason: "COST_CAP" | null;
  usage: ReturnType<CostMeter["summary"]>;
}

class CostCapReached extends Error {}

export async function runPipeline(input: { ports: PipelinePorts; provider: AIProvider; demand: readonly SearchDemandProvider[]; config: PipelineConfig; now: Date }): Promise<RunReport> {
  const { ports, provider, config, now } = input;
  const model = config.model ?? "claude-sonnet-5-5";
  const meter = new CostMeter(config.maxUsdPerRun, model);
  const report: RunReport = { dryRun: config.dryRun, queued: 0, requeued: 0, considered: 0, advanced: [], failures: [], wouldDo: [], waiting: [], stoppedReason: null, usage: meter.summary() };

  // 1. Queue.
  for (const c of await ports.listQueueCandidates(config.maxQueuePerRun)) {
    const fingerprint = sourceFingerprint(c.title, c.description, c.tags);
    const decision = queueDecision(c.existing, fingerprint);
    if (decision === "SKIP") continue;
    if (config.dryRun) {
      report.wouldDo.push(`${decision === "QUEUE" ? "queue" : "re-queue (its text changed)"} ${c.youtubeVideoId}`);
      continue;
    }
    await ports.enqueue(c, fingerprint, decision === "REQUEUE");
    if (decision === "QUEUE") report.queued++;
    else report.requeued++;
  }

  // 2. Advance.
  const work = await ports.listWork(config.maxVideosPerRun, config.maxAttempts);
  report.considered = work.length;
  let catalogue: CatalogueIndex | null = null;
  let aliases: AliasDecision[] | null = null;
  const charge = (usage: { inputTokens?: number; outputTokens?: number; webSearchRequests?: number } | undefined, fallback: { inputTokens: number; outputTokens: number; webSearchRequests: number }, usedModel: string) =>
    meter.charge({ model: usedModel, ...(usage ?? fallback) });
  const guard = (estimate: { inputTokens: number; outputTokens: number; webSearchRequests: number }) => {
    if (meter.wouldExceed(estimate)) throw new CostCapReached();
  };

  try {
    for (const row of work) {
      let status = row.status;
      const step = (to: string) => {
        report.advanced.push({ id: row.id, youtubeVideoId: row.youtubeVideoId, from: status, to });
        status = to;
      };
      const fail = async (stage: string, kind: string) => {
        const attempts = row.attempts + 1;
        report.failures.push({ id: row.id, youtubeVideoId: row.youtubeVideoId, stage, kind });
        await ports.saveStage(row.id, { attempts, lastErrorKind: kind, ...(attempts >= config.maxAttempts ? { status: "FAILED" } : {}) });
      };

      if (status === "QUEUED" && config.extractMode !== "api") {
        report.waiting.push(`${row.youtubeVideoId}: waiting for its extraction to be imported (PIPELINE_EXTRACT_MODE=${config.extractMode}: npm run pipeline:import${config.extractMode === "existing" ? " -- --reviewed" : ""})`);
        continue;
      }
      if (config.dryRun) {
        const none = { inputTokens: 0, outputTokens: 0, webSearchRequests: 0 };
        const est =
          status === "QUEUED" ? ESTIMATES.extraction : status === "RESOLVED" && config.researchMode === "api" ? ESTIMATES.research(config.maxSearchesPerEntity) : status === "RESEARCHED" && config.draftMode === "api" ? ESTIMATES.prose : none;
        report.wouldDo.push(`advance ${row.youtubeVideoId} from ${status}${est.inputTokens ? (meter.wouldExceed(est) ? " (its next paid call would exceed the cost cap)" : " (its next paid call fits the cost cap)") : ""}`);
        continue;
      }

      // QUEUED -> EXTRACTED
      let extraction = row.extraction;
      if (status === "QUEUED") {
        guard(ESTIMATES.extraction);
        const titleOnly = (row.description ?? "").trim().length === 0;
        const outcome = await extractVideoCredits({ youtubeVideoId: row.youtubeVideoId, title: row.title, description: row.description, privacyStatus: row.privacyStatus, observabilityState: row.observabilityState, publishedAt: row.publishedAt }, provider, { model: config.model, allowTitleOnly: true });
        if (outcome.status === "SKIPPED") {
          await ports.saveStage(row.id, { status: "SKIPPED", lastErrorKind: outcome.skipReason });
          step("SKIPPED");
          continue;
        }
        const usd = charge(outcome.status === "EXTRACTED" ? outcome.usage : undefined, ESTIMATES.extraction, outcome.status === "PROVIDER_FAILED" ? model : outcome.model);
        if (outcome.status !== "EXTRACTED") {
          await ports.saveStage(row.id, { addCostUsd: usd });
          await fail("extract", outcome.status === "PROVIDER_FAILED" ? outcome.errorType : "INVALID_OUTPUT");
          continue;
        }
        extraction = { checked: outcome.result, titleOnly, model: outcome.model };
        await ports.saveStage(row.id, { status: "EXTRACTED", extraction, addCostUsd: usd, lastErrorKind: null });
        step("EXTRACTED");
      }
      if (!extraction) continue;

      // EXTRACTED -> RESOLVED
      let resolution = row.resolution;
      if (status === "EXTRACTED") {
        catalogue ??= await ports.loadCatalogueIndex();
        aliases ??= await ports.loadAliases();
        resolution = resolveEntities(extraction.checked, catalogue, aliases);
        await ports.saveStage(row.id, { status: "RESOLVED", resolution });
        step("RESOLVED");
      }
      if (!resolution) continue;

      // RESOLVED -> RESEARCHED
      if (status === "RESOLVED" && config.researchMode === "manual") {
        // No call: the entity-first research already imported (or imported later) is attached when the bundle is drafted.
        await ports.saveStage(row.id, { status: "RESEARCHED", research: { mode: "manual", entityKeys: bundleEntityKeys(resolution), note: "research is done per entity outside the app (npm run pipeline:entities / pipeline:packet / pipeline:import)" } });
        step("RESEARCHED");
      } else if (status === "RESOLVED") {
        const research = await researchVideo(row, extraction.checked, resolution, { ports, provider, config, model, guard, charge, now });
        await ports.replaceClaims(row.id, research.claims);
        await ports.saveStage(row.id, { status: "RESEARCHED", research: research.log, addCostUsd: research.usd });
        step("RESEARCHED");
      }

      // RESEARCHED -> AWAITING_APPROVAL
      if (status === "RESEARCHED") {
        const claims = attachEntityClaims({ videoClaims: await ports.loadClaims(row.id), entityClaims: await ports.loadEntityClaims(bundleEntityKeys(resolution)), resolution, video: { title: row.title, description: row.description }, checked: extraction.checked });
        const existing = await ports.listPublishedCopySummaries();
        const bundle = await draftBundle(row, extraction, resolution, claims, input.demand, existing);
        let usd = 0;
        if (config.draftMode === "api") {
          guard(ESTIMATES.prose);
          const ctx = { youtubeVideoId: row.youtubeVideoId, recordingTitle: bundle.draft.video.name, transliteration: bundle.transliteration, credits: draftCredits(extraction.checked, resolution), claims };
          const generated = await provider.generate(buildProseRequest(ctx, { model: config.model }));
          usd = charge(generated.ok ? generated.usage : undefined, ESTIMATES.prose, generated.model ?? model);
          const checkedProse = generated.ok ? checkPageProse(generated.output, ctx, "api") : { ok: false as const, problems: [`provider failed (${generated.error.type})`] };
          if (checkedProse.ok) bundle.draft.video = applyProse(bundle.draft.video, checkedProse.prose);
          else bundle.draft.video.notes.push(`AI summary not used (${checkedProse.problems.slice(0, 3).join("; ")}): the template summary stands`);
        }
        await ports.saveStage(row.id, { status: "AWAITING_APPROVAL", draft: bundle.draft, flags: bundle.flags, ...(usd ? { addCostUsd: usd } : {}) });
        step("AWAITING_APPROVAL");
      }
    }
  } catch (err) {
    if (!(err instanceof CostCapReached)) throw err;
    report.stoppedReason = "COST_CAP";
  }
  report.usage = meter.summary();
  return report;
}

async function researchVideo(
  row: PipelineVideoRow,
  checked: CheckedVideoCredits,
  resolution: Resolution,
  ctx: {
    ports: PipelinePorts;
    provider: AIProvider;
    config: PipelineConfig;
    model: string;
    guard: (e: { inputTokens: number; outputTokens: number; webSearchRequests: number }) => void;
    charge: (u: { inputTokens?: number; outputTokens?: number; webSearchRequests?: number } | undefined, f: { inputTokens: number; outputTokens: number; webSearchRequests: number }, m: string) => number;
    now: Date;
  }
): Promise<{ claims: ProposedPipelineClaim[]; usd: number; log: Record<string, unknown> }> {
  const subjects: ResearchSubject[] = [];
  const work = checked.accepted.find((c) => c.role === "WORK");
  const workTitle = work?.name ?? (checked.suggestedTitle.status === "ACCEPTED" ? checked.suggestedTitle.value : null);
  if (workTitle) subjects.push({ key: "VIDEO", kind: "VIDEO", name: workTitle, role: "musical work", workTitle, videoTitle: row.title ?? "" });
  const skipped: string[] = [];
  for (const e of resolution.entities.filter((x) => x.status === "NEW" && x.kind !== "WORK")) {
    // One person in two roles (composer and lyricist) is researched once.
    if (subjects.some((s) => s.name.trim().toLowerCase() === e.canonicalName.trim().toLowerCase())) continue;
    if (subjects.length > ctx.config.maxEntitiesResearchedPerVideo) {
      skipped.push(`${e.canonicalName}: over the per-video research limit`);
      continue;
    }
    if (await ctx.ports.hasApprovedResearch(e.kind, e.canonicalName)) {
      skipped.push(`${e.canonicalName}: already has approved research`);
      continue;
    }
    subjects.push({ key: e.key, kind: e.kind, name: e.canonicalName, role: e.role.toLowerCase(), workTitle: e.workTitle, videoTitle: row.title ?? "" });
  }
  if (!ctx.provider.research) return { claims: [], usd: 0, log: { unavailable: true, subjects: subjects.map((s) => s.name), skipped } };

  // The whole video's research is checked against the cap up front, so a run never stops halfway through one video's research.
  const perSubject = ESTIMATES.research(ctx.config.maxSearchesPerEntity);
  ctx.guard({ inputTokens: (perSubject.inputTokens + ESTIMATES.claimsFromCitations.inputTokens) * subjects.length, outputTokens: (perSubject.outputTokens + ESTIMATES.claimsFromCitations.outputTokens) * subjects.length, webSearchRequests: perSubject.webSearchRequests * subjects.length });

  let usd = 0;
  const claims: ProposedPipelineClaim[] = [];
  const results: Array<Record<string, unknown>> = [];
  for (const subject of subjects) {
    const search = await ctx.provider.research(buildSearchRequest(subject, { maxSearches: ctx.config.maxSearchesPerEntity, model: ctx.config.model }));
    usd += ctx.charge(search.ok ? search.usage : undefined, perSubject, search.model ?? ctx.model);
    if (!search.ok) {
      results.push({ subject: subject.name, outcome: "FAILED", kind: search.error.type });
      continue;
    }
    if (search.passages.every((p) => p.citations.length === 0)) {
      results.push({ subject: subject.name, outcome: "NOT_FOUND", searches: search.usage?.webSearchRequests ?? null });
      continue;
    }
    const generated = await ctx.provider.generate(buildClaimsRequest(subject, search, { model: ctx.config.model }));
    usd += ctx.charge(generated.ok ? generated.usage : undefined, ESTIMATES.claimsFromCitations, generated.model ?? ctx.model);
    if (!generated.ok) {
      results.push({ subject: subject.name, outcome: "FAILED", kind: generated.error.type });
      continue;
    }
    const checkedClaims = checkResearchClaims({ subject, output: generated.output, research: search, video: { title: row.title, description: row.description }, checked, retrievedAt: ctx.now });
    claims.push(...checkedClaims.claims);
    results.push({ subject: subject.name, outcome: "RESEARCHED", claims: checkedClaims.claims.length, rejected: checkedClaims.rejected.length, notFound: checkedClaims.notFound });
  }
  return { claims, usd, log: { subjects: results, skipped } };
}

const DEMAND_KIND: Readonly<Record<string, DemandSubjectKind>> = { COMPOSER: "COMPOSER", PERSON: "PERSON", CONDUCTOR: "CONDUCTOR", CHOIR: "CHOIR", ENSEMBLE: "ENSEMBLE", ARTIST: "ARTIST", VENUE: "VENUE", WORK: "WORK", ORGANISATION: "ORGANISATION" };

export interface BundleDraft {
  video: PageDraft;
  entities: PageDraft[];
  mapped: Array<{ kind: EntityKind; name: string; entityId: string; aliasApplied: boolean; role: string }>;
  exceptions: string[];
  heldReasons: string[];
  titleOnly: boolean;
}

/** Stage 5: the bundle the owner reviews, and its FLAGS (a bundle with any flag cannot be bulk-approved). */
export async function draftBundle(
  row: PipelineVideoRow,
  extraction: NonNullable<PipelineVideoRow["extraction"]>,
  resolution: Resolution,
  claims: readonly DraftClaim[],
  demand: readonly SearchDemandProvider[],
  existing: ReadonlyArray<{ id: string; summary: string; name: string }>
): Promise<{ draft: BundleDraft; flags: string[]; transliteration: string | null }> {
  const checked = extraction.checked;
  const usable = draftableClaims(claims);
  const credits = draftCredits(checked, resolution);
  const facts = toVideoFacts({ youtubeVideoId: row.youtubeVideoId, youtubeTitle: row.title ?? "", checked, resolution });
  const plan = planVideo(facts);
  const recordingTitle = plan.recording?.title ?? facts.approvedRecordingTitle ?? credits.find((c) => c.role === "WORK")?.name ?? row.title ?? row.youtubeVideoId;
  const translit = facts.transliterationApproved ? facts.transliteration : null;

  const video = draftVideoPage({
    youtubeVideoId: row.youtubeVideoId,
    youtubeTitle: row.title,
    publishedAt: row.publishedAt,
    recordingTitle,
    transliteration: translit,
    credits,
    claims: usable,
    queries: await suggestQueries(demand, { kind: "VIDEO", name: recordingTitle, workTitle: credits.find((c) => c.role === "WORK")?.name ?? null, alternateTitle: translit }),
  });
  const entities: PageDraft[] = [];
  for (const e of resolution.entities.filter((x) => x.status === "NEW")) {
    if (entities.some((d) => d.subjectKey === e.key)) continue;
    entities.push(
      draftEntityPage({
        kind: e.kind,
        subjectKey: e.key,
        name: e.canonicalName,
        credits: credits.filter((c) => c.subjectKey === e.key),
        recordingTitle,
        claims: usable,
        queries: await suggestQueries(demand, { kind: DEMAND_KIND[e.kind] ?? "PERSON", name: e.canonicalName }),
      })
    );
  }

  const flags: string[] = [];
  for (const x of resolution.exceptions) flags.push(`exception: ${x}`);
  for (const c of claims.filter((x) => x.status === "CONFLICT")) flags.push(`conflict: ${c.id} (${c.subjectKind} "${c.value ?? ""}") disagrees with the video; decide it before approval`);
  for (const c of claims.filter((x) => x.entityLevel && x.status === "ACCEPTED" && x.videoRelation === "CONFLICTS")) flags.push(`conflict: ${c.id} (${c.subjectKind} "${c.value ?? ""}") is approved entity research that this video contradicts; it is not stated on this page`);
  const proposedEntity = claims.filter((x) => x.entityLevel && x.status === "PROPOSED");
  if (proposedEntity.length) flags.push(`entity research awaiting decision: ${proposedEntity.map((c) => c.id).join(", ")} (approving this bundle accepts those you do not reject, and the page is re-drafted with them)`);
  const uses = assessDraftClaims(usable);
  for (const d of [video, ...entities]) {
    for (const p of [...d.problems, ...draftWordingProblems(d)]) flags.push(`draft (${d.name}): ${p}`);
    const used = new Set(d.summarySupport.flat());
    for (const u of uses.filter((x) => x.weak && used.has(x.claim.id))) flags.push(`weak claim used with attribution in ${d.name}: ${u.claim.id}`);
  }
  for (const [id, problems] of nearDuplicateProblems([video, ...entities], existing)) for (const p of problems) flags.push(`near-duplicate (${id}): ${p}`);
  for (const h of plan.heldReasons) flags.push(`held: ${h}`);
  for (const n of plan.notes.filter((x) => /venue type/i.test(x))) flags.push(`venue: ${n}`);
  if (extraction.titleOnly) flags.push("title-only video: credits come from the YouTube title alone");
  if (checked.venueType.status === "ACCEPTED" && checked.venueTypeFromName) flags.push(`venue type ${checked.venueType.value} is inferred from the venue's own name, not stated: confirm it`);

  return {
    draft: {
      video,
      entities,
      mapped: resolution.entities.filter((e) => e.status === "MAPPED" && e.entityId).map((e) => ({ kind: e.kind, name: e.canonicalName, entityId: e.entityId!, aliasApplied: e.aliasApplied, role: e.role })),
      exceptions: resolution.exceptions,
      heldReasons: plan.heldReasons,
      titleOnly: extraction.titleOnly,
    },
    flags: [...new Set(flags)],
    transliteration: translit,
  };
}
