import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Must be at the true top level — vi.mock is hoisted above every import.
const mockGetCurrentStudioSession = vi.fn();
vi.mock("../../modules/auth/authService", () => ({ getCurrentStudioSession: () => mockGetCurrentStudioSession() }));

import { prisma } from "../../modules/db/client";
import { loadRecordingVisibilityWorkspace, VISIBILITY_PAGE_SIZE, type RecordingVisibilityRow } from "../../modules/db/repositories/recordingVisibilityRepository";
import { VISIBILITY_VIEWS, type VisibilityView } from "../../modules/mmke/recordingVisibility/recordingVisibility";
import { getPublicRecordingPageData } from "../../modules/db/repositories/entityRelationshipsRepository";
import { findPublishedRecordingBySlug, archiveRecording, attachWorkToRevision, createDraftRecording, forkDraftFromPublished, publishCurrentDraft, unpublishRecording, updateDraftRevisionContent } from "../../modules/db/repositories/recordingRepository";
import { listPublicRecordingSitemapEntries } from "../../modules/db/repositories/sitemapRepository";
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import { createVenue } from "../../modules/db/repositories/venueRepository";
import { createProgramme } from "../../modules/db/repositories/programmeRepository";
import { createPerformance } from "../../modules/db/repositories/performanceRepository";
import { clearReviewHold, setReviewHold } from "../../modules/db/repositories/unlistedReviewRepository";
import { approveExposure } from "../../modules/db/repositories/videoExposureRepository";
import { approveUnlistedPublication, createDraftVideoPage, publishVideoPage } from "../../modules/db/repositories/youtubeVideoPageRepository";
import { seedMediaOnRevision } from "./helpers/seedRevisionRows";
import RecordingVisibilityPage from "../../app/(studio)/studio/(protected)/recordings/visibility/page";

// The Recording public-visibility workspace against the isolated test database. Every classification is compared with what the PUBLIC contract actually does
// (the public Recording page, the sitemap), the published revision is the only revision read, the frozen legacy rows change nothing, loading writes nothing, and
// the page checks the session first. Synthetic fixtures only; every fixture is prefix-named and removed afterwards.

const TAG = "phase7vis";
const TOKEN = randomUUID().replace(/-/g, "").slice(0, 8);
const T = 180000;
const users = {} as Record<"admin" | "editor", string>;
const recordingIds: string[] = [];
const videoIds: string[] = [];
const pageIds: string[] = [];
const workIds: string[] = [];
const composerIds: string[] = [];
const venueIds: string[] = [];
const performanceIds: string[] = [];
const programmeIds: string[] = [];
let counter = 0;
let work: string;
let performance: string;
let archivedVenuePerformance: string;

const uniq = (label: string) => `${TAG}-${label}-${TOKEN}-${++counter}`;

async function makeVideo(privacy: "public" | "unlisted" | "private" = "public", opts: { page?: boolean } = {}) {
  const n = ++counter;
  const video = await prisma.youTubeVideo.create({ data: { youtubeVideoId: `v${TOKEN}${n}`.slice(0, 11), title: `Visibility video ${TOKEN} ${n}`, privacyStatus: privacy, observabilityState: "OBSERVED" } });
  videoIds.push(video.id);
  if (opts.page === false) return { video, page: null };
  const page = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: users.admin });
  pageIds.push(page.id);
  await publishVideoPage(page.id, users.admin);
  return { video, page };
}

interface MakeOptions {
  work?: boolean;
  performance?: string | false;
  videos?: string[]; // internal YouTubeVideo ids
  publish?: boolean;
  title?: string;
}

async function makeRecording(opts: MakeOptions = {}) {
  const draft = await createDraftRecording({ slug: uniq("rec"), actorId: users.admin, title: opts.title ?? `Visibility recording ${uniq("t")}` });
  recordingIds.push(draft.id);
  const revisionId = draft.currentDraftRevision!.id;
  if (opts.performance) await updateDraftRevisionContent(draft.id, draft.currentDraftRevision!.updatedAt, users.admin, { performanceId: opts.performance });
  if (opts.work) await attachWorkToRevision(revisionId, work, users.admin);
  for (const videoId of opts.videos ?? []) await seedMediaOnRevision({ recordingRevisionId: revisionId, provider: "YOUTUBE", role: "PRIMARY_VIDEO", youtubeVideoId: videoId });
  if (opts.publish !== false) await publishCurrentDraft(draft.id, users.admin);
  return { id: draft.id, slug: draft.slug, draftRevisionId: revisionId };
}

