import { describe, expect, it } from "vitest";
import {
  EDITORIAL_QUEUE_DEFAULT_PAGE_SIZE,
  EDITORIAL_QUEUE_EMPTY_MESSAGES,
  EDITORIAL_QUEUE_STATES,
  EDITORIAL_QUEUE_STATE_LABELS,
  assembleEditorialQueueRows,
  deriveRecordingQueueState,
  deriveSuggestionQueueState,
  isEditorialQueueState,
  queryEditorialQueue,
  type EditorialQueueRow,
  type QueueGenerationFacts,
  type QueueRecordingFacts,
  type QueueSuggestionFacts,
} from "../../modules/mmke/contentIntelligence/editorialOperationsQueue";
import { deriveContentSuggestionFreshness } from "../../modules/mmke/contentIntelligence/deriveContentSuggestionFreshness";

// Phase 6I-3 — pure, database-free tests of the Editorial Operations Queue's
// derivation rules. The queue is a view over existing state, so every rule is
// a function of plain facts.

const T0 = new Date("2026-01-01T00:00:00Z");
const at = (days: number) => new Date(T0.getTime() + days * 86_400_000);

function recording(over: Partial<QueueRecordingFacts> = {}): QueueRecordingFacts {
  return {
    id: "rec-1",
    status: "PUBLISHED",
    currentPublishedRevisionId: "rev-1",
    title: "Handel: Messiah",
    youtubeTitle: "Messiah live",
    hasEditorialProse: false,
    readiness: "READY_FOR_REVIEW",
    gaps: ["Venue"],
    updatedAt: at(1),
    ...over,
  };
}

function suggestion(over: Partial<QueueSuggestionFacts> = {}): QueueSuggestionFacts {
  return {
    id: "sug-1",
    recordingId: "rec-1",
    suggestionType: "EDITORIAL_PROSE",
    targetEntityType: "RECORDING",
    targetField: "description",
    status: "DRAFT_READY",
    generationStatus: "SUCCEEDED",
    freshness: "CURRENT",
    applied: false,
    reviewNote: null,
    reviewerName: null,
    reviewedAt: null,
    createdAt: at(1),
    updatedAt: at(1),
    ...over,
  };
}

const NO_GEN: QueueGenerationFacts[] = [];

function rowsFor(input: { recordings?: QueueRecordingFacts[]; suggestions?: QueueSuggestionFacts[]; generation?: QueueGenerationFacts[] }) {
  return assembleEditorialQueueRows({ recordings: input.recordings ?? [], suggestions: input.suggestions ?? [], generation: input.generation ?? NO_GEN });
}

describe("queue vocabulary", () => {
  it("has exactly the seven states, each with a label and an empty-state message", () => {
    expect([...EDITORIAL_QUEUE_STATES]).toEqual([
      "NEEDS_ENRICHMENT",
      "READY_FOR_GENERATION",
      "GENERATION",
      "AWAITING_REVIEW",
      "CHANGES_REQUESTED",
      "STALE",
      "APPROVED_AWAITING_APPLICATION",
    ]);
    for (const state of EDITORIAL_QUEUE_STATES) {
      expect(EDITORIAL_QUEUE_STATE_LABELS[state].length).toBeGreaterThan(3);
      expect(EDITORIAL_QUEUE_EMPTY_MESSAGES[state].length).toBeGreaterThan(10);
    }
  });

  it("validates a state parameter (anything else is not a state)", () => {
    expect(isEditorialQueueState("STALE")).toBe(true);
    expect(isEditorialQueueState("stale")).toBe(false);
    expect(isEditorialQueueState("PUBLISHED")).toBe(false);
    expect(isEditorialQueueState(undefined)).toBe(false);
  });
});

