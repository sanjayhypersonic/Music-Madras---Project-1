import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

// Must be at the true top level — vi.mock is hoisted above every import.
const mockGetCurrentStudioSession = vi.fn();
vi.mock("../../modules/auth/authService", () => ({
  getCurrentStudioSession: () => mockGetCurrentStudioSession(),
}));
// Server Actions call revalidatePath(), which only exists inside a real request.
const revalidated: string[] = [];
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => void revalidated.push(path) }));
// `after()` (analytics, used by the public pages) only exists inside a real request.
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: () => {} };
});

import { prisma } from "../../modules/db/client";
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import { createVenue } from "../../modules/db/repositories/venueRepository";
import { createChoir } from "../../modules/db/repositories/choirRepository";
import { createConductor } from "../../modules/db/repositories/conductorRepository";
import { addProgrammeItem, createProgramme } from "../../modules/db/repositories/programmeRepository";
import { addChoirToPerformance, addConductorToPerformance, createPerformance } from "../../modules/db/repositories/performanceRepository";
import {
  createDraftRecording,
  findPublishedRecordingBySlug,
  getRecordingRevisionCompletenessReport,
  updateDraftRevisionContent,
  attachWorkToRevision,
  forkDraftFromPublished,
} from "../../modules/db/repositories/recordingRepository";
import { addRecordingToCollection, createCollection, publishCollection } from "../../modules/db/repositories/collectionRepository";
import { approveUnlistedPublication, createDraftVideoPage, findPublicVideoPagesByYouTubeVideoIds, publishVideoPage } from "../../modules/db/repositories/youtubeVideoPageRepository";
import { buildRecordingJsonLd } from "../../modules/mmke/recordingPage/buildRecordingJsonLd";
import { getRecordingContext } from "../../modules/db/repositories/recordingContextRepository";
import { getPublicRecordingPageData, getPublicWorkPageData, getComposerEntityPageData } from "../../modules/db/repositories/entityRelationshipsRepository";
import { searchRecordings, searchComposers } from "../../modules/db/repositories/archiveSearchRepository";
import { listPublicRecordingSitemapEntries, listPublicComposerSitemapEntries, listPublicVenueSitemapEntries } from "../../modules/db/repositories/sitemapRepository";
import { createSource, approveSource, attachSourceToEntity } from "../../modules/db/repositories/sourceRepository";
import { completeGenerationRequest, createGenerationRequest } from "../../modules/db/repositories/contentSuggestionRepository";
import { RECORDING_EDITORIAL_PROMPT_V2 } from "../../modules/ai/prompts/recordingEditorial/recordingEditorialPromptV2";
import { generateRecordingEditorialSuggestion } from "../../modules/ai/gateway/generateRecordingEditorialSuggestion";
import { FakeAIProvider } from "../../modules/ai/providers/fake/fakeAIProvider";
import { computeContextFingerprint } from "../../modules/mmke/contentIntelligence/computeContextFingerprint";
import { RECORDING_CONTEXT_SOURCE_MAP } from "../../modules/mmke/contentIntelligence/recordingContextContract";
import { checkContentSuggestionFreshness } from "../../modules/db/repositories/contentSuggestionRepository";
import { findContentSuggestionApplication } from "../../modules/db/repositories/contentSuggestionApplicationRepository";
import { getEditorialOperationsQueue } from "../../modules/db/repositories/editorialQueueRepository";
import { findRecordingLinkedToYouTubeVideo } from "../../modules/db/repositories/recordingIntakeRepository";
import { createRecordingFromVideoAction } from "../../app/(studio)/studio/(protected)/catalogue/videos/[videoId]/actions";
import { publishAction, unpublishAction, restoreAction, archiveAction, submitForReviewAction } from "../../app/(studio)/studio/(protected)/recordings/[id]/review/actions";
import { startNewDraftAction } from "../../app/(studio)/studio/(protected)/recordings/[id]/draftActions";
import {
  submitForReviewAction as submitSuggestionAction,
  approveAction,
  rejectAction,
  requestChangesAction,
  applyToRecordingDraftAction,
} from "../../app/(studio)/studio/(protected)/content-suggestions/[id]/actions";
import { generateEditorialSuggestionAction } from "../../app/(studio)/studio/(protected)/content-suggestions/generateAction";
import { resetConfiguredAIProviderForTests } from "../../modules/ai/provider/aiProviderRegistry";
import RecordingPage, { generateMetadata as recordingMetadata } from "../../app/(museum)/recordings/[slug]/page";
import { loadRealYouTubeFixtures, realVideo, removeRealYouTubeFixtures, REAL_FIXTURES, REAL_VIDEO } from "./helpers/realYouTubeFixtures";

// Phase 6J-4 — the real editorial lifecycle, proven end to end on REAL synchronized
// YouTube metadata (tests/fixtures/realYouTubeVideos.json, exported read-only from the
// real catalogue) in the ISOLATED test database. Nothing here is invented: canonical
// entities are created only from what a video's own title/description states, and where
// the source does not support a fact (e.g. the composer of a traditional tune) it is left
// missing — which the system must surface as a gap and refuse to publish past.
//
// The AI is the deterministic FakeAIProvider (no credentials, no network); the "model
// output" it returns is written from the supplied context only.

const T = 180000;
const TOKEN = randomUUID().slice(0, 8);
const slug = (base: string) => `p6j4-${base}-${TOKEN}`;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

type Role = "CONTRIBUTOR" | "EDITOR" | "REVIEWER" | "ADMINISTRATOR";
const users = {} as Record<Role, string>;
const created = {
  recordings: [] as string[],
  composers: [] as string[],
  works: [] as string[],
  venues: [] as string[],
  choirs: [] as string[],
  conductors: [] as string[],
  programmes: [] as string[],
  performances: [] as string[],
  collections: [] as string[],
  sources: [] as string[],
};
let videoIds: Map<string, string>; // youtubeVideoId -> internal id
const asRole = (role: Role | null) => mockGetCurrentStudioSession.mockResolvedValue(role ? { user: { id: users[role], role, status: "ACTIVE" } } : null);

function redirectPath(err: unknown): string {
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
    return decodeURIComponent(redirectPath(err).replace(/\+/g, " "));
  }
  throw new Error("The action did not redirect");
}
const form = (fields: Record<string, string> = {}) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

async function recordingRow(id: string) {
  return prisma.recording.findUniqueOrThrow({ where: { id }, include: { currentDraftRevision: true, currentPublishedRevision: true } });
}
async function revisions(id: string) {
  return prisma.recordingRevision.findMany({ where: { recordingId: id }, orderBy: { revisionNumber: "asc" }, include: { works: true, mediaResources: true } });
}
async function auditActions(entityType: string, entityIds: string[]) {
  const rows = await prisma.auditLogEntry.findMany({ where: { entityType, entityId: { in: entityIds } }, orderBy: { timestamp: "asc" } });
  return rows.map((r) => r.action);
}

/** Intake through the real Studio action (the editor's one click), returning the new Recording. */
async function intake(youtubeVideoId: string, role: Role = "EDITOR") {
  asRole(role);
  const internal = videoIds.get(youtubeVideoId)!;
  const path = await redirectOf(() => createRecordingFromVideoAction(internal));
  const match = path.match(/^\/studio\/recordings\/([0-9a-f-]{36})\/media$/);
  if (!match) throw new Error(`Intake did not land on the new recording: ${path}`);
  created.recordings.push(match[1]);
  return recordingRow(match[1]);
}

// Canonical entities named by the real descriptions — created only where the source says so.
async function newVenue(name: string, type: "CHURCH" | "CONCERT_HALL", city?: string) {
  const v = await createVenue({ slug: slug(`venue-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, "-")), name, type, city, actorId: users.EDITOR });
  created.venues.push(v.id);
  return v;
}
async function newChoir(name: string) {
  const c = await createChoir({ slug: slug(`choir-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, "-")), name, actorId: users.EDITOR });
  created.choirs.push(c.id);
  return c;
}
async function newConductor(name: string) {
  const c = await createConductor({ slug: slug(`conductor-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, "-")), name, actorId: users.EDITOR });
  created.conductors.push(c.id);
  return c;
}
async function newComposer(name: string) {
  const c = await createComposer({ slug: slug(`composer-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, "-")), name, actorId: users.EDITOR });
  created.composers.push(c.id);
  return c;
}
async function newWork(title: string, composerId: string) {
  const w = await createMusicalWork({ slug: slug(`work-${title}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)), title, composerId, actorId: users.EDITOR });
  created.works.push(w.id);
  return w;
}
async function newPerformance(programmeTitle: string, venueId: string, choirId: string, conductorId: string) {
  const programme = await createProgramme({ slug: slug(`programme-${programmeTitle}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)), title: programmeTitle, actorId: users.EDITOR });
  created.programmes.push(programme.id);
  const performance = await createPerformance({ programmeId: programme.id, venueId, actorId: users.EDITOR });
  created.performances.push(performance.id);
  await addChoirToPerformance(performance.id, choirId, users.EDITOR);
  await addConductorToPerformance(performance.id, conductorId, users.EDITOR);
  return { programme, performance };
}
async function attachPerformance(recordingId: string, performanceId: string) {
  const row = await recordingRow(recordingId);
  await updateDraftRevisionContent(recordingId, row.currentDraftRevision!.updatedAt, users.EDITOR, { performanceId });
}