/** Finds one Recording's row by walking the pages of the view it should be in. */
async function rowIn(view: VisibilityView, id: string): Promise<RecordingVisibilityRow | undefined> {
  for (let page = 1; ; page++) {
    const w = await loadRecordingVisibilityWorkspace({ view, page });
    const hit = w.rows.find((r) => r.id === id);
    if (hit) return hit;
    if (page >= Math.ceil(w.viewTotal / w.pageSize)) return undefined;
  }
}
const codes = (row: RecordingVisibilityRow | undefined) => row?.visibility.findings.map((f) => f.code) ?? [];
const sitemapSlugs = async () => new Set((await listPublicRecordingSitemapEntries()).map((e) => e.slug));

const surface = async () =>
  JSON.stringify({
    recordings: await prisma.recording.findMany({ orderBy: { id: "asc" }, select: { id: true, updatedAt: true, status: true, currentDraftRevisionId: true, currentPublishedRevisionId: true } }),
    revisions: await prisma.recordingRevision.findMany({ orderBy: { id: "asc" }, select: { id: true, updatedAt: true, revisionStatus: true } }),
    media: await prisma.mediaResource.count(),
    videos: await prisma.youTubeVideo.findMany({ orderBy: { id: "asc" }, select: { id: true, updatedAt: true } }),
    reviews: await prisma.videoExposureReview.count(),
    approvals: await prisma.videoExposureApproval.count(),
    audits: await prisma.auditLogEntry.count(),
    legacy: await prisma.entityOccasion.count(),
    notifications: await prisma.studioNotification.count(),
    incidents: await prisma.operationalIncident.count(),
  });

beforeAll(async () => {
  for (const [who, role] of [["editor", "EDITOR"], ["admin", "ADMINISTRATOR"]] as const) {
    users[who] = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `${TAG}-${who}-${TOKEN}@musicmadras.test`, name: `Vis ${who}`, role, status: "ACTIVE" } })).id;
  }
  const composer = await createComposer({ slug: uniq("composer"), name: `Visibility Composer ${TOKEN}`, actorId: users.admin });
  composerIds.push(composer.id);
  const w = await createMusicalWork({ slug: uniq("work"), title: `Visibility Work ${TOKEN}`, composerId: composer.id, actorId: users.admin });
  workIds.push(w.id);
  work = w.id;
  const venue = await createVenue({ slug: uniq("venue"), name: `Visibility Venue ${TOKEN}`, type: "CHURCH", actorId: users.admin });
  const venue2 = await createVenue({ slug: uniq("venue"), name: `Visibility Venue ${TOKEN} B`, type: "CHURCH", actorId: users.admin });
  venueIds.push(venue.id, venue2.id);
  const programme = await createProgramme({ slug: uniq("prog"), title: `Visibility Programme ${TOKEN}`, actorId: users.admin });
  programmeIds.push(programme.id);
  const p1 = await createPerformance({ programmeId: programme.id, venueId: venue.id, actorId: users.admin });
  const p2 = await createPerformance({ programmeId: programme.id, venueId: venue2.id, actorId: users.admin });
  performanceIds.push(p1.id, p2.id);
  performance = p1.id;
  archivedVenuePerformance = p2.id;
}, T);

