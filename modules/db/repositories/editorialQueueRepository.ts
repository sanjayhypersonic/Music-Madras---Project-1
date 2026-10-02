import { prisma } from "../client";
import { checkRecordingRevisionCompleteness, computeRecordingReadiness } from "../../mmke/completeness/checkRecordingRevisionCompleteness";
import { isRecordingPublished } from "../../mmke/catalogue/isRecordingPublished";
import { computeContextFingerprint } from "../../mmke/contentIntelligence/computeContextFingerprint";
import { deriveContentSuggestionFreshness, type ContentSuggestionFreshness } from "../../mmke/contentIntelligence/deriveContentSuggestionFreshness";
import {
  assembleEditorialQueueRows,
  deriveSuggestionQueueState,
  queryEditorialQueue,
  type EditorialQueuePage,
  type EditorialQueueQuery,
  type EditorialQueueRow,
  type QueueGenerationFacts,
  type QueueRecordingFacts,
  type QueueSuggestionFacts,
} from "../../mmke/contentIntelligence/editorialOperationsQueue";
import { getRecordingContext } from "./recordingContextRepository";
import type { Prisma } from "@prisma/client";

// Phase 6I-3 — the Editorial Operations Queue's READ repository
// (docs/content-intelligence-architecture.md, Phase 6I-3 section).
//
// Read-only: it never writes, never calls an AI provider, never retrieves an
// external source, and never changes a review state. It gathers the facts the
// pure derivation (editorialOperationsQueue.ts) needs in a CONSTANT number of
// queries — not one per row — and hands them over:
//
//   1. non-archived Recordings, with just the columns the queue needs from the
//      published/draft revisions (title, prose presence, completeness counts,
//      the primary YouTube video's title)
//   2. open RECORDING suggestions (+ their generation request and reviewer)
//   3. which of the approved ones were already applied (one audit lookup)
//   4. in-flight generation requests, and 5. each Recording's latest request
//
// The one cost that is not constant is freshness: it needs the Recording's
// CURRENT context fingerprint, which is assembled by the existing
// getRecordingContext (about ten queries). That is done ONCE per distinct
// Recording that has an open suggestion — never once per suggestion — and
// compared against each suggestion's stored fingerprint with the same pure
// rule the per-suggestion check uses.
//
// "Applied" is derived from the audit log (6I-2). If this ever needs to scale
// past MVP volume, the natural fix is an explicit `appliedAt` column on
// ContentSuggestion — a migration, deliberately not made here.

const FRESHNESS_CONCURRENCY = 4;

const revisionSelect = {
  title: true,
  description: true,
  educationalListeningGuide: true,
  educationalAnalysis: true,
  seoMetaTitle: true,
  _count: { select: { works: true } },
  mediaResources: { where: { role: "PRIMARY_VIDEO" as const }, select: { youtubeVideo: { select: { title: true } } } },
  performance: { select: { _count: { select: { performers: true, choirs: true, conductors: true } } } },
} satisfies Prisma.RecordingRevisionSelect;

type QueueRevision = Prisma.RecordingRevisionGetPayload<{ select: typeof revisionSelect }>;

function hasText(value: string | null): boolean {
  return value !== null && value.trim().length > 0;
}

