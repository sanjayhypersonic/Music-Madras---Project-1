import { Prisma, type PipelineEntityKind, type PipelineVideoStatus } from "@prisma/client";
import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import { findExactNormalizedDuplicate } from "../../mmke/duplicate-detection/detectDuplicateName";
import { sourceFingerprint } from "../../pipeline/queue";
import type { PipelinePorts, PipelineVideoRow, QueueCandidate, StagePatch } from "../../pipeline/run";
import type { ApprovalDeps, BundleForApproval } from "../../pipeline/approve";
import type { AliasSeedRow } from "../../pipeline/aliasSeed";
import type { CatalogueIndex, EntityKind } from "../../pipeline/resolve";
import { nameKey } from "../../pipeline/resolve";
import type { DraftClaim } from "../../pipeline/drafts";
import type { VideoRunFacts } from "../../pipeline/select";
import { executeCreditsPlans } from "../../jobs/videoCreditsCreateExecute";
import { findRecordingLinkedToYouTubeVideo } from "./recordingIntakeRepository";
import { editDraftPerformanceParticipants, publishRecordingDraft, updateDraftRevisionContent } from "./recordingRepository";
import { addWorkContributor, ensureEnsemble, ensurePerson, linkPersonIfUnset } from "./peopleRepository";

// R-34: the database side of the upload-to-draft pipeline (docs/upload-pipeline.md). The pipeline's own tables (PipelineRun, PipelineVideo,
// PipelineClaim, EntityAlias, EntityPageCopy) are written here; every CATALOGUE write goes through the existing repositories and services
// (executeCreditsPlans and the services it uses, publishRecordingDraft, editDraftPerformanceParticipants, updateDraftRevisionContent) or the
// small additive people repository. Untested against a database in this phase (no database was used); the orchestration it serves is
// unit-tested with fakes.

const WORKING: PipelineVideoStatus[] = ["QUEUED", "EXTRACTED", "RESOLVED", "RESEARCHED"];
const json = (v: unknown) => (v === undefined ? undefined : v === null ? Prisma.DbNull : (v as Prisma.InputJsonValue));

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The run lease