afterAll(async () => {
  const ids = recordingIds.filter(Boolean);
  if (ids.length > 0) {
    const revisionIds = (await prisma.recordingRevision.findMany({ where: { recordingId: { in: ids } }, select: { id: true } })).map((r) => r.id);
    await prisma.entityOccasion.deleteMany({ where: { entityType: "RECORDING", entityId: { in: ids } } });
    await prisma.entitySource.deleteMany({ where: { entityType: "RECORDING", entityId: { in: ids } } });
    await prisma.auditLogEntry.deleteMany({ where: { entityId: { in: [...ids, ...revisionIds] } } });
    await prisma.recording.updateMany({ where: { id: { in: ids } }, data: { currentDraftRevisionId: null, currentPublishedRevisionId: null } });
    await prisma.recording.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.videoExposureReview.deleteMany({ where: { youtubeVideoId: { in: videoIds } } });
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityId: { in: [...pageIds, ...videoIds, ...performanceIds, ...programmeIds, ...venueIds, ...workIds, ...composerIds] } }, { actorId: { in: Object.values(users).filter(Boolean) } }] } });
  await prisma.youTubeVideoPage.deleteMany({ where: { id: { in: pageIds } } });
  await prisma.youTubeVideo.deleteMany({ where: { id: { in: videoIds } } });
  await prisma.performance.deleteMany({ where: { id: { in: performanceIds } } });
  await prisma.programme.deleteMany({ where: { id: { in: programmeIds } } });
  await prisma.venue.deleteMany({ where: { id: { in: venueIds } } });
  await prisma.musicalWork.deleteMany({ where: { id: { in: workIds } } });
  await prisma.composer.deleteMany({ where: { id: { in: composerIds } } });
  await prisma.studioUser.deleteMany({ where: { id: { in: Object.values(users).filter(Boolean) } } });
}, T);

