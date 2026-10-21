import { randomUUID } from "crypto";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../modules/db/client";
import { approveExposure, revokeExposure } from "../../modules/db/repositories/videoExposureRepository";
import { moveFeaturedVideo, pinFeaturedVideo, unpinFeaturedVideo } from "../../modules/db/repositories/featuredVideoRepository";
import { createDraftVideoPage, publishVideoPage } from "../../modules/db/repositories/youtubeVideoPageRepository";
import { addPlaylistMember, createPlaylistPage } from "../../modules/db/repositories/playlistPageRepository";

// Phase 6K lifecycle hardening, F16 — what the DATABASE guarantees (not just the application): at most one active approval per target, unique featured
// and playlist-member positions, and the migration's refusal to create those indexes over existing duplicates. Plus the locking that lets legitimate
// concurrent reorders succeed. Isolated test database only.

const TAG = randomUUID().slice(0, 8);
const T = 120000;
const users = {} as Record<"admin", string>;
const videoIds: string[] = [];
const pageIds: string[] = [];
const playlistIds: string[] = [];
let counter = 0;
const ytId = (prefix: string, n: number) => `${prefix}${TAG.slice(0, 5)}${String(n).padStart(5, "0")}`; // 11 characters, unique per counter value

async function newPage(privacy = "public") {
  const video = await prisma.youTubeVideo.create({ data: { youtubeVideoId: ytId("g", ++counter), title: `Guarantee ${counter}`, privacyStatus: privacy, observabilityState: "OBSERVED", currentViewCount: counter } });
  videoIds.push(video.id);
  const page = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: users.admin });
  await publishVideoPage(page.id, users.admin);
  pageIds.push(page.id);
  return page.id;
}
const rows = (videoPageId: string, scope?: "PAGE" | "DISCOVERY" | "PLAYLIST") => prisma.videoExposureApproval.findMany({ where: { videoPageId, ...(scope ? { scope } : {}) } });
const featuredPositions = async () => (await prisma.featuredVideo.findMany({ orderBy: { position: "asc" } })).map((r) => r.position);

beforeAll(async () => {
  users.admin = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `x6kg-admin-${TAG}@musicmadras.test`, name: "Guarantee admin", role: "ADMINISTRATOR", status: "ACTIVE" } })).id;
}, T);

afterAll(async () => {
  await prisma.featuredVideo.deleteMany({ where: { videoPageId: { in: pageIds } } });
  const remaining = await prisma.featuredVideo.findMany({ orderBy: { position: "asc" }, select: { id: true } });
  for (const [i, r] of remaining.entries()) await prisma.featuredVideo.update({ where: { id: r.id }, data: { position: i + 1 } }); // leave any other rows contiguous
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityId: { in: pageIds } }, { actorId: users.admin }] } });
  await prisma.youTubeVideoPage.deleteMany({ where: { id: { in: pageIds } } });
  await prisma.playlistPage.deleteMany({ where: { id: { in: playlistIds } } });
  await prisma.youTubeVideo.deleteMany({ where: { id: { in: videoIds } } });
  await prisma.studioUser.deleteMany({ where: { id: users.admin } });
}, T);

