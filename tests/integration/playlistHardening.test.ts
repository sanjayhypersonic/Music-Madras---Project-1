import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../modules/db/client";
import {
  PLAYLIST_FAILED_DEDUPE,
  PLAYLIST_REGRESSION_DEDUPE,
  addPlaylistMember,
  approvePlaylistInclusion,
  archivePlaylistPage,
  createPlaylistPage,
  evaluateDraftQuality,
  findPublishedPlaylistBySlug,
  listPublishedPlaylistPages,
  movePlaylistMember,
  publishPlaylistPage,
  removePlaylistMember,
  revokePlaylistInclusion,
  runPlaylistQualitySweep,
  unarchivePlaylistPage,
  unpublishPlaylistPage,
  updatePlaylistDraft,
} from "../../modules/db/repositories/playlistPageRepository";
import { addContextNote, answerInterviewQuestion, createDraftProposal, skipInterviewQuestion, withdrawContextInput } from "../../modules/db/repositories/playlistContextRepository";
import { approveExposure } from "../../modules/db/repositories/videoExposureRepository";
import { createDraftVideoPage, publishVideoPage } from "../../modules/db/repositories/youtubeVideoPageRepository";
import { updateSiteSetting } from "../../modules/db/repositories/siteSettingRepository";
import { PlaylistArchivedError, PlaylistQualityError } from "../../modules/mmke/playlists/playlistErrors";
import { ApprovalInvalidError } from "../../modules/mmke/catalogue/videoExposureErrors";
import sitemap from "../../app/sitemap";

// Phase 6K lifecycle hardening — playlist pages: published-snapshot isolation (F14), atomic lifecycle, archived-page protection and title uniqueness
// (F15), the published-snapshot quality sweep (F19), the stricter rubric through the repository (F13), and ordering integrity (F16). Isolated test DB.

const TAG = randomUUID().slice(0, 8);
const T = 120000;
const users = {} as Record<"admin", string>;
const videoIds: string[] = [];
const videoPageIds: string[] = [];
const playlistIds: string[] = [];
let counter = 0;
const ytId = (prefix: string, n: number) => `${prefix}${TAG.slice(0, 5)}${String(n).padStart(5, "0")}`; // 11 characters, unique per counter value

async function makeVideo(opts: { privacy?: string } = {}) {
  const n = ++counter;
  const video = await prisma.youTubeVideo.create({ data: { youtubeVideoId: ytId("p", n), title: `Hardening video ${TAG} ${n}`, privacyStatus: opts.privacy ?? "public", observabilityState: "OBSERVED", publishedAt: new Date(Date.now() - n * 3_600_000) } });
  videoIds.push(video.id);
  const page = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: users.admin });
  videoPageIds.push(page.id);
  await publishVideoPage(page.id, users.admin);
  return { video, pageId: page.id };
}
async function makePlaylist(title?: string) {
  const playlist = await createPlaylistPage({ title: title ?? `Hardening ${TAG} ${++counter}`, actorId: users.admin });
  playlistIds.push(playlist.id);
  return playlist;
}
async function setSetting(key: string, value: number | boolean) {
  const row = await prisma.siteSetting.findUnique({ where: { key } });
  await updateSiteSetting({ key, value, expectedVersion: row?.version ?? 0, actorId: users.admin });
}
const current = (id: string) => prisma.playlistPage.findUniqueOrThrow({ where: { id } });
const notification = (key: string) => prisma.studioNotification.findUnique({ where: { dedupeKey: key } });

/** A page with `count` public videos and a complete draft that passes the file's relaxed rubric (2 videos, no context needed). */
async function readyPlaylist(options: { count?: number; title?: string; notes?: string[] } = {}) {
  const playlist = await makePlaylist(options.title);
  const members: Array<{ pageId: string }> = [];
  for (let i = 0; i < (options.count ?? 2); i++) {
    const v = await makeVideo();
    await addPlaylistMember({ playlistPageId: playlist.id, videoPageId: v.pageId, note: options.notes?.[i] ?? null, actorId: users.admin });
    members.push(v);
  }
  const fresh = await current(playlist.id);
  await updatePlaylistDraft({ id: playlist.id, expectedVersion: fresh.version, actorId: users.admin, fields: { title: fresh.title, summary: `A short account of what ${fresh.title} is.`, seoDescription: `Watch ${fresh.title} on Music Madras.` } });
  return { playlist, members };
}
const publish = async (id: string) => publishPlaylistPage({ id, expectedVersion: (await current(id)).version, actorId: users.admin });
async function editDraft(id: string, fields: { title?: string; summary?: string | null; body?: string | null; seoDescription?: string | null }) {
  const fresh = await current(id);
  return updatePlaylistDraft({ id, expectedVersion: fresh.version, actorId: users.admin, fields: { title: fresh.title, summary: fresh.summary, body: fresh.body, seoDescription: fresh.seoDescription, ...fields } });
}