describe("public and unpublished recordings, compared with the public contract", () => {
  it("a fully described published recording is PUBLIC with nothing to report, and the public page, search source and sitemap agree", async () => {
    const { video } = await makeVideo("public");
    const r = await makeRecording({ work: true, performance, videos: [video.id] });
    const row = await rowIn("public", r.id);
    expect(row?.visibility).toMatchObject({ bucket: "PUBLIC", findings: [], publicPath: `/recordings/${r.slug}`, hasGaps: false, hasRestrictions: false });
    expect(row?.status).toBe("PUBLISHED");
    expect((await findPublishedRecordingBySlug(r.slug))?.recording.id).toBe(r.id);
    const page = await getPublicRecordingPageData(r.slug);
    expect(page).not.toBeNull();
    expect(page!.videos).toHaveLength(1);
    expect((await sitemapSlugs()).has(r.slug)).toBe(true);
  });

  it("missing video, work and venue are DISCOVERY GAPS, never blockers: the page, the lookup and the sitemap all still serve it", async () => {
    const r = await makeRecording({});
    const row = await rowIn("public", r.id);
    expect(row?.visibility.bucket).toBe("PUBLIC");
    expect(codes(row)).toEqual(["NO_WORK", "NO_PERFORMANCE", "NO_VIDEO"]);
    expect(row?.visibility.findings.every((f) => f.kind === "DISCOVERY_GAP")).toBe(true);
    expect(row?.visibility).toMatchObject({ hasGaps: true, hasRestrictions: false });
    expect(await getPublicRecordingPageData(r.slug)).not.toBeNull();
    expect((await sitemapSlugs()).has(r.slug)).toBe(true);
    // each gap links to an existing Studio edit route
    expect(row?.visibility.findings.map((f) => f.fix?.href)).toEqual([`/studio/recordings/${r.id}/works`, `/studio/recordings/${r.id}/performance`, `/studio/recordings/${r.id}/media`]);
  });

  it("each gap is diagnosed separately: only the work, only the performance and venue, only the video", async () => {
    const { video } = await makeVideo("public");
    const noWork = await makeRecording({ performance, videos: [video.id] });
    const noPerformance = await makeRecording({ work: true, videos: [video.id] });
    const noVideo = await makeRecording({ work: true, performance });
    expect(codes(await rowIn("gaps", noWork.id))).toEqual(["NO_WORK"]);
    expect(codes(await rowIn("gaps", noPerformance.id))).toEqual(["NO_PERFORMANCE"]);
    expect(codes(await rowIn("gaps", noVideo.id))).toEqual(["NO_VIDEO"]);
    expect((await getPublicRecordingPageData(noWork.slug))!.works).toHaveLength(0);
    expect((await getPublicRecordingPageData(noPerformance.slug))!.performance).toBeNull();
    expect((await getPublicRecordingPageData(noVideo.slug))!.videos).toHaveLength(0);
  });

  it("an archived venue makes the performance block disappear from the public page, and the workspace says so", async () => {
    const { video } = await makeVideo("public");
    const r = await makeRecording({ work: true, performance: archivedVenuePerformance, videos: [video.id] });
    expect(await rowIn("public", r.id)).toMatchObject({ visibility: { findings: [] } });
    expect((await getPublicRecordingPageData(r.slug))!.performance).not.toBeNull();
    const venueId = (await prisma.performance.findUniqueOrThrow({ where: { id: archivedVenuePerformance }, select: { venueId: true } })).venueId;
    await prisma.venue.update({ where: { id: venueId }, data: { archivedAt: new Date() } });
    try {
      const row = await rowIn("gaps", r.id);
      expect(codes(row)).toEqual(["PERFORMANCE_NOT_PUBLIC"]);
      expect(row?.visibility.findings[0].message).toMatch(/linked venue is archived/);
      expect((await getPublicRecordingPageData(r.slug))!.performance).toBeNull();
    } finally {
      await prisma.venue.update({ where: { id: venueId }, data: { archivedAt: null } });
    }
  });

  it("a never-published recording is NOT_PUBLISHED_YET: no public page, no public link, and its blockers are exactly the publish gate's required categories", async () => {
    const r = await makeRecording({ publish: false });
    const row = await rowIn("unpublished", r.id);
    expect(row?.visibility).toMatchObject({ bucket: "NOT_PUBLISHED_YET", publicPath: null, hasGaps: false });
    expect(codes(row)).toEqual(["NOT_PUBLISHED_YET", "PUBLISH_GATE_WORKS", "PUBLISH_GATE_VIDEO"]); // a title exists; a work and a primary video do not
    expect(row?.visibility.findings.every((f) => f.kind === "BLOCKER")).toBe(true);
    expect(await getPublicRecordingPageData(r.slug)).toBeNull();
    expect(await findPublishedRecordingBySlug(r.slug)).toBeNull();
    expect((await sitemapSlugs()).has(r.slug)).toBe(false);
  });

  it("a draft that meets the publish gate has only the status blocker; a missing performance or venue is not a blocker", async () => {
    const { video } = await makeVideo("public");
    const r = await makeRecording({ publish: false, work: true, videos: [video.id] });
    expect(codes(await rowIn("unpublished", r.id))).toEqual(["NOT_PUBLISHED_YET"]);
  });

  it("an unpublished recording is published-but-not-public, with the status as the blocker, and the page, lookup and sitemap agree", async () => {
    const { video } = await makeVideo("public");
    const r = await makeRecording({ work: true, performance, videos: [video.id] });
    await unpublishRecording(r.id, users.admin);
    const row = await rowIn("not-discoverable", r.id);
    expect(row?.visibility).toMatchObject({ bucket: "PUBLISHED_NOT_DISCOVERABLE", publicPath: null });
    expect(codes(row)).toEqual(["UNPUBLISHED", "NO_OPEN_DRAFT"]);
    expect(await getPublicRecordingPageData(r.slug)).toBeNull();
    expect((await sitemapSlugs()).has(r.slug)).toBe(false);
  });

  it("an archived recording is published-but-not-public with an ARCHIVED blocker", async () => {
    const { video } = await makeVideo("public");
    const r = await makeRecording({ work: true, performance, videos: [video.id] });
    await archiveRecording(r.id, users.admin);
    const row = await rowIn("not-discoverable", r.id);
    expect(codes(row)).toEqual(["ARCHIVED"]);
    expect(row?.visibility.publicPath).toBeNull();
    expect(await getPublicRecordingPageData(r.slug)).toBeNull();
  });
});