// ---------------------------------------------------------------------------
// State shared by the ordered scenarios below
// ---------------------------------------------------------------------------

let fixtureFingerprint: string;
const dingiri = {} as { recordingId: string; slug: string };
const mozart = {} as { recordingId: string; slug: string; workIds: string[]; composerIds: string[]; venueId: string; conductorId: string; choirId: string; programmeSlug: string; performanceId: string };
const promise = {} as { recordingId: string; slug: string };
const noDescription = {} as { recordingId: string };

async function fixtureRowsFingerprint() {
  const rows = await prisma.youTubeVideo.findMany({ where: { youtubeVideoId: { in: REAL_FIXTURES.videos.map((v) => v.youtubeVideoId) } }, orderBy: { youtubeVideoId: "asc" } });
  return JSON.stringify(rows.map((r) => [r.youtubeVideoId, r.title, r.description, r.privacyStatus, r.observabilityState, r.durationSeconds, r.updatedAt.toISOString()]));
}

beforeAll(async () => {
  resetConfiguredAIProviderForTests();
  for (const role of ["CONTRIBUTOR", "EDITOR", "REVIEWER", "ADMINISTRATOR"] as Role[]) {
    const u = await prisma.studioUser.create({ data: { id: randomUUID(), email: `p6j4-${role.toLowerCase()}-${TOKEN}@musicmadras.test`, name: `P6J4 ${role}`, role, status: "ACTIVE" } });
    users[role] = u.id;
  }
  videoIds = await loadRealYouTubeFixtures();
  fixtureFingerprint = await fixtureRowsFingerprint();
}, T);

afterAll(async () => {
  // Everything this suite created, children first. Audit rows have no FK on entityId, so they are removed explicitly.
  const recordingIds = created.recordings;
  const revisionIds = (await prisma.recordingRevision.findMany({ where: { recordingId: { in: recordingIds } }, select: { id: true } })).map((r) => r.id);
  const requests = (await prisma.contentGenerationRequest.findMany({ where: { targetEntityId: { in: recordingIds } }, select: { id: true } })).map((r) => r.id);
  const suggestions = (await prisma.contentSuggestion.findMany({ where: { targetEntityId: { in: recordingIds } }, select: { id: true } })).map((s) => s.id);
  const pages = (await prisma.youTubeVideoPage.findMany({ select: { id: true } })).map((p) => p.id);
  const mediaIds = (await prisma.mediaResource.findMany({ where: { recordingRevisionId: { in: revisionIds } }, select: { id: true } })).map((m) => m.id);
  const allIds = [
    ...recordingIds, ...revisionIds, ...requests, ...suggestions, ...pages, ...mediaIds, ...created.composers, ...created.works, ...created.venues, ...created.choirs,
    ...created.conductors, ...created.programmes, ...created.performances, ...created.collections, ...created.sources,
  ];
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityId: { in: allIds } }, { actorId: { in: Object.values(users) } }] } });
  await prisma.contentSuggestion.deleteMany({ where: { id: { in: suggestions } } });
  await prisma.contentGenerationRequest.deleteMany({ where: { id: { in: requests } } });
  await prisma.collection.deleteMany({ where: { id: { in: created.collections } } });
  await prisma.recording.deleteMany({ where: { id: { in: recordingIds } } });
  await removeRealYouTubeFixtures();
  await prisma.performance.deleteMany({ where: { id: { in: created.performances } } });
  await prisma.programme.deleteMany({ where: { id: { in: created.programmes } } });
  await prisma.venue.deleteMany({ where: { id: { in: created.venues } } });
  await prisma.choir.deleteMany({ where: { id: { in: created.choirs } } });
  await prisma.conductor.deleteMany({ where: { id: { in: created.conductors } } });
  await prisma.musicalWork.deleteMany({ where: { id: { in: created.works } } });
  await prisma.composer.deleteMany({ where: { id: { in: created.composers } } });
  await prisma.source.deleteMany({ where: { id: { in: created.sources } } });
  await prisma.studioUser.deleteMany({ where: { id: { in: Object.values(users) } } });
}, T);

// ===========================================================================
// 1. The real synchronized data
// ===========================================================================

describe("1. real synchronized YouTube data", () => {
  it("loads the exported real records exactly as they were synced (nothing invented, nothing edited)", async () => {
    expect(REAL_FIXTURES.videos.map((v) => v.youtubeVideoId).sort()).toEqual(Object.values(REAL_VIDEO).sort());
    for (const v of REAL_FIXTURES.videos) {
      const row = await prisma.youTubeVideo.findUniqueOrThrow({ where: { youtubeVideoId: v.youtubeVideoId } });
      expect(row.title).toBe(v.title);
      expect(row.description).toBe(v.description);
      expect(row.privacyStatus).toBe(v.privacyStatus);
    }
    // the case coverage the workflow depends on
    expect(realVideo(REAL_VIDEO.NO_DESCRIPTION).description ?? "").toBe("");
    expect(realVideo(REAL_VIDEO.UNLISTED).privacyStatus).toBe("unlisted");
    expect(realVideo(REAL_VIDEO.PROMISE).playlistMemberships).toHaveLength(2);
    expect(realVideo(REAL_VIDEO.DINGIRI).description).toContain("Conductor: Alvin Arumugam");
    expect((realVideo(REAL_VIDEO.MOZART_VERDI).description ?? "").length).toBeGreaterThan(1000);
  }, T);
});

// ===========================================================================
// 2. Recording intake
// ===========================================================================

describe("2. recording intake from a real synced video", () => {
  it("creates a DRAFT Recording with a draft revision and the video as PRIMARY_VIDEO — and nothing public", async () => {
    const before = await fixtureRowsFingerprint();
    const recording = await intake(REAL_VIDEO.DINGIRI, "CONTRIBUTOR"); // RECORDING_WRITE is enough: intake never publishes
    dingiri.recordingId = recording.id;
    dingiri.slug = recording.slug;

    expect(recording.status).toBe("DRAFT");
    expect(recording.currentPublishedRevisionId).toBeNull();
    expect(recording.currentDraftRevision!.revisionStatus).toBe("DRAFT");
    // the YouTube title is only an EDITABLE working title — never asserted to be a canonical title
    expect(recording.currentDraftRevision!.title).toBe(realVideo(REAL_VIDEO.DINGIRI).title!.trim());

    const media = await prisma.mediaResource.findMany({ where: { recordingRevisionId: recording.currentDraftRevisionId! } });
    expect(media).toHaveLength(1);
    expect(media[0]).toMatchObject({ provider: "YOUTUBE", role: "PRIMARY_VIDEO", providerResourceId: REAL_VIDEO.DINGIRI, youtubeVideoId: videoIds.get(REAL_VIDEO.DINGIRI) });
    expect((await findRecordingLinkedToYouTubeVideo(videoIds.get(REAL_VIDEO.DINGIRI)!))?.recordingId).toBe(recording.id);

    // The synced YouTube record itself is never touched by intake.
    expect(await fixtureRowsFingerprint()).toBe(before);

    // No public surface: page, archive search, sitemap.
    expect(await findPublishedRecordingBySlug(recording.slug)).toBeNull();
    expect(await getPublicRecordingPageData(recording.slug)).toBeNull();
    expect((await searchRecordings(undefined, 1, 100)).items.map((r) => r.slug)).not.toContain(recording.slug);
    expect((await listPublicRecordingSitemapEntries()).map((e) => e.slug)).not.toContain(recording.slug);
  }, T);

  it("refuses a second Recording for the same video, and concurrent clicks create exactly one", async () => {
    asRole("EDITOR");
    const again = await redirectOf(() => createRecordingFromVideoAction(videoIds.get(REAL_VIDEO.DINGIRI)!));
    expect(again).toMatch(/already linked to a Music Madras Recording/);
    expect(await prisma.mediaResource.count({ where: { youtubeVideoId: videoIds.get(REAL_VIDEO.DINGIRI)! } })).toBe(1);

    const target = videoIds.get(REAL_VIDEO.MOZART_VERDI)!;
    const outcomes = await Promise.allSettled([1, 2, 3, 4].map(() => redirectOf(() => createRecordingFromVideoAction(target))));
    const paths = outcomes.map((o) => (o.status === "fulfilled" ? o.value : String(o.reason)));
    expect(paths.filter((p) => /\/studio\/recordings\/[0-9a-f-]{36}\/media$/.test(p))).toHaveLength(1);
    expect(paths.filter((p) => /already linked/.test(p))).toHaveLength(3);
    const linked = await findRecordingLinkedToYouTubeVideo(target);
    mozart.recordingId = linked!.recordingId;
    mozart.slug = linked!.slug;
    created.recordings.push(linked!.recordingId);
    expect(await prisma.recording.count({ where: { id: linked!.recordingId } })).toBe(1);
  }, T);

  it("does not trust a client-supplied id: an unknown id, or YouTube's own id string, is refused and creates nothing", async () => {
    asRole("EDITOR");
    const before = await prisma.recording.count();
    expect(await redirectOf(() => createRecordingFromVideoAction(randomUUID()))).toMatch(/could not be found/);
    // YouTube's own id string is not the internal key either — it must not resolve to a video.
    expect(await redirectOf(() => createRecordingFromVideoAction(REAL_VIDEO.NO_DESCRIPTION))).toMatch(/could not be found|could not be created/i);
    expect(await prisma.recording.count()).toBe(before);
  }, T);

  it("is permission-gated on the server: no session, no Recording", async () => {
    asRole(null);
    const before = await prisma.recording.count();
    expect(await redirectOf(() => createRecordingFromVideoAction(videoIds.get(REAL_VIDEO.NO_DESCRIPTION)!))).toMatch(/permission/i);
    expect(await prisma.recording.count()).toBe(before);
  }, T);

  it("intake for the remaining real videos (no description; unlisted; with playlists) also lands as plain DRAFTs", async () => {
    const nd = await intake(REAL_VIDEO.NO_DESCRIPTION);
    noDescription.recordingId = nd.id;
    const pr = await intake(REAL_VIDEO.PROMISE);
    promise.recordingId = pr.id;
    promise.slug = pr.slug;
    const ul = await intake(REAL_VIDEO.UNLISTED);
    for (const r of [nd, pr, ul]) {
      expect(r.status).toBe("DRAFT");
      expect(r.currentPublishedRevisionId).toBeNull();
    }
    created.recordings.push(ul.id);
  }, T);
});