describe("deriveContentSuggestionFreshness (shared with the per-suggestion check)", () => {
  it("is UNKNOWN without a stored or current fingerprint, CURRENT when equal, STALE when different", () => {
    expect(deriveContentSuggestionFreshness(null, "a")).toBe("UNKNOWN");
    expect(deriveContentSuggestionFreshness("a", null)).toBe("UNKNOWN");
    expect(deriveContentSuggestionFreshness("a", "a")).toBe("CURRENT");
    expect(deriveContentSuggestionFreshness("a", "b")).toBe("STALE");
  });
});

describe("deriveSuggestionQueueState", () => {
  const base = { freshness: "CURRENT" as const, applied: false, suggestionType: "EDITORIAL_PROSE", targetEntityType: "RECORDING", targetField: "description" };

  it("DRAFT_READY and EDITOR_REVIEW are AWAITING_REVIEW", () => {
    expect(deriveSuggestionQueueState({ ...base, status: "DRAFT_READY" })).toBe("AWAITING_REVIEW");
    expect(deriveSuggestionQueueState({ ...base, status: "EDITOR_REVIEW" })).toBe("AWAITING_REVIEW");
  });

  it("CHANGES_REQUESTED is its own state", () => {
    expect(deriveSuggestionQueueState({ ...base, status: "CHANGES_REQUESTED" })).toBe("CHANGES_REQUESTED");
  });

  it("an APPROVED, applicable, unapplied suggestion awaits application", () => {
    expect(deriveSuggestionQueueState({ ...base, status: "APPROVED" })).toBe("APPROVED_AWAITING_APPLICATION");
  });

  it("an APPROVED suggestion that was already applied leaves the queue", () => {
    expect(deriveSuggestionQueueState({ ...base, status: "APPROVED", applied: true })).toBeNull();
  });

  it("an APPROVED suggestion with nothing to apply (no whitelisted field / not prose) leaves the queue", () => {
    expect(deriveSuggestionQueueState({ ...base, status: "APPROVED", suggestionType: "INFORMATION_GAP", targetField: null })).toBeNull();
    expect(deriveSuggestionQueueState({ ...base, status: "APPROVED", targetField: "title" })).toBeNull();
    expect(deriveSuggestionQueueState({ ...base, status: "APPROVED", targetEntityType: "COMPOSER" })).toBeNull();
  });

  it("a REJECTED suggestion is never in the queue", () => {
    expect(deriveSuggestionQueueState({ ...base, status: "REJECTED" })).toBeNull();
    expect(deriveSuggestionQueueState({ ...base, status: "REJECTED", freshness: "STALE" })).toBeNull();
  });

  it("is STALE only when freshness is STALE — CURRENT and UNKNOWN keep the base state", () => {
    expect(deriveSuggestionQueueState({ ...base, status: "EDITOR_REVIEW", freshness: "STALE" })).toBe("STALE");
    expect(deriveSuggestionQueueState({ ...base, status: "CHANGES_REQUESTED", freshness: "STALE" })).toBe("STALE");
    expect(deriveSuggestionQueueState({ ...base, status: "APPROVED", freshness: "STALE" })).toBe("STALE");
    expect(deriveSuggestionQueueState({ ...base, status: "EDITOR_REVIEW", freshness: "UNKNOWN" })).toBe("AWAITING_REVIEW");
    expect(deriveSuggestionQueueState({ ...base, status: "APPROVED", freshness: "UNKNOWN" })).toBe("APPROVED_AWAITING_APPLICATION");
  });

  it("an applied suggestion is out even if it is now stale (applying changed the context)", () => {
    expect(deriveSuggestionQueueState({ ...base, status: "APPROVED", applied: true, freshness: "STALE" })).toBeNull();
  });
});