beforeAll(async () => {
  users.admin = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `x6kp-admin-${TAG}@musicmadras.test`, name: "Hardening admin", role: "ADMINISTRATOR", status: "ACTIVE" } })).id;
  await setSetting("playlistQuality.minContextInputs", 0);
  await setSetting("playlistQuality.minEligibleVideos", 2);
}, T);

afterAll(async () => {
  await prisma.studioNotification.deleteMany({ where: { dedupeKey: { startsWith: "playlist-quality-" } } });
  await prisma.siteSetting.deleteMany({ where: { key: { startsWith: "playlistQuality." } } });
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityId: { in: [...playlistIds, ...videoPageIds] } }, { actorId: users.admin }] } });
  await prisma.youTubeVideoPage.deleteMany({ where: { id: { in: videoPageIds } } });
  await prisma.playlistPage.deleteMany({ where: { id: { in: playlistIds } } });
  await prisma.youTubeVideo.deleteMany({ where: { id: { in: videoIds } } });
  await prisma.studioUser.deleteMany({ where: { id: users.admin } });
}, T);

describe("a published page is read from its published snapshot only (F14)", () => {
  it("member notes, title, summary, body, search fields and members are what was published; no draft edit changes them", async () => {
    const { playlist, members } = await readyPlaylist({ notes: ["The published note for member one.", "The published note for member two."] });
    await editDraft(playlist.id, { body: "The published introduction." });
    await publish(playlist.id);
    const published = (await findPublishedPlaylistBySlug(playlist.slug))!;
    expect(published.members.map((m) => m.note)).toEqual(["The published note for member one.", "The published note for member two."]);
    const snapshot = JSON.stringify(published);

    // Every kind of unpublished edit.
    await editDraft(playlist.id, { title: "A different draft title", summary: "A different draft summary.", body: "A different draft body.", seoDescription: "A different draft search text." });
    await removePlaylistMember({ playlistPageId: playlist.id, videoPageId: members[0].pageId, actorId: users.admin });
    await addPlaylistMember({ playlistPageId: playlist.id, videoPageId: members[0].pageId, note: "A DRAFT note that must not appear.", actorId: users.admin });
    await removePlaylistMember({ playlistPageId: playlist.id, videoPageId: members[1].pageId, actorId: users.admin }); // the live page still lists it
    await addContextNote({ playlistPageId: playlist.id, body: "A new context note, written after publication.", actorId: users.admin });
    const extra = await makeVideo();
    await addPlaylistMember({ playlistPageId: playlist.id, videoPageId: extra.pageId, note: "Another draft note.", actorId: users.admin });
    await movePlaylistMember({ playlistPageId: playlist.id, videoPageId: extra.pageId, direction: "up", actorId: users.admin });

    expect(JSON.stringify((await findPublishedPlaylistBySlug(playlist.slug))!)).toBe(snapshot);
    const after = (await findPublishedPlaylistBySlug(playlist.slug))!;
    expect(after.title).toBe(playlist.title);
    expect(after.members.map((m) => m.page.id)).toEqual(members.map((m) => m.pageId));
    expect(JSON.stringify(after)).not.toMatch(/DRAFT note|Another draft note|different draft|written after publication/);
  }, T);

  it("republishing is what changes the public page, notes included — and the record of that publication keeps them", async () => {
    const { playlist, members } = await readyPlaylist({ notes: ["Note A"] });
    await publish(playlist.id);
    await removePlaylistMember({ playlistPageId: playlist.id, videoPageId: members[0].pageId, actorId: users.admin });
    await addPlaylistMember({ playlistPageId: playlist.id, videoPageId: members[0].pageId, note: "Note B", actorId: users.admin });
    expect((await findPublishedPlaylistBySlug(playlist.slug))!.members.find((m) => m.page.id === members[0].pageId)!.note).toBe("Note A");
    await publish(playlist.id);
    expect((await findPublishedPlaylistBySlug(playlist.slug))!.members.find((m) => m.page.id === members[0].pageId)!.note).toBe("Note B");
    const publications = await prisma.playlistPagePublication.findMany({ where: { playlistPageId: playlist.id, kind: "PUBLISHED" }, orderBy: { createdAt: "asc" } });
    expect(publications).toHaveLength(2);
    expect((publications[0].snapshot as { memberNotes: Record<string, string> }).memberNotes[members[0].pageId]).toBe("Note A");
    expect((publications[1].snapshot as { memberNotes: Record<string, string> }).memberNotes[members[0].pageId]).toBe("Note B");
  }, T);

  it("a page published before notes were part of the snapshot shows NO notes (a draft note is never shown instead)", async () => {
    const { playlist } = await readyPlaylist({ notes: ["Draft-side note one", "Draft-side note two"] });
    await publish(playlist.id);
    const raw = await prisma.$executeRaw`update playlist_pages set "publishedMemberNotes" = null where id = ${playlist.id}`;
    expect(raw).toBe(1);
    expect((await findPublishedPlaylistBySlug(playlist.slug))!.members.map((m) => m.note)).toEqual([null, null]);
  }, T);

  it("the sitemap and the public list report the PUBLICATION time: draft edits, context notes and answers do not move it; a republish does", async () => {
    vi.stubEnv("PUBLIC_SITE_URL", "https://museum.example.test");
    try {
      const { playlist } = await readyPlaylist();
      await publish(playlist.id);
      const publishedAt = (await current(playlist.id)).publishedAt!;
      const lastmod = async () => {
        const entries = await sitemap();
        return entries.find((e) => e.url.endsWith(`/playlists/${playlist.slug}`))!.lastModified as Date;
      };
      expect((await lastmod()).getTime()).toBe(publishedAt.getTime());
      await new Promise((resolve) => setTimeout(resolve, 20));
      await editDraft(playlist.id, { summary: "Edited later, unpublished." });
      await addContextNote({ playlistPageId: playlist.id, body: "A note added after publishing.", actorId: users.admin });
      expect((await current(playlist.id)).updatedAt.getTime()).toBeGreaterThan(publishedAt.getTime()); // the row WAS touched...
      expect((await lastmod()).getTime()).toBe(publishedAt.getTime()); // ...but the sitemap did not move
      expect((await listPublishedPlaylistPages()).find((p) => p.slug === playlist.slug)!.lastModified.getTime()).toBe(publishedAt.getTime());
      await publish(playlist.id);
      expect((await lastmod()).getTime()).toBeGreaterThan(publishedAt.getTime());
    } finally {
      vi.unstubAllEnvs();
    }
  }, T);
});

