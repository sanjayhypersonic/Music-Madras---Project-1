import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Must be at the true top level — vi.mock is hoisted above every import.
const mockGetCurrentStudioSession = vi.fn();
vi.mock("../../modules/auth/authService", () => ({ getCurrentStudioSession: () => mockGetCurrentStudioSession() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "../../modules/db/client";
import { RecordingHoldError, imposeRecordingHold, liftRecordingHold } from "../../modules/db/repositories/recordingHoldRepository";
import { loadRecordingVisibilityWorkspace, type RecordingVisibilityRow } from "../../modules/db/repositories/recordingVisibilityRepository";
import type { VisibilityView } from "../../modules/mmke/recordingVisibility/recordingVisibility";
import {
  getPublicCollectionPageData,
  getPublicPerformancePageData,
  getPublicProgrammePageData,
  getPublicRecordingPageData,
  getPublicWorkPageData,
  getVenueEntityPageData,
} from "../../modules/db/repositories/entityRelationshipsRepository";
import { findPublishedRecordingBySlug, attachWorkToRevision, createDraftRecording, forkDraftFromPublished, publishCurrentDraft, unpublishRecording, updateDraftRevisionContent } from "../../modules/db/repositories/recordingRepository";
import { listPublicPerformanceSitemapEntries, listPublicRecordingSitemapEntries } from "../../modules/db/repositories/sitemapRepository";
import { searchRecordings, searchWorks } from "../../modules/db/repositories/archiveSearchRepository";
import { getPublicOccasionPageData } from "../../modules/db/repositories/occasionPageRepository";
import { createOccasion } from "../../modules/db/repositories/occasionRepository";
import { attachOccasionToRevision } from "../../modules/db/repositories/recordingRevisionRelationshipsRepository";
import { addRecordingToCollection, createCollection, publishCollection } from "../../modules/db/repositories/collectionRepository";
import { findPublishedRecordingSlugForYouTubeVideo } from "../../modules/db/repositories/mediaResourceRepository";
import { clearReviewHold, getVideoHold, setReviewHold } from "../../modules/db/repositories/unlistedReviewRepository";
import { createDraftVideoPage, findPublicVideoPagesByYouTubeVideoIds, findPublishedBySlug, publishVideoPage } from "../../modules/db/repositories/youtubeVideoPageRepository";
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import { createVenue } from "../../modules/db/repositories/venueRepository";
import { createProgramme } from "../../modules/db/repositories/programmeRepository";
import { createPerformance } from "../../modules/db/repositories/performanceRepository";
import { seedMediaOnRevision } from "./helpers/seedRevisionRows";
import { imposeHoldAction, liftHoldAction } from "../../app/(studio)/studio/(protected)/recordings/[id]/review/actions";

// Recording-level holds (project register R-20) against the isolated test database: imposing and lifting, the audit trail, the permission, every public
// surface withholding a held Recording, a held video versus a held Recording, an unpublished Recording staying unpublished after a hold is lifted, published-
// revision safety with no legacy fallback, and the visibility workspace showing the right status. Synthetic fixtures only, prefix-named and removed afterwards.

const TAG = "phase7hold";
const TOKEN = randomUUID().replace(/-/g, "").slice(0, 8);
const T = 240000;
const users = {} as Record<"admin" | "editor", string>;
const recordingIds: string[] = [];
const videoIds: string[] = [];
const pageIds: string[] = [];
const workIds: string[] = [];
const composerIds: string[] = [];
const venueIds: string[] = [];
const performanceIds: string[] = [];
const programmeIds: string[] = [];
const occasionIds: string[] = [];
const collectionIds: string[] = [];
let counter = 0;

const uniq = (label: string) => `${TAG}-${label}-${TOKEN}-${++counter}`;
const as = (who: keyof typeof users | null) =>
  mockGetCurrentStudioSession.mockResolvedValue(who ? { user: { id: users[who], role: who === "admin" ? "ADMINISTRATOR" : "EDITOR", name: who, email: `${who}@example.test`, status: "ACTIVE" } } : null);

async function redirectOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    const digest = (err as { digest?: unknown })?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) return decodeURIComponent(digest.split(";").slice(2, -2).join(";").replace(/\+/g, " "));
    throw err;
  }
  throw new Error("did not redirect");
}
const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(entries)) data.set(k, v);
  return data;
};