describe("at most one ACTIVE approval per target, enforced by the database", () => {
  it("refuses a second active approval for the same page and scope, even from a writer that bypasses the application's locking", async () => {
    const pageId = await newPage("unlisted");
    await prisma.videoExposureApproval.create({ data: { videoPageId: pageId, scope: "PAGE", approvedById: users.admin } });
    await expect(prisma.videoExposureApproval.create({ data: { videoPageId: pageId, scope: "PAGE", approvedById: users.admin } })).rejects.toMatchObject({ code: "P2002" });
    expect(await rows(pageId)).toHaveLength(1);
  }, T);

  it("allows what is legitimately several: another scope, a revoked row beside an active one, history of any length", async () => {
    const pageId = await newPage("unlisted");
    await prisma.videoExposureApproval.create({ data: { videoPageId: pageId, scope: "PAGE", approvedById: users.admin, revokedAt: new Date(), revokedReason: "EDITOR" } });
    await prisma.videoExposureApproval.create({ data: { videoPageId: pageId, scope: "PAGE", approvedById: users.admin, revokedAt: new Date(), revokedReason: "VIDEO_PRIVATE" } });
    await prisma.videoExposureApproval.create({ data: { videoPageId: pageId, scope: "PAGE", approvedById: users.admin } });
    await prisma.videoExposureApproval.create({ data: { videoPageId: pageId, scope: "DISCOVERY", approvedById: users.admin } });
    expect(await rows(pageId)).toHaveLength(4);
    expect((await rows(pageId)).filter((r) => r.revokedAt === null)).toHaveLength(2);
  }, T);

  it("treats each playlist page as its own target: two playlists may both be approved, the same playlist twice may not", async () => {
    const pageId = await newPage("unlisted");
    const a = await createPlaylistPage({ title: `Guarantee playlist ${TAG} a`, actorId: users.admin });
    const b = await createPlaylistPage({ title: `Guarantee playlist ${TAG} b`, actorId: users.admin });
    playlistIds.push(a.id, b.id);
    await prisma.videoExposureApproval.create({ data: { videoPageId: pageId, scope: "PLAYLIST", playlistPageId: a.id, approvedById: users.admin } });
    await prisma.videoExposureApproval.create({ data: { videoPageId: pageId, scope: "PLAYLIST", playlistPageId: b.id, approvedById: users.admin } });
    await expect(prisma.videoExposureApproval.create({ data: { videoPageId: pageId, scope: "PLAYLIST", playlistPageId: a.id, approvedById: users.admin } })).rejects.toMatchObject({ code: "P2002" });
    expect(await rows(pageId, "PLAYLIST")).toHaveLength(2);
  }, T);

  it("eight simultaneous approvals of one scope leave exactly one active row, and every call succeeds", async () => {
    const pageId = await newPage("unlisted");
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => approveExposure({ videoPageId: pageId, scope: "PAGE", actorId: users.admin })));
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(0);
    expect((await rows(pageId, "PAGE")).filter((r) => r.revokedAt === null)).toHaveLength(1);
    expect(results.filter((r) => r.status === "fulfilled" && (r.value as { created: boolean }).created)).toHaveLength(1);
  }, T);

  it("a revoke racing an approve ends in a consistent state: never two active rows, flag and rows agree", async () => {
    for (let i = 0; i < 6; i++) {
      const pageId = await newPage("unlisted");
      await approveExposure({ videoPageId: pageId, scope: "PAGE", actorId: users.admin });
      await Promise.allSettled([revokeExposure({ videoPageId: pageId, scope: "PAGE", actorId: users.admin }), approveExposure({ videoPageId: pageId, scope: "PAGE", actorId: users.admin }), approveExposure({ videoPageId: pageId, scope: "PAGE", actorId: users.admin })]);
      const active = (await rows(pageId, "PAGE")).filter((r) => r.revokedAt === null);
      expect(active.length, `iteration ${i}`).toBeLessThanOrEqual(1);
      const flag = (await prisma.youTubeVideoPage.findUniqueOrThrow({ where: { id: pageId } })).unlistedPublicationApprovedAt;
      expect(flag !== null, `iteration ${i}`).toBe(active.length === 1);
    }
  }, T);
});

