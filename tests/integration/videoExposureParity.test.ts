import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../modules/db/client";
import { isVideoExposed, type ActiveApproval, type ExposureSurface } from "../../modules/mmke/catalogue/videoExposure";
import { exposedVideoPageWhere } from "../../modules/mmke/catalogue/videoExposureQuery";
import { listPublishedVideoPages, findPublicVideoPagesByYouTubeVideoIds } from "../../modules/db/repositories/youtubeVideoPageRepository";
import { searchPublicVideoCatalogue } from "../../modules/db/repositories/videoCatalogueRepository";

// Phase 6K-3 — PARITY: the pure rule (isVideoExposed) and its database twin (exposedVideoPageWhere) must select exactly the same pages, for every
// surface, over every combination of video visibility, availability, page state and approval history — including revoked approvals and
// look-alike values. Rows are written directly (not through the approval service) so inconsistent histories are covered too. Synthetic only.

const TAG = randomUUID().slice(0, 8);
const T = 120000;
// Real playlist pages (the approval table has a foreign key to them); "A" and "B" are placeholders mapped to their ids in beforeAll.
const playlist = { A: "", B: "" };
const playlistIds: string[] = [];
const PLAYLIST_A = "A";
let actorId = "";
const pageIds: string[] = [];
const videoIds: string[] = [];

const PRIVACY = ["public", "unlisted", "private", null, "Unlisted"] as const;
const OBSERVED = ["OBSERVED", "NOT_OBSERVED", "UNAVAILABLE"] as const;
const PAGES = ["published", "draft", "published-archived"] as const;
type ApprovalSpec = { scope: "PAGE" | "DISCOVERY" | "PLAYLIST"; playlistPageId: string | null; revoked: boolean };
const APPROVAL_SETS: Record<string, ApprovalSpec[]> = {
  none: [],
  page: [{ scope: "PAGE", playlistPageId: null, revoked: false }],
  "page+discovery": [{ scope: "PAGE", playlistPageId: null, revoked: false }, { scope: "DISCOVERY", playlistPageId: null, revoked: false }],
  "page+playlistA": [{ scope: "PAGE", playlistPageId: null, revoked: false }, { scope: "PLAYLIST", playlistPageId: PLAYLIST_A, revoked: false }],
  "discovery-only": [{ scope: "DISCOVERY", playlistPageId: null, revoked: false }],
  "playlistA-only": [{ scope: "PLAYLIST", playlistPageId: PLAYLIST_A, revoked: false }],
  "page-revoked+discovery": [{ scope: "PAGE", playlistPageId: null, revoked: true }, { scope: "DISCOVERY", playlistPageId: null, revoked: false }],
  "page+discovery-revoked": [{ scope: "PAGE", playlistPageId: null, revoked: false }, { scope: "DISCOVERY", playlistPageId: null, revoked: true }],
};
const surfaces = (): ExposureSurface[] => [{ kind: "PAGE" }, { kind: "DISCOVERY" }, { kind: "PLAYLIST", playlistPageId: playlist.A }, { kind: "PLAYLIST", playlistPageId: playlist.B }];
const resolvePlaylist = (placeholder: string | null) => (placeholder === null ? null : placeholder === "A" ? playlist.A : playlist.B);

interface Spec {
  pageId: string;
  videoId: string;
  youtubeVideoId: string;
  page: (typeof PAGES)[number];
  privacy: (typeof PRIVACY)[number];
  observed: (typeof OBSERVED)[number];
  approvals: string;
  flag: boolean;
  /** "none": no review row; "review": a review row WITHOUT a hold; otherwise a recorded hold of that kind. */
  hold: "none" | "review" | "RIGHTS" | "PRIVACY";
}
const HOLD_CASES: Spec["hold"][] = ["none", "review", "RIGHTS", "PRIVACY"];
const specs: Spec[] = [];