// ===========================================================================
// 3. Enrichment — canonical records ONLY where the source states them
// ===========================================================================

const promiseEntities = {} as { composerId: string; workId: string; workSlug: string; venueId: string; venueSlug: string; choirId: string; conductorId: string; performanceId: string; composerSlug: string };

describe("3. canonical enrichment and readiness (PROMISE video — its own description names work, composer, choir, conductor, venue)", () => {
  it("a draft with no works yet is INCOMPLETE; its Media row reports the CURRENT state (the 6J-4 media-readiness bug)", async () => {
    const row = await recordingRow(promise.recordingId);
    const result = (await getRecordingRevisionCompletenessReport(row.currentDraftRevisionId!))!;
    const media = result.report.find((i) => i.category === "Media")!;
    expect(media.level).toBe("REQUIRED");
    expect(media.status).toBe("COMPLETE");
    expect(media.detail).toBe("Primary video attached");
    expect(media.detail).not.toMatch(/required/i); // previously: COMPLETE next to "A primary video media resource is required"
    expect(result.report.find((i) => i.category === "Musical Works")!.status).toBe("MISSING");
    expect(result.readiness).toBe("INCOMPLETE");
  }, T);

  it("a draft with NO primary video is INCOMPLETE on Media and says what is required", async () => {
    const bare = await createDraftRecording({ slug: slug("no-media"), actorId: users.EDITOR, title: "A recording with no media" });
    created.recordings.push(bare.id);
    const result = (await getRecordingRevisionCompletenessReport(bare.currentDraftRevisionId!))!;
    const media = result.report.find((i) => i.category === "Media")!;
    expect(media.status).toBe("MISSING");
    expect(media.detail).toMatch(/primary video.*required/i);
    expect(result.readiness).toBe("INCOMPLETE");
    // and it cannot be published
    asRole("ADMINISTRATOR");
    expect(await redirectOf(() => publishAction(bare.id, bare.currentDraftRevisionId!))).toMatch(/not ready to publish/);
    expect((await recordingRow(bare.id)).status).toBe("DRAFT");
  }, T);

  it("the DRAFT context carries the YouTube title/description VERBATIM as YOUTUBE_METADATA and surfaces the gaps instead of inventing", async () => {
    const result = await getRecordingContext(promise.recordingId, "DRAFT");
    if (!result.ok) throw new Error("expected a draft context");
    const ctx = result.context;
    const video = await prisma.youTubeVideo.findUniqueOrThrow({ where: { youtubeVideoId: REAL_VIDEO.PROMISE } });

    expect(RECORDING_CONTEXT_SOURCE_MAP.media).toBe("YOUTUBE_METADATA");
    expect(RECORDING_CONTEXT_SOURCE_MAP.works).toBe("CANONICAL_MMKE");
    expect(RECORDING_CONTEXT_SOURCE_MAP.provenance).toBe("APPROVED_EXTERNAL_SOURCE");
    expect(ctx.media).toHaveLength(1);
    expect(ctx.media[0].title).toBe(video.title);
    expect(ctx.media[0].description).toBe(video.description); // byte for byte — the credits block is NOT parsed into canonical fields

    expect(ctx.works).toEqual([]);
    expect(ctx.performance).toBeNull();
    expect(ctx.provenance.sources).toEqual([]);
    const gapFields = ctx.completeness.gaps.map((g) => g.field);
    expect(gapFields).toEqual(expect.arrayContaining(["WORK", "PERFORMANCE", "EDITORIAL_CONTENT"]));

    // There is no published revision yet, so PUBLISHED-mode context (which AI generation uses) does not exist.
    expect(await getRecordingContext(promise.recordingId, "PUBLISHED")).toEqual({ ok: false, reason: "NO_PUBLISHED_REVISION" });
  }, T);

  it("AI generation is refused for a Recording that has never been published — no request row, no suggestion", async () => {
    asRole("EDITOR");
    const path = await redirectOf(() => generateEditorialSuggestionAction(form({ recordingId: promise.recordingId })));
    expect(path).toMatch(/^\/studio\/content-suggestions\?error=/);
    expect(await prisma.contentGenerationRequest.count({ where: { targetEntityId: promise.recordingId } })).toBe(0);
    expect(await prisma.contentSuggestion.count({ where: { targetEntityId: promise.recordingId } })).toBe(0);
  }, T);

  it("the Editorial Operations Queue lists the unpublished draft as NEEDS_ENRICHMENT (derived, nothing stored)", async () => {
    const queue = await getEditorialOperationsQueue({ state: "NEEDS_ENRICHMENT", pageSize: 100 });
    const row = queue.rows.find((r) => r.recordingId === promise.recordingId);
    expect(row).toBeDefined();
    expect(row!.actions).toEqual(["OPEN_RECORDING_EDITOR"]);
    expect(row!.readiness).toBe("INCOMPLETE");
    expect(queue.counts.NEEDS_ENRICHMENT).toBeGreaterThanOrEqual(4);
  }, T);

  it("an editor creates ONLY the canonical records the video's own description states, and links them", async () => {
    // "Work: Dancing Into the Promise!  Composer: John Carter  Choir: BHC Choir  Conductor: Jacob George  Venue/Church: Bishop Heber Chapel"
    const composer = await newComposer("John Carter");
    const work = await newWork("Dancing Into the Promise!", composer.id);
    const venue = await newVenue("Bishop Heber Chapel", "CHURCH");
    const choir = await newChoir("BHC Choir");
    const conductor = await newConductor("Jacob George");
    // A Performance needs a Programme; the work's own title is the only name the source supplies. No date is entered:
    // the title's "12 Dec 2025" is not stated to be the performance date, so it stays a gap rather than a guess.
    const { programme, performance } = await newPerformance("Dancing Into the Promise!", venue.id, choir.id, conductor.id);
    await addProgrammeItem({ programmeId: programme.id, musicalWorkId: work.id, actorId: users.EDITOR });
    Object.assign(promiseEntities, { composerId: composer.id, composerSlug: composer.slug, workId: work.id, workSlug: work.slug, venueId: venue.id, venueSlug: venue.slug, choirId: choir.id, conductorId: conductor.id, performanceId: performance.id });

    const draft = (await recordingRow(promise.recordingId)).currentDraftRevision!;
    await attachWorkToRevision(draft.id, work.id, users.EDITOR);
    await attachPerformance(promise.recordingId, performance.id);
    // The editor replaces the raw YouTube title (a working title) with the canonical title the description states.
    const fresh = (await recordingRow(promise.recordingId)).currentDraftRevision!;
    await updateDraftRevisionContent(promise.recordingId, fresh.updatedAt, users.EDITOR, { title: "Dancing Into the Promise!" });

    const result = (await getRecordingRevisionCompletenessReport(draft.id))!;
    expect(result.report.filter((i) => i.level === "REQUIRED").every((i) => i.status === "COMPLETE")).toBe(true);
    expect(result.report.find((i) => i.category === "Performance")!.status).toBe("COMPLETE");

    const ctx = await getRecordingContext(promise.recordingId, "DRAFT");
    if (!ctx.ok) throw new Error("expected a draft context");
    expect(ctx.context.works.map((w) => [w.title, w.composer.name])).toEqual([["Dancing Into the Promise!", "John Carter"]]);
    expect(ctx.context.performance!.venue.name).toBe("Bishop Heber Chapel");
    expect(ctx.context.performance!.choirs.map((c) => c.name)).toEqual(["BHC Choir"]);
    expect(ctx.context.performance!.conductors.map((c) => c.name)).toEqual(["Jacob George"]);
    expect(ctx.context.performance!.performanceDate).toBeNull();
    // still the editor's remaining gaps — editorial prose does not exist and is not made up
    expect(ctx.context.completeness.gaps.map((g) => g.field)).toContain("EDITORIAL_CONTENT");
    expect(ctx.context.completeness.gaps.map((g) => g.field)).not.toContain("WORK");
  }, T);

  it("the DINGIRI video's description names no composer (a traditional tune), so it has no Work — it stays unpublishable and the gap is explicit", async () => {
    const row = await recordingRow(dingiri.recordingId);
    const result = (await getRecordingRevisionCompletenessReport(row.currentDraftRevisionId!))!;
    expect(result.readiness).toBe("INCOMPLETE");
    expect(result.report.find((i) => i.category === "Musical Works")!.status).toBe("MISSING");
    asRole("ADMINISTRATOR");
    expect(await redirectOf(() => publishAction(dingiri.recordingId, row.currentDraftRevisionId!))).toMatch(/not ready to publish/);
    expect((await recordingRow(dingiri.recordingId)).currentPublishedRevisionId).toBeNull();
  }, T);

  it("external sources reach the context only once a human has APPROVED them (APPROVED_EXTERNAL_SOURCE)", async () => {
    const source = await createSource({ title: `P6J4 reference ${TOKEN}`, publisher: "Test publisher", actorId: users.EDITOR });
    created.sources.push(source.id);
    await attachSourceToEntity({ entityType: "WORK", entityId: promiseEntities.workId, sourceId: source.id, actorId: users.EDITOR });

    const sourcesOf = async () => {
      const r = await getRecordingContext(promise.recordingId, "DRAFT");
      if (!r.ok) throw new Error("expected a draft context");
      return r.context.provenance.sources;
    };
    expect(await sourcesOf()).toEqual([]); // UNREVIEWED — never reaches the AI
    await approveSource(source.id, users.REVIEWER);
    const approved = await sourcesOf();
    expect(approved.map((s) => [s.id, s.approvalState])).toEqual([[source.id, "APPROVED"]]);
    expect(approved[0].attachedTo).toEqual({ entityType: "WORK", entityId: promiseEntities.workId });
    expect(RECORDING_CONTEXT_SOURCE_MAP.provenance).toBe("APPROVED_EXTERNAL_SOURCE");
  }, T);

  it("the no-description video yields context with the video's gap, and nothing is fabricated for it", async () => {
    const row = await recordingRow(noDescription.recordingId);
    const ctx = await getRecordingContext(noDescription.recordingId, "DRAFT");
    if (!ctx.ok) throw new Error("expected a draft context");
    expect(ctx.context.media[0].description ?? "").toBe("");
    expect(ctx.context.works).toEqual([]);
    expect(ctx.context.editorial.description ?? null).toBeNull();
    const draft = row.currentDraftRevision!;
    expect(draft.description ?? null).toBeNull(); // intake never copies YouTube prose into the revision
  }, T);
});

