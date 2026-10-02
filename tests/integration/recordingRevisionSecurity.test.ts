import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

// Must be at the true top level — vi.mock is hoisted above every import.
const mockGetCurrentStudioSession = vi.fn();
vi.mock("../../modules/auth/authService", () => ({
  getCurrentStudioSession: () => mockGetCurrentStudioSession(),
}));

import { prisma } from "../../modules/db/client";
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import { createArtist } from "../../modules/db/repositories/artistRepository";
import { createProgramme } from "../../modules/db/repositories/programmeRepository";
import { createVenue } from "../../modules/db/repositories/venueRepository";
import { createPerformance } from "../../modules/db/repositories/performanceRepository";
import {
  archiveRecording,
  attachWorkToRevision,
  createDraftRecording,
  forkDraftFromPublished,
  publishCurrentDraft,
  resolveEditableDraftRevision,
  updateDraftRevisionContent,
} from "../../modules/db/repositories/recordingRepository";
import { attachMediaToRevision } from "../../modules/db/repositories/mediaResourceRepository";
import { getPublicRecordingPageData } from "../../modules/db/repositories/entityRelationshipsRepository";
import { attachWorkAction, detachWorkAction } from "../../app/(studio)/studio/(protected)/recordings/[id]/works/actions";
import { attachMediaAction } from "../../app/(studio)/studio/(protected)/recordings/[id]/media/actions";
import { addPerformerAction } from "../../app/(studio)/studio/(protected)/recordings/[id]/participants/actions";
import { createPerformanceAction } from "../../app/(studio)/studio/(protected)/recordings/[id]/performance/actions";
import {
  archiveAction,
  publishAction,
  restoreAction,
  unpublishAction,
} from "../../app/(studio)/studio/(protected)/recordings/[id]/review/actions";

// Phase 6J-1 — a Studio edit to a Recording must act on the Recording's real,
// editable draft, resolved on the SERVER. The bound revision id is only an
// "expected" token: a stale, published, archived or unrelated revision is
// refused. Real database; every fixture is disposable and cleaned up.

const TAG = "phase6j1rev";
const TOKEN = randomUUID().slice(0, 8);
const T = 120000;

let editorId: string;
let adminId: string;
const recordingIds: string[] = [];
const composerIds: string[] = [];
const workIds: string[] = [];
const artistIds: string[] = [];
const programmeIds: string[] = [];
const venueIds: string[] = [];
const performanceIds: string[] = [];

const slug = (base: string) => `${TAG}-${base}-${randomUUID().slice(0, 8)}`;

function as(role: "EDITOR" | "ADMINISTRATOR" | "CONTRIBUTOR") {
  const id = role === "ADMINISTRATOR" ? adminId : editorId;
  mockGetCurrentStudioSession.mockResolvedValue({ user: { id, role } });
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
    return decodeURIComponent(extractRedirectPath(err).replace(/\+/g, " "));
  }
  throw new Error("Action did not redirect");
}

function form(fields: Record<string, string> = {}): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function makeWork(label: string) {
  const composer = await createComposer({ slug: slug(`composer-${label}`), name: `Rev Composer ${label} ${TOKEN}`, actorId: editorId });
  composerIds.push(composer.id);
  const work = await createMusicalWork({ slug: slug(`work-${label}`), title: `Rev Work ${label} ${TOKEN}`, composerId: composer.id, actorId: editorId });
  workIds.push(work.id);
  return work;
}

/** A PUBLISHED Recording (revision 1) — complete enough to publish again (title, a Work, a primary video). */
async function publishedRecording(label: string) {
  const work = await makeWork(label);
  const draft = await createDraftRecording({ slug: slug(`recording-${label}`), actorId: editorId, title: `Rev Recording ${label} ${TOKEN}` });
  recordingIds.push(draft.id);
  const revisionId = draft.currentDraftRevision!.id;
  await attachWorkToRevision(revisionId, work.id, editorId);
  await attachMediaToRevision({ recordingRevisionId: revisionId, provider: "YOUTUBE", role: "PRIMARY_VIDEO", url: `https://www.youtube.com/watch?v=${TOKEN}`, actorId: editorId });
  const published = await publishCurrentDraft(draft.id, editorId);
  return { recordingId: draft.id, slug: published.slug, firstRevisionId: revisionId, work };
}