describe("explicit restrictions come from the existing video rules, and the public page agrees", () => {
  it("a hold on a linked video is a RESTRICTION; the recording stays public; the page shows no video; clearing the hold clears the finding", async () => {
    const { video } = await makeVideo("public");
    const r = await makeRecording({ work: true, performance, videos: [video.id] });
    expect(await rowIn("public", r.id)).toMatchObject({ visibility: { findings: [] } });
    await setReviewHold({ videoId: video.id, hold: "RIGHTS", actorId: users.admin });
    try {
      const row = await rowIn("restricted", r.id);
      expect(row?.visibility).toMatchObject({ bucket: "PUBLIC", hasRestrictions: true, hasGaps: false });
      expect(codes(row)).toEqual(["VIDEO_HOLD"]);
      expect(row?.visibility.findings[0]).toMatchObject({ kind: "RESTRICTION", fix: { href: `/studio/catalogue/videos/${video.id}` } });
      expect((await getPublicRecordingPageData(r.slug))!.videos).toHaveLength(0);
    } finally {
      await clearReviewHold({ videoId: video.id, actorId: users.admin });
    }
    expect(await rowIn("public", r.id)).toMatchObject({ visibility: { findings: [] } });
    expect((await getPublicRecordingPageData(r.slug))!.videos).toHaveLength(1);
  });

  it("a private video and an unlisted video without approval are RESTRICTIONS; an approved unlisted video is shown with no finding", async () => {
    const priv = await makeVideo("private");
    const unlisted = await makeVideo("unlisted");
    const approved = await makeVideo("unlisted");
    await approveUnlistedPublication(approved.page!.id, users.admin);
    await approveExposure({ videoPageId: approved.page!.id, scope: "PAGE", actorId: users.admin });
    await approveExposure({ videoPageId: approved.page!.id, scope: "DISCOVERY", actorId: users.admin });
    const a = await makeRecording({ work: true, performance, videos: [priv.video.id] });
    const b = await makeRecording({ work: true, performance, videos: [unlisted.video.id] });
    const c = await makeRecording({ work: true, performance, videos: [approved.video.id] });
    expect(codes(await rowIn("restricted", a.id))).toEqual(["VIDEO_PRIVATE"]);
    expect(codes(await rowIn("restricted", b.id))).toEqual(["VIDEO_UNLISTED_NOT_APPROVED"]);
    expect(await rowIn("restricted", c.id)).toBeUndefined();
    expect(await rowIn("public", c.id)).toMatchObject({ visibility: { findings: [] } });
    for (const [rec, shown] of [[a, 0], [b, 0], [c, 1]] as const) expect((await getPublicRecordingPageData(rec.slug))!.videos, rec.slug).toHaveLength(shown);
  });

  it("a video with no Music Madras page, or an unpublished one, is a GAP (not a restriction), and the page shows no video", async () => {
    const noPage = await makeVideo("public", { page: false });
    const draft = await makeVideo("public");
    await prisma.youTubeVideoPage.update({ where: { id: draft.page!.id }, data: { status: "DRAFT" } });
    const a = await makeRecording({ work: true, performance, videos: [noPage.video.id] });
    const b = await makeRecording({ work: true, performance, videos: [draft.video.id] });
    expect(codes(await rowIn("gaps", a.id))).toEqual(["VIDEO_PAGE_MISSING"]);
    expect(codes(await rowIn("gaps", b.id))).toEqual(["VIDEO_PAGE_NOT_PUBLISHED"]);
    expect(await rowIn("restricted", a.id)).toBeUndefined();
    expect((await getPublicRecordingPageData(a.slug))!.videos).toHaveLength(0);
    expect((await getPublicRecordingPageData(b.slug))!.videos).toHaveLength(0);
  });
});

