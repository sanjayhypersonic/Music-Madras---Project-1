import { isRecordingPublished } from "../catalogue/isRecordingPublished";
import { getApplicableTargetField } from "./applyContentSuggestionRules";
import type { ContentSuggestionFreshness } from "./deriveContentSuggestionFreshness";

// Phase 6I-3 — the Editorial Operations Queue's derivation rules.
//
// The queue is a VIEW over canonical state that already exists
// (Recording, RecordingRevision, ContentGenerationRequest, ContentSuggestion,
// the CONTENT_SUGGESTION_APPLIED audit entry, and the existing freshness
// rule). Nothing here is stored: there is no task table, priority, score, or
// assignment, and no state outlives the facts it is derived from. Pure — no
// database, no I/O — so every rule below is unit-tested without one; the
// repository (editorialQueueRepository.ts) only gathers the facts, in a
// constant number of queries.
//
// Seven states, and which fact decides each:
//
//   NEEDS_ENRICHMENT      the Recording is not publicly published, so it is not
//                         eligible for generation yet (the generation form offers
//                         PUBLISHED Recordings only — 6H-6).
//   READY_FOR_GENERATION  published, no generation in flight, no open suggestion,
//                         and the published revision has no editorial prose yet
//                         (the same "no description / listening guide / analysis"
//                         rule as the Recording context's EDITORIAL_CONTENT gap).
//   GENERATION            a generation request is PENDING/GENERATING, or the
//                         Recording's latest request FAILED (shown until a newer
//                         request supersedes it). SUCCEEDED requests are not rows
//                         of their own — their result is a suggestion, which is
//                         listed in its own state (counting both would double-count).
//   AWAITING_REVIEW       suggestion DRAFT_READY or EDITOR_REVIEW.
//   CHANGES_REQUESTED     suggestion CHANGES_REQUESTED.
//   STALE                 any still-open suggestion whose freshness is STALE
//                         (the existing fingerprint comparison — never a new one).
//   APPROVED_AWAITING_APPLICATION
//                         suggestion APPROVED, applicable to a Recording field,
//                         and with no CONTENT_SUGGESTION_APPLIED entry.
//
// A Recording can appear in several rows at once (one per open suggestion, plus
// at most one Recording-level row). Archived Recordings never appear.

export const EDITORIAL_QUEUE_STATES = [
  "NEEDS_ENRICHMENT",
  "READY_FOR_GENERATION",
  "GENERATION",
  "AWAITING_REVIEW",
  "CHANGES_REQUESTED",
  "STALE",
  "APPROVED_AWAITING_APPLICATION",
] as const;

export type EditorialQueueState = (typeof EDITORIAL_QUEUE_STATES)[number];

export function isEditorialQueueState(value: unknown): value is EditorialQueueState {
  return typeof value === "string" && (EDITORIAL_QUEUE_STATES as readonly string[]).includes(value);
}

export const EDITORIAL_QUEUE_STATE_LABELS: Record<EditorialQueueState, string> = {
  NEEDS_ENRICHMENT: "Needs enrichment",
  READY_FOR_GENERATION: "Ready for generation",
  GENERATION: "Generation",
  AWAITING_REVIEW: "Awaiting review",
  CHANGES_REQUESTED: "Changes requested",
  STALE: "Stale",
  APPROVED_AWAITING_APPLICATION: "Approved — awaiting application",
};

export const EDITORIAL_QUEUE_EMPTY_MESSAGES: Record<EditorialQueueState, string> = {
  NEEDS_ENRICHMENT: "No Recordings are waiting to be enriched.",
  READY_FOR_GENERATION: "No published Recordings are waiting for an editorial suggestion.",
  GENERATION: "No generation is in progress and none has failed.",
  AWAITING_REVIEW: "No suggestions are waiting for review.",
  CHANGES_REQUESTED: "No suggestions have changes requested.",
  STALE: "No open suggestions are stale.",
  APPROVED_AWAITING_APPLICATION: "No approved suggestions are waiting to be applied.",
};