describe("featured positions are unique, and concurrent pin / move / unpin are serialised", () => {
  it("the database refuses two pins at one position", async () => {
    const [a, b] = [await newPage(), await newPage()];
    await pinFeaturedVideo({ videoPageId: a, actorId: users.admin });
    await pinFeaturedVideo({ videoPageId: b, actorId: users.admin });
    const [rowA, rowB] = await Promise.all([a, b].map((id) => prisma.featuredVideo.findUniqueOrThrow({ where: { videoPageId: id } })));
    await expect(prisma.featuredVideo.update({ where: { id: rowB.id }, data: { position: rowA.position } })).rejects.toMatchObject({ code: "P2002" });
  }, T);

  it("eight simultaneous pins of different videos get eight different, contiguous positions", async () => {
    const before = (await featuredPositions()).length;
    const pages = await Promise.all(Array.from({ length: 8 }, () => newPage()));
    const results = await Promise.allSettled(pages.map((id) => pinFeaturedVideo({ videoPageId: id, actorId: users.admin })));
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(0);
    const positions = await featuredPositions();
    expect(positions).toHaveLength(before + 8);
    expect(positions).toEqual(Array.from({ length: before + 8 }, (_, i) => i + 1));
  }, T);

  it("pinning one video five times at once pins it once", async () => {
    const page = await newPage();
    const results = await Promise.all(Array.from({ length: 5 }, () => pinFeaturedVideo({ videoPageId: page, actorId: users.admin })));
    expect(results.filter((r) => r.pinned)).toHaveLength(1);
    expect(await prisma.featuredVideo.count({ where: { videoPageId: page } })).toBe(1);
  }, T);

  it("moves, unpins and pins racing each other all complete without a transient duplicate-position failure, and the list stays 1..n", async () => {
    const pages = await Promise.all(Array.from({ length: 6 }, () => newPage()));
    for (const id of pages) await pinFeaturedVideo({ videoPageId: id, actorId: users.admin });
    const fresh = await Promise.all(Array.from({ length: 3 }, () => newPage()));
    const operations: Array<Promise<unknown>> = [
      ...pages.slice(0, 4).map((id, n) => moveFeaturedVideo({ videoPageId: id, direction: n % 2 === 0 ? "up" : "down", actorId: users.admin })),
      unpinFeaturedVideo({ videoPageId: pages[4], actorId: users.admin }),
      ...fresh.map((id) => pinFeaturedVideo({ videoPageId: id, actorId: users.admin })),
      moveFeaturedVideo({ videoPageId: pages[5], direction: "up", actorId: users.admin }),
    ];
    const results = await Promise.allSettled(operations);
    expect(results.filter((r) => r.status === "rejected"), JSON.stringify(results.filter((r) => r.status === "rejected"))).toHaveLength(0);
    const positions = await featuredPositions();
    expect(positions).toEqual(Array.from({ length: positions.length }, (_, i) => i + 1));
  }, T);

  it("repeated reorders in both directions never fail and never leave a gap", async () => {
    const pages = await Promise.all(Array.from({ length: 4 }, () => newPage()));
    for (const id of pages) await pinFeaturedVideo({ videoPageId: id, actorId: users.admin });
    for (let i = 0; i < 20; i++) await moveFeaturedVideo({ videoPageId: pages[i % 4], direction: i % 3 === 0 ? "down" : "up", actorId: users.admin });
    const positions = await featuredPositions();
    expect(positions).toEqual(Array.from({ length: positions.length }, (_, i) => i + 1));
  }, T);
});

describe("playlist-member positions are unique per playlist page, and independent between pages", () => {
  it("two different playlist pages may both have a member at position 1", async () => {
    const [a, b] = [await createPlaylistPage({ title: `Positions ${TAG} a`, actorId: users.admin }), await createPlaylistPage({ title: `Positions ${TAG} b`, actorId: users.admin })];
    playlistIds.push(a.id, b.id);
    const pageId = await newPage();
    await addPlaylistMember({ playlistPageId: a.id, videoPageId: pageId, actorId: users.admin });
    await addPlaylistMember({ playlistPageId: b.id, videoPageId: pageId, actorId: users.admin });
    expect(await prisma.playlistPageItem.count({ where: { playlistPageId: { in: [a.id, b.id] }, position: 1 } })).toBe(2);
  }, T);
});

