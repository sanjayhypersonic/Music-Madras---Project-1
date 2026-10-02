import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

// Must be at the true top level — vi.mock/vi.hoisted run above every import.
const mockGetCurrentStudioSession = vi.fn();
const { mockCan } = vi.hoisted(() => ({ mockCan: vi.fn() }));
vi.mock("../../modules/auth/authService", () => ({
  getCurrentStudioSession: () => mockGetCurrentStudioSession(),
}));
vi.mock("../../modules/auth/policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../modules/auth/policy")>();
  mockCan.mockImplementation(actual.can);
  return { ...actual, can: mockCan };
});

// An instrumented Prisma client so the "no N+1" test can COUNT the SQL the
// queue issues. It replaces the shared client for this file only.
const { instrumented, queries } = await vi.hoisted(async () => {
  (await import("dotenv")).config();
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { PrismaClient } = await import("@prisma/client");
  const log: string[] = [];
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }), log: [{ emit: "event", level: "query" }] });
  (client as unknown as { $on: (event: string, cb: (e: { query: string }) => void) => void }).$on("query", (e) => log.push(e.query));
  return { instrumented: client, queries: log };
});
vi.mock("../../modules/db/client", () => ({ prisma: instrumented }));

import { prisma } from "../../modules/db/client";
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import { archiveRecording, attachWorkToRevision, publishCurrentDraft } from "../../modules/db/repositories/recordingRepository";
import { createRecordingFromYouTubeVideo } from "../../modules/db/repositories/recordingIntakeRepository";
import { generateRecordingEditorialSuggestion } from "../../modules/ai/gateway/generateRecordingEditorialSuggestion";
import { FakeAIProvider } from "../../modules/ai/providers/fake/fakeAIProvider";
import {
  approveContentSuggestion,
  checkContentSuggestionFreshness,
  createGenerationRequest,
  rejectContentSuggestion,
  requestContentSuggestionChanges,
  submitSuggestionForReview,
} from "../../modules/db/repositories/contentSuggestionRepository";
import { applyApprovedContentSuggestion } from "../../modules/db/repositories/contentSuggestionApplicationRepository";
import {
  getEditorialOperationsQueue,
  getRecordingDisplayTitles,
  listEditorialQueueRows,
} from "../../modules/db/repositories/editorialQueueRepository";
import { EDITORIAL_QUEUE_STATES, type EditorialQueueRow } from "../../modules/mmke/contentIntelligence/editorialOperationsQueue";
import { generateEditorialSuggestionAction } from "../../app/(studio)/studio/(protected)/content-suggestions/generateAction";
import { applyToRecordingDraftAction, approveAction } from "../../app/(studio)/studio/(protected)/content-suggestions/[id]/actions";

// Phase 6I-3 — the Editorial Operations Queue against a real database. One
// shared "world" of disposable Recordings, built through the real paths (6I-1
// intake -> Work -> publish -> generation with the FAKE provider only), puts a
// row of every state in the queue. Assertions are scoped to this file's own
// records — every title carries a per-run token — never global counts.

const TAG = "phase6i3";
const TOKEN = randomUUID().slice(0, 8);
const T = 120000;
const GUIDE = "educationalListeningGuide";

let userIds: string[] = [];
let videoIds: string[] = [];
let composerIds: string[] = [];
let recordingIds: string[] = [];

interface World {
  editor: { id: string };
  contributor: { id: string };
  enrich: Rec;
  ready: Rec;
  genActive: Rec;
  genFailed: Rec;
  review: Rec & { a: Sug; b: Sug };
  changes: Rec & { s: Sug };
  approved: Rec & { open: Sug; applied: Sug };
  stale: Rec & { s: Sug };
  done: Rec;
  archived: Rec;
}
interface Rec {
  id: string;
  slug: string;
  workId: string | null;
  publishedRevisionId: string | null;
  videoTitle: string;
}
interface Sug {
  id: string;
}
let W: World;