/** The order states appear in when no single state is selected: work a human must act on first. */
const LIST_PRIORITY: Record<EditorialQueueState, number> = {
  AWAITING_REVIEW: 0,
  CHANGES_REQUESTED: 1,
  APPROVED_AWAITING_APPLICATION: 2,
  STALE: 3,
  GENERATION: 4,
  READY_FOR_GENERATION: 5,
  NEEDS_ENRICHMENT: 6,
};

/** Human-attention queues are worked oldest-first; generation/enrichment queues show the most recently touched first. */
const OLDEST_FIRST: ReadonlySet<EditorialQueueState> = new Set<EditorialQueueState>([
  "AWAITING_REVIEW",
  "CHANGES_REQUESTED",
  "STALE",
  "APPROVED_AWAITING_APPLICATION",
]);

export type EditorialQueueAction = "OPEN_RECORDING_EDITOR" | "GENERATE" | "REGENERATE" | "REVIEW_SUGGESTION" | "APPLY_SUGGESTION";

export type QueueGenerationStatus = "PENDING" | "GENERATING" | "SUCCEEDED" | "FAILED";
export type QueueReadiness = "INCOMPLETE" | "READY_FOR_REVIEW" | "PUBLISHABLE";
export type QueueSuggestionStatus = "DRAFT_READY" | "EDITOR_REVIEW" | "CHANGES_REQUESTED" | "APPROVED" | "REJECTED";

export interface QueueRecordingFacts {
  id: string;
  status: "DRAFT" | "IN_REVIEW" | "PUBLISHED" | "ARCHIVED";
  currentPublishedRevisionId: string | null;
  title: string;
  youtubeTitle: string | null;
  /** description / educationalListeningGuide / educationalAnalysis — any non-blank value. */
  hasEditorialProse: boolean;
  readiness: QueueReadiness | null;
  /** Names of the completeness categories that are MISSING (existing completeness report). */
  gaps: string[];
  updatedAt: Date;
}