// ===========================================================================
// 4. Publishing — explicit, human, server-enforced
// ===========================================================================

describe("4. publish through the Studio workflow", () => {
  it("only an Administrator may publish — every other role is refused on the server and nothing changes", async () => {
    const draftId = (await recordingRow(promise.recordingId)).currentDraftRevisionId!;
    for (const role of ["CONTRIBUTOR", "EDITOR", "REVIEWER"] as Role[]) {
      asRole(role);
      expect(await redirectOf(() => publishAction(promise.recordingId, draftId))).toMatch(/permission to publish/);
    }
    asRole(null);
    expect(await redirectOf(() => publishAction(promise.recordingId, draftId))).toMatch(/permission to publish/);
    const row = await recordingRow(promise.recordingId);
    expect(row.status).toBe("DRAFT");
    expect(row.currentPublishedRevisionId).toBeNull();
  }, T);

  it("a forged or foreign revision id is only an expected token — it can never publish something else", async () => {
    asRole("ADMINISTRATOR");
    const foreignDraft = (await recordingRow(dingiri.recordingId)).currentDraftRevisionId!;
    for (const forged of [randomUUID(), foreignDraft]) {
      const path = await redirectOf(() => publishAction(promise.recordingId, forged));
      expect(path).toMatch(/\?error=/);
      expect(path).not.toMatch(/permission/);
    }
    const row = await recordingRow(promise.recordingId);
    expect(row.currentPublishedRevisionId).toBeNull();
    expect((await recordingRow(dingiri.recordingId)).currentPublishedRevisionId).toBeNull();
  }, T);

  it("publishes: the draft becomes the published revision, pointers move, audit written", async () => {
    asRole("ADMINISTRATOR");
    const before = await recordingRow(promise.recordingId);
    const draftId = before.currentDraftRevisionId!;
    expect(await redirectOf(() => publishAction(promise.recordingId, draftId))).toBe(`/studio/recordings/${promise.recordingId}/review`);

    const after = await recordingRow(promise.recordingId);
    expect(after.status).toBe("PUBLISHED");
    expect(after.currentPublishedRevisionId).toBe(draftId);
    expect(after.currentDraftRevisionId).toBeNull();
    expect(after.currentPublishedRevision!.revisionStatus).toBe("PUBLISHED");
    expect(revalidated.some((p) => p === `/studio/recordings/${promise.recordingId}`)).toBe(true); // the workflow layout is refreshed
    expect(await auditActions("Recording", [promise.recordingId])).toContain("RECORDING_PUBLISHED");

    // media and the YouTube link are exactly what intake attached
    const [rev] = await revisions(promise.recordingId);
    expect(rev.mediaResources.map((m) => [m.role, m.youtubeVideoId])).toEqual([["PRIMARY_VIDEO", videoIds.get(REAL_VIDEO.PROMISE)]]);
  }, T);

  it("the Recording is now public through the canonical relationship graph (page data, metadata, JSON-LD, search, sitemap)", async () => {
    const data = (await getPublicRecordingPageData(promise.slug))!;
    expect(data.title).toBe("Dancing Into the Promise!");
    expect(data.works.map((w) => w.title)).toEqual(["Dancing Into the Promise!"]);
    expect(data.composers.map((c) => c.name)).toEqual(["John Carter"]);
    expect(data.performance?.venue?.name).toBe("Bishop Heber Chapel");
    expect(data.performance?.choirs.map((c) => c.name)).toEqual(["BHC Choir"]);
    expect(data.performance?.conductors.map((c) => c.name)).toEqual(["Jacob George"]);
    expect(data.programme?.title).toBe("Dancing Into the Promise!");

    const metadata = await recordingMetadata({ params: Promise.resolve({ slug: promise.slug }) });
    expect(String(metadata.title)).toContain("Dancing Into the Promise!");
    const jsonLd = buildRecordingJsonLd(data, "https://example.test");
    expect(jsonLd["@type"]).toBe("MusicRecording");
    expect(jsonLd.recordingOf).toEqual({ "@type": "MusicComposition", name: "Dancing Into the Promise!", composer: { "@type": "Person", name: "John Carter" } });
    expect(() => RecordingPage({ params: Promise.resolve({ slug: promise.slug }) })).not.toThrow();

    expect((await searchRecordings("Dancing", 1, 100)).items.map((r) => r.slug)).toContain(promise.slug);
    expect((await listPublicRecordingSitemapEntries()).map((e) => e.slug)).toContain(promise.slug);
  }, T);

  it("entities reachable from the published Recording become public; unreachable ones stay private even when a title names them", async () => {
    expect(await getPublicWorkPageData(promiseEntities.workSlug)).not.toBeNull();
    expect(await getComposerEntityPageData(promiseEntities.composerSlug)).not.toBeNull();
    expect((await listPublicComposerSitemapEntries()).map((e) => e.slug)).toContain(promiseEntities.composerSlug);
    expect((await listPublicVenueSitemapEntries()).map((e) => e.slug)).toContain(promiseEntities.venueSlug);
    expect((await searchComposers("John Carter", 1, 50)).items.map((c) => c.slug)).toContain(promiseEntities.composerSlug);

    // A Composer named in a REAL video title but linked to no published Recording is NOT discoverable:
    // no title/keyword/fuzzy matching ever grants visibility.
    const orphan = await newComposer("Wolfgang Amadeus Mozart");
    expect(await getComposerEntityPageData(orphan.slug)).toBeNull();
    expect((await searchComposers("Mozart", 1, 50)).items.map((c) => c.slug)).not.toContain(orphan.slug);
    expect((await listPublicComposerSitemapEntries()).map((e) => e.slug)).not.toContain(orphan.slug);
  }, T);

  it("its YouTube video and playlist-backed Collection appear only through explicit canonical links", async () => {
    // before any video page / collection exists, the public page lists none
    expect((await getPublicRecordingPageData(promise.slug))!.videos).toEqual([]);
    expect((await getPublicRecordingPageData(promise.slug))!.collections).toEqual([]);

    const playlist = await prisma.youTubePlaylist.findUniqueOrThrow({ where: { youtubePlaylistId: "PL6HjF0ftgoquW81zBjg1r2s0h8fKUiWdb" } });
    const collection = await createCollection({ slug: slug("collection"), title: playlist.title ?? "Playlist", backingPlaylistId: playlist.id, actorId: users.EDITOR });
    created.collections.push(collection.id);
    await addRecordingToCollection(collection.id, promise.recordingId, users.EDITOR);
    // an unpublished Collection is not shown
    expect((await getPublicRecordingPageData(promise.slug))!.collections).toEqual([]);
    await publishCollection(collection.id, users.ADMINISTRATOR);
    expect((await getPublicRecordingPageData(promise.slug))!.collections.map((c) => c.title)).toEqual(["The Music Madras 2025 Christmas Carol Collection"]);

    // the video appears only once its own catalogue page is explicitly published
    const page = await createDraftVideoPage({ youtubeVideoId: videoIds.get(REAL_VIDEO.PROMISE)!, actorId: users.EDITOR });
    expect((await getPublicRecordingPageData(promise.slug))!.videos).toEqual([]);
    await publishVideoPage(page.id, users.ADMINISTRATOR);
    const videos = (await getPublicRecordingPageData(promise.slug))!.videos;
    expect(videos).toHaveLength(1); // the video is public on YouTube, so its published page is public
    expect(videos[0].thumbnailUrl).toBe(realVideo(REAL_VIDEO.PROMISE).thumbnailUrl);
  }, T);

  it("YouTube is authoritative for privacy: an UNLISTED video's published page stays private until a human explicitly approves it", async () => {
    const unlistedInternal = videoIds.get(REAL_VIDEO.UNLISTED)!;
    const page = await createDraftVideoPage({ youtubeVideoId: unlistedInternal, actorId: users.EDITOR });
    await publishVideoPage(page.id, users.ADMINISTRATOR);
    expect(await findPublicVideoPagesByYouTubeVideoIds([unlistedInternal])).toEqual([]);
    await approveUnlistedPublication(page.id, users.ADMINISTRATOR);
    expect(await findPublicVideoPagesByYouTubeVideoIds([unlistedInternal])).toHaveLength(1);
  }, T);
});