async function createUser(role: "EDITOR" | "CONTRIBUTOR") {
  const user = await prisma.studioUser.create({
    data: { id: randomUUID(), email: `${randomUUID()}-${TAG}-integration-test@musicmadras.test`, name: `Phase 6I-3 ${role}`, role, status: "ACTIVE" },
  });
  userIds.push(user.id);
  return user;
}

async function makeRecording(label: string, actorId: string, options: { publish: boolean }): Promise<Rec> {
  const videoTitle = `Phase6i3 ${TOKEN} ${label}`;
  const video = await prisma.youTubeVideo.create({
    data: { youtubeVideoId: `${TAG}-${TOKEN}-${label}`, title: videoTitle, description: `Recorded live (${label}).`, privacyStatus: "public", observabilityState: "OBSERVED" },
  });
  videoIds.push(video.id);

  const intake = await createRecordingFromYouTubeVideo({ youtubeVideoId: video.id, actorId });
  if (!intake.ok) throw new Error(`intake failed for ${label}`);
  recordingIds.push(intake.recording.id);
  if (!options.publish) {
    return { id: intake.recording.id, slug: intake.recording.slug, workId: null, publishedRevisionId: null, videoTitle };
  }

  const composer = await createComposer({ slug: `${TAG}-composer-${TOKEN}-${label}`, name: `Queue Composer ${TOKEN} ${label}`, actorId });
  composerIds.push(composer.id);
  const work = await createMusicalWork({ slug: `${TAG}-work-${TOKEN}-${label}`, title: `Queue Work ${TOKEN} ${label}`, composerId: composer.id, actorId });
  await attachWorkToRevision(intake.recording.currentDraftRevision!.id, work.id, actorId);
  const published = await publishCurrentDraft(intake.recording.id, actorId);
  return { id: published.id, slug: published.slug, workId: work.id, publishedRevisionId: published.currentPublishedRevisionId!, videoTitle };
}

async function generate(rec: Rec, actorId: string, targetField: string, content: string): Promise<Sug> {
  const result = await generateRecordingEditorialSuggestion({
    recordingId: rec.id,
    requestedById: actorId,
    provider: new FakeAIProvider({
      mode: "SUCCESS",
      output: { outputType: "SUGGESTION", proposedContent: content, targetField, evidenceEntityIds: [rec.workId], missingField: null, whyItMatters: null, requestedAction: null },
    }),
  });
  if (!result.ok) throw new Error(`generation failed: ${result.reason}`);
  return { id: result.suggestion.id };
}

async function cleanup() {
  if (recordingIds.length > 0) {
    const suggestionIds = (await prisma.contentSuggestion.findMany({ where: { targetEntityId: { in: recordingIds } }, select: { id: true } })).map((s) => s.id);
    const requestIds = (await prisma.contentGenerationRequest.findMany({ where: { targetEntityId: { in: recordingIds } }, select: { id: true } })).map((r) => r.id);
    if (suggestionIds.length > 0) await prisma.auditLogEntry.deleteMany({ where: { entityType: "ContentSuggestion", entityId: { in: suggestionIds } } });
    if (requestIds.length > 0) await prisma.auditLogEntry.deleteMany({ where: { entityType: "ContentGenerationRequest", entityId: { in: requestIds } } });
    await prisma.contentSuggestion.deleteMany({ where: { targetEntityId: { in: recordingIds } } });
    await prisma.contentGenerationRequest.deleteMany({ where: { targetEntityId: { in: recordingIds } } });
    const revisions = await prisma.recordingRevision.findMany({ where: { recordingId: { in: recordingIds } }, select: { id: true } });
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "Recording", entityId: { in: recordingIds } } });
    if (revisions.length > 0) await prisma.auditLogEntry.deleteMany({ where: { entityType: "RecordingRevision", entityId: { in: revisions.map((r) => r.id) } } });
    await prisma.recording.deleteMany({ where: { id: { in: recordingIds } } });
  }
  if (composerIds.length > 0) {
    const works = await prisma.musicalWork.findMany({ where: { composerId: { in: composerIds } }, select: { id: true } });
    if (works.length > 0) {
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "MusicalWork", entityId: { in: works.map((w) => w.id) } } });
      await prisma.musicalWork.deleteMany({ where: { composerId: { in: composerIds } } });
    }
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "Composer", entityId: { in: composerIds } } });
    await prisma.composer.deleteMany({ where: { id: { in: composerIds } } });
  }
  if (videoIds.length > 0) await prisma.youTubeVideo.deleteMany({ where: { id: { in: videoIds } } });
  if (userIds.length > 0) await prisma.studioUser.deleteMany({ where: { id: { in: userIds } } });
  userIds = [];
  videoIds = [];
  composerIds = [];
  recordingIds = [];
}