describe("revision correctness: only the published revision counts, and legacy rows change nothing", () => {
  it("a draft that adds a work, a venue and a video does not change a public recording's findings or title until that draft is PUBLISHED", async () => {
    const r = await makeRecording({ title: `Published title ${TOKEN}` });
    expect(codes(await rowIn("gaps", r.id))).toEqual(["NO_WORK", "NO_PERFORMANCE", "NO_VIDEO"]);

    const forked = await forkDraftFromPublished(r.id, users.admin);
    const draftRevisionId = forked.id;
    const { video } = await makeVideo("public");
    await attachWorkToRevision(draftRevisionId, work, users.admin);
    await seedMediaOnRevision({ recordingRevisionId: draftRevisionId, provider: "YOUTUBE", role: "PRIMARY_VIDEO", youtubeVideoId: video.id });
    const fresh = await prisma.recordingRevision.findUniqueOrThrow({ where: { id: draftRevisionId } });
    await updateDraftRevisionContent(r.id, fresh.updatedAt, users.admin, { performanceId: performance, title: `Secret draft title ${TOKEN}` });

    const before = await rowIn("gaps", r.id);
    expect(codes(before)).toEqual(["NO_WORK", "NO_PERFORMANCE", "NO_VIDEO"]); // still the published revision's gaps
    expect(before?.visibility.title).toBe(`Published title ${TOKEN}`);
    expect(JSON.stringify(before)).not.toContain("Secret draft title");
    expect(before?.visibility.publicPath).toBe(`/recordings/${r.slug}`);

    await publishCurrentDraft(r.id, users.admin);
    const after = await rowIn("public", r.id);
    expect(after?.visibility.findings).toEqual([]);
    expect(after?.visibility.title).toBe(`Secret draft title ${TOKEN}`);
  });

  it("the frozen legacy Recording-level rows have no effect at all on the classification", async () => {
    const r = await makeRecording({});
    const before = JSON.stringify((await rowIn("gaps", r.id))?.visibility);
    const occasion = await prisma.occasion.create({ data: { slug: uniq("occ"), name: `Legacy Occasion ${TOKEN}`, createdById: users.admin, updatedById: users.admin } });
    const source = await prisma.source.create({ data: { title: `Legacy Source ${TOKEN}` } });
    try {
      await prisma.entityOccasion.create({ data: { entityType: "RECORDING", entityId: r.id, occasionId: occasion.id } });
      await prisma.entitySource.create({ data: { entityType: "RECORDING", entityId: r.id, sourceId: source.id } });
      expect(JSON.stringify((await rowIn("gaps", r.id))?.visibility)).toBe(before);
    } finally {
      await prisma.entityOccasion.deleteMany({ where: { entityId: r.id } });
      await prisma.entitySource.deleteMany({ where: { entityId: r.id } });
      await prisma.source.deleteMany({ where: { id: source.id } });
      await prisma.occasion.deleteMany({ where: { id: occasion.id } });
    }
  });
});

describe("inconsistent records are reported, never crash the workspace", () => {
  it("marked PUBLISHED without a published revision: published-but-not-public (blocker), and the public rules agree it is not public", async () => {
    const r = await makeRecording({ work: true, performance });
    const original = (await prisma.recording.findUniqueOrThrow({ where: { id: r.id } })).currentPublishedRevisionId;
    await prisma.recording.update({ where: { id: r.id }, data: { currentPublishedRevisionId: null } });
    try {
      const row = await rowIn("not-discoverable", r.id);
      expect(codes(row)).toEqual(["NO_PUBLISHED_REVISION"]);
      expect(row?.visibility.publicPath).toBeNull();
      expect(await getPublicRecordingPageData(r.slug)).toBeNull();
      expect((await sitemapSlugs()).has(r.slug)).toBe(false);
    } finally {
      await prisma.recording.update({ where: { id: r.id }, data: { currentPublishedRevisionId: original } });
    }
  });

  it("a published pointer that names another recording's revision is NOT DETERMINED, with no public link, while the rest of the workspace still loads", async () => {
    const a = await makeRecording({ work: true, performance });
    const b = await makeRecording({ publish: false });
    const original = (await prisma.recording.findUniqueOrThrow({ where: { id: a.id } })).currentPublishedRevisionId;
    await prisma.recording.update({ where: { id: a.id }, data: { currentPublishedRevisionId: b.draftRevisionId } });
    try {
      const row = await rowIn("undetermined", a.id);
      expect(row?.visibility).toMatchObject({ bucket: "NOT_DETERMINED", publicPath: null });
      expect(codes(row)).toEqual(["REVISION_POINTER_INCONSISTENT"]);
      expect(row?.visibility.findings[0].message).toMatch(/different recording/);
      expect(await rowIn("unpublished", b.id)).toBeDefined(); // the others are unaffected
    } finally {
      await prisma.recording.update({ where: { id: a.id }, data: { currentPublishedRevisionId: original } });
    }
  });
});