describe("deriveRecordingQueueState", () => {
  const published = { status: "PUBLISHED" as const, currentPublishedRevisionId: "rev-1", hasEditorialProse: false };

  it("a Recording that is not published needs enrichment (it is not eligible for generation)", () => {
    expect(deriveRecordingQueueState({ status: "DRAFT", currentPublishedRevisionId: null, hasEditorialProse: false }, undefined, false)).toBe("NEEDS_ENRICHMENT");
    expect(deriveRecordingQueueState({ status: "IN_REVIEW", currentPublishedRevisionId: null, hasEditorialProse: true }, undefined, false)).toBe("NEEDS_ENRICHMENT");
  });

  it("an archived Recording has no row", () => {
    expect(deriveRecordingQueueState({ status: "ARCHIVED", currentPublishedRevisionId: "rev-1", hasEditorialProse: false }, undefined, false)).toBeNull();
  });

  it("a published Recording with no prose, no open suggestion and no generation is READY_FOR_GENERATION", () => {
    expect(deriveRecordingQueueState(published, undefined, false)).toBe("READY_FOR_GENERATION");
    expect(deriveRecordingQueueState(published, { activeStatus: null, latestStatus: "SUCCEEDED" }, false)).toBe("READY_FOR_GENERATION");
  });

  it("a published Recording that already has editorial prose has no row", () => {
    expect(deriveRecordingQueueState({ ...published, hasEditorialProse: true }, undefined, false)).toBeNull();
  });

  it("an open suggestion suppresses the Recording-level READY row (the suggestion is the work item)", () => {
    expect(deriveRecordingQueueState(published, undefined, true)).toBeNull();
  });

  it("a PENDING/GENERATING request is GENERATION even if the Recording also has a suggestion row", () => {
    expect(deriveRecordingQueueState(published, { activeStatus: "PENDING", latestStatus: "PENDING" }, false)).toBe("GENERATION");
    expect(deriveRecordingQueueState(published, { activeStatus: "GENERATING", latestStatus: "GENERATING" }, true)).toBe("GENERATION");
  });

  it("a FAILED latest request is GENERATION until superseded", () => {
    expect(deriveRecordingQueueState(published, { activeStatus: null, latestStatus: "FAILED" }, false)).toBe("GENERATION");
    expect(deriveRecordingQueueState({ ...published, hasEditorialProse: true }, { activeStatus: null, latestStatus: "FAILED" }, false)).toBe("GENERATION");
  });
});