describe("archiving is atomic and cannot race with publishing (F15)", () => {
  it("archiving a live page unpublishes, archives and audits together, and frees its title", async () => {
    const { playlist } = await readyPlaylist();
    await publish(playlist.id);
    expect((await current(playlist.id)).publishedTitleKey).not.toBeNull();
    await archivePlaylistPage({ id: playlist.id, actorId: users.admin });
    const row = await current(playlist.id);
    expect(row).toMatchObject({ status: "DRAFT", publishedTitleKey: null });
    expect(row.archivedAt).not.toBeNull();
    expect(await findPublishedPlaylistBySlug(playlist.slug)).toBeNull();
    expect(await prisma.playlistPagePublication.count({ where: { playlistPageId: playlist.id, kind: "UNPUBLISHED" } })).toBe(1);
    expect(await prisma.auditLogEntry.count({ where: { entityId: playlist.id, action: { in: ["PLAYLIST_PAGE_UNPUBLISHED", "PLAYLIST_PAGE_ARCHIVED"] } } })).toBe(2);
    await archivePlaylistPage({ id: playlist.id, actorId: users.admin }); // idempotent
    expect(await prisma.auditLogEntry.count({ where: { entityId: playlist.id, action: "PLAYLIST_PAGE_ARCHIVED" } })).toBe(1);
  }, T);

  it("a publish racing an archive never leaves a page that is both live and archived (repeated with both orderings)", async () => {
    for (let i = 0; i < 12; i++) {
      const { playlist } = await readyPlaylist();
      await publish(playlist.id);
      await editDraft(playlist.id, { summary: `Edit ${i}` }); // so publishing again is a real republish
      const expectedVersion = (await current(playlist.id)).version;
      const publishRun = () => publishPlaylistPage({ id: playlist.id, expectedVersion, actorId: users.admin });
      const archiveRun = () => archivePlaylistPage({ id: playlist.id, actorId: users.admin });
      const outcomes = await Promise.allSettled(i % 2 === 0 ? [publishRun(), archiveRun()] : [archiveRun(), publishRun()]);
      const row = await current(playlist.id);
      expect(row.archivedAt, `iteration ${i}`).not.toBeNull(); // the archive always wins in the end
      expect(row.status, `iteration ${i}`).toBe("DRAFT");
      expect(row.publishedTitleKey, `iteration ${i}`).toBeNull();
      expect(await findPublishedPlaylistBySlug(playlist.slug), `iteration ${i}`).toBeNull();
      for (const o of outcomes) if (o.status === "rejected") expect(o.reason, `iteration ${i}`).toBeInstanceOf(PlaylistArchivedError); // a refused publish is a typed refusal
    }
  }, T);

  it("restoring brings the page back as a DRAFT: it is not republished, and must pass the checks and be published by a person", async () => {
    const { playlist } = await readyPlaylist();
    await publish(playlist.id);
    await archivePlaylistPage({ id: playlist.id, actorId: users.admin });
    await unarchivePlaylistPage({ id: playlist.id, actorId: users.admin });
    expect(await current(playlist.id)).toMatchObject({ archivedAt: null, status: "DRAFT", publishedTitleKey: null });
    expect(await findPublishedPlaylistBySlug(playlist.slug)).toBeNull();
    await publish(playlist.id);
    expect(await findPublishedPlaylistBySlug(playlist.slug)).not.toBeNull();
  }, T);

  it("restoring repairs a legacy contradictory row (published AND archived) to a clean draft rather than quietly going live", async () => {
    const { playlist } = await readyPlaylist();
    await publish(playlist.id);
    await prisma.playlistPage.update({ where: { id: playlist.id }, data: { archivedAt: new Date() } }); // a state the old code could produce
    await unarchivePlaylistPage({ id: playlist.id, actorId: users.admin });
    expect(await current(playlist.id)).toMatchObject({ archivedAt: null, status: "DRAFT", publishedTitleKey: null });
    expect(await findPublishedPlaylistBySlug(playlist.slug)).toBeNull();
  }, T);
});