function extractRedirectPath(err: unknown): string {
  if (typeof err === "object" && err !== null && "digest" in err) {
    const digest = (err as { digest: unknown }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) return digest.split(";").slice(2, -2).join(";");
  }
  throw err;
}

async function redirectOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    return extractRedirectPath(err);
  }
  throw new Error("Action did not redirect");
}

function signIn(user: { id: string }, role: "EDITOR" | "CONTRIBUTOR") {
  mockGetCurrentStudioSession.mockResolvedValue({ user: { id: user.id, role } });
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

/** This file's own rows only (every title carries the run token). */
async function myRows(extra: Partial<Parameters<typeof getEditorialOperationsQueue>[0]> = {}) {
  return getEditorialOperationsQueue({ recordingTitle: TOKEN, pageSize: 100, ...extra });
}

const rowsOf = (rows: EditorialQueueRow[], recordingId: string) => rows.filter((r) => r.recordingId === recordingId);

beforeAll(async () => {
  const editor = await createUser("EDITOR");
  const contributor = await createUser("CONTRIBUTOR");

  const enrich = await makeRecording("enrich", editor.id, { publish: false });
  const ready = await makeRecording("ready", editor.id, { publish: true });
  const genActive = await makeRecording("genactive", editor.id, { publish: true });
  const genFailed = await makeRecording("genfailed", editor.id, { publish: true });
  const review = await makeRecording("review", editor.id, { publish: true });
  const changes = await makeRecording("changes", editor.id, { publish: true });
  const approved = await makeRecording("approved", editor.id, { publish: true });
  const stale = await makeRecording("stale", editor.id, { publish: true });
  const done = await makeRecording("done", editor.id, { publish: true });
  const archived = await makeRecording("archived", editor.id, { publish: true });

  // GENERATION: one in flight (PENDING), one that FAILED through the real gateway path.
  await createGenerationRequest({ targetEntityType: "RECORDING", targetEntityId: genActive.id, suggestionType: "EDITORIAL_PROSE", requestedById: editor.id });
  await generateRecordingEditorialSuggestion({ recordingId: genFailed.id, requestedById: editor.id, provider: new FakeAIProvider({ mode: "PROVIDER_ERROR" }) });

  // AWAITING_REVIEW: one DRAFT_READY, one EDITOR_REVIEW. Retitled so the Recording
  // title and the YouTube video title differ (search must tell them apart).
  await prisma.recordingRevision.update({ where: { id: review.publishedRevisionId! }, data: { title: `Handel Messiah ${TOKEN}` } });
  const reviewA = await generate(review, editor.id, "description", "A description awaiting its first review.");
  const reviewB = await generate(review, editor.id, "seoMetaTitle", "SEO title proposal");
  await submitSuggestionForReview(reviewB.id, editor.id);

  // CHANGES_REQUESTED
  const changesS = await generate(changes, editor.id, "educationalAnalysis", "An analysis that needs a citation.");
  await submitSuggestionForReview(changesS.id, editor.id);
  await requestContentSuggestionChanges(changesS.id, editor.id, "Please cite the source.");

  // APPROVED: one still awaiting application, one already applied (leaves the queue).
  const open = await generate(approved, editor.id, GUIDE, "A listening guide awaiting application.");
  const applied = await generate(approved, editor.id, "description", "A description that will be applied.");
  for (const s of [open, applied]) {
    await submitSuggestionForReview(s.id, editor.id);
    await approveContentSuggestion(s.id, editor.id, {});
  }
  const applyResult = await applyApprovedContentSuggestion({ suggestionId: applied.id, actorId: editor.id });
  if (!applyResult.ok) throw new Error(`fixture apply failed: ${applyResult.reason}`);

  // STALE: generated, then the published context changes underneath it.
  const staleS = await generate(stale, editor.id, "description", "A description generated before the context changed.");
  await prisma.recordingRevision.update({ where: { id: stale.publishedRevisionId! }, data: { description: "The published description changed after generation." } });

  // DONE: has editorial prose, and only terminal suggestions (rejected; an approved information gap).
  await prisma.recordingRevision.update({ where: { id: done.publishedRevisionId! }, data: { description: "Already described." } });
  const doneRejected = await generate(done, editor.id, "seoMetaTitle", "Rejected proposal");
  await submitSuggestionForReview(doneRejected.id, editor.id);
  await rejectContentSuggestion(doneRejected.id, editor.id, { reason: "OTHER" });
  const gap = await generateRecordingEditorialSuggestion({ recordingId: done.id, requestedById: editor.id, provider: new FakeAIProvider({ mode: "SUCCESS" }) });
  if (gap.ok) {
    await submitSuggestionForReview(gap.suggestion.id, editor.id);
    await approveContentSuggestion(gap.suggestion.id, editor.id, {});
  }

  // ARCHIVED: has an open suggestion, but archived Recordings never appear.
  await generate(archived, editor.id, "description", "Suggestion on a soon-archived Recording.");
  await archiveRecording(archived.id, editor.id);

  W = {
    editor,
    contributor,
    enrich,
    ready,
    genActive,
    genFailed,
    review: { ...review, a: reviewA, b: reviewB },
    changes: { ...changes, s: changesS },
    approved: { ...approved, open, applied },
    stale: { ...stale, s: staleS },
    done,
    archived,
  };
}, 900000);

afterAll(cleanup, 300000);

describe("A. State derivation against real data", () => {
  it("NEEDS_ENRICHMENT: an unpublished Recording lists its gaps and links to the editor", async () => {
    const { rows } = await myRows({ state: "NEEDS_ENRICHMENT" });
    const mine = rowsOf(rows, W.enrich.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].readiness).toBe("INCOMPLETE");
    expect(mine[0].gaps).toContain("Musical Works");
    expect(mine[0].actions).toEqual(["OPEN_RECORDING_EDITOR"]);
    expect(mine[0].youtubeTitle).toBe(W.enrich.videoTitle);
  }, T);

  it("READY_FOR_GENERATION: a published Recording with no prose, no open work, no generation", async () => {
    const { rows } = await myRows({ state: "READY_FOR_GENERATION" });
    const mine = rowsOf(rows, W.ready.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].actions).toEqual(["GENERATE"]);
    expect(mine[0].readiness).not.toBeNull();
    expect(mine[0].youtubeTitle).toBe(W.ready.videoTitle);
  }, T);

  it("GENERATION: an in-flight request is listed and blocks a duplicate Generate", async () => {
    const { rows } = await myRows({ state: "GENERATION" });
    const mine = rowsOf(rows, W.genActive.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].generationStatus).toBe("PENDING");
    expect(mine[0].actions).toEqual([]);
    expect(mine[0].blockedReason).toMatch(/already in progress/);
  }, T);

  it("GENERATION: a FAILED latest request is listed with an explicit retry", async () => {
    const { rows } = await myRows({ state: "GENERATION" });
    const mine = rowsOf(rows, W.genFailed.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].generationStatus).toBe("FAILED");
    expect(mine[0].actions).toEqual(["GENERATE"]);
  }, T);

  it("AWAITING_REVIEW: DRAFT_READY and EDITOR_REVIEW suggestions each get a row with target field and status", async () => {
    const { rows } = await myRows({ state: "AWAITING_REVIEW" });
    const mine = rowsOf(rows, W.review.id);
    expect(mine.map((r) => r.suggestionId).sort()).toEqual([W.review.a.id, W.review.b.id].sort());
    const a = mine.find((r) => r.suggestionId === W.review.a.id)!;
    const b = mine.find((r) => r.suggestionId === W.review.b.id)!;
    expect([a.suggestionStatus, a.targetField]).toEqual(["DRAFT_READY", "description"]);
    expect([b.suggestionStatus, b.targetField]).toEqual(["EDITOR_REVIEW", "seoMetaTitle"]);
    expect(a.freshness).toBe("CURRENT");
    expect(a.actions).toEqual(["REVIEW_SUGGESTION"]);
  }, T);

  it("an open suggestion replaces the Recording-level READY row (no duplicate work item)", async () => {
    const { rows } = await myRows();
    expect(rowsOf(rows, W.review.id).some((r) => r.state === "READY_FOR_GENERATION")).toBe(false);
  }, T);

  it("CHANGES_REQUESTED: shows the review note, reviewer and date", async () => {
    const { rows } = await myRows({ state: "CHANGES_REQUESTED" });
    const mine = rowsOf(rows, W.changes.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].reviewNote).toBe("Please cite the source.");
    expect(mine[0].reviewerName).toBe("Phase 6I-3 EDITOR");
    expect(mine[0].reviewedAt).toBeInstanceOf(Date);
  }, T);

  it("STALE: only when the existing freshness check says STALE, offering Review and an explicit Regenerate", async () => {
    expect(await checkContentSuggestionFreshness(W.stale.s.id)).toBe("STALE");
    const { rows } = await myRows({ state: "STALE" });
    const mine = rowsOf(rows, W.stale.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].freshness).toBe("STALE");
    expect(mine[0].actions).toEqual(["REVIEW_SUGGESTION", "REGENERATE"]);
    // ...and nothing was regenerated, discarded or re-reviewed by looking at it.
    const after = await prisma.contentSuggestion.findUniqueOrThrow({ where: { id: W.stale.s.id } });
    expect(after.status).toBe("DRAFT_READY");
  }, T);

  it("APPROVED_AWAITING_APPLICATION: an approved, unapplied suggestion — and an applied one is gone", async () => {
    const { rows } = await myRows({ state: "APPROVED_AWAITING_APPLICATION" });
    const mine = rowsOf(rows, W.approved.id);
    expect(mine.map((r) => r.suggestionId)).toEqual([W.approved.open.id]);
    expect(mine[0].actions).toEqual(["APPLY_SUGGESTION"]);
    expect(mine[0].targetField).toBe(GUIDE);
  }, T);

  it("terminal work has no row: a Recording with prose and only rejected / approved-information-gap suggestions", async () => {
    const { rows } = await myRows();
    expect(rowsOf(rows, W.done.id)).toEqual([]);
  }, T);

  it("an ARCHIVED Recording never appears, even with an open suggestion", async () => {
    const { rows } = await myRows();
    expect(rowsOf(rows, W.archived.id)).toEqual([]);
  }, T);

  it("every suggestion row's freshness equals the existing per-suggestion check", async () => {
    const { rows } = await myRows();
    const suggestionRows = rows.filter((r) => r.suggestionId);
    expect(suggestionRows.length).toBeGreaterThanOrEqual(5);
    for (const row of suggestionRows) {
      expect(row.freshness).toBe(await checkContentSuggestionFreshness(row.suggestionId!));
    }
  }, T);

  it("rows carry the Recording title and the YouTube title separately, never a raw id", async () => {
    const { rows } = await myRows();
    const review = rowsOf(rows, W.review.id);
    expect(review.length).toBeGreaterThan(0);
    for (const row of review) {
      expect(row.recordingTitle).toBe(`Handel Messiah ${TOKEN}`);
      expect(row.youtubeTitle).toBe(W.review.videoTitle);
    }
    for (const row of rows) {
      expect(row.recordingTitle).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    }
  }, T);
});