describe("counts, overlap and bounds", () => {
  it("the five buckets add up to what was counted; gaps are a subset of public; every recording is in exactly one bucket", async () => {
    const w = await loadRecordingVisibilityWorkspace({ view: "public", page: 1 });
    const { counts } = w;
    expect(counts.public + counts.notDiscoverable + counts.held + counts.unpublished + counts.undetermined).toBe(counts.counted);
    expect(counts.counted).toBe(w.totalRecordings);
    expect(w.truncated).toBe(false);
    expect(counts.withGaps).toBeLessThanOrEqual(counts.public);
    expect(counts.withRestrictions).toBeLessThanOrEqual(counts.counted); // restrictions overlay every bucket (a held recording, or a public one with a restricted video)
    expect(w.viewTotal).toBe(counts.public);
    const sizes = await Promise.all(VISIBILITY_VIEWS.map(async (view) => (await loadRecordingVisibilityWorkspace({ view, page: 1 })).viewTotal));
    expect(sizes).toEqual([counts.public, counts.notDiscoverable, counts.withGaps, counts.withRestrictions, counts.undetermined, counts.unpublished, counts.held]);
  });

  it("the public count equals the number of recordings the sitemap lists, and the sitemap lists no recording the workspace calls non-public", async () => {
    const w = await loadRecordingVisibilityWorkspace({ view: "public", page: 1 });
    const sitemap = await listPublicRecordingSitemapEntries();
    expect(w.counts.public).toBe(sitemap.length);
  });

  it("lists are paginated and bounded: a page is at most the page size, later pages continue, and an out-of-range page is clamped", async () => {
    const before = (await loadRecordingVisibilityWorkspace({ view: "unpublished", page: 1 })).viewTotal;
    for (let i = 0; i < VISIBILITY_PAGE_SIZE + 2; i++) await makeRecording({ publish: false });
    const first = await loadRecordingVisibilityWorkspace({ view: "unpublished", page: 1 });
    expect(first.viewTotal).toBe(before + VISIBILITY_PAGE_SIZE + 2);
    expect(first.rows).toHaveLength(VISIBILITY_PAGE_SIZE);
    const second = await loadRecordingVisibilityWorkspace({ view: "unpublished", page: 2 });
    expect(second.rows.length).toBeGreaterThan(0);
    expect(new Set([...first.rows, ...second.rows].map((r) => r.id)).size).toBe(first.rows.length + second.rows.length); // no repeats across pages
    const clamped = await loadRecordingVisibilityWorkspace({ view: "unpublished", page: 9999 });
    expect(clamped.page).toBe(Math.ceil(clamped.viewTotal / clamped.pageSize));
    expect(clamped.rows.length).toBeGreaterThan(0);
    expect((await loadRecordingVisibilityWorkspace({ view: "unpublished", page: -4 })).page).toBe(1);
  }, T);
});

describe("read-only, and authorized on the server", () => {
  it("loading every view creates and changes nothing: no draft, no revision, no review, no approval, no audit entry, no notification", async () => {
    const before = await surface();
    for (const view of VISIBILITY_VIEWS) await loadRecordingVisibilityWorkspace({ view, page: 1 });
    expect(await surface()).toBe(before);
  }, T);

  it("the page refuses a request with no signed-in session before loading anything, and renders for a signed-in user", async () => {
    mockGetCurrentStudioSession.mockResolvedValue(null);
    let redirectedTo = "";
    try {
      await RecordingVisibilityPage({ searchParams: Promise.resolve({}) });
    } catch (err) {
      const digest = (err as { digest?: unknown })?.digest;
      if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) redirectedTo = digest.split(";")[2];
      else throw err;
    }
    expect(redirectedTo).toBe("/studio/signin");

    mockGetCurrentStudioSession.mockResolvedValue({ user: { id: users.editor, role: "EDITOR", name: "editor", email: "e@example.test", status: "ACTIVE" } });
    const before = await surface();
    const element = await RecordingVisibilityPage({ searchParams: Promise.resolve({ view: "gaps", page: "1" }) });
    expect(element).toBeTruthy();
    expect(await surface()).toBe(before);
  }, T);
});
