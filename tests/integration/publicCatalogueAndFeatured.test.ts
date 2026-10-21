import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Must be at the true top level — vi.mock is hoisted above every import.
const mockGetCurrentStudioSession = vi.fn();
vi.mock("../../modules/auth/authService", () => ({ getCurrentStudioSession: () => mockGetCurrentStudioSession() }));

import { prisma } from "../../modules/db/client";
import { createEditorialDraftFromBuiltIn, publishEditorialContent, resolveEditorialBlock, resolveEditorialBlocks, unpublishEditorialContent, createEditorialDraft, getPublishedEditorialBlock } from "../../modules/db/repositories/editorialContentRepository";
import { loadFeaturedPlan, moveFeaturedVideo, pinFeaturedVideo, unpinFeaturedVideo } from "../../modules/db/repositories/featuredVideoRepository";
import { resetSiteSetting, updateSiteSetting } from "../../modules/db/repositories/siteSettingRepository";
import { searchPublicVideoCatalogue } from "../../modules/db/repositories/videoCatalogueRepository";
import { approveExposure, revokeExposure } from "../../modules/db/repositories/videoExposureRepository";
import { createDraftVideoPage, publishVideoPage } from "../../modules/db/repositories/youtubeVideoPageRepository";
import { FeaturedNotEligibleError, FeaturedNotFoundError } from "../../modules/mmke/featured/featuredErrors";
import { moveAction, pinAction, unpinAction } from "../../app/(studio)/studio/(protected)/catalogue/featured/actions";

// Phase 6K-3 — the public Videos catalogue, featured videos, and editorial block resolution, against the isolated test database. Synthetic
// data only; assertions concern the rows this file creates (the catalogue is isolated by a unique search token).

const TAG = randomUUID().slice(0, 8);
const T = 60000;
const users = {} as Record<"admin" | "editor", string>;
const roles = { admin: "ADMINISTRATOR", editor: "EDITOR" } as const;
const videoIds: string[] = [];
const pageIds: string[] = [];
const EDITORIAL_SLUGS = ["museum-home-story", "museum-videos-intro", "museum-footer-tagline"];
let counter = 0;
const HOUR = 3_600_000;

interface MadeVideo {
  videoId: string;
  pageId: string;
  slug: string;
}

async function makeVideo(opts: { privacy?: string | null; observed?: "OBSERVED" | "NOT_OBSERVED"; publish?: boolean; views?: number | null; ageHours?: number; title?: string; description?: string } = {}): Promise<MadeVideo> {
  const n = ++counter;
  const video = await prisma.youTubeVideo.create({
    data: {
      youtubeVideoId: `c${TAG}${n}`.slice(0, 11),
      title: opts.title ?? `Catalogue ${TAG} ${n}`,
      description: opts.description ?? null,
      privacyStatus: opts.privacy === undefined ? "public" : opts.privacy,
      observabilityState: opts.observed ?? "OBSERVED",
      currentViewCount: opts.views === undefined ? n : opts.views,
      publishedAt: new Date(Date.now() - (opts.ageHours ?? n) * HOUR),
    },
  });
  videoIds.push(video.id);
  const page = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: users.admin });
  pageIds.push(page.id);
  if (opts.publish !== false) await publishVideoPage(page.id, users.admin);
  return { videoId: video.id, pageId: page.id, slug: page.slug };
}

const as = (who: keyof typeof users) => mockGetCurrentStudioSession.mockResolvedValue({ user: { id: users[who], role: roles[who], name: who, email: `${who}@example.test`, status: "ACTIVE" } });
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
const catalogueIds = async (extra: Partial<Parameters<typeof searchPublicVideoCatalogue>[0]> = {}) =>
  (await searchPublicVideoCatalogue({ q: TAG, page: 1, pageSize: 100, sort: "newest", ...extra })).items.map((i) => i.page.id);

beforeAll(async () => {
  for (const who of Object.keys(roles) as (keyof typeof users)[]) {
    users[who] = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `x6k3-${who}-${TAG}@musicmadras.test`, name: `Catalogue ${who}`, role: roles[who], status: "ACTIVE" } })).id;
  }
  await prisma.editorialContent.deleteMany({ where: { slug: { in: EDITORIAL_SLUGS } } });
}, T);