beforeAll(async () => {
  actorId = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `parity-${TAG}@musicmadras.test`, name: "Parity", role: "ADMINISTRATOR", status: "ACTIVE" } })).id;
  for (const key of ["A", "B"] as const) {
    const created = await prisma.playlistPage.create({ data: { id: randomUUID(), slug: `parity-playlist-${key}-${TAG}`, title: `Parity playlist ${key} ${TAG}`, createdById: actorId, updatedById: actorId } });
    playlist[key] = created.id;
    playlistIds.push(created.id);
  }
  let n = 0;
  for (const page of PAGES)
    for (const privacy of PRIVACY)
      for (const observed of OBSERVED)
        for (const approvals of Object.keys(APPROVAL_SETS))
          for (const flag of [true, false])
            for (const hold of HOLD_CASES) {
              n += 1;
              specs.push({ pageId: randomUUID(), videoId: randomUUID(), youtubeVideoId: `p${TAG}${n}`, page, privacy, observed, approvals, flag, hold });
            }
  videoIds.push(...specs.map((s) => s.videoId));
  pageIds.push(...specs.map((s) => s.pageId));
  const now = new Date();
  await prisma.youTubeVideo.createMany({
    data: specs.map((s, i) => ({ id: s.videoId, youtubeVideoId: s.youtubeVideoId, title: `Parity ${i}`, privacyStatus: s.privacy, observabilityState: s.observed, currentViewCount: i, publishedAt: new Date(now.getTime() - i * 3_600_000) })),
  });
  await prisma.youTubeVideoPage.createMany({
    data: specs.map((s) => ({
      id: s.pageId,
      slug: `parity-${TAG}-${s.youtubeVideoId}`,
      youtubeVideoId: s.videoId,
      status: s.page === "draft" ? ("DRAFT" as const) : ("PUBLISHED" as const),
      archivedAt: s.page === "published-archived" ? now : null,
      unlistedPublicationApprovedAt: s.flag ? now : null,
      createdById: actorId,
      updatedById: actorId,
    })),
  });
  await prisma.videoExposureReview.createMany({
    data: specs
      .filter((s) => s.hold !== "none")
      .map((s) => ({ youtubeVideoId: s.videoId, state: s.hold === "review" ? ("PENDING" as const) : ("DECLINED" as const), proposalFingerprint: "parity", holdReason: s.hold === "review" || s.hold === "none" ? null : s.hold })),
  });
  await prisma.videoExposureApproval.createMany({
    data: specs.flatMap((s) =>
      APPROVAL_SETS[s.approvals].map((a) => ({ videoPageId: s.pageId, scope: a.scope, playlistPageId: resolvePlaylist(a.playlistPageId), approvedById: actorId, revokedAt: a.revoked ? now : null, revokedById: a.revoked ? actorId : null }))
    ),
  });
}, T);

afterAll(async () => {
  await prisma.youTubeVideoPage.deleteMany({ where: { id: { in: pageIds } } });
  await prisma.playlistPage.deleteMany({ where: { id: { in: playlistIds } } });
  await prisma.youTubeVideo.deleteMany({ where: { id: { in: videoIds } } });
  await prisma.studioUser.deleteMany({ where: { id: actorId } });
}, T);

describe("SQL fragment ≡ pure rule", () => {
  it("selects exactly the pages isVideoExposed allows, for every surface, across the whole combination matrix", async () => {
    const rows = await prisma.youTubeVideoPage.findMany({
      where: { id: { in: pageIds } },
      include: { youtubeVideo: { include: { exposureReview: { select: { holdReason: true } } } }, exposureApprovals: { where: { revokedAt: null }, select: { scope: true, playlistPageId: true } } },
    });
    expect(rows).toHaveLength(specs.length);
    let allowedSomewhere = 0;
    for (const surface of surfaces()) {
      const expected = new Set(
        rows
          .filter((p) =>
            isVideoExposed(
              {
                page: { status: p.status, archivedAt: p.archivedAt, unlistedPublicationApprovedAt: p.unlistedPublicationApprovedAt },
                youtubeVideo: { privacyStatus: p.youtubeVideo.privacyStatus, observabilityState: p.youtubeVideo.observabilityState },
                activeApprovals: p.exposureApprovals as ActiveApproval[],
                hold: p.youtubeVideo.exposureReview?.holdReason ?? null,
              },
              surface
            )
          )
          .map((p) => p.id)
      );
      const actual = new Set((await prisma.youTubeVideoPage.findMany({ where: { AND: [{ id: { in: pageIds } }, exposedVideoPageWhere(surface)] }, select: { id: true } })).map((p) => p.id));
      const missing = [...expected].filter((id) => !actual.has(id)).map((id) => specs.find((s) => s.pageId === id));
      const extra = [...actual].filter((id) => !expected.has(id)).map((id) => specs.find((s) => s.pageId === id));
      expect({ surface, missing, extra }).toEqual({ surface, missing: [], extra: [] });
      allowedSomewhere += expected.size;
    }
    expect(allowedSomewhere).toBeGreaterThan(0); // the comparison is not vacuous
  }, T);

  it("the surfaces nest as the product requires: playlist ⊆ page, discovery ⊆ page", async () => {
    const ids = async (surface: ExposureSurface) => new Set((await prisma.youTubeVideoPage.findMany({ where: { AND: [{ id: { in: pageIds } }, exposedVideoPageWhere(surface)] }, select: { id: true } })).map((p) => p.id));
    const page = await ids({ kind: "PAGE" });
    for (const surface of surfaces().slice(1)) for (const id of await ids(surface)) expect(page.has(id)).toBe(true);
  }, T);
});