describe("an archived playlist page cannot be changed (F15)", () => {
  it("rejects drafts, members, moves, context, proposals and publication with a typed error, and changes nothing", async () => {
    const { playlist, members } = await readyPlaylist({ count: 3 });
    const question = await prisma.playlistContextInput.create({ data: { playlistPageId: playlist.id, source: "AI_QUESTION", status: "AWAITING_ANSWER", question: "Which choir sang?", createdById: users.admin } });
    const note = await addContextNote({ playlistPageId: playlist.id, body: "A note that exists before archiving.", actorId: users.admin });
    await archivePlaylistPage({ id: playlist.id, actorId: users.admin });
    const before = await current(playlist.id);
    const extra = await makeVideo();

    const attempts: Array<[string, () => Promise<unknown>]> = [
      ["update the draft", () => updatePlaylistDraft({ id: playlist.id, expectedVersion: before.version, actorId: users.admin, fields: { title: "Changed" } })],
      ["add a member", () => addPlaylistMember({ playlistPageId: playlist.id, videoPageId: extra.pageId, actorId: users.admin })],
      ["remove a member", () => removePlaylistMember({ playlistPageId: playlist.id, videoPageId: members[0].pageId, actorId: users.admin })],
      ["move a member", () => movePlaylistMember({ playlistPageId: playlist.id, videoPageId: members[1].pageId, direction: "up", actorId: users.admin })],
      ["add a note", () => addContextNote({ playlistPageId: playlist.id, body: "Too late.", actorId: users.admin })],
      ["answer a question", () => answerInterviewQuestion({ inputId: question.id, body: "Too late.", actorId: users.admin })],
      ["skip a question", () => skipInterviewQuestion({ inputId: question.id, actorId: users.admin })],
      ["withdraw a note", () => withdrawContextInput({ inputId: note.id, actorId: users.admin })],
      ["propose a draft", () => createDraftProposal({ playlistPageId: playlist.id, target: "SUMMARY", text: "x", sentences: [], evidenceFingerprint: "f", provider: "fake", model: "m", promptVersion: "p", requestedById: users.admin })],
      ["publish", () => publishPlaylistPage({ id: playlist.id, expectedVersion: before.version, actorId: users.admin })],
    ];
    for (const [name, run] of attempts) await expect(run(), name).rejects.toBeInstanceOf(PlaylistArchivedError);

    const after = await current(playlist.id);
    expect(after.version).toBe(before.version);
    expect(after.title).toBe(before.title);
    expect(after.status).toBe("DRAFT");
    expect(await prisma.playlistPageItem.count({ where: { playlistPageId: playlist.id } })).toBe(3);
    expect(await prisma.playlistContextInput.findUniqueOrThrow({ where: { id: question.id } })).toMatchObject({ status: "AWAITING_ANSWER", body: null });
    expect(await prisma.playlistContextInput.findUniqueOrThrow({ where: { id: note.id } })).toMatchObject({ status: "ACTIVE" });
    expect(await prisma.playlistDraftProposal.count({ where: { playlistPageId: playlist.id } })).toBe(0);
  }, T);

  it("approving an unlisted video for an archived playlist is refused too, while revoking an existing approval stays possible", async () => {
    const { playlist } = await readyPlaylist();
    const unlisted = await makeVideo({ privacy: "unlisted" });
    await addPlaylistMember({ playlistPageId: playlist.id, videoPageId: unlisted.pageId, actorId: users.admin });
    await approveExposure({ videoPageId: unlisted.pageId, scope: "PAGE", actorId: users.admin });
    await approvePlaylistInclusion({ playlistPageId: playlist.id, videoPageId: unlisted.pageId, actorId: users.admin });
    await archivePlaylistPage({ id: playlist.id, actorId: users.admin });
    await expect(approvePlaylistInclusion({ playlistPageId: playlist.id, videoPageId: unlisted.pageId, actorId: users.admin })).rejects.toBeInstanceOf(ApprovalInvalidError); // even a repeat: nothing about an archived page changes
    const other = await makeVideo({ privacy: "unlisted" });
    await approveExposure({ videoPageId: other.pageId, scope: "PAGE", actorId: users.admin }); // so that the archived playlist is what refuses it
    await expect(approvePlaylistInclusion({ playlistPageId: playlist.id, videoPageId: other.pageId, actorId: users.admin })).rejects.toBeInstanceOf(ApprovalInvalidError);
    await expect(revokePlaylistInclusion({ playlistPageId: playlist.id, videoPageId: unlisted.pageId, actorId: users.admin })).resolves.toMatchObject({ revoked: 1 });
  }, T);
});