describe("B. Search, filters, counts, ordering and pagination", () => {
  it("searches the Recording title", async () => {
    const { rows } = await getEditorialOperationsQueue({ recordingTitle: `handel messiah ${TOKEN}`, pageSize: 100 });
    expect(rows.length).toBe(2);
    expect(new Set(rows.map((r) => r.recordingId))).toEqual(new Set([W.review.id]));
  }, T);

  it("searches the YouTube title independently — and the Recording-title search does not match it", async () => {
    const byVideo = await getEditorialOperationsQueue({ youtubeTitle: W.review.videoTitle, pageSize: 100 });
    expect(new Set(byVideo.rows.map((r) => r.recordingId))).toEqual(new Set([W.review.id]));
    const byTitle = await getEditorialOperationsQueue({ recordingTitle: W.review.videoTitle, pageSize: 100 });
    expect(byTitle.total).toBe(0);
  }, T);

  it("filters by state", async () => {
    const stale = await myRows({ state: "STALE" });
    expect(stale.rows.every((r) => r.state === "STALE")).toBe(true);
    expect(rowsOf(stale.rows, W.stale.id)).toHaveLength(1);
  }, T);

  it("filters by target field (Recording-level rows have none)", async () => {
    const guide = await myRows({ targetField: GUIDE });
    expect(guide.rows.every((r) => r.targetField === GUIDE)).toBe(true);
    expect(rowsOf(guide.rows, W.approved.id)).toHaveLength(1);
    expect(guide.rows.some((r) => r.state === "NEEDS_ENRICHMENT")).toBe(false);
  }, T);

  it("combines filters", async () => {
    const combined = await myRows({ state: "AWAITING_REVIEW", targetField: "seoMetaTitle" });
    expect(combined.rows.map((r) => r.suggestionId)).toEqual([W.review.b.id]);
  }, T);

  it("summary counts cover every state and agree with the rows (one snapshot)", async () => {
    const result = await myRows();
    for (const state of EDITORIAL_QUEUE_STATES) {
      expect(result.counts[state]).toBeGreaterThanOrEqual(result.rows.filter((r) => r.state === state).length);
    }
    const stateOnly = await getEditorialOperationsQueue({ state: "AWAITING_REVIEW", pageSize: 100 });
    expect(stateOnly.total).toBe(stateOnly.counts.AWAITING_REVIEW);
    expect(result.counts.APPROVED_AWAITING_APPLICATION).toBeGreaterThanOrEqual(1);
    expect(result.counts.GENERATION).toBeGreaterThanOrEqual(2);
  }, T);

  it("orders deterministically: two reads return the same order, and attention queues are oldest-first", async () => {
    const first = (await myRows()).rows.map((r) => r.key);
    const second = (await myRows()).rows.map((r) => r.key);
    expect(second).toEqual(first);
    const review = (await myRows({ state: "AWAITING_REVIEW" })).rows;
    const times = review.map((r) => r.lastUpdated.getTime());
    expect(times).toEqual([...times].sort((x, y) => x - y));
  }, T);

  it("paginates server-side: pages are disjoint, ordered, and add up to the whole", async () => {
    const whole = await myRows();
    expect(whole.total).toBeGreaterThanOrEqual(9);
    const size = 4;
    const pages = [];
    for (let page = 1; page <= Math.ceil(whole.total / size); page++) pages.push(await myRows({ page, pageSize: size }));
    expect(pages[0].pageSize).toBe(size);
    expect(pages[0].rows).toHaveLength(size);
    const keys = pages.flatMap((p) => p.rows.map((r) => r.key));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(whole.rows.map((r) => r.key));
  }, T);

  it("defaults to 20 per page", async () => {
    expect((await getEditorialOperationsQueue({ recordingTitle: TOKEN })).pageSize).toBe(20);
  }, T);

  it("an empty state returns an empty page, not an error", async () => {
    const none = await getEditorialOperationsQueue({ recordingTitle: `no-such-recording-${randomUUID()}` });
    expect(none).toMatchObject({ total: 0, rows: [], page: 1, totalPages: 1 });
  }, T);
});