export interface QueueSuggestionFacts {
  id: string;
  recordingId: string;
  suggestionType: string;
  targetEntityType: string;
  targetField: string | null;
  status: QueueSuggestionStatus;
  generationStatus: QueueGenerationStatus;
  freshness: ContentSuggestionFreshness;
  applied: boolean;
  reviewNote: string | null;
  reviewerName: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface QueueGenerationFacts {
  recordingId: string;
  /** An in-flight request (PENDING/GENERATING), if any. */
  activeStatus: "PENDING" | "GENERATING" | null;
  activeAt: Date | null;
  /** The Recording's most recent request, whatever its outcome. */
  latestStatus: QueueGenerationStatus | null;
  latestAt: Date | null;
}

export interface EditorialQueueRow {
  /** Stable React key / tie-breaker: `<state>:<suggestion id | recording id>`. */
  key: string;
  state: EditorialQueueState;
  recordingId: string;
  recordingTitle: string;
  youtubeTitle: string | null;
  suggestionId: string | null;
  suggestionType: string | null;
  targetField: string | null;
  suggestionStatus: QueueSuggestionStatus | null;
  freshness: ContentSuggestionFreshness | null;
  /** The generation request status relevant to this row (own request for a suggestion, latest/in-flight for a Recording). */
  generationStatus: QueueGenerationStatus | null;
  readiness: QueueReadiness | null;
  gaps: string[];
  reviewNote: string | null;
  reviewerName: string | null;
  reviewedAt: Date | null;
  lastUpdated: Date;
  actions: EditorialQueueAction[];
  /** Why the row's natural action is unavailable (e.g. a generation is already running). */
  blockedReason: string | null;
}

/** null = the suggestion is not in the queue (done, or nothing further can be done with it). */
export function deriveSuggestionQueueState(input: {
  status: QueueSuggestionStatus;
  freshness: ContentSuggestionFreshness;
  applied: boolean;
  suggestionType: string;
  targetEntityType: string;
  targetField: string | null;
}): EditorialQueueState | null {
  if (input.status === "REJECTED") return null;

  if (input.status === "APPROVED") {
    if (input.applied) return null;
    // Approved but not applicable to any Recording field (e.g. an information gap):
    // approval is its whole lifecycle, so there is nothing to wait for.
    if (!getApplicableTargetField(input)) return null;
  }

  if (input.freshness === "STALE") return "STALE";

  switch (input.status) {
    case "DRAFT_READY":
    case "EDITOR_REVIEW":
      return "AWAITING_REVIEW";
    case "CHANGES_REQUESTED":
      return "CHANGES_REQUESTED";
    case "APPROVED":
      return "APPROVED_AWAITING_APPLICATION";
  }
}

/** null = no Recording-level row. `hasOpenSuggestionRow` = the Recording already has a row of its own in a suggestion state. */
export function deriveRecordingQueueState(
  recording: Pick<QueueRecordingFacts, "status" | "currentPublishedRevisionId" | "hasEditorialProse">,
  generation: Pick<QueueGenerationFacts, "activeStatus" | "latestStatus"> | undefined,
  hasOpenSuggestionRow: boolean
): EditorialQueueState | null {
  if (recording.status === "ARCHIVED") return null;
  if (!isRecordingPublished(recording)) return "NEEDS_ENRICHMENT";

  if (generation?.activeStatus) return "GENERATION";
  if (hasOpenSuggestionRow) return null;
  if (generation?.latestStatus === "FAILED") return "GENERATION";
  if (!recording.hasEditorialProse) return "READY_FOR_GENERATION";
  return null;
}

export function assembleEditorialQueueRows(input: {
  recordings: QueueRecordingFacts[];
  suggestions: QueueSuggestionFacts[];
  generation: QueueGenerationFacts[];
}): EditorialQueueRow[] {
  const recordings = new Map(input.recordings.filter((r) => r.status !== "ARCHIVED").map((r) => [r.id, r]));
  const generation = new Map(input.generation.map((g) => [g.recordingId, g]));
  const rows: EditorialQueueRow[] = [];
  const recordingsWithSuggestionRow = new Set<string>();

  for (const suggestion of input.suggestions) {
    const recording = recordings.get(suggestion.recordingId);
    if (!recording || suggestion.targetEntityType !== "RECORDING") continue;

    const state = deriveSuggestionQueueState(suggestion);
    if (!state) continue;
    recordingsWithSuggestionRow.add(recording.id);

    const gen = generation.get(recording.id);
    const actions: EditorialQueueAction[] = [];
    let blockedReason: string | null = null;
    if (state === "APPROVED_AWAITING_APPLICATION") {
      actions.push("APPLY_SUGGESTION");
    } else {
      actions.push("REVIEW_SUGGESTION");
      if (state === "STALE") {
        // Offered only where the existing generation guard would allow it; never automatic.
        if (gen?.activeStatus) blockedReason = "A generation is already in progress for this Recording.";
        else if (isRecordingPublished(recording)) actions.push("REGENERATE");
      }
    }

    rows.push({
      key: `${state}:${suggestion.id}`,
      state,
      recordingId: recording.id,
      recordingTitle: recording.title,
      youtubeTitle: recording.youtubeTitle,
      suggestionId: suggestion.id,
      suggestionType: suggestion.suggestionType,
      targetField: suggestion.targetField,
      suggestionStatus: suggestion.status,
      freshness: suggestion.freshness,
      generationStatus: suggestion.generationStatus,
      readiness: recording.readiness,
      gaps: [],
      reviewNote: suggestion.reviewNote,
      reviewerName: suggestion.reviewerName,
      reviewedAt: suggestion.reviewedAt,
      lastUpdated: suggestion.updatedAt,
      actions,
      blockedReason,
    });
  }

  for (const recording of recordings.values()) {
    const gen = generation.get(recording.id);
    const state = deriveRecordingQueueState(recording, gen, recordingsWithSuggestionRow.has(recording.id));
    if (!state) continue;

    const actions: EditorialQueueAction[] = [];
    let blockedReason: string | null = null;
    let generationStatus: QueueGenerationStatus | null = gen?.latestStatus ?? null;
    let lastUpdated = recording.updatedAt;

    if (state === "NEEDS_ENRICHMENT") {
      actions.push("OPEN_RECORDING_EDITOR");
    } else if (state === "GENERATION") {
      if (gen?.activeStatus) {
        generationStatus = gen.activeStatus;
        lastUpdated = gen.activeAt ?? lastUpdated;
        blockedReason = "A generation is already in progress for this Recording.";
      } else {
        lastUpdated = gen?.latestAt ?? lastUpdated;
        actions.push("GENERATE");
      }
    } else {
      actions.push("GENERATE");
    }

    rows.push({
      key: `${state}:${recording.id}`,
      state,
      recordingId: recording.id,
      recordingTitle: recording.title,
      youtubeTitle: recording.youtubeTitle,
      suggestionId: null,
      suggestionType: null,
      targetField: null,
      suggestionStatus: null,
      freshness: null,
      generationStatus,
      readiness: recording.readiness,
      gaps: recording.gaps,
      reviewNote: null,
      reviewerName: null,
      reviewedAt: null,
      lastUpdated,
      actions,
      blockedReason,
    });
  }

  return rows;
}

export const EDITORIAL_QUEUE_DEFAULT_PAGE_SIZE = 20;
export const EDITORIAL_QUEUE_MAX_PAGE_SIZE = 100;

export interface EditorialQueueQuery {
  state?: EditorialQueueState;
  /** Case-insensitive substring of the Recording title. */
  recordingTitle?: string;
  /** Case-insensitive substring of the primary YouTube video title. */
  youtubeTitle?: string;
  targetField?: string;
  page?: number;
  pageSize?: number;
}

export interface EditorialQueuePage {
  /** Per-state totals over the WHOLE queue — unaffected by the filters, so they read as a summary. */
  counts: Record<EditorialQueueState, number>;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  rows: EditorialQueueRow[];
}

function normalise(value: string | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

function compareRows(a: EditorialQueueRow, b: EditorialQueueRow): number {
  if (a.state !== b.state) return LIST_PRIORITY[a.state] - LIST_PRIORITY[b.state];
  const delta = a.lastUpdated.getTime() - b.lastUpdated.getTime();
  if (delta !== 0) return OLDEST_FIRST.has(a.state) ? delta : -delta;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

export function queryEditorialQueue(allRows: EditorialQueueRow[], query: EditorialQueueQuery = {}): EditorialQueuePage {
  const counts = Object.fromEntries(EDITORIAL_QUEUE_STATES.map((s) => [s, 0])) as Record<EditorialQueueState, number>;
  for (const row of allRows) counts[row.state] += 1;

  const title = normalise(query.recordingTitle);
  const youtube = normalise(query.youtubeTitle);
  const field = query.targetField?.trim() || null;

  const filtered = allRows
    .filter((row) => !query.state || row.state === query.state)
    .filter((row) => !title || row.recordingTitle.toLowerCase().includes(title))
    .filter((row) => !youtube || (row.youtubeTitle?.toLowerCase().includes(youtube) ?? false))
    .filter((row) => !field || row.targetField === field)
    .sort(compareRows);

  const pageSize = Math.min(Math.max(Math.trunc(query.pageSize ?? EDITORIAL_QUEUE_DEFAULT_PAGE_SIZE) || EDITORIAL_QUEUE_DEFAULT_PAGE_SIZE, 1), EDITORIAL_QUEUE_MAX_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(Math.max(Math.trunc(query.page ?? 1) || 1, 1), totalPages);

  return {
    counts,
    total: filtered.length,
    page,
    pageSize,
    totalPages,
    rows: filtered.slice((page - 1) * pageSize, page * pageSize),
  };
}