describe("a published title is unique among live pages, and drafts elsewhere are irrelevant (F15/F19)", () => {
  it("sets the normalised title key on publish and clears it on unpublish and archive", async () => {
    const { playlist } = await readyPlaylist({ title: `  Keyed   Title ${TAG}  ` });
    await publish(playlist.id);
    expect((await current(playlist.id)).publishedTitleKey).toBe(`keyed title ${TAG}`.toLowerCase());
    await unpublishPlaylistPage({ id: playlist.id, actorId: users.admin });
    expect((await current(playlist.id)).publishedTitleKey).toBeNull();
  }, T);

  it("another page's DRAFT with the same title is not a conflict for evaluating, publishing, or sweeping — only a LIVE page is", async () => {
    const title = `Shared title ${TAG}`;
    const a = (await readyPlaylist({ title })).playlist;
    const b = (await readyPlaylist({ title })).playlist;
    expect((await evaluateDraftQuality(a.id)).passed).toBe(true); // b is only a draft
    expect((await evaluateDraftQuality(b.id)).passed).toBe(true);
    await publish(a.id);
    const blocked = await evaluateDraftQuality(b.id);
    expect(blocked.failing.map((c) => c.key)).toEqual(["UNIQUE_TITLE"]); // a is LIVE now
    await expect(publish(b.id)).rejects.toBeInstanceOf(PlaylistQualityError);
    expect((await current(b.id)).status).toBe("DRAFT");
    expect((await evaluateDraftQuality(a.id)).passed).toBe(true); // a is not in conflict with its own draft neighbour
  }, T);

  it("compares with the PUBLISHED title, not the other page's current draft title: a renamed draft does not free the live title", async () => {
    const title = `Held title ${TAG}`;
    const a = (await readyPlaylist({ title })).playlist;
    const b = (await readyPlaylist({ title })).playlist;
    await publish(a.id);
    await editDraft(a.id, { title: `Renamed in draft ${TAG}` }); // a is still LIVE under the old title
    await expect(publish(b.id)).rejects.toBeInstanceOf(PlaylistQualityError);
    expect((await findPublishedPlaylistBySlug(a.slug))!.title).toBe(title);
    // And a draft ELSEWHERE named like a's draft title does not matter either.
    const c = (await readyPlaylist({ title: `Renamed in draft ${TAG}` })).playlist;
    await publish(c.id);
    expect((await current(c.id)).status).toBe("PUBLISHED");
  }, T);

  it("is case- and whitespace-insensitive, and an unpublished or archived page frees its title", async () => {
    const a = (await readyPlaylist({ title: `Case Title ${TAG}` })).playlist;
    const b = (await readyPlaylist({ title: `  case   TITLE ${TAG} ` })).playlist;
    await publish(a.id);
    await expect(publish(b.id)).rejects.toBeInstanceOf(PlaylistQualityError);
    await unpublishPlaylistPage({ id: a.id, actorId: users.admin });
    await publish(b.id);
    expect((await current(b.id)).status).toBe("PUBLISHED");
    await archivePlaylistPage({ id: b.id, actorId: users.admin });
    await publish(a.id);
    expect((await current(a.id)).status).toBe("PUBLISHED");
  }, T);

  it("two pages published at the same moment under one title: exactly one goes live, the other gets the title-conflict refusal (repeated)", async () => {
    for (let i = 0; i < 8; i++) {
      const title = `Simultaneous ${TAG} ${i}`;
      const a = (await readyPlaylist({ title })).playlist;
      const b = (await readyPlaylist({ title })).playlist;
      const versions = { a: (await current(a.id)).version, b: (await current(b.id)).version };
      const outcomes = await Promise.allSettled([
        publishPlaylistPage({ id: a.id, expectedVersion: versions.a, actorId: users.admin }),
        publishPlaylistPage({ id: b.id, expectedVersion: versions.b, actorId: users.admin }),
      ]);
      expect(outcomes.filter((o) => o.status === "fulfilled"), `iteration ${i}`).toHaveLength(1);
      const rejected = outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult;
      expect(rejected.reason, `iteration ${i}`).toBeInstanceOf(PlaylistQualityError);
      expect((rejected.reason as PlaylistQualityError).result.failing.map((c) => c.key), `iteration ${i}`).toContain("UNIQUE_TITLE");
      const live = await prisma.playlistPage.findMany({ where: { id: { in: [a.id, b.id] }, status: "PUBLISHED" } });
      expect(live, `iteration ${i}`).toHaveLength(1);
      expect(await prisma.playlistPage.count({ where: { publishedTitleKey: title.toLowerCase() } }), `iteration ${i}`).toBe(1);
    }
  }, T);

  it("the database itself refuses two live rows with one title key", async () => {
    const a = (await readyPlaylist({ title: `Db key ${TAG} a` })).playlist;
    const b = (await readyPlaylist({ title: `Db key ${TAG} b` })).playlist;
    await publish(a.id);
    await publish(b.id);
    const key = (await current(a.id)).publishedTitleKey!;
    await expect(prisma.playlistPage.update({ where: { id: b.id }, data: { publishedTitleKey: key } })).rejects.toMatchObject({ code: "P2002" });
  }, T);
});