describe("the migration refuses to create these guarantees over existing duplicates, and changes nothing", () => {
  const migrationsDir = path.resolve(__dirname, "../../prisma/migrations");
  const migration = readdirSync(migrationsDir).find((d) => d.endsWith("_phase6k_hardening_integrity"))!;
  const sql = readFileSync(path.join(migrationsDir, migration, "migration.sql"), "utf8");
  const preflight = /DO \$\$[\s\S]*?\$\$;/.exec(sql)![0];

  class Rollback extends Error {}

  /** Runs the migration's own pre-flight block in a scratch schema holding the given rows, then rolls everything back. Resolves with the error text, or null. */
  async function run(inserts: string[]): Promise<string | null> {
    let message: string | null = null;
    try {
      await prisma.$transaction(async (tx) => {
        const schema = `pf_${TAG}_${++counter}`;
        await tx.$executeRawUnsafe(`create schema ${schema}`);
        await tx.$executeRawUnsafe(`set local search_path = ${schema}`);
        await tx.$executeRawUnsafe(`create table video_exposure_approvals ("videoPageId" text, scope text, "playlistPageId" text, "revokedAt" timestamp)`);
        await tx.$executeRawUnsafe(`create table featured_videos ("position" int)`);
        await tx.$executeRawUnsafe(`create table playlist_page_items ("playlistPageId" text, "position" int)`);
        await tx.$executeRawUnsafe(`create table playlist_pages ("status" text, "archivedAt" timestamp, "publishedTitle" text)`);
        for (const statement of inserts) await tx.$executeRawUnsafe(statement);
        try {
          await tx.$executeRawUnsafe(preflight);
        } catch (err) {
          message = err instanceof Error ? err.message : String(err);
          throw new Rollback(); // the failed statement has aborted the transaction anyway
        }
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
    return message;
  }

  it("passes on data with no duplicates", async () => {
    expect(await run([`insert into video_exposure_approvals values ('p','PAGE',null,null),('p','PAGE',null,now()),('p','DISCOVERY',null,null)`, `insert into featured_videos values (1),(2)`, `insert into playlist_page_items values ('a',1),('a',2),('b',1)`])).toBeNull();
  }, T);

  it("refuses two active approvals for one target (a revoked one beside an active one is fine)", async () => {
    expect(await run([`insert into video_exposure_approvals values ('p','PAGE',null,null),('p','PAGE',null,null)`])).toMatch(/more than one active approval[\s\S]*Nothing was changed/);
    expect(await run([`insert into video_exposure_approvals values ('p','PLAYLIST','x',null),('p','PLAYLIST','x',null)`])).toMatch(/more than one active approval/);
    expect(await run([`insert into video_exposure_approvals values ('p','PLAYLIST','x',null),('p','PLAYLIST','y',null)`])).toBeNull();
  }, T);

  it("refuses duplicate featured positions and duplicate playlist-member positions", async () => {
    expect(await run([`insert into featured_videos values (1),(1)`])).toMatch(/featured videos share a position/);
    expect(await run([`insert into playlist_page_items values ('a',1),('a',1)`])).toMatch(/two members at one position/);
  }, T);

  it("refuses two live playlist pages with one published title (ignoring case and spacing), but not a live and an archived or draft one", async () => {
    expect(await run([`insert into playlist_pages values ('PUBLISHED',null,'Advent  Carols'),('PUBLISHED',null,'advent carols')`])).toMatch(/share a published title/);
    expect(await run([`insert into playlist_pages values ('PUBLISHED',null,'Advent Carols'),('PUBLISHED',now(),'Advent Carols'),('DRAFT',null,'Advent Carols')`])).toBeNull();
  }, T);

  it("states in plain words what to do and never deletes or rewrites data to make the index fit (the pre-flight block contains no data-changing statement)", () => {
    expect(preflight).not.toMatch(/\b(delete|update|insert|truncate|drop)\b/i);
    expect(sql).toMatch(/never deletes or\s*-- rewrites a record/);
  });
});