describe("C. Recording titles resolved from canonical relationships", () => {
  it("resolves published title, else draft title, else slug — and omits unknown ids", async () => {
    const titles = await getRecordingDisplayTitles([W.review.id, W.enrich.id, randomUUID()]);
    expect(titles.get(W.review.id)).toBe(`Handel Messiah ${TOKEN}`);
    expect(titles.get(W.enrich.id)).toBe(W.enrich.videoTitle); // draft title, copied from the video by intake
    expect(titles.size).toBe(2);
    expect((await getRecordingDisplayTitles([])).size).toBe(0);

    const slugOnly = await prisma.recording.create({ data: { slug: `${TAG}-${TOKEN}-untitled`, createdById: W.editor.id, updatedById: W.editor.id } });
    recordingIds.push(slugOnly.id);
    expect((await getRecordingDisplayTitles([slugOnly.id])).get(slugOnly.id)).toBe(slugOnly.slug);
  }, T);
});

describe("D. Efficiency — no N+1", () => {
  it("issues the same number of queries however many Recordings (without suggestions) exist", async () => {
    queries.length = 0;
    await listEditorialQueueRows();
    const before = queries.length;
    expect(before).toBeGreaterThan(0);

    for (const label of ["extra1", "extra2", "extra3"]) await makeRecording(label, W.editor.id, { publish: false });

    queries.length = 0;
    const rows = await listEditorialQueueRows();
    expect(rows.filter((r) => r.recordingTitle.includes(`${TOKEN} extra`)).length).toBe(3);
    expect(queries.length).toBe(before);
  }, T);

  it("assembles each Recording's context once, however many open suggestions it has", async () => {
    queries.length = 0;
    await listEditorialQueueRows();
    const before = queries.length;

    await generate(W.review, W.editor.id, "educationalAnalysis", "A third open suggestion for the same Recording.");

    queries.length = 0;
    const rows = await listEditorialQueueRows();
    expect(rowsOf(rows, W.review.id).filter((r) => r.suggestionId).length).toBe(3);
    expect(queries.length).toBe(before);
  }, T);
});