describe("assembleEditorialQueueRows", () => {
  it("builds a NEEDS_ENRICHMENT row with gaps, readiness and an open-in-editor action only", () => {
    const [row] = rowsFor({ recordings: [recording({ status: "DRAFT", currentPublishedRevisionId: null, readiness: "INCOMPLETE", gaps: ["Musical Works", "Media"] })] });
    expect(row.state).toBe("NEEDS_ENRICHMENT");
    expect(row.gaps).toEqual(["Musical Works", "Media"]);
    expect(row.readiness).toBe("INCOMPLETE");
    expect(row.actions).toEqual(["OPEN_RECORDING_EDITOR"]);
    expect(row.suggestionId).toBeNull();
  });

  it("builds a READY_FOR_GENERATION row whose only action is an explicit Generate", () => {
    const [row] = rowsFor({ recordings: [recording()], generation: [{ recordingId: "rec-1", activeStatus: null, activeAt: null, latestStatus: "SUCCEEDED", latestAt: at(2) }] });
    expect(row.state).toBe("READY_FOR_GENERATION");
    expect(row.actions).toEqual(["GENERATE"]);
    expect(row.generationStatus).toBe("SUCCEEDED");
    expect(row.youtubeTitle).toBe("Messiah live");
  });

  it("an in-flight generation row offers no Generate action and says why", () => {
    const [row] = rowsFor({ recordings: [recording()], generation: [{ recordingId: "rec-1", activeStatus: "GENERATING", activeAt: at(3), latestStatus: "GENERATING", latestAt: at(3) }] });
    expect(row.state).toBe("GENERATION");
    expect(row.generationStatus).toBe("GENERATING");
    expect(row.actions).toEqual([]);
    expect(row.blockedReason).toMatch(/already in progress/);
    expect(row.lastUpdated).toEqual(at(3));
  });

  it("a FAILED generation row offers an explicit retry", () => {
    const [row] = rowsFor({ recordings: [recording()], generation: [{ recordingId: "rec-1", activeStatus: null, activeAt: null, latestStatus: "FAILED", latestAt: at(4) }] });
    expect(row.state).toBe("GENERATION");
    expect(row.generationStatus).toBe("FAILED");
    expect(row.actions).toEqual(["GENERATE"]);
  });

  it("builds an AWAITING_REVIEW suggestion row with target field, status, freshness and a review action", () => {
    const rows = rowsFor({ recordings: [recording()], suggestions: [suggestion({ status: "EDITOR_REVIEW" })] });
    expect(rows).toHaveLength(1); // the suggestion suppresses the READY row
    const [row] = rows;
    expect(row.state).toBe("AWAITING_REVIEW");
    expect(row.targetField).toBe("description");
    expect(row.suggestionStatus).toBe("EDITOR_REVIEW");
    expect(row.freshness).toBe("CURRENT");
    expect(row.recordingTitle).toBe("Handel: Messiah");
    expect(row.actions).toEqual(["REVIEW_SUGGESTION"]);
  });

  it("a CHANGES_REQUESTED row carries the review note, reviewer and date", () => {
    const [row] = rowsFor({
      recordings: [recording()],
      suggestions: [suggestion({ status: "CHANGES_REQUESTED", reviewNote: "Cite the source.", reviewerName: "Asha", reviewedAt: at(5) })],
    });
    expect(row.state).toBe("CHANGES_REQUESTED");
    expect(row.reviewNote).toBe("Cite the source.");
    expect(row.reviewerName).toBe("Asha");
    expect(row.reviewedAt).toEqual(at(5));
  });

  it("a STALE row offers Review and an explicit Regenerate — but no Regenerate while a generation is in flight", () => {
    const stale = suggestion({ status: "EDITOR_REVIEW", freshness: "STALE" });
    const [row] = rowsFor({ recordings: [recording()], suggestions: [stale] });
    expect(row.state).toBe("STALE");
    expect(row.actions).toEqual(["REVIEW_SUGGESTION", "REGENERATE"]);

    const blocked = rowsFor({
      recordings: [recording()],
      suggestions: [stale],
      generation: [{ recordingId: "rec-1", activeStatus: "PENDING", activeAt: at(2), latestStatus: "PENDING", latestAt: at(2) }],
    }).find((r) => r.state === "STALE")!;
    expect(blocked.actions).toEqual(["REVIEW_SUGGESTION"]);
    expect(blocked.blockedReason).toMatch(/already in progress/);
  });

  it("an APPROVED row links to application", () => {
    const [row] = rowsFor({ recordings: [recording()], suggestions: [suggestion({ status: "APPROVED" })] });
    expect(row.state).toBe("APPROVED_AWAITING_APPLICATION");
    expect(row.actions).toEqual(["APPLY_SUGGESTION"]);
  });

  it("one Recording can have several rows (one per open suggestion)", () => {
    const rows = rowsFor({
      recordings: [recording()],
      suggestions: [suggestion({ id: "a", status: "DRAFT_READY" }), suggestion({ id: "b", status: "APPROVED", targetField: "seoMetaTitle" })],
    });
    expect(rows.map((r) => r.state).sort()).toEqual(["APPROVED_AWAITING_APPLICATION", "AWAITING_REVIEW"]);
  });

  it("ignores suggestions for archived or unknown Recordings and for non-Recording targets", () => {
    const rows = rowsFor({
      recordings: [recording({ id: "arch", status: "ARCHIVED" })],
      suggestions: [suggestion({ recordingId: "arch" }), suggestion({ id: "x", recordingId: "missing" }), suggestion({ id: "y", targetEntityType: "COMPOSER" })],
    });
    expect(rows).toEqual([]);
  });

  it("never exposes a raw id as a title — the row carries the resolved title", () => {
    const [row] = rowsFor({ recordings: [recording({ id: "6f1d2c9e-aaaa-bbbb-cccc-000000000001" })], suggestions: [suggestion({ recordingId: "6f1d2c9e-aaaa-bbbb-cccc-000000000001" })] });
    expect(row.recordingTitle).toBe("Handel: Messiah");
    expect(row.recordingTitle).not.toContain("6f1d2c9e");
  });
});