// ===========================================================================
// 5. One controlled, human-triggered AI suggestion (FakeAIProvider)
// ===========================================================================
//
// AI generation is grounded on the PUBLISHED revision (6H-6) — so it becomes available once a Recording has
// been published with its required canonical content, and its output is later applied to a NEW draft (6I-2).

const DESCRIPTION_TEXT = "Dancing Into the Promise! by John Carter, performed by the BHC Choir and conducted by Jacob George at Bishop Heber Chapel.";
const suggestions = {} as Record<"description" | "changes" | "rejected" | "stale" | "gap", string>;

/** Model output written ONLY from facts present in the supplied context — never from outside knowledge. */
async function outputFromContext(recordingId: string, proposedContent: string, targetField: string) {
  const result = await getRecordingContext(recordingId, "PUBLISHED");
  if (!result.ok) throw new Error("no published context");
  const c = result.context;
  return {
    outputType: "SUGGESTION",
    proposedContent,
    targetField,
    evidenceEntityIds: [c.works[0].id, c.works[0].composer.id, c.performance!.id, c.performance!.venue.id, ...c.performance!.choirs.map((x) => x.id), ...c.performance!.conductors.map((x) => x.id)],
  };
}
async function generate(recordingId: string, output?: unknown) {
  return generateRecordingEditorialSuggestion({ recordingId, requestedById: users.EDITOR, provider: new FakeAIProvider(output === undefined ? {} : { output }) });
}
async function suggestionRow(id: string) {
  return prisma.contentSuggestion.findUniqueOrThrow({ where: { id }, include: { generationRequest: true } });
}

describe("5. controlled AI suggestion", () => {
  it("a published, un-prosed Recording is READY_FOR_GENERATION in the queue", async () => {
    const queue = await getEditorialOperationsQueue({ state: "READY_FOR_GENERATION", pageSize: 100 });
    const row = queue.rows.find((r) => r.recordingId === promise.recordingId);
    expect(row?.actions).toEqual(["GENERATE"]);
    // the Recordings that were never published are NOT offered for generation
    expect(queue.rows.some((r) => r.recordingId === dingiri.recordingId)).toBe(false);
  }, T);

  it("evidence the model cites must exist in the supplied context — invented evidence fails the generation and creates no suggestion", async () => {
    const good = await outputFromContext(promise.recordingId, DESCRIPTION_TEXT, "description");
    const result = await generate(promise.recordingId, { ...good, evidenceEntityIds: [randomUUID()] });
    expect(result.ok).toBe(false);
    const requests = await prisma.contentGenerationRequest.findMany({ where: { targetEntityId: promise.recordingId } });
    expect(requests).toHaveLength(1);
    expect(requests[0].status).toBe("FAILED");
    expect(requests[0].errorDetails).toMatch(/no valid evidence references/);
    expect(await prisma.contentSuggestion.count({ where: { targetEntityId: promise.recordingId } })).toBe(0);

    // output that tries to edit a canonical field (title) or carries extra keys is rejected too
    expect((await generate(promise.recordingId, { ...good, targetField: "title" })).ok).toBe(false);
    expect((await generate(promise.recordingId, { ...good, approve: true })).ok).toBe(false);
    expect(await prisma.contentSuggestion.count({ where: { targetEntityId: promise.recordingId } })).toBe(0);
    // a FAILED generation is visible in the queue, with a retry action
    const queue = await getEditorialOperationsQueue({ state: "GENERATION", pageSize: 100 });
    expect(queue.rows.find((r) => r.recordingId === promise.recordingId)?.generationStatus).toBe("FAILED");
  }, T);

  it("a second generation while one is in flight is refused (no uncontrolled duplicates)", async () => {
    const ctx = await getRecordingContext(promise.recordingId, "PUBLISHED");
    if (!ctx.ok) throw new Error("no context");
    const active = await createGenerationRequest({
      targetEntityType: "RECORDING",
      targetEntityId: promise.recordingId,
      suggestionType: "EDITORIAL_PROSE",
      contextFingerprint: computeContextFingerprint(ctx.context),
      provider: "fake",
      promptVersion: "test",
      requestedById: users.EDITOR,
    });
    const before = await prisma.contentGenerationRequest.count({ where: { targetEntityId: promise.recordingId } });
    const refused = await generate(promise.recordingId);
    expect(refused).toMatchObject({ ok: false, reason: "GENERATION_ALREADY_IN_PROGRESS" });
    expect(await prisma.contentGenerationRequest.count({ where: { targetEntityId: promise.recordingId } })).toBe(before);

    const queue = await getEditorialOperationsQueue({ state: "GENERATION", pageSize: 100 });
    const row = queue.rows.find((r) => r.recordingId === promise.recordingId)!;
    expect(row.blockedReason).toMatch(/already in progress/);
    expect(row.actions).toEqual([]);
    await completeGenerationRequest(active.id, { status: "FAILED", errorDetails: "released by the test" });
  }, T);

  it("generates ONE suggestion: DRAFT_READY, evidence-backed, fingerprinted, audited — and changes nothing canonical", async () => {
    const before = await recordingRow(promise.recordingId);
    const ctx = await getRecordingContext(promise.recordingId, "PUBLISHED");
    if (!ctx.ok) throw new Error("no context");

    const result = await generate(promise.recordingId, await outputFromContext(promise.recordingId, DESCRIPTION_TEXT, "description"));
    if (!result.ok) throw new Error(`generation failed: ${result.reason}`);
    suggestions.description = result.suggestion.id;

    const row = await suggestionRow(result.suggestion.id);
    expect(row).toMatchObject({ status: "DRAFT_READY", suggestionType: "EDITORIAL_PROSE", targetEntityType: "RECORDING", targetEntityId: promise.recordingId, targetField: "description", proposedContent: DESCRIPTION_TEXT });
    expect(row.finalContent).toBeNull();
    expect(row.reviewedById).toBeNull(); // no human has decided anything yet
    expect(row.generationRequest).toMatchObject({ status: "SUCCEEDED", provider: "fake", promptVersion: RECORDING_EDITORIAL_PROMPT_V2, requestedById: users.EDITOR, contextFingerprint: computeContextFingerprint(ctx.context) });

    const refs = row.evidenceRefs as { sourceType: string; entityType: string; entityId: string }[];
    expect(refs.length).toBeGreaterThanOrEqual(5);
    expect(new Set(refs.map((r) => r.sourceType))).toEqual(new Set(["CANONICAL_MMKE"]));
    expect(refs.map((r) => r.entityId)).toEqual(expect.arrayContaining([promiseEntities.workId, promiseEntities.composerId, promiseEntities.venueId]));

    expect(await checkContentSuggestionFreshness(row.id)).toBe("CURRENT");
    // the AI changed nothing: same pointers, same published content, no draft opened
    const after = await recordingRow(promise.recordingId);
    expect(after.currentPublishedRevisionId).toBe(before.currentPublishedRevisionId);
    expect(after.currentDraftRevisionId).toBeNull();
    expect(after.currentPublishedRevision!.description).toBeNull();
    expect(after.currentPublishedRevision!.updatedAt).toEqual(before.currentPublishedRevision!.updatedAt);

    expect(await auditActions("ContentGenerationRequest", [row.generationRequestId])).toEqual(expect.arrayContaining(["CONTENT_GENERATION_REQUESTED", "CONTENT_GENERATION_STARTED"]));
    expect(await auditActions("ContentSuggestion", [row.id])).toContain("CONTENT_SUGGESTION_CREATED");
  }, T);

  it("when the context cannot support a claim the model returns an INFORMATION_GAP — a successful, non-applicable result", async () => {
    const result = await generate(promise.recordingId); // the FakeAIProvider's default output IS an information gap
    if (!result.ok) throw new Error(`generation failed: ${result.reason}`);
    suggestions.gap = result.suggestion.id;
    const row = await suggestionRow(result.suggestion.id);
    expect(row.suggestionType).toBe("INFORMATION_GAP");
    expect(row.targetField).toBeNull();
    expect(JSON.parse(row.proposedContent)).toMatchObject({ missingField: expect.any(String), whyItMatters: expect.any(String), requestedAction: expect.any(String) });
  }, T);

  it("can be requested only by a signed-in Studio user with RECORDING_WRITE (no automatic generation exists)", async () => {
    asRole(null);
    const before = await prisma.contentGenerationRequest.count({ where: { targetEntityId: promise.recordingId } });
    expect(await redirectOf(() => generateEditorialSuggestionAction(form({ recordingId: promise.recordingId })))).toMatch(/permission/);
    expect(await prisma.contentGenerationRequest.count({ where: { targetEntityId: promise.recordingId } })).toBe(before);
  }, T);
});