async function makeVideo(privacy: "public" | "unlisted" = "public") {
  const n = ++counter;
  const video = await prisma.youTubeVideo.create({ data: { youtubeVideoId: `h${TOKEN}${n}`.slice(0, 11), title: `Hold video ${TOKEN} ${n}`, privacyStatus: privacy, observabilityState: "OBSERVED" } });
  videoIds.push(video.id);
  const page = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: users.admin });
  pageIds.push(page.id);
  await publishVideoPage(page.id, users.admin);
  return { video, page };
}

async function makeSite() {
  const venue = await createVenue({ slug: uniq("venue"), name: `Hold Venue ${uniq("v")}`, type: "CHURCH", actorId: users.admin });
  const programme = await createProgramme({ slug: uniq("prog"), title: `Hold Programme ${uniq("p")}`, actorId: users.admin });
  const performance = await createPerformance({ programmeId: programme.id, venueId: venue.id, actorId: users.admin });
  venueIds.push(venue.id);
  programmeIds.push(programme.id);
  performanceIds.push(performance.id);
  return { venue, programme, performance };
}

async function makeWork() {
  const composer = await createComposer({ slug: uniq("composer"), name: `Hold Composer ${uniq("c")}`, actorId: users.admin });
  composerIds.push(composer.id);
  const work = await createMusicalWork({ slug: uniq("work"), title: `Hold Work ${uniq("w")}`, composerId: composer.id, actorId: users.admin });
  workIds.push(work.id);
  return work;
}

interface MakeOptions {
  work?: string;
  performance?: string;
  videos?: string[];
  occasions?: string[];
  publish?: boolean;
  title?: string;
}

async function makeRecording(opts: MakeOptions = {}) {
  const title = opts.title ?? `Hold recording ${uniq("t")}`;
  const draft = await createDraftRecording({ slug: uniq("rec"), actorId: users.admin, title });
  recordingIds.push(draft.id);
  const revisionId = draft.currentDraftRevision!.id;
  if (opts.performance) await updateDraftRevisionContent(draft.id, draft.currentDraftRevision!.updatedAt, users.admin, { performanceId: opts.performance });
  if (opts.work) await attachWorkToRevision(revisionId, opts.work, users.admin);
  for (const videoId of opts.videos ?? []) await seedMediaOnRevision({ recordingRevisionId: revisionId, provider: "YOUTUBE", role: "PRIMARY_VIDEO", youtubeVideoId: videoId });
  for (const occasionId of opts.occasions ?? []) await attachOccasionToRevision(revisionId, occasionId, users.admin);
  if (opts.publish !== false) await publishCurrentDraft(draft.id, users.admin);
  return { id: draft.id, slug: draft.slug, title, draftRevisionId: revisionId };
}

async function newOccasion() {
  const o = await createOccasion({ slug: uniq("occ"), name: `Hold Occasion ${uniq("o")}`, description: "About", actorId: users.admin });
  occasionIds.push(o.id);
  return o;
}

async function rowIn(view: VisibilityView, id: string, includeHoldNotes = false): Promise<RecordingVisibilityRow | undefined> {
  for (let page = 1; ; page++) {
    const w = await loadRecordingVisibilityWorkspace({ view, page, includeHoldNotes });
    const hit = w.rows.find((r) => r.id === id);
    if (hit) return hit;
    if (page >= Math.ceil(w.viewTotal / w.pageSize)) return undefined;
  }
}
const codes = (row: RecordingVisibilityRow | undefined) => row?.visibility.findings.map((f) => f.code) ?? [];