afterAll(async () => {
  await prisma.editorialContent.deleteMany({ where: { slug: { in: EDITORIAL_SLUGS } } });
  await prisma.siteSetting.deleteMany({ where: { key: { startsWith: "featured." } } });
  await prisma.siteSetting.deleteMany({ where: { key: { startsWith: "catalogue." } } });
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityId: { in: pageIds } }, { actorId: { in: Object.values(users) } }] } });
  await prisma.youTubeVideoPage.deleteMany({ where: { id: { in: pageIds } } }); // cascades pins and approvals
  await prisma.youTubeVideo.deleteMany({ where: { id: { in: videoIds } } });
  await prisma.studioUser.deleteMany({ where: { id: { in: Object.values(users) } } });
}, T);

describe("the public Videos catalogue", () => {
  it("lists only what the shared rule lets the Museum list", async () => {
    const listed = await makeVideo();
    const draft = await makeVideo({ publish: false });
    const priv = await makeVideo({ privacy: "private" });
    const gone = await makeVideo({ observed: "NOT_OBSERVED" });
    const noVisibility = await makeVideo({ privacy: null });
    const unlistedUnapproved = await makeVideo({ privacy: "unlisted" });
    const unlistedPageOnly = await makeVideo({ privacy: "unlisted" });
    const unlistedListed = await makeVideo({ privacy: "unlisted" });
    await approveExposure({ videoPageId: unlistedPageOnly.pageId, scope: "PAGE", actorId: users.admin });
    await approveExposure({ videoPageId: unlistedListed.pageId, scope: "PAGE", actorId: users.admin });
    await approveExposure({ videoPageId: unlistedListed.pageId, scope: "DISCOVERY", actorId: users.admin });

    const ids = new Set(await catalogueIds());
    expect(ids).toEqual(new Set([listed.pageId, unlistedListed.pageId]));
    for (const hidden of [draft, priv, gone, noVisibility, unlistedUnapproved, unlistedPageOnly]) expect(ids.has(hidden.pageId)).toBe(false);

    await revokeExposure({ videoPageId: unlistedListed.pageId, scope: "DISCOVERY", actorId: users.admin }); // revocation removes it from the listing
    expect((await catalogueIds()).includes(unlistedListed.pageId)).toBe(false);
  }, T);

  it("paginates in the database with an accurate total, and a page size is honoured", async () => {
    const token = `pg${TAG}`;
    const made: MadeVideo[] = [];
    for (let i = 0; i < 5; i++) made.push(await makeVideo({ title: `${token} item ${i}`, ageHours: 1000 + i }));
    const page1 = await searchPublicVideoCatalogue({ q: token, page: 1, pageSize: 2, sort: "newest" });
    expect(page1).toMatchObject({ total: 5, totalPages: 3, page: 1, pageSize: 2 });
    expect(page1.items).toHaveLength(2);
    const page3 = await searchPublicVideoCatalogue({ q: token, page: 3, pageSize: 2, sort: "newest" });
    expect(page3.items).toHaveLength(1);
    const beyond = await searchPublicVideoCatalogue({ q: token, page: 9, pageSize: 2, sort: "newest" });
    expect(beyond.items).toHaveLength(0);
    expect(beyond.total).toBe(5);
    const all = [...page1.items, ...(await searchPublicVideoCatalogue({ q: token, page: 2, pageSize: 2, sort: "newest" })).items, ...page3.items].map((i) => i.page.id);
    expect(new Set(all).size).toBe(5); // no repeats or gaps across pages
    expect(new Set(all)).toEqual(new Set(made.map((m) => m.pageId)));
  }, T);

  it("orders newest first or most viewed first, deterministically", async () => {
    const token = `ord${TAG}`;
    const oldPopular = await makeVideo({ title: `${token} old popular`, views: 9000, ageHours: 5000 });
    const newQuiet = await makeVideo({ title: `${token} new quiet`, views: 5, ageHours: 1 });
    const noViews = await makeVideo({ title: `${token} no views`, views: null, ageHours: 100 });
    const byNewest = (await searchPublicVideoCatalogue({ q: token, page: 1, pageSize: 10, sort: "newest" })).items.map((i) => i.page.id);
    expect(byNewest).toEqual([newQuiet.pageId, noViews.pageId, oldPopular.pageId]);
    const byViews = (await searchPublicVideoCatalogue({ q: token, page: 1, pageSize: 10, sort: "mostViewed" })).items.map((i) => i.page.id);
    expect(byViews).toEqual([oldPopular.pageId, newQuiet.pageId, noViews.pageId]); // a missing count sorts last
  }, T);

  it("searches titles and descriptions case-insensitively, normalises input, and treats wildcard characters literally", async () => {
    const token = `srch${TAG}`;
    const inTitle = await makeVideo({ title: `Evensong ${token}` });
    const inDescription = await makeVideo({ title: "Plain", description: `A recording of the ${token.toUpperCase()} service` });
    await makeVideo({ title: "Unrelated" });
    expect(new Set(await catalogueIds({ q: token }))).toEqual(new Set([inTitle.pageId, inDescription.pageId]));
    expect(await catalogueIds({ q: `  ${token.toUpperCase()}  ` })).toHaveLength(2);
    expect((await searchPublicVideoCatalogue({ q: "%", page: 1, pageSize: 100, sort: "newest" })).items.every((i) => `${i.youtubeVideo.title}${i.youtubeVideo.description}`.includes("%"))).toBe(true);
    expect((await searchPublicVideoCatalogue({ q: "_".repeat(300), page: 1, pageSize: 100, sort: "newest" })).total).toBe(0); // over-long input is bounded and matches nothing
  }, T);

  it("the page size setting is a real setting with validation", async () => {
    await expect(updateSiteSetting({ key: "catalogue.videos.pageSize", value: 3, expectedVersion: 0, actorId: users.admin })).rejects.toThrow();
    await expect(updateSiteSetting({ key: "catalogue.videos.pageSize", value: 61, expectedVersion: 0, actorId: users.admin })).rejects.toThrow();
    await updateSiteSetting({ key: "catalogue.videos.pageSize", value: 12, expectedVersion: 0, actorId: users.admin });
    await resetSiteSetting({ key: "catalogue.videos.pageSize", expectedVersion: 1, actorId: users.admin });
  }, T);
});