// ===========================================================================
// 6. Human review — approval and application are separate acts
// ===========================================================================

describe("6. human review", () => {
  it("generates the review-outcome fixtures from the same published context", async () => {
    const changes = await generate(promise.recordingId, await outputFromContext(promise.recordingId, "Performed by the BHC Choir.", "seoMetaDescription"));
    const rejected = await generate(promise.recordingId, await outputFromContext(promise.recordingId, "A Christmas anthem for choir.", "seoMetaTitle"));
    const stale = await generate(promise.recordingId, await outputFromContext(promise.recordingId, "Dancing Into the Promise! — BHC Choir", "seoMetaTitle"));
    if (!changes.ok || !rejected.ok || !stale.ok) throw new Error("fixture generation failed");
    suggestions.changes = changes.suggestion.id;
    suggestions.rejected = rejected.suggestion.id;
    suggestions.stale = stale.suggestion.id;
  }, T);

  it("review actions are server-enforced: a Contributor cannot move a suggestion into review or approve it", async () => {
    asRole("CONTRIBUTOR");
    expect(await redirectOf(() => submitSuggestionAction(suggestions.description))).toMatch(/permission/);
    expect(await redirectOf(() => approveAction(suggestions.description, form()))).toMatch(/permission/);
    expect((await suggestionRow(suggestions.description)).status).toBe("DRAFT_READY");
  }, T);

  it("a transition the lifecycle forbids is reported on the page, not thrown (approve straight from DRAFT_READY, double submit)", async () => {
    asRole("EDITOR");
    const path = await redirectOf(() => approveAction(suggestions.description, form()));
    if (!/\?error=/.test(path)) {
      // some lifecycles allow it; then there is nothing forbidden to report — restore the expected starting point is impossible, so fail loudly
      throw new Error("approve from DRAFT_READY unexpectedly succeeded");
    }
    expect((await suggestionRow(suggestions.description)).status).toBe("DRAFT_READY");
  }, T);

  it("DRAFT_READY → EDITOR_REVIEW; the suggestion is awaiting review, evidence still attached", async () => {
    asRole("EDITOR");
    expect(await redirectOf(() => submitSuggestionAction(suggestions.description))).toBe(`/studio/content-suggestions/${suggestions.description}`);
    expect((await suggestionRow(suggestions.description)).status).toBe("EDITOR_REVIEW");
    // submitting again is refused with a message, status unchanged
    expect(await redirectOf(() => submitSuggestionAction(suggestions.description))).toMatch(/\?error=/);
    const queue = await getEditorialOperationsQueue({ state: "AWAITING_REVIEW", pageSize: 100 });
    const row = queue.rows.find((r) => r.suggestionId === suggestions.description)!;
    expect(row.actions).toEqual(["REVIEW_SUGGESTION"]);
    expect(row.freshness).toBe("CURRENT");
    expect(row.targetField).toBe("description");
  }, T);

  it("CHANGES_REQUESTED needs a reason; REJECTED is terminal and can never be applied", async () => {
    asRole("EDITOR");
    for (const id of [suggestions.changes, suggestions.rejected]) {
      expect(await redirectOf(() => submitSuggestionAction(id))).toBe(`/studio/content-suggestions/${id}`);
    }
    expect(await redirectOf(() => requestChangesAction(suggestions.changes, form({ reviewNote: "  " })))).toMatch(/Explain what changes/);
    expect((await suggestionRow(suggestions.changes)).status).toBe("EDITOR_REVIEW");
    await redirectOf(() => requestChangesAction(suggestions.changes, form({ reviewNote: "Name the venue as well." })));
    expect(await suggestionRow(suggestions.changes)).toMatchObject({ status: "CHANGES_REQUESTED", reviewNote: "Name the venue as well." });

    await redirectOf(() => rejectAction(suggestions.rejected, form({ reason: "INCORRECT", reviewNote: "Not what the recording is." })));
    expect(await suggestionRow(suggestions.rejected)).toMatchObject({ status: "REJECTED", reviewDecision: "REJECT_INCORRECT" });
    // a rejected suggestion cannot be approved afterwards, and cannot be applied
    expect(await redirectOf(() => approveAction(suggestions.rejected, form()))).toMatch(/\?error=/);
    asRole("EDITOR");
    expect(await redirectOf(() => applyToRecordingDraftAction(suggestions.rejected))).toMatch(/\?error=/);
    expect(await findContentSuggestionApplication(suggestions.rejected)).toBeNull();

    const queue = await getEditorialOperationsQueue({ state: "CHANGES_REQUESTED", pageSize: 100 });
    expect(queue.rows.some((r) => r.suggestionId === suggestions.changes)).toBe(true);
    expect((await getEditorialOperationsQueue({ pageSize: 200 })).rows.some((r) => r.suggestionId === suggestions.rejected)).toBe(false);
  }, T);

  it("approval is a human decision that records the editor's own wording — and applies NOTHING", async () => {
    asRole("EDITOR");
    const editorWording = "Dancing Into the Promise! is an Advent choral anthem by John Carter, performed by the BHC Choir under Jacob George at Bishop Heber Chapel.";
    // the stale-fixture suggestion is approved too, so it can be seen to go stale later
    await redirectOf(() => submitSuggestionAction(suggestions.stale));
    await redirectOf(() => approveAction(suggestions.stale, form({})));
    await redirectOf(() => approveAction(suggestions.description, form({ finalContent: editorWording, reviewNote: "Checked against the video description." })));

    const row = await suggestionRow(suggestions.description);
    expect(row).toMatchObject({ status: "APPROVED", reviewDecision: "EDIT_AND_ACCEPT", finalContent: editorWording, proposedContent: DESCRIPTION_TEXT, reviewedById: users.EDITOR });
    expect(await findContentSuggestionApplication(row.id)).toBeNull(); // approval ≠ application

    const rec = await recordingRow(promise.recordingId);
    expect(rec.currentPublishedRevision!.description).toBeNull();
    expect(rec.currentDraftRevisionId).toBeNull();

    const queue = await getEditorialOperationsQueue({ state: "APPROVED_AWAITING_APPLICATION", pageSize: 100 });
    expect(queue.rows.find((r) => r.suggestionId === suggestions.description)?.actions).toEqual(["APPLY_SUGGESTION"]);
    expect(await auditActions("ContentSuggestion", [row.id])).toEqual(expect.arrayContaining(["CONTENT_SUGGESTION_SUBMITTED_FOR_REVIEW", "CONTENT_SUGGESTION_APPROVED"]));
  }, T);

  it("an INFORMATION_GAP can be reviewed and approved but never applied to a Recording", async () => {
    asRole("EDITOR");
    await redirectOf(() => submitSuggestionAction(suggestions.gap));
    await redirectOf(() => approveAction(suggestions.gap, form({})));
    expect((await suggestionRow(suggestions.gap)).status).toBe("APPROVED");
    expect(await redirectOf(() => applyToRecordingDraftAction(suggestions.gap))).toMatch(/\?error=/);
    expect(await findContentSuggestionApplication(suggestions.gap)).toBeNull();
    expect((await getEditorialOperationsQueue({ pageSize: 200 })).rows.some((r) => r.suggestionId === suggestions.gap)).toBe(false);
  }, T);
});

// ===========================================================================
// 7. Apply approved content, then republish — never mutating the live revision
// ===========================================================================