describe("E. The queue is a read-only view", () => {
  it("reading it writes nothing: no audit entries, generation requests or suggestion changes", async () => {
    const ids = recordingIds;
    const snapshot = async () => ({
      audit: await prisma.auditLogEntry.count({ where: { entityType: { in: ["Recording", "ContentSuggestion", "ContentGenerationRequest"] }, timestamp: { gte: new Date(Date.now() - 3_600_000) } } }),
      requests: await prisma.contentGenerationRequest.count({ where: { targetEntityId: { in: ids } } }),
      suggestions: await prisma.contentSuggestion.findMany({ where: { targetEntityId: { in: ids } }, select: { id: true, status: true, updatedAt: true }, orderBy: { id: "asc" } }),
    });
    const before = await snapshot();
    await myRows();
    await getEditorialOperationsQueue({});
    const after = await snapshot();
    expect(after.requests).toBe(before.requests);
    expect(after.suggestions).toEqual(before.suggestions);
    expect(after.audit).toBe(before.audit);
  }, T);
});

describe("F. Permissions are enforced server-side, independent of the UI", () => {
  async function requestCount(recordingId: string) {
    return prisma.contentGenerationRequest.count({ where: { targetEntityId: recordingId } });
  }

  it("generation: no session is refused and no request is created", async () => {
    mockGetCurrentStudioSession.mockResolvedValue(null);
    const before = await requestCount(W.ready.id);
    const path = await redirectOf(() => generateEditorialSuggestionAction(form({ recordingId: W.ready.id })));
    expect(path).toContain("/studio/content-suggestions?error=");
    expect(decodeURIComponent(path)).toMatch(/permission/i);
    expect(await requestCount(W.ready.id)).toBe(before);
  }, T);

  it("generation: a user denied RECORDING_WRITE is refused and no request is created", async () => {
    signIn(W.contributor, "CONTRIBUTOR");
    mockCan.mockReturnValueOnce(false);
    const before = await requestCount(W.ready.id);
    await redirectOf(() => generateEditorialSuggestionAction(form({ recordingId: W.ready.id })));
    expect(await requestCount(W.ready.id)).toBe(before);
  }, T);

  it("generation: a failure returns to the queue when asked to, and only to the queue", async () => {
    mockGetCurrentStudioSession.mockResolvedValue(null);
    const toQueue = await redirectOf(() => generateEditorialSuggestionAction(form({ recordingId: W.ready.id, returnTo: "/studio/editorial?state=READY_FOR_GENERATION&q=abc" })));
    expect(toQueue.startsWith("/studio/editorial?state=READY_FOR_GENERATION&q=abc&error=")).toBe(true);

    for (const hostile of ["https://evil.example/steal", "//evil.example", "/studio/users", "/studio/editorial/../users", "/studio/editorial?x=<script>"]) {
      const path = await redirectOf(() => generateEditorialSuggestionAction(form({ recordingId: W.ready.id, returnTo: hostile })));
      expect(path.startsWith("/studio/content-suggestions?error=")).toBe(true);
    }
  }, T);

  it("generation: the duplicate guard refuses a second request while one is in flight", async () => {
    signIn(W.editor, "EDITOR");
    const before = await requestCount(W.genActive.id);
    const path = await redirectOf(() => generateEditorialSuggestionAction(form({ recordingId: W.genActive.id, returnTo: "/studio/editorial" })));
    expect(path.startsWith("/studio/editorial?error=")).toBe(true);
    expect(await requestCount(W.genActive.id)).toBe(before);
  }, T);

  it("generation: an unpublished Recording is refused server-side even if its button were forged", async () => {
    signIn(W.editor, "EDITOR");
    const before = await requestCount(W.enrich.id);
    await redirectOf(() => generateEditorialSuggestionAction(form({ recordingId: W.enrich.id })));
    expect(await requestCount(W.enrich.id)).toBe(before);
  }, T);

  it("review: a CONTRIBUTOR (no EDITORIAL_REVIEW) cannot approve from anywhere", async () => {
    signIn(W.contributor, "CONTRIBUTOR");
    const path = await redirectOf(() => approveAction(W.review.b.id, form({})));
    expect(decodeURIComponent(path)).toMatch(/permission to approve/i);
    expect((await prisma.contentSuggestion.findUniqueOrThrow({ where: { id: W.review.b.id } })).status).toBe("EDITOR_REVIEW");
  }, T);

  it("application: a user denied RECORDING_WRITE cannot apply, and nothing changes", async () => {
    signIn(W.editor, "EDITOR");
    mockCan.mockReturnValueOnce(false);
    const path = await redirectOf(() => applyToRecordingDraftAction(W.approved.open.id));
    expect(decodeURIComponent(path)).toMatch(/permission/i);
    expect(await prisma.auditLogEntry.count({ where: { entityType: "ContentSuggestion", entityId: W.approved.open.id, action: "CONTENT_SUGGESTION_APPLIED" } })).toBe(0);
    const { rows } = await myRows({ state: "APPROVED_AWAITING_APPLICATION" });
    expect(rowsOf(rows, W.approved.id)).toHaveLength(1);
  }, T);
});