describe("featured videos", () => {
  async function withSettings<T>(settings: Record<string, number | boolean>, run: () => Promise<T>): Promise<T> {
    for (const [key, value] of Object.entries(settings)) await updateSiteSetting({ key, value, expectedVersion: 0, actorId: users.admin });
    try {
      return await run();
    } finally {
      for (const key of Object.keys(settings)) await resetSiteSetting({ key, expectedVersion: 1, actorId: users.admin });
    }
  }
  const entryIds = async () => (await loadFeaturedPlan()).entries.map((e) => e.page.id);

  it("only a video the Museum currently lists can be pinned", async () => {
    const draft = await makeVideo({ publish: false });
    const unlisted = await makeVideo({ privacy: "unlisted" });
    await approveExposure({ videoPageId: unlisted.pageId, scope: "PAGE", actorId: users.admin });
    await expect(pinFeaturedVideo({ videoPageId: draft.pageId, actorId: users.admin })).rejects.toBeInstanceOf(FeaturedNotEligibleError);
    await expect(pinFeaturedVideo({ videoPageId: unlisted.pageId, actorId: users.admin })).rejects.toBeInstanceOf(FeaturedNotEligibleError); // reachable is not listed
    await expect(pinFeaturedVideo({ videoPageId: randomUUID(), actorId: users.admin })).rejects.toBeInstanceOf(FeaturedNotFoundError);
    await approveExposure({ videoPageId: unlisted.pageId, scope: "DISCOVERY", actorId: users.admin });
    expect(await pinFeaturedVideo({ videoPageId: unlisted.pageId, actorId: users.admin })).toEqual({ pinned: true });
    await unpinFeaturedVideo({ videoPageId: unlisted.pageId, actorId: users.admin });
  }, T);

  it("pins are ordered, idempotent, movable and renumbered on removal — and each change is audited", async () => {
    const a = await makeVideo();
    const b = await makeVideo();
    const c = await makeVideo();
    for (const v of [a, b, c]) expect((await pinFeaturedVideo({ videoPageId: v.pageId, actorId: users.admin })).pinned).toBe(true);
    expect((await pinFeaturedVideo({ videoPageId: a.pageId, actorId: users.admin })).pinned).toBe(false); // already pinned
    const order = async () => (await loadFeaturedPlan()).pinned.filter((p) => [a, b, c].some((v) => v.pageId === p.row.videoPageId)).map((p) => p.row.videoPageId);
    expect(await order()).toEqual([a.pageId, b.pageId, c.pageId]);

    expect(await moveFeaturedVideo({ videoPageId: c.pageId, direction: "up", actorId: users.admin })).toEqual({ moved: true });
    expect(await order()).toEqual([a.pageId, c.pageId, b.pageId]);
    expect(await moveFeaturedVideo({ videoPageId: a.pageId, direction: "up", actorId: users.admin })).toEqual({ moved: false }); // already first
    await expect(moveFeaturedVideo({ videoPageId: randomUUID(), direction: "down", actorId: users.admin })).rejects.toBeInstanceOf(FeaturedNotFoundError);

    expect((await unpinFeaturedVideo({ videoPageId: c.pageId, actorId: users.admin })).unpinned).toBe(true);
    expect((await unpinFeaturedVideo({ videoPageId: c.pageId, actorId: users.admin })).unpinned).toBe(false);
    expect(await order()).toEqual([a.pageId, b.pageId]);
    const positions = (await prisma.featuredVideo.findMany({ orderBy: { position: "asc" } })).map((p) => p.position);
    expect(positions).toEqual(positions.map((_, i) => i + 1)); // contiguous 1..n

    const actions = (await prisma.auditLogEntry.findMany({ where: { entityId: { in: [a.pageId, b.pageId, c.pageId] } } })).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["FEATURED_VIDEO_PINNED", "FEATURED_VIDEO_REORDERED", "FEATURED_VIDEO_UNPINNED"]));
    await unpinFeaturedVideo({ videoPageId: a.pageId, actorId: users.admin });
    await unpinFeaturedVideo({ videoPageId: b.pageId, actorId: users.admin });
  }, T);

  it("pinned videos lead the homepage list; the rest is automatic and explained; the slot count is a setting", async () => {
    const pinned = await makeVideo({ views: 1, ageHours: 9000, title: `pinned ${TAG}` });
    await pinFeaturedVideo({ videoPageId: pinned.pageId, actorId: users.admin });
    try {
      await withSettings({ "featured.homepage.count": 24 }, async () => {
        const plan = await loadFeaturedPlan();
        expect(plan.entries[0]).toMatchObject({ slot: { source: "PINNED" } });
        expect(plan.entries[0].page.id).toBe(pinned.pageId);
        const automatic = plan.entries.filter((e) => e.slot.source === "AUTOMATIC");
        expect(automatic.length).toBeGreaterThan(0);
        const scores = automatic.map((e) => e.slot.score!);
        expect([...scores].sort((x, y) => y - x)).toEqual(scores); // ranked best first
        for (const e of automatic) expect(e.slot.reason).toMatch(/^Automatic: /);
      });
      await withSettings({ "featured.homepage.count": 1 }, async () => expect(await entryIds()).toEqual([pinned.pageId]));
      await withSettings({ "featured.homepage.count": 24, "featured.autoFill.enabled": false }, async () => {
        const plan = await loadFeaturedPlan();
        expect(plan.entries.every((e) => e.slot.source === "PINNED")).toBe(true);
        expect(plan.entries.map((e) => e.page.id)).toContain(pinned.pageId);
      });
    } finally {
      await unpinFeaturedVideo({ videoPageId: pinned.pageId, actorId: users.admin });
    }
  }, T);

  it("a pinned video that stops being listable disappears from the homepage list and returns when it is listable again", async () => {
    const v = await makeVideo({ privacy: "unlisted" });
    await approveExposure({ videoPageId: v.pageId, scope: "PAGE", actorId: users.admin });
    await approveExposure({ videoPageId: v.pageId, scope: "DISCOVERY", actorId: users.admin });
    await pinFeaturedVideo({ videoPageId: v.pageId, actorId: users.admin });
    try {
      await withSettings({ "featured.homepage.count": 24 }, async () => {
        expect(await entryIds()).toContain(v.pageId);
        await revokeExposure({ videoPageId: v.pageId, scope: "DISCOVERY", actorId: users.admin });
        const plan = await loadFeaturedPlan();
        expect(plan.entries.map((e) => e.page.id)).not.toContain(v.pageId);
        expect(plan.pinned.find((p) => p.row.videoPageId === v.pageId)).toMatchObject({ currentlyShown: false }); // the pin is kept, and Studio says it is not shown
        await approveExposure({ videoPageId: v.pageId, scope: "DISCOVERY", actorId: users.admin });
        expect(await entryIds()).toContain(v.pageId);
      });
    } finally {
      await unpinFeaturedVideo({ videoPageId: v.pageId, actorId: users.admin });
    }
  }, T);

  it("featured settings are validated", async () => {
    await expect(updateSiteSetting({ key: "featured.homepage.count", value: 0, expectedVersion: 0, actorId: users.admin })).rejects.toThrow();
    await expect(updateSiteSetting({ key: "featured.homepage.count", value: 25, expectedVersion: 0, actorId: users.admin })).rejects.toThrow();
    await expect(updateSiteSetting({ key: "featured.autoFill.recencyWeightPercent", value: 101, expectedVersion: 0, actorId: users.admin })).rejects.toThrow();
    await expect(updateSiteSetting({ key: "featured.autoFill.recencyHalfLifeDays", value: 1, expectedVersion: 0, actorId: users.admin })).rejects.toThrow();
    await expect(updateSiteSetting({ key: "featured.autoFill.enabled", value: "yes", expectedVersion: 0, actorId: users.admin })).rejects.toThrow();
  }, T);

  it("authorization: an editor cannot pin, unpin or reorder; an administrator can", async () => {
    const v = await makeVideo();
    as("editor");
    expect(await redirectOf(() => pinAction(form({ videoPageId: v.pageId })))).toMatch(/permission/i);
    expect(await prisma.featuredVideo.count({ where: { videoPageId: v.pageId } })).toBe(0);
    as("admin");
    expect(await redirectOf(() => pinAction(form({ videoPageId: v.pageId })))).toMatch(/now pinned/i);
    expect(await redirectOf(() => pinAction(form({ videoPageId: v.pageId })))).toMatch(/already pinned/i);
    as("editor");
    expect(await redirectOf(() => moveAction(form({ videoPageId: v.pageId, direction: "up" })))).toMatch(/permission/i);
    expect(await redirectOf(() => unpinAction(form({ videoPageId: v.pageId })))).toMatch(/permission/i);
    expect(await prisma.featuredVideo.count({ where: { videoPageId: v.pageId } })).toBe(1);
    mockGetCurrentStudioSession.mockResolvedValue(null);
    expect(await redirectOf(() => unpinAction(form({ videoPageId: v.pageId })))).toMatch(/permission/i);
    as("admin");
    const draft = await makeVideo({ publish: false });
    expect(await redirectOf(() => pinAction(form({ videoPageId: draft.pageId })))).toMatch(/currently lists/i);
    expect(await redirectOf(() => unpinAction(form({ videoPageId: v.pageId })))).toMatch(/no longer pinned/i);
  }, T);
});