describe("the quality sweep judges a live page by its PUBLISHED snapshot (F19)", () => {
  it("draft edits, another page's draft and withdrawn draft-side context never make a live page regress", async () => {
    await setSetting("playlistQuality.minContextInputs", 2);
    try {
      const { playlist } = await readyPlaylist({ title: `Sweep subject ${TAG}` });
      const one = await addContextNote({ playlistPageId: playlist.id, body: "They open the annual Advent service at the cathedral.", actorId: users.admin });
      await addContextNote({ playlistPageId: playlist.id, body: "The junior choir sings the first two carols every year.", actorId: users.admin });
      await publish(playlist.id);

      // Everything that happens only in the draft world.
      await editDraft(playlist.id, { summary: ".", seoDescription: null });
      await withdrawContextInput({ inputId: one.id, actorId: users.admin });
      await readyPlaylist({ title: `Sweep subject ${TAG}` }); // another page whose DRAFT has the same title
      expect((await evaluateDraftQuality(playlist.id)).passed).toBe(false); // the DRAFT is poor now...

      const result = await runPlaylistQualitySweep();
      expect(result.failedBatches).toBe(0);
      expect(await notification(PLAYLIST_REGRESSION_DEDUPE(playlist.id))).toBeNull(); // ...but the LIVE page is exactly what was published
      expect((await findPublishedPlaylistBySlug(playlist.slug))!.summary).toMatch(/short account/);
    } finally {
      await setSetting("playlistQuality.minContextInputs", 0);
    }
  }, T);

  it("regresses on what visitors can actually see (a lost approval), raises ONE notification however often it runs, and recovers when the approval returns", async () => {
    const { playlist } = await readyPlaylist({ count: 1 });
    const unlisted = await makeVideo({ privacy: "unlisted" });
    await addPlaylistMember({ playlistPageId: playlist.id, videoPageId: unlisted.pageId, actorId: users.admin });
    await approveExposure({ videoPageId: unlisted.pageId, scope: "PAGE", actorId: users.admin });
    await approvePlaylistInclusion({ playlistPageId: playlist.id, videoPageId: unlisted.pageId, actorId: users.admin });
    await publish(playlist.id);
    expect((await runPlaylistQualitySweep()).regressions).toBeGreaterThanOrEqual(0);
    expect(await notification(PLAYLIST_REGRESSION_DEDUPE(playlist.id))).toBeNull();

    await revokePlaylistInclusion({ playlistPageId: playlist.id, videoPageId: unlisted.pageId, actorId: users.admin });
    await runPlaylistQualitySweep();
    await runPlaylistQualitySweep();
    await runPlaylistQualitySweep();
    const raised = await notification(PLAYLIST_REGRESSION_DEDUPE(playlist.id));
    expect(raised).toMatchObject({ status: "OPEN", occurrenceCount: 1 }); // announced once, however many sweeps ran
    expect(raised!.body).toMatch(/Only 1 video can be shown; 2 are needed/);

    await approvePlaylistInclusion({ playlistPageId: playlist.id, videoPageId: unlisted.pageId, actorId: users.admin });
    const recovered = await runPlaylistQualitySweep();
    expect(recovered.recovered).toBeGreaterThanOrEqual(1);
    expect((await notification(PLAYLIST_REGRESSION_DEDUPE(playlist.id)))!.status).toBe("RESOLVED");
  }, T);

  it("does not judge the context of a page published before its context was recorded (it cannot know), and judges the recorded context of one published after", async () => {
    await setSetting("playlistQuality.minContextInputs", 2);
    try {
      const { playlist } = await readyPlaylist();
      await addContextNote({ playlistPageId: playlist.id, body: "The first real note about why these were chosen.", actorId: users.admin });
      await addContextNote({ playlistPageId: playlist.id, body: "A second, different note about the occasion.", actorId: users.admin });
      await publish(playlist.id);
      expect((await current(playlist.id)).publishedContextTexts).toEqual(["The first real note about why these were chosen.", "A second, different note about the occasion."]);
      // A legacy page: no recorded context. It must not be flagged for lacking what nobody recorded.
      await prisma.$executeRaw`update playlist_pages set "publishedContextTexts" = null where id = ${playlist.id}`;
      await runPlaylistQualitySweep();
      expect(await notification(PLAYLIST_REGRESSION_DEDUPE(playlist.id))).toBeNull();
      // A published snapshot whose recorded context is below the threshold DOES regress (the threshold was raised, say).
      await prisma.$executeRaw`update playlist_pages set "publishedContextTexts" = '["only one"]'::jsonb where id = ${playlist.id}`;
      await runPlaylistQualitySweep();
      expect(await notification(PLAYLIST_REGRESSION_DEDUPE(playlist.id))).toMatchObject({ status: "OPEN" });
    } finally {
      await setSetting("playlistQuality.minContextInputs", 0);
    }
  }, T);

  it("works in bounded batches in a stable order, reports them, and a second run repeats nothing", async () => {
    const pages = [];
    for (let i = 0; i < 5; i++) {
      const { playlist } = await readyPlaylist();
      await publish(playlist.id);
      pages.push(playlist);
    }
    const first = await runPlaylistQualitySweep({ batchSize: 2 });
    expect(first.checked).toBeGreaterThanOrEqual(5);
    expect(first.batches).toBeGreaterThanOrEqual(3);
    expect(first).toMatchObject({ failedBatches: 0, notificationFailures: 0, completed: true });
    const second = await runPlaylistQualitySweep({ batchSize: 2 });
    expect(second.regressions).toBe(first.regressions);
    expect(second.completed).toBe(true);
  }, T);

  it("a notification for a draft that now passes, or for an archived page, is resolved by the sweep and does not recur", async () => {
    const { playlist } = await readyPlaylist();
    await editDraft(playlist.id, { summary: "" }); // fails: raises the "cannot be published yet" notice
    expect(await notification(PLAYLIST_FAILED_DEDUPE(playlist.id))).toMatchObject({ status: "OPEN" });
    await prisma.playlistPage.update({ where: { id: playlist.id }, data: { summary: "Now there is a real summary of the playlist." } }); // fixed behind the notifier's back
    await runPlaylistQualitySweep();
    const resolved = (await notification(PLAYLIST_FAILED_DEDUPE(playlist.id)))!;
    expect(resolved.status).toBe("RESOLVED");
    await runPlaylistQualitySweep();
    await runPlaylistQualitySweep();
    expect((await notification(PLAYLIST_FAILED_DEDUPE(playlist.id)))).toMatchObject({ status: "RESOLVED", occurrenceCount: resolved.occurrenceCount }); // it does not recur

    const other = (await readyPlaylist()).playlist;
    await editDraft(other.id, { summary: "" });
    expect(await notification(PLAYLIST_FAILED_DEDUPE(other.id))).toMatchObject({ status: "OPEN" });
    await prisma.playlistPage.update({ where: { id: other.id }, data: { archivedAt: new Date() } }); // archived behind the notifier's back
    await runPlaylistQualitySweep();
    expect((await notification(PLAYLIST_FAILED_DEDUPE(other.id)))!.status).toBe("RESOLVED");
  }, T);
});