const recordingState = async (id: string) => {
  const r = await prisma.recording.findUniqueOrThrow({ where: { id } });
  const revisions = await prisma.recordingRevision.findMany({ where: { recordingId: id }, orderBy: { id: "asc" }, select: { id: true, revisionStatus: true, updatedAt: true, title: true } });
  return JSON.stringify({ status: r.status, published: r.currentPublishedRevisionId, draft: r.currentDraftRevisionId, slug: r.slug, revisions });
};
const holdColumns = async (id: string) => {
  const r = await prisma.recording.findUniqueOrThrow({ where: { id } });
  return { reason: r.holdReason, note: r.holdNote, setAt: r.holdSetAt, setBy: r.holdSetById };
};
const holdAudit = (id: string) => prisma.auditLogEntry.findMany({ where: { entityType: "Recording", entityId: id, action: { in: ["RECORDING_HOLD_SET", "RECORDING_HOLD_LIFTED"] } }, orderBy: { timestamp: "asc" } });

beforeAll(async () => {
  for (const [who, role] of [["editor", "EDITOR"], ["admin", "ADMINISTRATOR"]] as const) {
    users[who] = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `${TAG}-${who}-${TOKEN}@musicmadras.test`, name: `Hold ${who}`, role, status: "ACTIVE" } })).id;
  }
}, T);

afterAll(async () => {
  const ids = recordingIds.filter(Boolean);
  if (ids.length > 0) {
    const revisionIds = (await prisma.recordingRevision.findMany({ where: { recordingId: { in: ids } }, select: { id: true } })).map((r) => r.id);
    await prisma.collectionRecording.deleteMany({ where: { recordingId: { in: ids } } });
    await prisma.entityOccasion.deleteMany({ where: { entityType: "RECORDING", entityId: { in: ids } } });
    await prisma.auditLogEntry.deleteMany({ where: { entityId: { in: [...ids, ...revisionIds] } } });
    await prisma.recording.updateMany({ where: { id: { in: ids } }, data: { currentDraftRevisionId: null, currentPublishedRevisionId: null, holdReason: null, holdNote: null, holdSetAt: null, holdSetById: null } });
    await prisma.recording.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.videoExposureReview.deleteMany({ where: { youtubeVideoId: { in: videoIds } } });
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityId: { in: [...pageIds, ...videoIds, ...performanceIds, ...programmeIds, ...venueIds, ...workIds, ...composerIds, ...occasionIds, ...collectionIds] } }, { actorId: { in: Object.values(users).filter(Boolean) } }] } });
  await prisma.entityOccasion.deleteMany({ where: { occasionId: { in: occasionIds } } });
  await prisma.occasion.deleteMany({ where: { id: { in: occasionIds } } });
  await prisma.collection.deleteMany({ where: { id: { in: collectionIds } } });
  await prisma.youTubeVideoPage.deleteMany({ where: { id: { in: pageIds } } });
  await prisma.youTubeVideo.deleteMany({ where: { id: { in: videoIds } } });
  await prisma.performance.deleteMany({ where: { id: { in: performanceIds } } });
  await prisma.programme.deleteMany({ where: { id: { in: programmeIds } } });
  await prisma.venue.deleteMany({ where: { id: { in: venueIds } } });
  await prisma.musicalWork.deleteMany({ where: { id: { in: workIds } } });
  await prisma.composer.deleteMany({ where: { id: { in: composerIds } } });
  await prisma.studioUser.deleteMany({ where: { id: { in: Object.values(users).filter(Boolean) } } });
}, T);