describe("editorial block resolution (built-in text → published → withdrawn)", () => {
  it("shows the built-in wording only until a block is first published, and nothing once it is deliberately withdrawn", async () => {
    const slug = "museum-home-story";
    const actorId = users.admin;
    expect((await resolveEditorialBlock(slug))!.source).toBe("built-in"); // never created

    const draft = await createEditorialDraftFromBuiltIn({ slug, actorId });
    expect(draft.title.length).toBeGreaterThan(0);
    expect(draft.body).toBeTruthy();
    expect((await resolveEditorialBlock(slug))!.source).toBe("built-in"); // a draft is not public
    expect(await getPublishedEditorialBlock(slug)).toBeNull();
    await expect(createEditorialDraftFromBuiltIn({ slug, actorId })).rejects.toThrow(/already/i);

    await prisma.editorialContent.update({ where: { slug }, data: { title: "Edited headline", version: { increment: 1 } } });
    const row = await prisma.editorialContent.findUniqueOrThrow({ where: { slug } });
    await publishEditorialContent({ slug, expectedVersion: row.version, actorId });
    const published = (await resolveEditorialBlock(slug))!;
    expect(published).toMatchObject({ source: "published", title: "Edited headline" });

    // edits after publishing do not change the live words
    await prisma.editorialContent.update({ where: { slug }, data: { title: "Unpublished edit", version: { increment: 1 } } });
    expect((await resolveEditorialBlock(slug))!.title).toBe("Edited headline");

    await unpublishEditorialContent({ slug, actorId });
    expect(await resolveEditorialBlock(slug)).toBeNull(); // taken off on purpose: the built-in text does NOT come back
    expect((await resolveEditorialBlocks([slug, "museum-footer-tagline"])).has(slug)).toBe(false);
  }, T);

  it("a block with no built-in copy renders nothing until it is published, and an unknown slug never resolves", async () => {
    expect(await resolveEditorialBlock("museum-videos-intro")).toBeNull();
    await createEditorialDraft({ slug: "museum-videos-intro", title: "Videos", actorId: users.admin });
    expect(await resolveEditorialBlock("museum-videos-intro")).toBeNull();
    expect(await resolveEditorialBlock("not-a-block")).toBeNull();
    await expect(createEditorialDraftFromBuiltIn({ slug: "museum-videos-intro", actorId: users.admin })).rejects.toThrow();
  }, T);
});