describe("every public list reads the same fragment", () => {
  it("listPublishedVideoPages, findPublicVideoPagesByYouTubeVideoIds and the catalogue return exactly the DISCOVERY set", async () => {
    const discovery = new Set((await prisma.youTubeVideoPage.findMany({ where: { AND: [{ id: { in: pageIds } }, exposedVideoPageWhere({ kind: "DISCOVERY" })] }, select: { id: true } })).map((p) => p.id));
    expect(discovery.size).toBeGreaterThan(0);

    const listed = (await listPublishedVideoPages(Number.MAX_SAFE_INTEGER)).filter((r) => pageIds.includes(r.page.id));
    expect(new Set(listed.map((r) => r.page.id))).toEqual(discovery);

    const byVideo = await findPublicVideoPagesByYouTubeVideoIds(videoIds);
    expect(new Set(byVideo.map((r) => r.page.id))).toEqual(discovery);

    const seen = new Set<string>();
    for (let page = 1; ; page++) {
      const result = await searchPublicVideoCatalogue({ page, pageSize: 100, sort: "newest" });
      for (const item of result.items) if (pageIds.includes(item.page.id)) seen.add(item.page.id);
      if (page >= result.totalPages) break;
    }
    expect(seen).toEqual(discovery);
  }, T);

  it("a limit applies to eligible rows only (an ineligible newer row cannot use up a slot)", async () => {
    const some = await listPublishedVideoPages(3);
    expect(some.length).toBeLessThanOrEqual(3);
    const eligible = new Set((await prisma.youTubeVideoPage.findMany({ where: exposedVideoPageWhere({ kind: "DISCOVERY" }), select: { id: true } })).map((p) => p.id));
    expect(some.every((r) => eligible.has(r.page.id))).toBe(true);
    expect(some).toHaveLength(Math.min(3, eligible.size));
  }, T);
});

describe("holds at the SQL level", () => {
  it("a held video is excluded from every list on every surface, public or unlisted, and a review row without a hold excludes nothing", async () => {
    const ids = async (surface: ExposureSurface) => new Set((await prisma.youTubeVideoPage.findMany({ where: { AND: [{ id: { in: pageIds } }, exposedVideoPageWhere(surface)] }, select: { id: true } })).map((p) => p.id));
    let publicHeldChecked = 0;
    for (const surface of surfaces()) {
      const exposed = await ids(surface);
      for (const s of specs) {
        if (s.hold === "RIGHTS" || s.hold === "PRIVACY") expect(exposed.has(s.pageId), `${JSON.stringify({ surface, s })}`).toBe(false);
      }
      // the same page with no hold row, or a hold-free review row, is exposed exactly when its twin without the hold is
      for (const held of specs.filter((s) => s.hold === "RIGHTS")) {
        const twin = specs.find((s) => s.hold === "none" && s.page === held.page && s.privacy === held.privacy && s.observed === held.observed && s.approvals === held.approvals && s.flag === held.flag)!;
        const reviewTwin = specs.find((s) => s.hold === "review" && s.page === held.page && s.privacy === held.privacy && s.observed === held.observed && s.approvals === held.approvals && s.flag === held.flag)!;
        expect(exposed.has(reviewTwin.pageId)).toBe(exposed.has(twin.pageId));
        if (held.privacy === "public" && held.page === "published" && held.observed === "OBSERVED" && surface.kind !== "PLAYLIST") {
          expect(exposed.has(twin.pageId)).toBe(true); // the unheld public twin IS shown…
          expect(exposed.has(held.pageId)).toBe(false); // …and the held one is not
          publicHeldChecked += 1;
        }
      }
    }
    expect(publicHeldChecked).toBeGreaterThan(0);
  }, T);

  it("every public list (homepage/sitemap list, related-video lookup, catalogue) leaves out held videos", async () => {
    const heldPublic = specs.filter((s) => s.hold === "RIGHTS" && s.privacy === "public" && s.page === "published" && s.observed === "OBSERVED").map((s) => s.pageId);
    expect(heldPublic.length).toBeGreaterThan(0);
    const listed = new Set((await listPublishedVideoPages(100_000)).map((r) => r.page.id));
    for (const id of heldPublic) expect(listed.has(id)).toBe(false);
    const byVideo = await findPublicVideoPagesByYouTubeVideoIds(videoIds);
    for (const id of heldPublic) expect(byVideo.some((r) => r.page.id === id)).toBe(false);
    const seen = new Set<string>();
    for (let page = 1; ; page++) {
      const result = await searchPublicVideoCatalogue({ page, pageSize: 100, sort: "newest" });
      for (const item of result.items) seen.add(item.page.id);
      if (page >= result.totalPages) break;
    }
    for (const id of heldPublic) expect(seen.has(id)).toBe(false);
  }, T);
});