describe("the stricter rubric, through the repository (F13)", () => {
  it("refuses placeholder and redundant text at publication with an actionable explanation, and publishes a real draft", async () => {
    const { playlist } = await readyPlaylist({ title: `Rubric ${TAG}` });
    await editDraft(playlist.id, { summary: "tbd", seoDescription: `Rubric ${TAG}` });
    const error = await publish(playlist.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PlaylistQualityError);
    const messages = (error as PlaylistQualityError).result.failing.map((c) => `${c.key}: ${c.detail}`);
    expect(messages.join("\n")).toMatch(/SUMMARY: The summary does not say anything yet \(it is a placeholder\)/);
    expect(messages.join("\n")).toMatch(/SEARCH_DESCRIPTION: The search description only repeats the title/);
    expect((await current(playlist.id)).status).toBe("DRAFT");
    await editDraft(playlist.id, { summary: "Carols for the annual service.", seoDescription: "Listen to carols from the annual service." });
    await publish(playlist.id);
    expect((await current(playlist.id)).status).toBe("PUBLISHED");
  }, T);

  it("duplicate context notes count once, so two copies of one note cannot meet a minimum of two", async () => {
    await setSetting("playlistQuality.minContextInputs", 2);
    try {
      const { playlist } = await readyPlaylist();
      await addContextNote({ playlistPageId: playlist.id, body: "They open the annual Advent service.", actorId: users.admin });
      await addContextNote({ playlistPageId: playlist.id, body: "they open the ANNUAL advent service", actorId: users.admin });
      expect((await evaluateDraftQuality(playlist.id)).failing.map((c) => c.key)).toEqual(["HUMAN_CONTEXT"]);
      await addContextNote({ playlistPageId: playlist.id, body: "The junior choir sings the first two carols.", actorId: users.admin });
      expect((await evaluateDraftQuality(playlist.id)).passed).toBe(true);
    } finally {
      await setSetting("playlistQuality.minContextInputs", 0);
    }
  }, T);
});