function toRecordingFacts(recording: {
  id: string;
  slug: string;
  status: QueueRecordingFacts["status"];
  currentPublishedRevisionId: string | null;
  updatedAt: Date;
  currentPublishedRevision: QueueRevision | null;
  currentDraftRevision: QueueRevision | null;
}): QueueRecordingFacts {
  const published = recording.currentPublishedRevision;
  const draft = recording.currentDraftRevision;
  const youtubeTitleOf = (revision: QueueRevision | null) => revision?.mediaResources.find((media) => media.youtubeVideo?.title)?.youtubeVideo?.title ?? null;
  // Gaps describe what the editor has to work on: the live revision for a published
  // Recording, the open draft otherwise.
  const assessed = isRecordingPublished(recording) ? published : (draft ?? published);

  let readiness: QueueRecordingFacts["readiness"] = null;
  let gaps: string[] = [];
  if (assessed) {
    const performance = assessed.performance;
    // The existing pure completeness rule — not a second mechanism.
    const report = checkRecordingRevisionCompleteness({
      title: assessed.title,
      linkedWorkCount: assessed._count.works,
      hasPerformance: performance !== null,
      hasVenue: performance !== null, // Performance.venueId is required, so a linked Performance always has a Venue
      participantCount: performance ? performance._count.performers + performance._count.choirs + performance._count.conductors : 0,
      hasPrimaryVideo: assessed.mediaResources.length > 0,
      hasEducationalContent: hasText(assessed.educationalListeningGuide) || hasText(assessed.educationalAnalysis),
      hasSeoMetaTitle: hasText(assessed.seoMetaTitle),
    });
    readiness = computeRecordingReadiness(report);
    gaps = report.filter((item) => item.status === "MISSING").map((item) => item.category);
  }

  return {
    id: recording.id,
    status: recording.status,
    currentPublishedRevisionId: recording.currentPublishedRevisionId,
    // Same label rule the Studio lists already use: published title, else draft title, else the slug.
    title: published?.title ?? draft?.title ?? recording.slug,
    youtubeTitle: youtubeTitleOf(published) ?? youtubeTitleOf(draft),
    hasEditorialProse: published ? hasText(published.description) || hasText(published.educationalListeningGuide) || hasText(published.educationalAnalysis) : false,
    readiness,
    gaps,
    updatedAt: recording.updatedAt,
  };
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Every queue row, unfiltered and unpaginated — the input the pure query step filters, sorts and pages. */
export async function listEditorialQueueRows(): Promise<EditorialQueueRow[]> {
  const recordings = await prisma.recording.findMany({
    where: { status: { not: "ARCHIVED" } },
    select: {
      id: true,
      slug: true,
      status: true,
      currentPublishedRevisionId: true,
      updatedAt: true,
      currentPublishedRevision: { select: revisionSelect },
      currentDraftRevision: { select: revisionSelect },
    },
  });
  const recordingFacts = recordings.map(toRecordingFacts);
  const recordingIds = new Set(recordingFacts.map((r) => r.id));

  const [openSuggestions, activeRequests, latestRequests] = await Promise.all([
    prisma.contentSuggestion.findMany({
      where: { targetEntityType: "RECORDING", status: { in: ["DRAFT_READY", "EDITOR_REVIEW", "CHANGES_REQUESTED", "APPROVED"] } },
      select: {
        id: true,
        suggestionType: true,
        targetEntityType: true,
        targetEntityId: true,
        targetField: true,
        status: true,
        reviewNote: true,
        reviewedAt: true,
        createdAt: true,
        updatedAt: true,
        reviewedBy: { select: { name: true } },
        generationRequest: { select: { status: true, contextFingerprint: true } },
      },
    }),
    prisma.contentGenerationRequest.findMany({
      where: { targetEntityType: "RECORDING", status: { in: ["PENDING", "GENERATING"] } },
      orderBy: [{ requestedAt: "desc" }, { id: "asc" }],
      select: { targetEntityId: true, status: true, requestedAt: true },
    }),
    prisma.contentGenerationRequest.findMany({
      where: { targetEntityType: "RECORDING" },
      orderBy: [{ requestedAt: "desc" }, { id: "asc" }],
      distinct: ["targetEntityId"],
      select: { targetEntityId: true, status: true, requestedAt: true, completedAt: true },
    }),
  ]);

  const inScope = openSuggestions.filter((s) => recordingIds.has(s.targetEntityId));

  const approvedIds = inScope.filter((s) => s.status === "APPROVED").map((s) => s.id);
  const appliedIds = new Set(
    approvedIds.length === 0
      ? []
      : (
          await prisma.auditLogEntry.findMany({
            where: { entityType: "ContentSuggestion", action: "CONTENT_SUGGESTION_APPLIED", entityId: { in: approvedIds } },
            select: { entityId: true },
          })
        ).map((entry) => entry.entityId)
  );

  // Freshness: only suggestions that could still be in the queue need it, and the
  // Recording's current fingerprint is assembled once however many it has.
  const needsFreshness = inScope.filter(
    (s) =>
      deriveSuggestionQueueState({
        status: s.status,
        freshness: "CURRENT",
        applied: appliedIds.has(s.id),
        suggestionType: s.suggestionType,
        targetEntityType: s.targetEntityType,
        targetField: s.targetField,
      }) !== null
  );
  const recordingIdsToCheck = Array.from(new Set(needsFreshness.filter((s) => s.generationRequest.contextFingerprint).map((s) => s.targetEntityId)));
  const currentFingerprints = new Map<string, string | null>();
  await mapWithConcurrency(recordingIdsToCheck, FRESHNESS_CONCURRENCY, async (recordingId) => {
    const context = await getRecordingContext(recordingId);
    currentFingerprints.set(recordingId, context.ok ? computeContextFingerprint(context.context) : null);
  });

  const suggestionFacts: QueueSuggestionFacts[] = inScope.map((s) => {
    const freshness: ContentSuggestionFreshness = deriveContentSuggestionFreshness(
      s.generationRequest.contextFingerprint,
      currentFingerprints.get(s.targetEntityId) ?? null
    );
    return {
      id: s.id,
      recordingId: s.targetEntityId,
      suggestionType: s.suggestionType,
      targetEntityType: s.targetEntityType,
      targetField: s.targetField,
      status: s.status,
      generationStatus: s.generationRequest.status,
      freshness,
      applied: appliedIds.has(s.id),
      reviewNote: s.reviewNote,
      reviewerName: s.reviewedBy?.name ?? null,
      reviewedAt: s.reviewedAt,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  });

  const generation = new Map<string, QueueGenerationFacts>();
  for (const latest of latestRequests) {
    generation.set(latest.targetEntityId, {
      recordingId: latest.targetEntityId,
      activeStatus: null,
      activeAt: null,
      latestStatus: latest.status,
      latestAt: latest.completedAt ?? latest.requestedAt,
    });
  }
  for (const active of activeRequests) {
    const entry = generation.get(active.targetEntityId) ?? {
      recordingId: active.targetEntityId,
      activeStatus: null,
      activeAt: null,
      latestStatus: null,
      latestAt: null,
    };
    // Ordered newest-first, so the first in-flight request per Recording wins.
    if (!entry.activeStatus) {
      entry.activeStatus = active.status as "PENDING" | "GENERATING";
      entry.activeAt = active.requestedAt;
    }
    generation.set(active.targetEntityId, entry);
  }

  return assembleEditorialQueueRows({ recordings: recordingFacts, suggestions: suggestionFacts, generation: Array.from(generation.values()) });
}

/** The queue page the Studio renders: summary counts, plus one filtered, deterministically ordered, server-paginated slice. */
export async function getEditorialOperationsQueue(query: EditorialQueueQuery = {}): Promise<EditorialQueuePage> {
  return queryEditorialQueue(await listEditorialQueueRows(), query);
}

/**
 * Resolves human-readable Recording titles from the canonical relationships
 * (published revision title, else draft revision title, else the slug) in ONE
 * query — so a list never has to show a raw id, and the title is never
 * duplicated onto ContentSuggestion.
 */
export async function getRecordingDisplayTitles(recordingIds: string[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(recordingIds));
  if (ids.length === 0) return new Map();
  const recordings = await prisma.recording.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      slug: true,
      currentPublishedRevision: { select: { title: true } },
      currentDraftRevision: { select: { title: true } },
    },
  });
  return new Map(recordings.map((r) => [r.id, r.currentPublishedRevision?.title ?? r.currentDraftRevision?.title ?? r.slug]));
}