describe("queryEditorialQueue — counts, filters, ordering, pagination", () => {
  function row(over: Partial<EditorialQueueRow>): EditorialQueueRow {
    return {
      key: `${over.state ?? "AWAITING_REVIEW"}:${over.recordingId ?? "r"}`,
      state: "AWAITING_REVIEW",
      recordingId: "r",
      recordingTitle: "Title",
      youtubeTitle: null,
      suggestionId: null,
      suggestionType: null,
      targetField: null,
      suggestionStatus: null,
      freshness: null,
      generationStatus: null,
      readiness: null,
      gaps: [],
      reviewNote: null,
      reviewerName: null,
      reviewedAt: null,
      lastUpdated: at(0),
      actions: [],
      blockedReason: null,
      ...over,
    };
  }

  const sample: EditorialQueueRow[] = [
    row({ recordingId: "1", state: "AWAITING_REVIEW", recordingTitle: "Handel: Messiah", youtubeTitle: "Messiah — live in Chennai", targetField: "description", lastUpdated: at(3) }),
    row({ recordingId: "2", state: "AWAITING_REVIEW", recordingTitle: "Bach: Mass in B minor", youtubeTitle: "Bach Mass", targetField: "seoMetaTitle", lastUpdated: at(1) }),
    row({ recordingId: "3", state: "STALE", recordingTitle: "Handel: Water Music", youtubeTitle: null, targetField: "description", lastUpdated: at(2) }),
    row({ recordingId: "4", state: "READY_FOR_GENERATION", recordingTitle: "Vivaldi: Gloria", lastUpdated: at(1) }),
    row({ recordingId: "5", state: "READY_FOR_GENERATION", recordingTitle: "Mozart: Requiem", lastUpdated: at(5) }),
    row({ recordingId: "6", state: "NEEDS_ENRICHMENT", recordingTitle: "Untitled", lastUpdated: at(4) }),
  ];

  it("counts every state over the whole queue, including zero, regardless of filters", () => {
    const all = queryEditorialQueue(sample);
    expect(all.counts).toEqual({
      NEEDS_ENRICHMENT: 1,
      READY_FOR_GENERATION: 2,
      GENERATION: 0,
      AWAITING_REVIEW: 2,
      CHANGES_REQUESTED: 0,
      STALE: 1,
      APPROVED_AWAITING_APPLICATION: 0,
    });
    const filtered = queryEditorialQueue(sample, { state: "STALE", recordingTitle: "handel" });
    expect(filtered.counts).toEqual(all.counts);
    expect(filtered.total).toBe(1);
  });

  it("filters by state", () => {
    expect(queryEditorialQueue(sample, { state: "READY_FOR_GENERATION" }).rows.map((r) => r.recordingId).sort()).toEqual(["4", "5"]);
    expect(queryEditorialQueue(sample, { state: "GENERATION" }).total).toBe(0);
  });

  it("searches the Recording title, case-insensitively, as a substring", () => {
    expect(queryEditorialQueue(sample, { recordingTitle: "HANDEL" }).rows.map((r) => r.recordingId).sort()).toEqual(["1", "3"]);
    expect(queryEditorialQueue(sample, { recordingTitle: "  mass " }).rows.map((r) => r.recordingId)).toEqual(["2"]);
  });

  it("searches the YouTube title separately — a Recording with no YouTube title never matches", () => {
    expect(queryEditorialQueue(sample, { youtubeTitle: "chennai" }).rows.map((r) => r.recordingId)).toEqual(["1"]);
    expect(queryEditorialQueue(sample, { youtubeTitle: "handel" }).total).toBe(0); // "handel" is only in Recording titles
  });

  it("filters by target field (Recording-level rows have none, so they drop out)", () => {
    expect(queryEditorialQueue(sample, { targetField: "description" }).rows.map((r) => r.recordingId).sort()).toEqual(["1", "3"]);
    expect(queryEditorialQueue(sample, { targetField: "seoMetaTitle" }).rows.map((r) => r.recordingId)).toEqual(["2"]);
  });

  it("combines filters (AND)", () => {
    expect(queryEditorialQueue(sample, { state: "AWAITING_REVIEW", recordingTitle: "handel", targetField: "description" }).rows.map((r) => r.recordingId)).toEqual(["1"]);
    expect(queryEditorialQueue(sample, { state: "STALE", recordingTitle: "bach" }).total).toBe(0);
  });

  it("orders human-attention queues oldest-first and generation/enrichment queues newest-first", () => {
    expect(queryEditorialQueue(sample, { state: "AWAITING_REVIEW" }).rows.map((r) => r.recordingId)).toEqual(["2", "1"]); // at(1) before at(3)
    expect(queryEditorialQueue(sample, { state: "READY_FOR_GENERATION" }).rows.map((r) => r.recordingId)).toEqual(["5", "4"]); // at(5) before at(1)
  });

  it("with no state selected, lists human-attention work before generation and enrichment", () => {
    expect(queryEditorialQueue(sample).rows.map((r) => r.state)).toEqual([
      "AWAITING_REVIEW",
      "AWAITING_REVIEW",
      "STALE",
      "READY_FOR_GENERATION",
      "READY_FOR_GENERATION",
      "NEEDS_ENRICHMENT",
    ]);
  });

  it("is deterministic: equal timestamps tie-break on the stable key, whatever the input order", () => {
    const same = [row({ recordingId: "b", lastUpdated: at(1) }), row({ recordingId: "a", lastUpdated: at(1) }), row({ recordingId: "c", lastUpdated: at(1) })];
    const forward = queryEditorialQueue(same).rows.map((r) => r.recordingId);
    const reversed = queryEditorialQueue([...same].reverse()).rows.map((r) => r.recordingId);
    expect(forward).toEqual(["a", "b", "c"]);
    expect(reversed).toEqual(forward);
  });

  it("paginates server-side with a default page size of 20", () => {
    const many = Array.from({ length: 45 }, (_, i) => row({ recordingId: `r${String(i).padStart(2, "0")}`, lastUpdated: at(i) }));
    const first = queryEditorialQueue(many);
    expect(EDITORIAL_QUEUE_DEFAULT_PAGE_SIZE).toBe(20);
    expect(first.pageSize).toBe(20);
    expect(first.rows).toHaveLength(20);
    expect(first.total).toBe(45);
    expect(first.totalPages).toBe(3);
    expect(queryEditorialQueue(many, { page: 3 }).rows).toHaveLength(5);

    const seen = [1, 2, 3].flatMap((page) => queryEditorialQueue(many, { page }).rows.map((r) => r.recordingId));
    expect(new Set(seen).size).toBe(45);
    expect(seen).toEqual(queryEditorialQueue(many, { pageSize: 100 }).rows.map((r) => r.recordingId));
  });

  it("clamps out-of-range and nonsense page numbers and sizes instead of failing", () => {
    const many = Array.from({ length: 45 }, (_, i) => row({ recordingId: `r${i}`, lastUpdated: at(i) }));
    expect(queryEditorialQueue(many, { page: 99 }).page).toBe(3);
    expect(queryEditorialQueue(many, { page: -4 }).page).toBe(1);
    expect(queryEditorialQueue(many, { page: Number.NaN }).page).toBe(1);
    expect(queryEditorialQueue(many, { pageSize: 0 }).pageSize).toBe(20);
    expect(queryEditorialQueue(many, { pageSize: 100000 }).pageSize).toBe(100);
  });

  it("an empty queue is one empty page", () => {
    const empty = queryEditorialQueue([]);
    expect(empty).toMatchObject({ total: 0, page: 1, totalPages: 1, rows: [] });
    expect(Object.values(empty.counts).every((n) => n === 0)).toBe(true);
  });
});