describe("imposing and lifting a hold, and every public surface", () => {
  it("withholds the Recording from its page, lookup, sitemap, search, collection, occasion, video link and the pages its content alone made public; lifting restores exactly that; nothing about publication changes", async () => {
    const work = await makeWork();
    const site = await makeSite();
    const { video, page: videoPage } = await makeVideo("public");
    const occasion = await newOccasion();
    const r = await makeRecording({ work: work.id, performance: site.performance.id, videos: [video.id], occasions: [occasion.id] });
    const collection = await createCollection({ slug: uniq("coll"), title: `Hold collection ${TOKEN}`, actorId: users.admin });
    collectionIds.push(collection.id);
    await publishCollection(collection.id, users.admin);
    await addRecordingToCollection(collection.id, r.id, users.admin);

    const surfaces = async () => ({
      recordingPage: (await getPublicRecordingPageData(r.slug)) !== null,
      recordingLookup: (await findPublishedRecordingBySlug(r.slug)) !== null,
      sitemap: (await listPublicRecordingSitemapEntries()).some((e) => e.slug === r.slug),
      search: (await searchRecordings(r.title)).items.some((i) => i.id === r.id),
      workSearch: (await searchWorks(work.title)).items.some((i) => i.id === work.id),
      collectionPage: ((await getPublicCollectionPageData(collection.slug))?.recordings ?? []).some((i) => i.id === r.id),
      occasionPage: (await getPublicOccasionPageData(occasion.slug)) !== null,
      performancePage: (await getPublicPerformancePageData(site.performance.slug)) !== null,
      programmePage: (await getPublicProgrammePageData(site.programme.slug)) !== null,
      venuePage: (await getVenueEntityPageData(site.venue.slug)) !== null,
      workPage: (await getPublicWorkPageData(work.slug)) !== null,
      performanceSitemap: (await listPublicPerformanceSitemapEntries()).some((e) => e.slug === site.performance.slug),
      videoPointsToRecording: (await findPublishedRecordingSlugForYouTubeVideo(video.id)) === r.slug,
      // not a Recording surface: the video's own page, which a Recording hold must not touch
      videoPage: (await findPublishedBySlug(videoPage.slug)) !== null,
    });
    const everythingOn = { recordingPage: true, recordingLookup: true, sitemap: true, search: true, workSearch: true, collectionPage: true, occasionPage: true, performancePage: true, programmePage: true, venuePage: true, workPage: true, performanceSitemap: true, videoPointsToRecording: true, videoPage: true };

    expect(await surfaces()).toEqual(everythingOn);
    const before = await recordingState(r.id);
    expect(await holdColumns(r.id)).toEqual({ reason: null, note: null, setAt: null, setBy: null });

    await imposeRecordingHold({ recordingId: r.id, reason: "RIGHTS", note: "  Claim received from the rights holder  ", actorId: users.admin });
    expect(await holdColumns(r.id)).toEqual({ reason: "RIGHTS", note: "Claim received from the rights holder", setAt: expect.any(Date), setBy: users.admin });
    expect(await surfaces()).toEqual({ ...Object.fromEntries(Object.keys(everythingOn).map((k) => [k, false])), videoPage: true });
    // publication state and revisions are untouched by imposing the hold
    expect(await recordingState(r.id)).toBe(before);
    expect((await prisma.recording.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("PUBLISHED");

    await liftRecordingHold({ recordingId: r.id, actorId: users.admin });
    expect(await holdColumns(r.id)).toEqual({ reason: null, note: null, setAt: null, setBy: null });
    expect(await surfaces()).toEqual(everythingOn);
    expect(await recordingState(r.id)).toBe(before);

    // the audit log is the history: who, what, when, why — and what it was when lifted
    const audit = await holdAudit(r.id);
    expect(audit.map((a) => a.action)).toEqual(["RECORDING_HOLD_SET", "RECORDING_HOLD_LIFTED"]);
    expect(audit.every((a) => a.actorId === users.admin)).toBe(true);
    expect(audit[0].afterSnapshot).toMatchObject({ holdReason: "RIGHTS", holdNote: "Claim received from the rights holder" });
    expect(audit[1].beforeSnapshot).toMatchObject({ holdReason: "RIGHTS", holdNote: "Claim received from the rights holder", holdSetById: users.admin });
  }, T);

  it("refuses a second hold, lifting a hold that does not exist, an unknown recording and an unknown kind of hold; the note is trimmed and bounded", async () => {
    const r = await makeRecording({});
    await expect(liftRecordingHold({ recordingId: r.id, actorId: users.admin })).rejects.toMatchObject({ reason: "NOT_HELD" });
    await imposeRecordingHold({ recordingId: r.id, reason: "OTHER", note: "x".repeat(900), actorId: users.admin });
    expect((await holdColumns(r.id)).note).toHaveLength(500);
    await expect(imposeRecordingHold({ recordingId: r.id, reason: "PRIVACY", actorId: users.admin })).rejects.toBeInstanceOf(RecordingHoldError);
    expect((await holdColumns(r.id)).reason).toBe("OTHER"); // the first hold stands, not overwritten
    await expect(imposeRecordingHold({ recordingId: randomUUID(), reason: "RIGHTS", actorId: users.admin })).rejects.toMatchObject({ reason: "NOT_FOUND" });
    await expect(imposeRecordingHold({ recordingId: r.id, reason: "NONSENSE" as never, actorId: users.admin })).rejects.toBeInstanceOf(RecordingHoldError);
    await liftRecordingHold({ recordingId: r.id, actorId: users.admin });
    expect((await holdAudit(r.id)).map((a) => a.action)).toEqual(["RECORDING_HOLD_SET", "RECORDING_HOLD_LIFTED"]); // refusals wrote nothing
  }, T);

  it("the database refuses a half-recorded hold (a reason without a time, or a time without a reason)", async () => {
    const r = await makeRecording({});
    await expect(prisma.recording.update({ where: { id: r.id }, data: { holdReason: "RIGHTS" } })).rejects.toThrow();
    await expect(prisma.recording.update({ where: { id: r.id }, data: { holdSetAt: new Date() } })).rejects.toThrow();
    expect((await holdColumns(r.id)).reason).toBeNull();
  }, T);
});

describe("authorization is enforced on the server", () => {
  it("only a user who may publish can impose or lift a hold; everyone else is refused with nothing changed and nothing audited", async () => {
    const r = await makeRecording({});
    const post = (kind: "impose" | "lift") => (kind === "impose" ? imposeHoldAction(r.id, form({ reason: "COPYRIGHT", note: "n" })) : liftHoldAction(r.id));

    for (const who of [null, "editor"] as const) {
      as(who);
      expect(await redirectOf(() => post("impose")), String(who)).toMatch(/permission to put a recording on hold/);
      expect((await holdColumns(r.id)).reason).toBeNull();
    }

    as("admin");
    expect(await redirectOf(() => post("impose"))).toBe(`/studio/recordings/${r.id}/review`);
    expect((await holdColumns(r.id)).reason).toBe("COPYRIGHT");

    for (const who of [null, "editor"] as const) {
      as(who);
      expect(await redirectOf(() => post("lift")), String(who)).toMatch(/permission to lift a hold/);
      expect((await holdColumns(r.id)).reason).toBe("COPYRIGHT"); // still held: the refused lift changed nothing
    }

    as("admin");
    expect(await redirectOf(() => post("lift"))).toBe(`/studio/recordings/${r.id}/review`);
    expect((await holdColumns(r.id)).reason).toBeNull();
    const audit = await holdAudit(r.id);
    expect(audit.map((a) => a.action)).toEqual(["RECORDING_HOLD_SET", "RECORDING_HOLD_LIFTED"]);
    expect(audit.every((a) => a.actorId === users.admin)).toBe(true);
  }, T);

  it("the permission matrix: contributor, editor and reviewer are refused; administrator, super administrator and founder may impose and lift", async () => {
    const asRole = (role: string) => mockGetCurrentStudioSession.mockResolvedValue({ user: { id: users.admin, role, name: role, email: `${role}@example.test`, status: "ACTIVE" } });
    const r = await makeRecording({});
    for (const role of ["CONTRIBUTOR", "EDITOR", "REVIEWER"]) {
      asRole(role);
      expect(await redirectOf(() => imposeHoldAction(r.id, form({ reason: "RIGHTS" }))), role).toMatch(/permission to put a recording on hold/);
      expect((await holdColumns(r.id)).reason, role).toBeNull();
    }
    for (const role of ["ADMINISTRATOR", "SUPER_ADMINISTRATOR", "FOUNDER"]) {
      asRole(role);
      expect(await redirectOf(() => imposeHoldAction(r.id, form({ reason: "RIGHTS" }))), role).toBe(`/studio/recordings/${r.id}/review`);
      expect((await holdColumns(r.id)).reason, role).toBe("RIGHTS");
      // a role that may not lift is refused while the hold stands
      asRole("REVIEWER");
      expect(await redirectOf(() => liftHoldAction(r.id)), `${role} hold, reviewer lift`).toMatch(/permission to lift a hold/);
      expect((await holdColumns(r.id)).reason, role).toBe("RIGHTS");
      asRole(role);
      expect(await redirectOf(() => liftHoldAction(r.id)), role).toBe(`/studio/recordings/${r.id}/review`);
      expect((await holdColumns(r.id)).reason, role).toBeNull();
    }
    expect((await holdAudit(r.id)).length).toBe(6); // three holds, three lifts, nothing from the refused attempts
  }, T);
  it("a hold action with no kind, or on a recording that is already held, reports the problem and changes nothing", async () => {
    const r = await makeRecording({});
    as("admin");
    expect(await redirectOf(() => imposeHoldAction(r.id, form({ note: "n" })))).toMatch(/Choose the kind of hold/);
    expect((await holdColumns(r.id)).reason).toBeNull();
    await redirectOf(() => imposeHoldAction(r.id, form({ reason: "PRIVACY" })));
    expect(await redirectOf(() => imposeHoldAction(r.id, form({ reason: "RIGHTS" })))).toMatch(/already on hold/);
    expect((await holdColumns(r.id)).reason).toBe("PRIVACY");
    await redirectOf(() => liftHoldAction(r.id));
  }, T);
});

describe("a held video versus a held Recording", () => {
  it("holding a video does not hold its Recording; holding the Recording does not hold its video", async () => {
    const { video, page } = await makeVideo("public");
    const work = await makeWork();
    const site = await makeSite();
    const r = await makeRecording({ work: work.id, performance: site.performance.id, videos: [video.id] });

    // A held VIDEO: the Recording stays public (its page, lookup and sitemap entry), with the video as a restriction in the workspace
    await setReviewHold({ videoId: video.id, hold: "RIGHTS", actorId: users.admin });
    try {
      expect((await getPublicRecordingPageData(r.slug)) !== null).toBe(true);
      expect((await holdColumns(r.id)).reason).toBeNull();
      const row = await rowIn("restricted", r.id);
      expect(row?.visibility.bucket).toBe("PUBLIC");
      expect(codes(row)).toEqual(["VIDEO_HOLD"]);
    } finally {
      await clearReviewHold({ videoId: video.id, actorId: users.admin });
    }

    // A held RECORDING: the video stays exactly as public as before, and has no hold of its own
    await imposeRecordingHold({ recordingId: r.id, reason: "PRIVACY", actorId: users.admin });
    try {
      expect(await getVideoHold(video.id)).toBeNull();
      expect((await findPublishedBySlug(page.slug)) !== null).toBe(true);
      expect((await findPublicVideoPagesByYouTubeVideoIds([video.id])).length).toBe(1);
      expect(await getPublicRecordingPageData(r.slug)).toBeNull();
      expect(await findPublishedRecordingSlugForYouTubeVideo(video.id)).toBeNull(); // the video page no longer links to the held Recording
      const row = await rowIn("held", r.id);
      expect(row?.visibility.bucket).toBe("HELD");
      expect(codes(row)).toEqual(["RECORDING_HOLD"]); // no video finding: the video is not the cause
    } finally {
      await liftRecordingHold({ recordingId: r.id, actorId: users.admin });
    }
    expect(await findPublishedRecordingSlugForYouTubeVideo(video.id)).toBe(r.slug);
  }, T);
});

describe("lifting a hold never publishes", () => {
  it("a recording that was never published, and one that was unpublished, are exactly as unpublished after impose and lift", async () => {
    const work = await makeWork();
    const { video } = await makeVideo("public");
    const draft = await makeRecording({ publish: false, work: work.id, videos: [video.id] }); // complete enough to publish, but not published
    const gone = await makeRecording({ work: work.id, videos: [video.id] });
    await unpublishRecording(gone.id, users.admin);

    for (const r of [draft, gone]) {
      const before = await recordingState(r.id);
      await imposeRecordingHold({ recordingId: r.id, reason: "OTHER", actorId: users.admin });
      expect(await getPublicRecordingPageData(r.slug)).toBeNull();
      await liftRecordingHold({ recordingId: r.id, actorId: users.admin });
      expect(await recordingState(r.id)).toBe(before);
      expect(await getPublicRecordingPageData(r.slug)).toBeNull();
      expect(await findPublishedRecordingBySlug(r.slug)).toBeNull();
      expect((await listPublicRecordingSitemapEntries()).some((e) => e.slug === r.slug)).toBe(false);
    }
    expect((await prisma.recording.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("DRAFT");
    expect((await prisma.recording.findUniqueOrThrow({ where: { id: draft.id } })).currentPublishedRevisionId).toBeNull();
  }, T);

  it("publishing a recording that is on hold changes nothing public; the lifted hold then shows it, because it IS published", async () => {
    const r = await makeRecording({ publish: false });
    await imposeRecordingHold({ recordingId: r.id, reason: "RIGHTS", actorId: users.admin });
    await publishCurrentDraft(r.id, users.admin);
    expect(await getPublicRecordingPageData(r.slug)).toBeNull();
    expect((await rowIn("held", r.id))?.visibility.bucket).toBe("HELD");
    await liftRecordingHold({ recordingId: r.id, actorId: users.admin });
    expect(await getPublicRecordingPageData(r.slug)).not.toBeNull();
  }, T);
});

describe("published-revision safety and no legacy fallback", () => {
  it("a hold changes no revision, no revision-scoped relationship and no legacy row, and only the PUBLISHED revision's occasion ever reaches a public page", async () => {
    const work = await makeWork();
    const site = await makeSite();
    const published = await newOccasion(); // carried by the published revision
    const draftOnly = await newOccasion(); // carried only by the open draft
    const legacyOnly = await newOccasion(); // linked only by a frozen legacy Recording-level row
    const r = await makeRecording({ work: work.id, performance: site.performance.id, occasions: [published.id] });
    const forked = await forkDraftFromPublished(r.id, users.admin);
    await attachOccasionToRevision(forked.id, draftOnly.id, users.admin);
    await prisma.entityOccasion.create({ data: { entityType: "RECORDING", entityId: r.id, occasionId: legacyOnly.id } });

    const pages = async () => ({ published: (await getPublicOccasionPageData(published.slug)) !== null, draftOnly: (await getPublicOccasionPageData(draftOnly.slug)) !== null, legacyOnly: (await getPublicOccasionPageData(legacyOnly.slug)) !== null });
    const counts = async () => JSON.stringify({ revisionLinks: await prisma.recordingRevisionOccasion.count(), legacy: await prisma.entityOccasion.count(), revisionSources: await prisma.recordingRevisionSource.count(), revisionRights: await prisma.recordingRevisionRights.count(), revisions: await prisma.recordingRevision.count() });

    expect(await pages()).toEqual({ published: true, draftOnly: false, legacyOnly: false });
    const before = { state: await recordingState(r.id), counts: await counts() };

    await imposeRecordingHold({ recordingId: r.id, reason: "RIGHTS", actorId: users.admin });
    expect(await pages()).toEqual({ published: false, draftOnly: false, legacyOnly: false }); // held: even its published occasion goes; the others never appear
    expect({ state: await recordingState(r.id), counts: await counts() }).toEqual(before);

    await liftRecordingHold({ recordingId: r.id, actorId: users.admin });
    expect(await pages()).toEqual({ published: true, draftOnly: false, legacyOnly: false });
    expect({ state: await recordingState(r.id), counts: await counts() }).toEqual(before);
  }, T);
});

describe("the Recording visibility workspace shows the hold", () => {
  it("a held published recording moves from 'public' to 'held' (and 'restricted') with the hold as its finding and no public link; counts add up; lifting returns it", async () => {
    const work = await makeWork();
    const { video } = await makeVideo("public");
    const site = await makeSite();
    const r = await makeRecording({ work: work.id, performance: site.performance.id, videos: [video.id] });
    const counts = async () => (await loadRecordingVisibilityWorkspace({ view: "public", page: 1 })).counts;

    const before = await counts();
    expect(await rowIn("public", r.id)).toMatchObject({ visibility: { bucket: "PUBLIC", findings: [] } });

    await imposeRecordingHold({ recordingId: r.id, reason: "COPYRIGHT", note: "Takedown notice", actorId: users.admin });
    const during = await counts();
    expect(during.public).toBe(before.public - 1);
    expect(during.held).toBe(before.held + 1);
    expect(during.withRestrictions).toBe(before.withRestrictions + 1);
    expect(during.public + during.notDiscoverable + during.held + during.unpublished + during.undetermined).toBe(during.counted);
    expect(await rowIn("public", r.id)).toBeUndefined();

    // Notes are for people who can manage holds: the default (and what a contributor, editor or reviewer gets) carries no note at all, in any field.
    const anonymous = await rowIn("held", r.id);
    expect(anonymous?.visibility.bucket).toBe("HELD");
    expect(anonymous?.visibility.findings[0].message).not.toMatch(/Takedown notice|Note:/);
    expect(JSON.stringify(anonymous)).not.toContain("Takedown notice");
    const held = await rowIn("held", r.id, true);
    expect(held?.visibility).toMatchObject({ bucket: "HELD", publicPath: null, hasRestrictions: true, hasGaps: false });
    expect(held?.status).toBe("PUBLISHED"); // the publication state is shown as it is: the hold does not rewrite it
    expect(held?.visibility.findings).toEqual([expect.objectContaining({ kind: "RESTRICTION", code: "RECORDING_HOLD", fix: { label: expect.any(String), href: `/studio/recordings/${r.id}/review` } })]);
    expect(held?.visibility.findings[0].message).toMatch(/On hold \(copyright/);
    expect(held?.visibility.findings[0].message).toMatch(/Note: Takedown notice/);
    expect(await rowIn("restricted", r.id)).toBeDefined();

    await liftRecordingHold({ recordingId: r.id, actorId: users.admin });
    expect(await counts()).toEqual(before);
    expect(await rowIn("public", r.id)).toMatchObject({ visibility: { bucket: "PUBLIC", findings: [] } });
  }, T);

  it("a recording held while still a draft stays 'not published yet', with its blockers and the hold that will outlast publication", async () => {
    const r = await makeRecording({ publish: false });
    await imposeRecordingHold({ recordingId: r.id, reason: "PRIVACY", actorId: users.admin });
    try {
      const row = await rowIn("unpublished", r.id);
      expect(row?.visibility.bucket).toBe("NOT_PUBLISHED_YET");
      expect(codes(row)).toEqual(["NOT_PUBLISHED_YET", "PUBLISH_GATE_WORKS", "PUBLISH_GATE_VIDEO", "RECORDING_HOLD"]);
      expect(await rowIn("held", r.id)).toBeUndefined(); // not "held": nothing of it is public to withhold
      expect(await rowIn("restricted", r.id)).toBeDefined();
    } finally {
      await liftRecordingHold({ recordingId: r.id, actorId: users.admin });
    }
  }, T);
});