describe("G. The queue follows a suggestion through its lifecycle", () => {
  it("review -> approve -> apply moves a row through the states and out; publishing then makes the rest stale", async () => {
    signIn(W.editor, "EDITOR");
    const rec = await makeRecording("lifecycle", W.editor.id, { publish: true });
    const s = await generate(rec, W.editor.id, GUIDE, "A guide that walks the whole lifecycle.");
    const other = await generate(rec, W.editor.id, "seoMetaDescription", "A sibling suggestion that will go stale.");
    const stateOf = async (id: string) => (await myRows()).rows.find((r) => r.suggestionId === id)?.state ?? null;

    expect(await stateOf(s.id)).toBe("AWAITING_REVIEW");
    await submitSuggestionForReview(s.id, W.editor.id);
    expect(await stateOf(s.id)).toBe("AWAITING_REVIEW");

    await redirectOf(() => approveAction(s.id, form({})));
    expect(await stateOf(s.id)).toBe("APPROVED_AWAITING_APPLICATION");

    await redirectOf(() => applyToRecordingDraftAction(s.id));
    expect(await stateOf(s.id)).toBeNull();
    // Applying edits the draft only: the published context — and so the sibling — is still current.
    expect(await stateOf(other.id)).toBe("AWAITING_REVIEW");

    await publishCurrentDraft(rec.id, W.editor.id);
    expect(await stateOf(other.id)).toBe("STALE");
  }, 300000);
});