async function revisionsOf(recordingId: string) {
  return prisma.recordingRevision.findMany({
    where: { recordingId },
    orderBy: { revisionNumber: "asc" },
    include: { works: true, mediaResources: true },
  });
}

async function cleanup() {
  if (recordingIds.length > 0) {
    const revisions = await prisma.recordingRevision.findMany({ where: { recordingId: { in: recordingIds } }, select: { id: true } });
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "Recording", entityId: { in: recordingIds } } });
    if (revisions.length > 0) await prisma.auditLogEntry.deleteMany({ where: { entityType: "RecordingRevision", entityId: { in: revisions.map((r) => r.id) } } });
    await prisma.recording.deleteMany({ where: { id: { in: recordingIds } } });
  }
  for (const id of performanceIds) {
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "Performance", entityId: id } });
    await prisma.performance.deleteMany({ where: { id } });
  }
  for (const id of programmeIds) {
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "Programme", entityId: id } });
    await prisma.programme.deleteMany({ where: { id } });
  }
  for (const id of venueIds) {
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "Venue", entityId: id } });
    await prisma.venue.deleteMany({ where: { id } });
  }
  for (const id of artistIds) {
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "Artist", entityId: id } });
    await prisma.artist.deleteMany({ where: { id } });
  }
  for (const id of workIds) {
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "MusicalWork", entityId: id } });
    await prisma.musicalWork.deleteMany({ where: { id } });
  }
  for (const id of composerIds) {
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "Composer", entityId: id } });
    await prisma.composer.deleteMany({ where: { id } });
  }
  await prisma.auditLogEntry.deleteMany({ where: { actorId: { in: [editorId, adminId] } } });
  await prisma.studioUser.deleteMany({ where: { id: { in: [editorId, adminId] } } });
}

beforeAll(async () => {
  const mk = (role: "EDITOR" | "ADMINISTRATOR") =>
    prisma.studioUser.create({
      data: { id: randomUUID(), email: `${TAG}-${role.toLowerCase()}-${TOKEN}-integration-test@musicmadras.test`, name: `Phase 6J-1 ${role}`, role, status: "ACTIVE" },
    });
  editorId = (await mk("EDITOR")).id;
  adminId = (await mk("ADMINISTRATOR")).id;
}, T);

afterAll(cleanup, T);

describe("A. resolveEditableDraftRevision — the server decides which revision is editable", () => {
  it("resolves the current draft (with or without an expected id)", async () => {
    const draft = await createDraftRecording({ slug: slug("a1"), actorId: editorId, title: `A1 ${TOKEN}` });
    recordingIds.push(draft.id);
    const expected = draft.currentDraftRevision!.id;

    const withExpected = await resolveEditableDraftRevision(draft.id, expected);
    expect(withExpected).toMatchObject({ ok: true, revisionId: expected });
    expect(await resolveEditableDraftRevision(draft.id)).toMatchObject({ ok: true, revisionId: expected });
  }, T);

  it("refuses a STALE revision id: the form was rendered for revision 1, but revision 2 is now the draft", async () => {
    const rec = await publishedRecording("stale");
    const fork = await forkDraftFromPublished(rec.recordingId, editorId);

    expect(await resolveEditableDraftRevision(rec.recordingId, rec.firstRevisionId)).toEqual({ ok: false, reason: "STALE_REVISION" });
    expect(await resolveEditableDraftRevision(rec.recordingId, fork.id)).toMatchObject({ ok: true });
  }, T);

  it("refuses a PUBLISHED revision id, and a revision that belongs to another Recording", async () => {
    const a = await publishedRecording("pub-a");
    const b = await publishedRecording("pub-b");
    const forkA = await forkDraftFromPublished(a.recordingId, editorId);
    const forkB = await forkDraftFromPublished(b.recordingId, editorId);

    // A's own PUBLISHED revision is never editable.
    expect(await resolveEditableDraftRevision(a.recordingId, a.firstRevisionId)).toEqual({ ok: false, reason: "STALE_REVISION" });
    // B's genuinely-editable draft is still not A's.
    expect(await resolveEditableDraftRevision(a.recordingId, forkB.id)).toEqual({ ok: false, reason: "STALE_REVISION" });
    expect(forkA.id).not.toBe(forkB.id);
  }, T);

  it("refuses a Recording with no open draft, an archived Recording and an unknown one", async () => {
    const rec = await publishedRecording("nodraft");
    expect(await resolveEditableDraftRevision(rec.recordingId)).toEqual({ ok: false, reason: "NO_OPEN_DRAFT" });

    const forked = await forkDraftFromPublished(rec.recordingId, editorId);
    await archiveRecording(rec.recordingId, editorId);
    expect(await resolveEditableDraftRevision(rec.recordingId, forked.id)).toEqual({ ok: false, reason: "RECORDING_ARCHIVED" });

    expect(await resolveEditableDraftRevision(randomUUID())).toEqual({ ok: false, reason: "RECORDING_NOT_FOUND" });
  }, T);

  it("refuses a REPLAYED id once its draft has been published", async () => {
    const rec = await publishedRecording("replay");
    const fork = await forkDraftFromPublished(rec.recordingId, editorId);
    await publishCurrentDraft(rec.recordingId, editorId);
    expect(await resolveEditableDraftRevision(rec.recordingId, fork.id)).toEqual({ ok: false, reason: "NO_OPEN_DRAFT" });
  }, T);
});