describe("member order is protected by the database and by locking (F16)", () => {
  const positionsOf = async (playlistId: string) => (await prisma.playlistPageItem.findMany({ where: { playlistPageId: playlistId }, orderBy: { position: "asc" } })).map((i) => i.position);

  it("concurrent moves on one playlist all succeed and leave positions unique", async () => {
    const { playlist, members } = await readyPlaylist({ count: 5 });
    const results = await Promise.allSettled(
      [0, 1, 2, 3, 4, 1, 2, 3].map((i, n) => movePlaylistMember({ playlistPageId: playlist.id, videoPageId: members[i].pageId, direction: n % 2 === 0 ? "up" : "down", actorId: users.admin }))
    );
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(0);
    const positions = await positionsOf(playlist.id);
    expect(new Set(positions).size).toBe(5);
    expect([...positions].sort()).toEqual([1, 2, 3, 4, 5]);
  }, T);

  it("a swap does not trip the unique index, and moves racing removals and additions stay consistent", async () => {
    const { playlist, members } = await readyPlaylist({ count: 4 });
    const extra = await makeVideo();
    const results = await Promise.allSettled([
      movePlaylistMember({ playlistPageId: playlist.id, videoPageId: members[1].pageId, direction: "up", actorId: users.admin }),
      removePlaylistMember({ playlistPageId: playlist.id, videoPageId: members[3].pageId, actorId: users.admin }),
      addPlaylistMember({ playlistPageId: playlist.id, videoPageId: extra.pageId, actorId: users.admin }),
      movePlaylistMember({ playlistPageId: playlist.id, videoPageId: members[0].pageId, direction: "down", actorId: users.admin }),
    ]);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(0);
    const positions = await positionsOf(playlist.id);
    expect(new Set(positions).size).toBe(positions.length);
    expect(positions[0]).toBeGreaterThanOrEqual(1);
  }, T);

  it("the database refuses two members at one position", async () => {
    const { playlist, members } = await readyPlaylist({ count: 2 });
    const rows = await prisma.playlistPageItem.findMany({ where: { playlistPageId: playlist.id }, orderBy: { position: "asc" } });
    await expect(prisma.playlistPageItem.update({ where: { id: rows[1].id }, data: { position: rows[0].position } })).rejects.toMatchObject({ code: "P2002" });
    expect(members).toHaveLength(2);
  }, T);
});