describe("7. apply and republish", () => {
  it("applying the approved wording forks a NEW draft; the live published revision is untouched, nothing is public until publish", async () => {
    const before = await recordingRow(promise.recordingId);
    const liveRevisionId = before.currentPublishedRevisionId!;

    asRole("EDITOR");
    expect(await redirectOf(() => applyToRecordingDraftAction(suggestions.description))).toBe(`/studio/content-suggestions/${suggestions.description}`);

    const after = await recordingRow(promise.recordingId);
    expect(after.currentPublishedRevisionId).toBe(liveRevisionId);
    expect(after.status).toBe("PUBLISHED"); // a live recording stays live while its draft is edited
    expect(after.currentPublishedRevision!.description).toBeNull(); // the live revision is NEVER mutated
    const draft = after.currentDraftRevision!;
    expect(draft.id).not.toBe(liveRevisionId);
    expect(draft.description).toBe("Dancing Into the Promise! is an Advent choral anthem by John Carter, performed by the BHC Choir under Jacob George at Bishop Heber Chapel."); // the editor's wording, not the AI's
    expect(draft.title).toBe("Dancing Into the Promise!");

    // existing works, media (PRIMARY_VIDEO + YouTube link) and the Performance are carried over
    const [live, forked] = await revisions(promise.recordingId);
    expect(forked.works.map((w) => w.musicalWorkId)).toEqual(live.works.map((w) => w.musicalWorkId));
    expect(forked.mediaResources.map((m) => [m.role, m.youtubeVideoId])).toEqual([["PRIMARY_VIDEO", videoIds.get(REAL_VIDEO.PROMISE)]]);
    expect(forked.performanceId).toBe(live.performanceId);

    // public page still shows the live version
    expect((await getPublicRecordingPageData(promise.slug))!.description).toBeNull();

    const application = await findContentSuggestionApplication(suggestions.description);
    expect(application).toMatchObject({ recordingRevisionId: draft.id, forkedDraft: true });
    expect(await auditActions("ContentSuggestion", [suggestions.description])).toContain("CONTENT_SUGGESTION_APPLIED");
    expect(await auditActions("Recording", [promise.recordingId])).toEqual(expect.arrayContaining(["RECORDING_DRAFT_FORKED_FROM_PUBLISHED", "RECORDING_DRAFT_CONTENT_APPLIED"]));

    // a repeat (double click) is refused: applied exactly once
    expect(await redirectOf(() => applyToRecordingDraftAction(suggestions.description))).toMatch(/\?error=/);
    expect(await prisma.recordingRevision.count({ where: { recordingId: promise.recordingId } })).toBe(2);
  }, T);

  it("republishing moves the pointer, supersedes the old revision and keeps history", async () => {
    const draftId = (await recordingRow(promise.recordingId)).currentDraftRevisionId!;
    const oldLiveId = (await recordingRow(promise.recordingId)).currentPublishedRevisionId!;
    asRole("ADMINISTRATOR");
    await redirectOf(() => publishAction(promise.recordingId, draftId));

    const row = await recordingRow(promise.recordingId);
    expect(row).toMatchObject({ status: "PUBLISHED", currentPublishedRevisionId: draftId, currentDraftRevisionId: null });
    const revs = await revisions(promise.recordingId);
    expect(revs.map((r) => [r.id, r.revisionStatus])).toEqual([[oldLiveId, "SUPERSEDED"], [draftId, "PUBLISHED"]]);
    expect((await getPublicRecordingPageData(promise.slug))!.description).toMatch(/Advent choral anthem by John Carter/);
    expect((await searchRecordings("Advent choral anthem", 1, 50)).items.map((r) => r.slug)).toContain(promise.slug);
  }, T);

  it("content that was approved against the OLD context is now STALE and refuses to apply; nothing is written", async () => {
    expect(await checkContentSuggestionFreshness(suggestions.stale)).toBe("STALE");
    const before = await prisma.recordingRevision.count({ where: { recordingId: promise.recordingId } });
    asRole("EDITOR");
    expect(await redirectOf(() => applyToRecordingDraftAction(suggestions.stale))).toMatch(/\?error=/);
    expect(await findContentSuggestionApplication(suggestions.stale)).toBeNull();
    expect(await prisma.recordingRevision.count({ where: { recordingId: promise.recordingId } })).toBe(before);
    expect((await recordingRow(promise.recordingId)).currentDraftRevisionId).toBeNull();
    expect(await auditActions("ContentSuggestion", [suggestions.stale])).toContain("CONTENT_SUGGESTION_APPLY_REFUSED");

    const queue = await getEditorialOperationsQueue({ state: "STALE", pageSize: 100 });
    const staleRows = queue.rows.filter((r) => r.recordingId === promise.recordingId).map((r) => r.suggestionId);
    expect(staleRows).toEqual(expect.arrayContaining([suggestions.stale, suggestions.changes]));
    expect(queue.rows.find((r) => r.suggestionId === suggestions.stale)?.actions).toEqual(["REVIEW_SUGGESTION", "REGENERATE"]);
  }, T);

  it("the Recording, now carrying editorial prose, is no longer offered for generation", async () => {
    const queue = await getEditorialOperationsQueue({ state: "READY_FOR_GENERATION", pageSize: 100 });
    expect(queue.rows.some((r) => r.recordingId === promise.recordingId)).toBe(false);
  }, T);
});

// ===========================================================================
// 8. Unpublish → edit → republish (the 6J-4 lifecycle finding)
// ===========================================================================
//
// Original behaviour (found while QA-ing 6J-3B): unpublishing keeps the last published revision as history and
// opens NO draft, so the Recording had "no open draft revision to publish" and the Review step offered a bogus
// "Submit for editorial review". The only way back to an editable draft (fork) was reachable from the Source
// step only, with wrong copy. The fix keeps unpublish minimal and makes the recovery explicit: "Start a new draft".

describe("8. unpublish and republish", () => {
  it("unpublish is an Administrator action; the others are refused on the server", async () => {
    for (const role of ["CONTRIBUTOR", "EDITOR", "REVIEWER"] as Role[]) {
      asRole(role);
      expect(await redirectOf(() => unpublishAction(promise.recordingId))).toMatch(/permission to unpublish/);
    }
    expect((await recordingRow(promise.recordingId)).status).toBe("PUBLISHED");
  }, T);

  it("unpublishing removes the Recording from every public surface but deletes nothing", async () => {
    const before = await revisions(promise.recordingId);
    asRole("ADMINISTRATOR");
    expect(await redirectOf(() => unpublishAction(promise.recordingId))).toBe(`/studio/recordings/${promise.recordingId}/review`);

    const row = await recordingRow(promise.recordingId);
    expect(row.status).toBe("DRAFT");
    // history is preserved: the published revision is still there, still PUBLISHED, still the pointer
    expect(row.currentPublishedRevision!.revisionStatus).toBe("PUBLISHED");
    expect(row.currentDraftRevisionId).toBeNull();
    expect((await revisions(promise.recordingId)).map((r) => [r.id, r.revisionStatus])).toEqual(before.map((r) => [r.id, r.revisionStatus]));

    // no public leakage anywhere
    expect(await findPublishedRecordingBySlug(promise.slug)).toBeNull();
    expect(await getPublicRecordingPageData(promise.slug)).toBeNull();
    expect((await searchRecordings("Dancing", 1, 100)).items.map((r) => r.slug)).not.toContain(promise.slug);
    expect((await listPublicRecordingSitemapEntries()).map((e) => e.slug)).not.toContain(promise.slug);
    await expect(Promise.resolve(RecordingPage({ params: Promise.resolve({ slug: promise.slug }) }))).rejects.toThrow(); // notFound()
    expect(await recordingMetadata({ params: Promise.resolve({ slug: promise.slug }) })).toEqual({});
    // entities reachable only through this Recording stop being public too (eligibility is derived, not stored)
    expect(await getPublicWorkPageData(promiseEntities.workSlug)).toBeNull();
    expect(await getComposerEntityPageData(promiseEntities.composerSlug)).toBeNull();
    expect((await listPublicComposerSitemapEntries()).map((e) => e.slug)).not.toContain(promiseEntities.composerSlug);
    expect((await listPublicVenueSitemapEntries()).map((e) => e.slug)).not.toContain(promiseEntities.venueSlug);
    // …but the canonical records still exist
    expect(await prisma.composer.count({ where: { id: promiseEntities.composerId } })).toBe(1);
    expect(await prisma.musicalWork.count({ where: { id: promiseEntities.workId } })).toBe(1);
    // the playlist-backed Collection no longer lists it
    expect(await prisma.collectionRecording.count({ where: { recordingId: promise.recordingId } })).toBe(1);
    expect(await auditActions("Recording", [promise.recordingId])).toContain("RECORDING_UNPUBLISHED");
  }, T);

  it("publishing again immediately is refused (nothing to publish) — and 'submit for review' no longer pretends there is a draft", async () => {
    asRole("ADMINISTRATOR");
    const row = await recordingRow(promise.recordingId);
    expect(await redirectOf(() => publishAction(promise.recordingId, row.currentPublishedRevisionId!))).toMatch(/\?error=/);
    expect(await redirectOf(() => submitForReviewAction(promise.recordingId))).toMatch(/can no longer be submitted/);
    const after = await recordingRow(promise.recordingId);
    expect(after.status).toBe("DRAFT"); // NOT moved to IN_REVIEW with nothing in review
    expect(after.currentPublishedRevisionId).toBe(row.currentPublishedRevisionId);
    // The queue treats it as needing work again, not as a published recording
    const queue = await getEditorialOperationsQueue({ state: "NEEDS_ENRICHMENT", pageSize: 100 });
    expect(queue.rows.some((r) => r.recordingId === promise.recordingId)).toBe(true);
  }, T);

  it("'Start a new draft' reopens an editable draft from the last published content — idempotent, permission-gated, never public", async () => {
    asRole(null);
    expect(await redirectOf(() => startNewDraftAction(promise.recordingId, "review"))).toMatch(/permission/);
    expect(await prisma.recordingRevision.count({ where: { recordingId: promise.recordingId } })).toBe(2);

    asRole("CONTRIBUTOR"); // RECORDING_WRITE — editing a draft needs no publish rights
    const lastPublished = (await recordingRow(promise.recordingId)).currentPublishedRevision!;
    expect(await redirectOf(() => startNewDraftAction(promise.recordingId, "review"))).toBe(`/studio/recordings/${promise.recordingId}/review`);
    expect(await redirectOf(() => startNewDraftAction(promise.recordingId, "review"))).toBe(`/studio/recordings/${promise.recordingId}/review`); // double click
    expect(await redirectOf(() => startNewDraftAction(promise.recordingId, "https://evil.example"))).toBe(`/studio/recordings/${promise.recordingId}/review`); // landing step is allow-listed

    const row = await recordingRow(promise.recordingId);
    expect(await prisma.recordingRevision.count({ where: { recordingId: promise.recordingId } })).toBe(3); // exactly ONE new revision
    const draft = row.currentDraftRevision!;
    expect(draft.revisionStatus).toBe("DRAFT");
    expect(draft.description).toBe(lastPublished.description);
    expect(draft.title).toBe(lastPublished.title);
    expect(row.currentPublishedRevisionId).toBe(lastPublished.id); // history untouched
    expect(row.status).not.toBe("PUBLISHED"); // still unpublished
    expect(await getPublicRecordingPageData(promise.slug)).toBeNull();
    expect(revalidated.filter((p) => p === `/studio/recordings/${promise.recordingId}`).length).toBeGreaterThan(0);
    expect(await auditActions("Recording", [promise.recordingId])).toContain("RECORDING_DRAFT_FORKED_FROM_PUBLISHED");

    // works, media and performance came along
    const revs = await revisions(promise.recordingId);
    const forked = revs[revs.length - 1];
    expect(forked.works.map((w) => w.musicalWorkId)).toEqual([promiseEntities.workId]);
    expect(forked.mediaResources.map((m) => m.role)).toEqual(["PRIMARY_VIDEO"]);
    expect(forked.performanceId).toBe(promiseEntities.performanceId);
  }, T);

  it("the editor edits the draft, and the Administrator republishes it", async () => {
    const row = await recordingRow(promise.recordingId);
    await updateDraftRevisionContent(promise.recordingId, row.currentDraftRevision!.updatedAt, users.EDITOR, { seoMetaTitle: "Dancing Into the Promise! — BHC Choir, Bishop Heber Chapel" });

    asRole("EDITOR");
    expect(await redirectOf(() => publishAction(promise.recordingId, row.currentDraftRevisionId!))).toMatch(/permission to publish/); // still not an editor action
    asRole("ADMINISTRATOR");
    expect(await redirectOf(() => publishAction(promise.recordingId, row.currentDraftRevisionId!))).toBe(`/studio/recordings/${promise.recordingId}/review`);

    const after = await recordingRow(promise.recordingId);
    expect(after).toMatchObject({ status: "PUBLISHED", currentPublishedRevisionId: row.currentDraftRevisionId, currentDraftRevisionId: null });
    // revision history is preserved: three revisions, only the newest PUBLISHED, the prior ones SUPERSEDED
    const revs = await revisions(promise.recordingId);
    expect(revs.map((r) => r.revisionNumber)).toEqual([1, 2, 3]);
    expect(revs.map((r) => r.revisionStatus)).toEqual(["SUPERSEDED", "SUPERSEDED", "PUBLISHED"]);

    // publicly visible again, with the edit, and all derived discovery restored
    const data = (await getPublicRecordingPageData(promise.slug))!;
    expect(data.seoMetaTitle).toBe("Dancing Into the Promise! — BHC Choir, Bishop Heber Chapel");
    expect(data.description).toMatch(/Advent choral anthem/);
    expect(data.works.map((w) => w.title)).toEqual(["Dancing Into the Promise!"]);
    expect((await searchRecordings("Dancing", 1, 100)).items.map((r) => r.slug)).toContain(promise.slug);
    expect((await listPublicRecordingSitemapEntries()).map((e) => e.slug)).toContain(promise.slug);
    expect(await getComposerEntityPageData(promiseEntities.composerSlug)).not.toBeNull();
    expect(data.videos).toHaveLength(1);

    const audit = await auditActions("Recording", [promise.recordingId]);
    expect(audit.filter((a) => a === "RECORDING_PUBLISHED")).toHaveLength(3);
    expect(audit.filter((a) => a === "RECORDING_UNPUBLISHED")).toHaveLength(1);
  }, T);

  it("a live Recording with no pending changes offers 'Start a new draft' too — and forking is refused when a draft is already open", async () => {
    asRole("EDITOR");
    expect(await redirectOf(() => startNewDraftAction(promise.recordingId, "source"))).toBe(`/studio/recordings/${promise.recordingId}/source`);
    const row = await recordingRow(promise.recordingId);
    expect(row.status).toBe("PUBLISHED"); // a live recording stays live while its draft is edited
    expect(row.currentDraftRevisionId).not.toBeNull();
    expect(await getPublicRecordingPageData(promise.slug)).not.toBeNull();
    await expect(forkDraftFromPublished(promise.recordingId, users.EDITOR)).rejects.toThrow(); // one open draft at a time
    expect(await prisma.recordingRevision.count({ where: { recordingId: promise.recordingId } })).toBe(4);
  }, T);
});