describe("B. Studio actions mutate only the real editable draft", () => {
  it("attaches a Work to the current draft, never to the published revision", async () => {
    as("EDITOR");
    const rec = await publishedRecording("attach");
    const fork = await forkDraftFromPublished(rec.recordingId, editorId);
    const extra = await makeWork("attach-extra");

    await redirectOf(() => attachWorkAction(rec.recordingId, fork.id, form({ musicalWorkId: extra.id })));

    const [first, second] = await revisionsOf(rec.recordingId);
    expect(second.works.map((w) => w.musicalWorkId)).toContain(extra.id);
    expect(first.works.map((w) => w.musicalWorkId)).not.toContain(extra.id);
  }, T);

  it("refuses a PUBLISHED / stale revision id: nothing changes on either revision", async () => {
    as("EDITOR");
    const rec = await publishedRecording("forged");
    const fork = await forkDraftFromPublished(rec.recordingId, editorId);
    const extra = await makeWork("forged-extra");
    const before = await revisionsOf(rec.recordingId);

    const message = await redirectOf(() => attachWorkAction(rec.recordingId, rec.firstRevisionId, form({ musicalWorkId: extra.id })));
    expect(message).toMatch(/out of date/i);

    const after = await revisionsOf(rec.recordingId);
    expect(after.map((r) => r.works.length)).toEqual(before.map((r) => r.works.length));
    expect(fork.id).toBe(after[1].id);
  }, T);

  it("refuses another Recording's revision id (an unrelated revision)", async () => {
    as("EDITOR");
    const mine = await publishedRecording("mine");
    const other = await publishedRecording("other");
    await forkDraftFromPublished(mine.recordingId, editorId);
    const otherFork = await forkDraftFromPublished(other.recordingId, editorId);
    const extra = await makeWork("unrelated-extra");

    await redirectOf(() => attachWorkAction(mine.recordingId, otherFork.id, form({ musicalWorkId: extra.id })));

    const otherRevisions = await revisionsOf(other.recordingId);
    expect(otherRevisions[1].works.map((w) => w.musicalWorkId)).not.toContain(extra.id);
    const mineRevisions = await revisionsOf(mine.recordingId);
    expect(mineRevisions[1].works.map((w) => w.musicalWorkId)).not.toContain(extra.id);
  }, T);

  it("refuses an ARCHIVED Recording, and a replay after its draft was published", async () => {
    as("EDITOR");
    const archived = await publishedRecording("arch-action");
    const forkA = await forkDraftFromPublished(archived.recordingId, editorId);
    await archiveRecording(archived.recordingId, editorId);
    const extra = await makeWork("arch-extra");
    const archivedMessage = await redirectOf(() => attachWorkAction(archived.recordingId, forkA.id, form({ musicalWorkId: extra.id })));
    expect(archivedMessage).toMatch(/archived/i);
    expect((await revisionsOf(archived.recordingId))[1].works.map((w) => w.musicalWorkId)).not.toContain(extra.id);

    const replayed = await publishedRecording("replay-action");
    const forkB = await forkDraftFromPublished(replayed.recordingId, editorId);
    await publishCurrentDraft(replayed.recordingId, editorId);
    const replayMessage = await redirectOf(() => attachWorkAction(replayed.recordingId, forkB.id, form({ musicalWorkId: extra.id })));
    expect(replayMessage).toMatch(/no open draft/i);
    expect((await revisionsOf(replayed.recordingId)).flatMap((r) => r.works.map((w) => w.musicalWorkId))).not.toContain(extra.id);
  }, T);

  it("detach is guarded the same way", async () => {
    as("EDITOR");
    const rec = await publishedRecording("detach");
    const fork = await forkDraftFromPublished(rec.recordingId, editorId);

    await redirectOf(() => detachWorkAction(rec.recordingId, rec.firstRevisionId, rec.work.id)); // stale id: refused
    expect((await revisionsOf(rec.recordingId))[0].works.map((w) => w.musicalWorkId)).toContain(rec.work.id);

    await redirectOf(() => detachWorkAction(rec.recordingId, fork.id, rec.work.id)); // the real draft
    const [first, second] = await revisionsOf(rec.recordingId);
    expect(second.works).toHaveLength(0);
    expect(first.works.map((w) => w.musicalWorkId)).toContain(rec.work.id); // the published revision is untouched
  }, T);

  it("media attach is guarded, and a forged provider/role is a validation error", async () => {
    as("EDITOR");
    const rec = await publishedRecording("media");
    const fork = await forkDraftFromPublished(rec.recordingId, editorId);
    const before = (await revisionsOf(rec.recordingId)).map((r) => r.mediaResources.length);

    const stale = await redirectOf(() => attachMediaAction(rec.recordingId, rec.firstRevisionId, form({ provider: "YOUTUBE", role: "TRAILER", url: "https://example.test/x" })));
    expect(stale).toMatch(/out of date|valid provider/i);
    const forged = await redirectOf(() => attachMediaAction(rec.recordingId, fork.id, form({ provider: "NOT_A_PROVIDER", role: "NOT_A_ROLE", url: "https://example.test/x" })));
    expect(forged).toMatch(/valid provider and role/i);

    expect((await revisionsOf(rec.recordingId)).map((r) => r.mediaResources.length)).toEqual(before);
  }, T);

  it("participants: a stale performance id is refused; the draft's own performance is accepted", async () => {
    as("EDITOR");
    const rec = await publishedRecording("participants");
    const programme = await createProgramme({ slug: slug("prog"), title: `Rev Programme ${TOKEN}`, actorId: editorId });
    programmeIds.push(programme.id);
    const venue = await createVenue({ slug: slug("venue"), name: `Rev Venue ${TOKEN} ${randomUUID().slice(0, 4)}`, type: "CHURCH", actorId: editorId });
    venueIds.push(venue.id);
    const performance = await createPerformance({ programmeId: programme.id, venueId: venue.id, actorId: editorId });
    performanceIds.push(performance.id);
    const otherPerformance = await createPerformance({ programmeId: programme.id, venueId: venue.id, actorId: editorId });
    performanceIds.push(otherPerformance.id);
    const artist = await createArtist({ slug: slug("artist"), name: `Rev Artist ${TOKEN}`, actorId: editorId });
    artistIds.push(artist.id);

    const fork = await forkDraftFromPublished(rec.recordingId, editorId);
    await updateDraftRevisionContent(rec.recordingId, fork.updatedAt, editorId, { performanceId: performance.id });

    // A performance id the draft does not use (forged / stale form): refused.
    const refused = await redirectOf(() => addPerformerAction(rec.recordingId, otherPerformance.id, form({ artistId: artist.id })));
    expect(refused).toMatch(/out of date/i);
    expect(await prisma.performancePerformer.count({ where: { performanceId: otherPerformance.id } })).toBe(0);

    await redirectOf(() => addPerformerAction(rec.recordingId, performance.id, form({ artistId: artist.id })));
    expect(await prisma.performancePerformer.count({ where: { performanceId: performance.id } })).toBe(1);
  }, T);

  it("creating a performance on an archived Recording is refused BEFORE anything is created", async () => {
    as("EDITOR");
    const rec = await publishedRecording("perf-archived");
    const fork = await forkDraftFromPublished(rec.recordingId, editorId);
    await archiveRecording(rec.recordingId, editorId);
    const programme = await createProgramme({ slug: slug("prog2"), title: `Rev Programme2 ${TOKEN}`, actorId: editorId });
    programmeIds.push(programme.id);
    const venue = await createVenue({ slug: slug("venue2"), name: `Rev Venue2 ${TOKEN} ${randomUUID().slice(0, 4)}`, type: "CHURCH", actorId: editorId });
    venueIds.push(venue.id);

    const before = await prisma.performance.count({ where: { programmeId: programme.id } });
    const message = await redirectOf(() =>
      createPerformanceAction(rec.recordingId, fork.updatedAt.toISOString(), form({ programmeId: programme.id, venueId: venue.id }))
    );
    expect(message).toMatch(/archived/i);
    expect(await prisma.performance.count({ where: { programmeId: programme.id } })).toBe(before);
  }, T);

  it("updateDraftRevisionContent refuses to edit an archived Recording's draft", async () => {
    const rec = await publishedRecording("content-archived");
    const fork = await forkDraftFromPublished(rec.recordingId, editorId);
    await archiveRecording(rec.recordingId, editorId);
    await expect(updateDraftRevisionContent(rec.recordingId, fork.updatedAt, editorId, { title: "nope" })).rejects.toThrow(/archived/i);
  }, T);
});