export async function startPipelineRun(input: { trigger: string; dryRun: boolean; capUsd: number; leaseSeconds: number; now: Date }): Promise<{ id: string } | null> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('music-madras:pipeline-run'))`;
    const holder = await tx.pipelineRun.findFirst({ where: { status: "RUNNING", leaseExpiresAt: { gt: input.now } }, select: { id: true } });
    if (holder) return null;
    return tx.pipelineRun.create({ data: { trigger: input.trigger, dryRun: input.dryRun, costCapUsd: input.capUsd, leaseExpiresAt: new Date(input.now.getTime() + input.leaseSeconds * 1000) }, select: { id: true } });
  });
}

export async function finishPipelineRun(id: string, outcome: { status: "SUCCEEDED" | "PARTIAL" | "FAILED" | "STOPPED_COST_CAP"; videosConsidered: number; videosAdvanced: number; inputTokens: number; outputTokens: number; webSearches: number; costUsd: number; stoppedReason: string | null; steps: unknown }): Promise<void> {
  await prisma.pipelineRun.update({ where: { id }, data: { ...outcome, steps: json(outcome.steps), finishedAt: new Date(), leaseExpiresAt: new Date() } });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Ports used by the orchestrator

function toRow(v: { id: string; status: string; attempts: number; extraction: Prisma.JsonValue; resolution: Prisma.JsonValue; youtubeVideo: { youtubeVideoId: string; title: string | null; description: string | null; publishedAt: Date | null; privacyStatus: string | null; observabilityState: string } }): PipelineVideoRow {
  return {
    id: v.id,
    youtubeVideoId: v.youtubeVideo.youtubeVideoId,
    title: v.youtubeVideo.title,
    description: v.youtubeVideo.description,
    publishedAt: v.youtubeVideo.publishedAt?.toISOString() ?? null,
    privacyStatus: v.youtubeVideo.privacyStatus,
    observabilityState: v.youtubeVideo.observabilityState,
    status: v.status,
    attempts: v.attempts,
    extraction: (v.extraction as unknown as PipelineVideoRow["extraction"]) ?? null,
    resolution: (v.resolution as unknown as PipelineVideoRow["resolution"]) ?? null,
  };
}

/** With `scope`, every queue and work query is restricted to those YouTube video ids (npm run pipeline:run). */
export function buildPipelinePorts(scope: { youtubeVideoIds?: readonly string[] } = {}): PipelinePorts {
  const only = scope.youtubeVideoIds ? { youtubeVideoId: { in: [...scope.youtubeVideoIds] } } : {};
  return {
    async listQueueCandidates(limit) {
      const videos = await prisma.youTubeVideo.findMany({
        where: { privacyStatus: "public", observabilityState: "OBSERVED", ...only },
        select: { id: true, youtubeVideoId: true, title: true, description: true, tags: true, pipelineItem: { select: { id: true, status: true, sourceFingerprint: true } } },
        orderBy: [{ publishedAt: "desc" }, { youtubeVideoId: "asc" }],
      });
      const out: QueueCandidate[] = [];
      for (const v of videos) {
        const fp = sourceFingerprint(v.title, v.description, v.tags);
        if (v.pipelineItem && v.pipelineItem.sourceFingerprint === fp) continue;
        out.push({ youtubeVideoRowId: v.id, youtubeVideoId: v.youtubeVideoId, title: v.title, description: v.description, tags: v.tags, existing: v.pipelineItem });
        if (out.length >= limit) break;
      }
      return out;
    },
    async enqueue(c, fingerprint, requeue) {
      await prisma.$transaction(async (tx) => {
        const row = await tx.pipelineVideo.upsert({
          where: { youtubeVideoRowId: c.youtubeVideoRowId },
          create: { youtubeVideoRowId: c.youtubeVideoRowId, sourceFingerprint: fingerprint },
          update: requeue
            ? { status: "QUEUED", sourceFingerprint: fingerprint, attempts: 0, lastErrorKind: null, extraction: Prisma.DbNull, resolution: Prisma.DbNull, research: Prisma.DbNull, draft: Prisma.DbNull, flags: [], decidedById: null, decidedAt: null, decisionNote: null }
            : {},
        });
        if (requeue) await tx.pipelineClaim.deleteMany({ where: { pipelineVideoId: row.id, status: { not: "ACCEPTED" } } });
      });
    },
    async listWork(limit, maxAttempts) {
      const rows = await prisma.pipelineVideo.findMany({
        where: { status: { in: WORKING }, attempts: { lt: maxAttempts }, ...(scope.youtubeVideoIds ? { youtubeVideo: only } : {}) },
        include: { youtubeVideo: { select: { youtubeVideoId: true, title: true, description: true, publishedAt: true, privacyStatus: true, observabilityState: true } } },
        orderBy: { updatedAt: "asc" },
        take: limit,
      });
      return rows.map(toRow);
    },
    async saveStage(id, patch: StagePatch) {
      await prisma.pipelineVideo.update({
        where: { id },
        data: {
          ...(patch.status ? { status: patch.status as PipelineVideoStatus } : {}),
          extraction: json(patch.extraction),
          resolution: json(patch.resolution),
          research: json(patch.research),
          draft: json(patch.draft),
          ...(patch.flags ? { flags: patch.flags } : {}),
          ...(patch.addCostUsd ? { costUsd: { increment: patch.addCostUsd } } : {}),
          ...(patch.attempts !== undefined ? { attempts: patch.attempts } : {}),
          ...(patch.lastErrorKind !== undefined ? { lastErrorKind: patch.lastErrorKind } : {}),
        },
      });
    },
    async replaceClaims(id, claims) {
      await prisma.$transaction([
        prisma.pipelineClaim.deleteMany({ where: { pipelineVideoId: id, status: { in: ["PROPOSED", "CONFLICT"] } } }),
        prisma.pipelineClaim.createMany({
          data: claims.map((c) => ({
            pipelineVideoId: id,
            subjectKey: c.subjectKey,
            entityKind: (c.entityKind ?? null) as PipelineEntityKind | null,
            entityName: c.entityName,
            subjectKind: c.subjectKind,
            workTitle: c.workTitle,
            value: c.value,
            statement: c.statement,
            sourceUrl: c.sourceUrl,
            sourceTitle: c.sourceTitle,
            excerpt: c.excerpt,
            sourceTier: c.sourceTier,
            videoRelation: c.videoRelation,
            status: c.status,
            retrievedAt: new Date(c.retrievedAt),
          })),
        }),
      ]);
    },
    loadClaims: loadDraftClaims,
    async loadCatalogueIndex(): Promise<CatalogueIndex> {
      const [composers, works, conductors, choirs, artists, venues, ensembles, persons, organisations] = await Promise.all([
        prisma.composer.findMany({ where: { archivedAt: null }, select: { id: true, name: true } }),
        prisma.musicalWork.findMany({ where: { archivedAt: null }, select: { id: true, title: true, alternateTitles: true, composer: { select: { name: true } } } }),
        prisma.conductor.findMany({ where: { archivedAt: null }, select: { id: true, name: true } }),
        prisma.choir.findMany({ where: { archivedAt: null }, select: { id: true, name: true } }),
        prisma.artist.findMany({ where: { archivedAt: null }, select: { id: true, name: true } }),
        prisma.venue.findMany({ where: { archivedAt: null }, select: { id: true, name: true } }),
        prisma.ensemble.findMany({ where: { archivedAt: null }, select: { id: true, name: true } }),
        prisma.person.findMany({ where: { archivedAt: null }, select: { id: true, name: true } }),
        prisma.organisation.findMany({ where: { archivedAt: null }, select: { id: true, name: true } }),
      ]);
      return {
        COMPOSER: composers,
        WORK: works.map((w) => ({ id: w.id, name: w.title, composerName: w.composer.name, alternateTitles: w.alternateTitles })),
        CONDUCTOR: conductors,
        CHOIR: choirs,
        ARTIST: artists,
        VENUE: venues,
        ENSEMBLE: ensembles,
        PERSON: persons,
        ORGANISATION: organisations,
      };
    },
    async loadAliases() {
      const rows = await prisma.entityAlias.findMany();
      return rows.map((r) => ({ kind: r.entityKind as EntityKind, aliasKey: r.aliasKey, canonicalName: r.canonicalName, entityId: r.entityId }));
    },
    async hasApprovedResearch(kind, name) {
      return (await prisma.pipelineClaim.count({ where: { entityKind: kind as PipelineEntityKind, entityName: { equals: name, mode: "insensitive" }, status: "ACCEPTED" } })) > 0;
    },
    listPublishedCopySummaries,
  };
}

async function loadDraftClaims(pipelineVideoId: string): Promise<DraftClaim[]> {
  const rows = await prisma.pipelineClaim.findMany({ where: { pipelineVideoId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return rows.map((r, i) => ({
    id: `R${i + 1}`,
    dbId: r.id,
    subjectKey: r.subjectKey,
    subjectKind: r.subjectKind,
    value: r.value,
    statement: r.statement,
    excerpt: r.excerpt,
    sourceUrl: r.sourceUrl,
    sourceTitle: r.sourceTitle,
    sourceTier: r.sourceTier,
    videoRelation: r.videoRelation as DraftClaim["videoRelation"],
    status: r.status,
  }));
}

async function listPublishedCopySummaries() {
  const rows = await prisma.entityPageCopy.findMany({ where: { status: "PUBLISHED" }, select: { id: true, summary: true, seoTitle: true }, take: 2000 });
  return rows.map((r) => ({ id: r.id, summary: r.summary, name: r.seoTitle }));
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Studio: the inbox

export async function listPipelineBundles(filter: { status?: string } = {}) {
  return prisma.pipelineVideo.findMany({
    where: filter.status ? { status: filter.status as PipelineVideoStatus } : { status: { in: ["AWAITING_APPROVAL", "APPROVED", "FAILED"] } },
    include: { youtubeVideo: { select: { youtubeVideoId: true, title: true, thumbnailUrl: true } }, _count: { select: { claims: true } } },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
}

export async function countPipelineByStatus(): Promise<Record<string, number>> {
  const groups = await prisma.pipelineVideo.groupBy({ by: ["status"], _count: { _all: true } });
  return Object.fromEntries(groups.map((g) => [g.status, g._count._all]));
}

export async function listRecentPipelineRuns(take = 5) {
  return prisma.pipelineRun.findMany({ orderBy: { startedAt: "desc" }, take });
}

export async function loadBundleForApproval(id: string): Promise<BundleForApproval | null> {
  const v = await prisma.pipelineVideo.findUnique({ where: { id }, include: { youtubeVideo: true } });
  if (!v || !v.extraction || !v.resolution || !v.draft) return null;
  const claims = (await loadDraftClaims(id)) as Array<DraftClaim & { dbId: string }>;
  return {
    id: v.id,
    status: v.status,
    flags: v.flags,
    youtubeVideoRowId: v.youtubeVideoRowId,
    youtubeVideoId: v.youtubeVideo.youtubeVideoId,
    youtubeTitle: v.youtubeVideo.title,
    description: v.youtubeVideo.description,
    publishedAt: v.youtubeVideo.publishedAt?.toISOString() ?? null,
    extraction: v.extraction as unknown as BundleForApproval["extraction"],
    resolution: v.resolution as unknown as BundleForApproval["resolution"],
    draft: v.draft as unknown as BundleForApproval["draft"],
    claims,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Approval

export function buildApprovalDeps(): ApprovalDeps {
  return {
    loadBundle: loadBundleForApproval,
    executePlans: (plans, actorId) => executeCreditsPlans(plans, {}, undefined, { actorId }),
    async findRecordingForVideo(youtubeVideoRowId) {
      const linked = await findRecordingLinkedToYouTubeVideo(youtubeVideoRowId);
      return linked ? { recordingId: linked.recordingId } : null;
    },
    async linkContributorsAndPeople({ recordingId, actorId, checked, resolution }) {
      const notes: string[] = [];
      const recording = await prisma.recording.findUnique({
        where: { id: recordingId },
        select: { currentDraftRevision: { select: { id: true, performanceId: true, works: { select: { musicalWork: { select: { id: true, title: true, alternateTitles: true } } } } } } },
      });
      const draft = recording?.currentDraftRevision;
      if (!draft) return ["no open draft: contributors and people were not linked"];
      for (const c of checked.accepted) {
        const e = resolution.entities.find((x) => x.role === c.role && nameKey(x.nameInVideo) === nameKey(c.name));
        if (!e || e.status === "EXCEPTION") continue;
        if (c.role === "ARRANGER" || c.role === "LYRICIST") {
          const workTitle = c.workTitle ? resolution.entities.find((x) => x.role === "WORK" && nameKey(x.nameInVideo) === nameKey(c.workTitle!))?.canonicalName ?? c.workTitle : null;
          const works = draft.works.map((w) => w.musicalWork);
          const work = workTitle ? works.find((w) => nameKey(w.title) === nameKey(workTitle) || w.alternateTitles.some((t) => nameKey(t) === nameKey(workTitle))) : works.length === 1 ? works[0] : undefined;
          if (!work) {
            notes.push(`${c.role.toLowerCase()} ${e.canonicalName}: no single work to attach to; not linked`);
            continue;
          }
          const { person } = await ensurePerson(e.canonicalName, actorId);
          if (await addWorkContributor({ musicalWorkId: work.id, personId: person.id, role: c.role, actorId })) notes.push(`${c.role.toLowerCase()} ${person.name} linked to "${work.title}"`);
        } else if (c.role === "ENSEMBLE") {
          if (!draft.performanceId) {
            notes.push(`ensemble ${e.canonicalName}: no Performance on the draft (venue or venue type missing); not linked`);
            continue;
          }
          const { ensemble } = await ensureEnsemble(e.canonicalName, actorId);
          await editDraftPerformanceParticipants({
            recordingId,
            expectedPerformanceId: draft.performanceId,
            actorId,
            change: async (tx, performanceId) => {
              await tx.performanceEnsemble.upsert({ where: { performanceId_ensembleId: { performanceId, ensembleId: ensemble.id } }, create: { performanceId, ensembleId: ensemble.id }, update: {} });
              await writeAuditLog({ actorId, action: "ENSEMBLE_LINKED_TO_PERFORMANCE", entityType: "Performance", entityId: performanceId, afterSnapshot: { ensembleId: ensemble.id } }, tx);
            },
          });
          notes.push(`ensemble ${ensemble.name} linked`);
        } else if (c.role === "COMPOSER" || c.role === "CONDUCTOR" || c.role === "PERFORMER") {
          const kind = c.role === "PERFORMER" ? "ARTIST" : c.role;
          const records = kind === "COMPOSER" ? await prisma.composer.findMany({ where: { archivedAt: null }, select: { id: true, name: true } }) : kind === "CONDUCTOR" ? await prisma.conductor.findMany({ where: { archivedAt: null }, select: { id: true, name: true } }) : await prisma.artist.findMany({ where: { archivedAt: null }, select: { id: true, name: true } });
          const match = findExactNormalizedDuplicate(e.canonicalName, records.map((r) => r.name));
          const record = match ? records.find((r) => r.name === match) : undefined;
          if (!record) continue;
          const { person } = await ensurePerson(e.canonicalName, actorId);
          if (await linkPersonIfUnset(kind, record.id, person.id, actorId)) notes.push(`${kind.toLowerCase()} ${record.name} linked to person page ${person.slug}`);
        }
      }
      return notes;
    },
    async fillRecordingSeo({ recordingId, actorId, seoTitle, metaDescription, summary }) {
      const r = await prisma.recording.findUnique({ where: { id: recordingId }, select: { status: true, currentDraftRevision: { select: { id: true, updatedAt: true, seoMetaTitle: true, seoMetaDescription: true, description: true } } } });
      const d = r?.currentDraftRevision;
      if (!d) return "SEO not filled: no open draft";
      const patch = { ...(d.seoMetaTitle ? {} : { seoMetaTitle: seoTitle }), ...(d.seoMetaDescription ? {} : { seoMetaDescription: metaDescription }), ...(d.description ? {} : { description: summary }) };
      if (Object.keys(patch).length === 0) return "SEO fields already set by an editor; left as they are";
      await updateDraftRevisionContent(recordingId, d.updatedAt, actorId, patch, undefined, { expectedRevisionId: d.id });
      return `filled ${Object.keys(patch).join(", ")}`;
    },
    async publishEntityCopies({ actorId, pages, claimDbIds }) {
      const notes: string[] = [];
      for (const page of pages) {
        const kind = page.kind as PipelineEntityKind;
        const id = await findEntityIdByName(kind, page.name);
        if (!id) {
          notes.push(`${page.name}: no ${kind.toLowerCase()} record was created, so its page copy was not saved`);
          continue;
        }
        const existing = await prisma.entityPageCopy.findUnique({ where: { entityKind_entityId: { entityKind: kind, entityId: id } } });
        if (existing?.status === "PUBLISHED") {
          notes.push(`${page.name}: already has published page copy; left as it is`);
          continue;
        }
        const data = { seoTitle: page.seoTitle, metaDescription: page.metaDescription, summary: page.summary.join(" "), keyFacts: page.keyFacts as unknown as Prisma.InputJsonValue, sameAs: page.sameAs, sourceClaimIds: claimDbIds, status: "PUBLISHED" as const, approvedById: actorId, approvedAt: new Date() };
        await prisma.entityPageCopy.upsert({ where: { entityKind_entityId: { entityKind: kind, entityId: id } }, create: { entityKind: kind, entityId: id, ...data }, update: data });
        await writeAuditLog({ actorId, action: "ENTITY_PAGE_COPY_PUBLISHED", entityType: kind, entityId: id, afterSnapshot: { seoTitle: page.seoTitle } });
        notes.push(`${page.name}: page copy published`);
      }
      return notes;
    },
    async decideClaims({ pipelineVideoId, accepted, rejected, actorId, at }) {
      await prisma.$transaction([
        prisma.pipelineClaim.updateMany({ where: { pipelineVideoId, id: { in: accepted } }, data: { status: "ACCEPTED", decidedById: actorId, decidedAt: at } }),
        prisma.pipelineClaim.updateMany({ where: { pipelineVideoId, id: { in: rejected } }, data: { status: "REJECTED", decidedById: actorId, decidedAt: at } }),
      ]);
    },
    async publish({ recordingId, actorId }) {
      const result = await publishRecordingDraft({ recordingId, actorId });
      return result.ok ? { ok: true } : { ok: false, reason: result.reason, missingCategories: result.missingCategories };
    },
    async markDecision(id, patch) {
      await prisma.pipelineVideo.update({ where: { id }, data: { status: patch.status, decidedById: patch.decidedById, decidedAt: patch.decidedAt, decisionNote: patch.decisionNote, ...(patch.recordingId !== undefined ? { recordingId: patch.recordingId } : {}), ...(patch.draft ? { draft: patch.draft as unknown as Prisma.InputJsonValue } : {}) } });
    },
    async audit({ actorId, action, entityId, afterSnapshot }) {
      await writeAuditLog({ actorId, action, entityType: "PipelineVideo", entityId, afterSnapshot });
    },
    listPublishedCopySummaries,
  };
}

async function findEntityIdByName(kind: PipelineEntityKind, name: string): Promise<string | null> {
  const pick = (rows: Array<{ id: string; name: string }>) => {
    const match = findExactNormalizedDuplicate(name, rows.map((r) => r.name));
    return match ? rows.find((r) => r.name === match)?.id ?? null : null;
  };
  const sel = { where: { archivedAt: null }, select: { id: true, name: true } } as const;
  switch (kind) {
    case "COMPOSER":
      return pick(await prisma.composer.findMany(sel));
    case "CONDUCTOR":
      return pick(await prisma.conductor.findMany(sel));
    case "CHOIR":
      return pick(await prisma.choir.findMany(sel));
    case "ARTIST":
      return pick(await prisma.artist.findMany(sel));
    case "VENUE":
      return pick(await prisma.venue.findMany(sel));
    case "ENSEMBLE":
      return pick(await prisma.ensemble.findMany(sel));
    case "PERSON":
      return pick(await prisma.person.findMany(sel));
    case "ORGANISATION":
      return pick(await prisma.organisation.findMany(sel));
    case "WORK":
      return pick((await prisma.musicalWork.findMany({ where: { archivedAt: null }, select: { id: true, title: true } })).map((w) => ({ id: w.id, name: w.title })));
  }
}

/** The approved page copy of an entity, for its public page (status PUBLISHED only). */
export function findPublishedEntityPageCopy(kind: PipelineEntityKind, entityId: string) {
  return prisma.entityPageCopy.findFirst({ where: { entityKind: kind, entityId, status: "PUBLISHED" } });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Aliases

export async function upsertEntityAliases(rows: readonly AliasSeedRow[], decidedBy: string): Promise<{ created: number; updated: number; unchanged: number }> {
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  for (const r of rows) {
    const key = { entityKind_aliasKey: { entityKind: r.kind as PipelineEntityKind, aliasKey: r.aliasKey } };
    const existing = await prisma.entityAlias.findUnique({ where: key });
    if (!existing) {
      await prisma.entityAlias.create({ data: { entityKind: r.kind as PipelineEntityKind, alias: r.alias, aliasKey: r.aliasKey, canonicalName: r.canonicalName, source: r.source, decidedBy } });
      created++;
    } else if (existing.canonicalName !== r.canonicalName) {
      await prisma.entityAlias.update({ where: key, data: { canonicalName: r.canonicalName, source: r.source, decidedBy, entityId: null } });
      updated++;
    } else unchanged++;
  }
  return { created, updated, unchanged };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Operator runs (npm run pipeline:run): the facts that decide whether a video may be run (modules/pipeline/select.ts). Read-only.

export async function loadVideoRunFacts(input: { youtubeVideoIds?: readonly string[]; limit?: number }): Promise<VideoRunFacts[]> {
  const ids = input.youtubeVideoIds
    ? [...input.youtubeVideoIds]
    : (
        await prisma.pipelineVideo.findMany({ where: { status: { in: WORKING } }, orderBy: { updatedAt: "asc" }, take: (input.limit ?? 3) * 4, select: { youtubeVideo: { select: { youtubeVideoId: true } } } })
      ).map((r) => r.youtubeVideo.youtubeVideoId);
  if (ids.length === 0) return [];
  const videos = await prisma.youTubeVideo.findMany({
    where: { youtubeVideoId: { in: ids } },
    select: {
      youtubeVideoId: true,
      privacyStatus: true,
      observabilityState: true,
      pipelineItem: { select: { status: true, draft: true } },
      exposureReview: { select: { holdReason: true } },
      mediaResources: { where: { recordingRevisionId: { not: null } }, select: { recordingRevision: { select: { recording: { select: { status: true, holdReason: true } } } } } },
    },
  });
  const byId = new Map(videos.map((v) => [v.youtubeVideoId, v]));
  return ids.map((id) => {
    const v = byId.get(id);
    if (!v) return { youtubeVideoId: id, inCatalogue: false, privacyStatus: null, observabilityState: null, bundleStatus: null, bundleHeldReasons: [], videoHoldReason: null, recordingHoldReason: null, recordingStatus: null };
    const recordings = v.mediaResources.flatMap((m) => (m.recordingRevision ? [m.recordingRevision.recording] : []));
    const draft = v.pipelineItem?.draft as { heldReasons?: unknown } | null | undefined;
    return {
      youtubeVideoId: id,
      inCatalogue: true,
      privacyStatus: v.privacyStatus,
      observabilityState: v.observabilityState,
      bundleStatus: v.pipelineItem?.status ?? null,
      bundleHeldReasons: Array.isArray(draft?.heldReasons) ? draft.heldReasons.filter((r): r is string => typeof r === "string") : [],
      videoHoldReason: v.exposureReview?.holdReason ?? null,
      recordingHoldReason: recordings.find((r) => r.holdReason)?.holdReason ?? null,
      recordingStatus: recordings.some((r) => r.status === "PUBLISHED") ? "PUBLISHED" : recordings[0]?.status ?? null,
    };
  });
}