// ===========================================================================
// 9. Archive / restore — archived records stay archived
// ===========================================================================

describe("9. archived Recordings", () => {
  it("archive is an Administrator action and removes the Recording from every public surface", async () => {
    asRole("EDITOR");
    expect(await redirectOf(() => archiveAction(promise.recordingId))).toMatch(/permission to archive/);
    asRole("ADMINISTRATOR");
    expect(await redirectOf(() => archiveAction(promise.recordingId))).toBe("/studio/recordings");
    expect((await recordingRow(promise.recordingId)).status).toBe("ARCHIVED");
    expect(await getPublicRecordingPageData(promise.slug)).toBeNull();
    expect((await searchRecordings("Dancing", 1, 100)).items.map((r) => r.slug)).not.toContain(promise.slug);
    expect((await listPublicRecordingSitemapEntries()).map((e) => e.slug)).not.toContain(promise.slug);
    // archiving twice changes nothing
    const audit1 = (await auditActions("Recording", [promise.recordingId])).filter((a) => a === "RECORDING_ARCHIVED").length;
    await redirectOf(() => archiveAction(promise.recordingId));
    expect((await auditActions("Recording", [promise.recordingId])).filter((a) => a === "RECORDING_ARCHIVED").length).toBe(audit1);
  }, T);

  it("an archived Recording cannot be published, edited into a new draft, generated for, or applied to", async () => {
    asRole("ADMINISTRATOR");
    const row = await recordingRow(promise.recordingId);
    expect(await redirectOf(() => publishAction(promise.recordingId, row.currentDraftRevisionId!))).toMatch(/\?error=/);
    expect((await recordingRow(promise.recordingId)).status).toBe("ARCHIVED");
    asRole("EDITOR");
    expect(await redirectOf(() => startNewDraftAction(promise.recordingId, "review"))).toMatch(/archived/i);
    expect(await redirectOf(() => generateEditorialSuggestionAction(form({ recordingId: promise.recordingId })))).toMatch(/\?error=/);
    expect(await getRecordingContext(promise.recordingId, "PUBLISHED")).toEqual({ ok: false, reason: "ARCHIVED" });
    expect((await getEditorialOperationsQueue({ pageSize: 200 })).rows.some((r) => r.recordingId === promise.recordingId)).toBe(false);
  }, T);

  it("restore returns a Recording to DRAFT — it never republishes", async () => {
    asRole("EDITOR");
    expect(await redirectOf(() => restoreAction(promise.recordingId))).toMatch(/permission to restore/);
    asRole("ADMINISTRATOR");
    await redirectOf(() => restoreAction(promise.recordingId));
    const row = await recordingRow(promise.recordingId);
    expect(row.status).toBe("DRAFT");
    expect(await getPublicRecordingPageData(promise.slug)).toBeNull();
    expect((await listPublicRecordingSitemapEntries()).map((e) => e.slug)).not.toContain(promise.slug);
    const audit = await auditActions("Recording", [promise.recordingId]);
    expect(audit).toEqual(expect.arrayContaining(["RECORDING_ARCHIVED", "RECORDING_RESTORED"]));
  }, T);
});

// ===========================================================================
// 10. Audit trail and test-data hygiene
// ===========================================================================

describe("10. audit trail", () => {
  it("every step of the PROMISE lifecycle is attributable, in order", async () => {
    const rows = await prisma.auditLogEntry.findMany({ where: { entityType: "Recording", entityId: promise.recordingId }, orderBy: { timestamp: "asc" } });
    const actions = rows.map((r) => r.action);
    expect(actions.slice(0, 2)).toEqual(["RECORDING_DRAFT_CREATED", "RECORDING_CREATED_FROM_YOUTUBE_VIDEO"]);
    for (const expected of ["RECORDING_PUBLISHED", "RECORDING_DRAFT_FORKED_FROM_PUBLISHED", "RECORDING_DRAFT_CONTENT_APPLIED", "RECORDING_UNPUBLISHED", "RECORDING_ARCHIVED", "RECORDING_RESTORED"]) {
      expect(actions).toContain(expected);
    }
    // each Studio-initiated entry names the human who did it
    for (const entry of rows) expect(Object.values(users)).toContain(entry.actorId);
    const published = rows.filter((r) => r.action === "RECORDING_PUBLISHED");
    expect(published.every((r) => r.actorId === users.ADMINISTRATOR)).toBe(true);
    // intake is recorded against the video as well
    expect(await prisma.auditLogEntry.count({ where: { action: "RECORDING_CREATED_FROM_YOUTUBE_VIDEO", entityId: promise.recordingId } })).toBe(1);
  }, T);

  it("the synced YouTube records were never modified by any step of the workflow", async () => {
    expect(await fixtureRowsFingerprint()).toBe(fixtureFingerprint);
  }, T);
});