describe("C. Lifecycle: publish / unpublish / restore / archive", () => {
  it("a published Recording keeps serving its published revision while its draft is being edited", async () => {
    as("EDITOR");
    const rec = await publishedRecording("continuity");
    const fork = await forkDraftFromPublished(rec.recordingId, editorId);
    await updateDraftRevisionContent(rec.recordingId, fork.updatedAt, editorId, { title: `Draft-only title ${TOKEN}` });

    const page = await getPublicRecordingPageData(rec.slug);
    expect(page).not.toBeNull();
    expect(page!.title).toBe(`Rev Recording continuity ${TOKEN}`);
  }, T);

  it("publish validates the real draft, publishes it, and a stale form (replay) is then refused", async () => {
    as("ADMINISTRATOR");
    const rec = await publishedRecording("publish");
    const fork = await forkDraftFromPublished(rec.recordingId, editorId);

    await redirectOf(() => publishAction(rec.recordingId, fork.id));
    const after = await prisma.recording.findUniqueOrThrow({ where: { id: rec.recordingId } });
    expect(after.currentPublishedRevisionId).toBe(fork.id);
    expect(after.currentDraftRevisionId).toBeNull();
    expect(after.status).toBe("PUBLISHED");

    const replay = await redirectOf(() => publishAction(rec.recordingId, fork.id));
    expect(replay).toMatch(/no open draft/i);
  }, T);

  it("publish refuses a stale expected revision id", async () => {
    as("ADMINISTRATOR");
    const rec = await publishedRecording("publish-stale");
    await forkDraftFromPublished(rec.recordingId, editorId);

    const message = await redirectOf(() => publishAction(rec.recordingId, rec.firstRevisionId));
    expect(message).toMatch(/out of date/i);
    expect((await prisma.recording.findUniqueOrThrow({ where: { id: rec.recordingId } })).currentPublishedRevisionId).toBe(rec.firstRevisionId);
  }, T);

  it("publishing can never silently un-archive a Recording", async () => {
    as("ADMINISTRATOR");
    const rec = await publishedRecording("no-unarchive");
    const fork = await forkDraftFromPublished(rec.recordingId, editorId);
    await archiveRecording(rec.recordingId, editorId);

    await expect(publishCurrentDraft(rec.recordingId, editorId)).rejects.toThrow(/archived/i);
    const message = await redirectOf(() => publishAction(rec.recordingId, fork.id));
    expect(message).toMatch(/archived/i);
    expect((await prisma.recording.findUniqueOrThrow({ where: { id: rec.recordingId } })).status).toBe("ARCHIVED");
  }, T);

  it("unpublish takes a live Recording offline without touching its revisions; restore returns an archived one to DRAFT", async () => {
    as("ADMINISTRATOR");
    const rec = await publishedRecording("unpublish");
    expect(await getPublicRecordingPageData(rec.slug)).not.toBeNull();

    await redirectOf(() => unpublishAction(rec.recordingId));
    expect(await getPublicRecordingPageData(rec.slug)).toBeNull();
    const unpublished = await prisma.recording.findUniqueOrThrow({ where: { id: rec.recordingId } });
    expect(unpublished.status).toBe("DRAFT");
    expect((await revisionsOf(rec.recordingId))[0].revisionStatus).toBe("PUBLISHED"); // the published revision stays historical

    await redirectOf(() => archiveAction(rec.recordingId));
    expect((await prisma.recording.findUniqueOrThrow({ where: { id: rec.recordingId } })).status).toBe("ARCHIVED");

    await redirectOf(() => restoreAction(rec.recordingId));
    expect((await prisma.recording.findUniqueOrThrow({ where: { id: rec.recordingId } })).status).toBe("DRAFT");
    expect(await getPublicRecordingPageData(rec.slug)).toBeNull(); // restore never makes anything public
  }, T);

  it("unpublish / restore refuse the wrong state with a message, not an error", async () => {
    as("ADMINISTRATOR");
    const rec = await publishedRecording("wrong-state");
    const notArchived = await redirectOf(() => restoreAction(rec.recordingId));
    expect(notArchived).toMatch(/not archived/i);
    await redirectOf(() => unpublishAction(rec.recordingId));
    const notPublished = await redirectOf(() => unpublishAction(rec.recordingId));
    expect(notPublished).toMatch(/not published/i);
  }, T);

  it("archive is idempotent — a double click writes one audit entry", async () => {
    as("ADMINISTRATOR");
    const rec = await publishedRecording("archive-twice");
    await redirectOf(() => archiveAction(rec.recordingId));
    await redirectOf(() => archiveAction(rec.recordingId));
    expect(await prisma.auditLogEntry.count({ where: { entityType: "Recording", entityId: rec.recordingId, action: "RECORDING_ARCHIVED" } })).toBe(1);
  }, T);

  it("publish / unpublish / restore / archive require RECORDING_PUBLISH (an Editor is refused, state unchanged)", async () => {
    as("EDITOR");
    const rec = await publishedRecording("rbac");
    const fork = await forkDraftFromPublished(rec.recordingId, editorId);

    expect(await redirectOf(() => publishAction(rec.recordingId, fork.id))).toMatch(/permission/i);
    expect(await redirectOf(() => unpublishAction(rec.recordingId))).toMatch(/permission/i);
    expect(await redirectOf(() => restoreAction(rec.recordingId))).toMatch(/permission/i);
    expect(await redirectOf(() => archiveAction(rec.recordingId))).toMatch(/permission/i);

    const after = await prisma.recording.findUniqueOrThrow({ where: { id: rec.recordingId } });
    expect(after.status).toBe("PUBLISHED");
    expect(after.currentPublishedRevisionId).toBe(rec.firstRevisionId);
  }, T);

  it("unauthenticated callers are refused by every guarded action", async () => {
    mockGetCurrentStudioSession.mockResolvedValue(null);
    const id = randomUUID();
    expect(await redirectOf(() => attachWorkAction(id, randomUUID(), form({ musicalWorkId: randomUUID() })))).toMatch(/permission/i);
    expect(await redirectOf(() => attachMediaAction(id, randomUUID(), form({ provider: "YOUTUBE", role: "PRIMARY_VIDEO", url: "https://x.test" })))).toMatch(/permission/i);
    expect(await redirectOf(() => publishAction(id, randomUUID()))).toMatch(/permission/i);
    expect(await redirectOf(() => unpublishAction(id))).toMatch(/permission/i);
  }, T);
});
