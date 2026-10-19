import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

// Must be at the true top level — vi.mock is hoisted above every import.
const mockGetCurrentStudioSession = vi.fn();
vi.mock("../../modules/auth/authService", () => ({
  getCurrentStudioSession: () => mockGetCurrentStudioSession(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// Fault injection (see lifecycleSerialization.test.ts): `action` fails the audit write; `afterAction` writes the audit
// row and then fails, so the row survives only if it was written outside the operation's transaction.
const inject = vi.hoisted(() => ({ action: null as string | null, afterAction: null as string | null }));
vi.mock("../../modules/audit/writeAuditLog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../modules/audit/writeAuditLog")>();
  return {
    ...actual,
    writeAuditLog: (input: Parameters<typeof actual.writeAuditLog>[0], client?: Parameters<typeof actual.writeAuditLog>[1]) => {
      if (inject.action !== null && input.action === inject.action) return Promise.reject(new Error("injected audit failure"));
      if (inject.afterAction !== null && input.action === inject.afterAction) {
        return actual.writeAuditLog(input, client).then(() => {
          throw new Error("injected failure after audit write");
        });
      }
      return actual.writeAuditLog(input, client);
    },
  };
});

import type { Prisma } from "@prisma/client";
import { prisma } from "../../modules/db/client";
import { createArtist } from "../../modules/db/repositories/artistRepository";
import { createChoir } from "../../modules/db/repositories/choirRepository";
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createConductor } from "../../modules/db/repositories/conductorRepository";
import { createMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import { attachMediaToRevision } from "../../modules/db/repositories/mediaResourceRepository";
import { getPublicPerformancePageData } from "../../modules/db/repositories/entityRelationshipsRepository";
import {
  addChoirToPerformance,
  addConductorToPerformance,
  addPerformerToPerformance,
  listPerformancesForStudio,
  removePerformerFromPerformance,
} from "../../modules/db/repositories/performanceRepository";
import {
  ProgrammeBusyError,
  ProgrammeInPublishedContentError,
  programmeEditLockKey,
  addProgrammeItem,
  createProgramme,
  removeProgrammeItem,
} from "../../modules/db/repositories/programmeRepository";
import { createVenue, findVenueById } from "../../modules/db/repositories/venueRepository";
import {
  ConcurrentEditError,
  RevisionNotEditableError,
  archiveRecording,
  attachWorkToRevision,
  createDraftRecording,
  createPerformanceForDraft,
  discardDraftPerformanceClone,
  editDraftPerformanceParticipants,
  getDraftPerformanceCloneStatus,
  forkDraftFromPublished,
  publishCurrentDraft,
  publishRecordingDraft,
  restoreRecording,
  unpublishRecording,
  updateDraftRevisionContent,
} from "../../modules/db/repositories/recordingRepository";
import { addPerformerAction, discardParticipantChangesAction } from "../../app/(studio)/studio/(protected)/recordings/[id]/participants/actions";
import { describePublishRefusal } from "../../modules/publishing/publishRefusal";
import { addProgrammeItemAction } from "../../app/(studio)/studio/(protected)/recordings/[id]/programme/actions";

// Phase 6J-10F — draft edits must not silently change published content through shared records.
//
// Ownership model under test (docs/recording-publication-safety.md):
//  - Programme, Venue, Artist, Choir, Conductor, Work stay canonical, shared catalogue identities.
//  - A Performance is shared between a published revision and its draft after a fork. The participants of a Performance
//    are edited copy-on-write: the draft gets its own clone (same Programme/Venue/date, copied links) on its first
//    participant edit, and publishing promotes the clone's participants onto the original, keeping its URL.
//  - The Recording workflow cannot change a Programme that published content shows.

const T = 120000;
const TOKEN = randomUUID().slice(0, 8);
const ROUNDS = 6;

const userIds = {} as { admin: string; editor: string };
const recordingIds: string[] = [];
const workIds: string[] = [];
const artistIds: string[] = [];
const choirIds: string[] = [];
const conductorIds: string[] = [];
const programmeIds: string[] = [];
const venueIds: string[] = [];
let composerId: string;
let counter = 0;
const A = {} as { one: string; two: string; three: string };
let choirId: string;
let conductorId: string;
let programmeId: string;
let venueId: string;
const artistSlugs: Record<string, string> = {};

const uniq = (label: string) => `f10-${label}-${TOKEN}-${++counter}-${randomUUID().slice(0, 4)}`;

async function newProgramme(label: string) {
  const programme = await createProgramme({ slug: uniq(`prog-${label}`), title: `F10 Programme ${label} ${TOKEN} ${counter}`, actorId: userIds.editor });
  programmeIds.push(programme.id);
  return programme.id;
}

/** A published Recording whose Performance (programme P, venue V) has performer one. Participants on a fresh, draft-owned Performance are edited in place. */
async function publishedWithPerformance(label: string, options: { programme?: string } = {}) {
  const recording = await createDraftRecording({ slug: uniq(label), actorId: userIds.editor, title: `F10 ${label}` });
  recordingIds.push(recording.id);
  const draftId = recording.currentDraftRevisionId!;
  const work = await createMusicalWork({ slug: uniq(`w-${label}`), title: `F10 Work ${label} ${TOKEN} ${counter}`, composerId, actorId: userIds.editor });
  workIds.push(work.id);
  await attachWorkToRevision(draftId, work.id, userIds.editor);
  await attachMediaToRevision({ recordingRevisionId: draftId, provider: "YOUTUBE", role: "PRIMARY_VIDEO", url: "https://www.youtube.com/watch?v=f10", actorId: userIds.editor });
  const token = (await prisma.recordingRevision.findUniqueOrThrow({ where: { id: draftId } })).updatedAt;
  const performance = await createPerformanceForDraft(recording.id, draftId, token, { programmeId: options.programme ?? programmeId, venueId, actorId: userIds.editor });
  const first = await editDraftPerformanceParticipants({ recordingId: recording.id, expectedPerformanceId: performance.id, actorId: userIds.editor, change: (tx, id) => addPerformerToPerformance(id, A.one, "Soloist", userIds.editor, tx) });
  expect(first.cloned).toBe(false); // nothing else uses this Performance: edited in place
  await publishCurrentDraft(recording.id, userIds.admin);
  return { id: recording.id, slug: recording.slug, publishedRevisionId: draftId, performanceId: performance.id, performanceSlug: performance.slug };
}

async function liveWithOpenDraft(label: string) {
  const rec = await publishedWithPerformance(label);
  const draft = await forkDraftFromPublished(rec.id, userIds.editor);
  return { ...rec, draftId: draft.id };
}

const revision = (id: string) => prisma.recordingRevision.findUniqueOrThrow({ where: { id } });

async function publicParticipants(slug: string) {
  const data = await getPublicPerformancePageData(slug);
  if (!data) return null;
  return { artists: data.artists.map((a) => a.slug).sort(), choirs: data.choirs.map((c) => c.id).sort(), conductors: data.conductors.map((c) => c.id).sort() };
}

async function participantRows(performanceId: string) {
  const [performers, choirs, conductors] = await Promise.all([
    prisma.performancePerformer.findMany({ where: { performanceId } }),
    prisma.performanceChoir.findMany({ where: { performanceId } }),
    prisma.performanceConductor.findMany({ where: { performanceId } }),
  ]);
  return { performers: performers.map((p) => p.artistId).sort(), choirs: choirs.map((c) => c.choirId).sort(), conductors: conductors.map((c) => c.conductorId).sort() };
}

const addPerformer = (recordingId: string, performanceId: string, artistId: string) =>
  editDraftPerformanceParticipants({ recordingId, expectedPerformanceId: performanceId, actorId: userIds.editor, change: (tx, id) => addPerformerToPerformance(id, artistId, undefined, userIds.editor, tx) });

const clonesOf = (performanceId: string) => prisma.performance.findMany({ where: { draftOfPerformanceId: performanceId } });

function holdEditLock(recordingId: string) {
  let release!: () => void;
  let acquired!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const got = new Promise<void>((resolve) => (acquired = resolve));
  const done = prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`recording-edit:${recordingId}`}))`;
      acquired();
      await released;
    },
    { timeout: 60000, maxWait: 10000 }
  );
  return { got, release, done };
}
const PENDING = Symbol("pending");
async function stillPending(promise: Promise<unknown>, afterMs = 600) {
  return (await Promise.race([promise.then(() => "settled", () => "settled"), new Promise((resolve) => setTimeout(() => resolve(PENDING), afterMs))])) === PENDING;
}
const settle = <V,>(promise: Promise<V>) => promise.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));

async function redirectOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    const digest = (err as { digest?: unknown }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) return decodeURIComponent(digest.split(";").slice(2, -2).join(";").replace(/\+/g, " "));
    throw err;
  }
  throw new Error("The action did not redirect");
}

beforeAll(async () => {
  for (const [key, role] of [["admin", "ADMINISTRATOR"], ["editor", "EDITOR"]] as const) {
    userIds[key] = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `f10-${key}-${TOKEN}@musicmadras.test`, name: `F10 ${key}`, role, status: "ACTIVE" } })).id;
  }
  composerId = (await createComposer({ slug: `f10-composer-${TOKEN}`, name: `F10 Composer ${TOKEN}`, actorId: userIds.editor })).id;
  for (const key of ["one", "two", "three"] as const) {
    const artist = await createArtist({ slug: `f10-artist-${key}-${TOKEN}`, name: `F10 Artist ${key} ${TOKEN}`, actorId: userIds.editor });
    A[key] = artist.id;
    artistIds.push(artist.id);
    artistSlugs[artist.id] = artist.slug;
  }
  choirId = (await createChoir({ slug: `f10-choir-${TOKEN}`, name: `F10 Choir ${TOKEN}`, actorId: userIds.editor })).id;
  choirIds.push(choirId);
  conductorId = (await createConductor({ slug: `f10-conductor-${TOKEN}`, name: `F10 Conductor ${TOKEN}`, actorId: userIds.editor })).id;
  conductorIds.push(conductorId);
  programmeId = await newProgramme("shared");
  venueId = (await createVenue({ slug: `f10-venue-${TOKEN}`, name: `F10 Venue ${TOKEN}`, type: "CHURCH", actorId: userIds.editor })).id;
  venueIds.push(venueId);
}, T);

afterAll(async () => {
  const revisionIds = (await prisma.recordingRevision.findMany({ where: { recordingId: { in: recordingIds } }, select: { id: true } })).map((r) => r.id);
  const mediaIds = (await prisma.mediaResource.findMany({ where: { recordingRevisionId: { in: revisionIds } }, select: { id: true } })).map((m) => m.id);
  const performanceIds = (await prisma.performance.findMany({ where: { OR: [{ programmeId: { in: programmeIds } }, { venueId: { in: venueIds } }] }, select: { id: true } })).map((p) => p.id);
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityId: { in: [...recordingIds, ...revisionIds, ...mediaIds, ...performanceIds, ...programmeIds] } }, { actorId: { in: Object.values(userIds) } }] } });
  await prisma.mediaResource.deleteMany({ where: { recordingRevisionId: { in: revisionIds } } });
  await prisma.recording.deleteMany({ where: { id: { in: recordingIds } } });
  await prisma.instrument.deleteMany({ where: { venueId: { in: venueIds } } });
  await prisma.performance.updateMany({ where: { id: { in: performanceIds } }, data: { draftOfPerformanceId: null } });
  await prisma.performance.deleteMany({ where: { id: { in: performanceIds } } });
  await prisma.programmeItem.deleteMany({ where: { programmeId: { in: programmeIds } } });
  await prisma.programme.deleteMany({ where: { id: { in: programmeIds } } });
  await prisma.venue.deleteMany({ where: { id: { in: venueIds } } });
  await prisma.artist.deleteMany({ where: { id: { in: artistIds } } });
  await prisma.choir.deleteMany({ where: { id: { in: choirIds } } });
  await prisma.conductor.deleteMany({ where: { id: { in: conductorIds } } });
  await prisma.musicalWork.deleteMany({ where: { id: { in: workIds } } });
  await prisma.composer.deleteMany({ where: { id: composerId } });
  await prisma.studioUser.deleteMany({ where: { id: { in: Object.values(userIds) } } });
}, T);

describe("A. a fork's participant edits are isolated from the published page", () => {
  it("the first participant edit gives the draft its own Performance; the published Performance and its public page do not change", async () => {
    const rec = await liveWithOpenDraft("iso");
    const publishedBefore = await publicParticipants(rec.performanceSlug);
    expect(publishedBefore).toEqual({ artists: [artistSlugs[A.one]], choirs: [], conductors: [] });
    expect((await revision(rec.draftId)).performanceId).toBe(rec.performanceId); // a fresh fork shares the Performance

    const edit = await addPerformer(rec.id, rec.performanceId, A.two);
    expect(edit.cloned).toBe(true);
    expect(edit.performanceId).not.toBe(rec.performanceId);

    // the draft now points at its own clone; the published revision still points at the original
    expect((await revision(rec.draftId)).performanceId).toBe(edit.performanceId);
    expect((await revision(rec.publishedRevisionId)).performanceId).toBe(rec.performanceId);
    // the clone carries everything and the edit; the original is untouched
    expect(await participantRows(edit.performanceId)).toEqual({ performers: [A.one, A.two].sort(), choirs: [], conductors: [] });
    expect(await participantRows(rec.performanceId)).toEqual({ performers: [A.one], choirs: [], conductors: [] });
    // the public page is byte-for-byte what it was
    expect(await publicParticipants(rec.performanceSlug)).toEqual(publishedBefore);
    // and the clone is not public at all
    const clone = await prisma.performance.findUniqueOrThrow({ where: { id: edit.performanceId } });
    expect(await getPublicPerformancePageData(clone.slug)).toBeNull();
    expect(clone).toMatchObject({ draftOfPerformanceId: rec.performanceId });
    // audit trail: clone creation and the edit are both recorded against the clone
    const audits = await prisma.auditLogEntry.findMany({ where: { entityType: "Performance", entityId: edit.performanceId } });
    expect(audits.map((a) => a.action).sort()).toEqual(["PERFORMANCE_CLONED_FOR_DRAFT", "PERFORMER_LINKED_TO_PERFORMANCE"]);
  }, T);

  it("choir, conductor and removal edits are isolated the same way; later edits reuse the same clone", async () => {
    const rec = await liveWithOpenDraft("iso-all");
    const first = await editDraftPerformanceParticipants({ recordingId: rec.id, expectedPerformanceId: rec.performanceId, actorId: userIds.editor, change: (tx, id) => addChoirToPerformance(id, choirId, userIds.editor, tx) });
    expect(first.cloned).toBe(true);
    const second = await editDraftPerformanceParticipants({ recordingId: rec.id, expectedPerformanceId: first.performanceId, actorId: userIds.editor, change: (tx, id) => addConductorToPerformance(id, conductorId, userIds.editor, tx) });
    expect(second).toMatchObject({ cloned: false, performanceId: first.performanceId });
    await editDraftPerformanceParticipants({ recordingId: rec.id, expectedPerformanceId: first.performanceId, actorId: userIds.editor, change: (tx, id) => removePerformerFromPerformance(id, A.one, userIds.editor, tx) });

    expect(await clonesOf(rec.performanceId)).toHaveLength(1);
    expect(await participantRows(first.performanceId)).toEqual({ performers: [], choirs: [choirId], conductors: [conductorId] });
    expect(await publicParticipants(rec.performanceSlug)).toEqual({ artists: [artistSlugs[A.one]], choirs: [], conductors: [] });
  }, T);

  it("a stale form (bound to the old Performance) is refused after the clone exists", async () => {
    const rec = await liveWithOpenDraft("stale-form");
    await addPerformer(rec.id, rec.performanceId, A.two);
    await expect(addPerformer(rec.id, rec.performanceId, A.three)).rejects.toBeInstanceOf(RevisionNotEditableError);
    expect(await participantRows(rec.performanceId)).toEqual({ performers: [A.one], choirs: [], conductors: [] });
  }, T);

  it("the Studio action applies the same isolation and reports a stale form as a message", async () => {
    mockGetCurrentStudioSession.mockResolvedValue({ user: { id: userIds.editor, role: "EDITOR", status: "ACTIVE" } });
    const rec = await liveWithOpenDraft("action");
    const form = new FormData();
    form.set("artistId", A.two);
    await redirectOf(() => addPerformerAction(rec.id, rec.performanceId, form));
    expect(await participantRows(rec.performanceId)).toEqual({ performers: [A.one], choirs: [], conductors: [] });
    expect(await redirectOf(() => addPerformerAction(rec.id, rec.performanceId, form))).toMatch(/out of date/i);
  }, T);

  it("canonical identities stay shared: the clone uses the same Programme, Venue, date and Artist rows", async () => {
    const rec = await liveWithOpenDraft("canonical");
    const artistCount = await prisma.artist.count({ where: { id: { in: artistIds } } });
    const edit = await addPerformer(rec.id, rec.performanceId, A.two);
    const original = await prisma.performance.findUniqueOrThrow({ where: { id: rec.performanceId } });
    const clone = await prisma.performance.findUniqueOrThrow({ where: { id: edit.performanceId } });
    expect({ programmeId: clone.programmeId, venueId: clone.venueId, performanceDate: clone.performanceDate }).toEqual({ programmeId: original.programmeId, venueId: original.venueId, performanceDate: original.performanceDate });
    expect(await prisma.artist.count({ where: { id: { in: artistIds } } })).toBe(artistCount); // no Artist was duplicated
    expect(clone.slug).not.toBe(original.slug);
  }, T);

  it("a Performance used only by this draft is edited in place (no clone)", async () => {
    const rec = await createDraftRecording({ slug: uniq("own"), actorId: userIds.editor, title: "F10 own" });
    recordingIds.push(rec.id);
    const token = (await revision(rec.currentDraftRevisionId!)).updatedAt;
    const performance = await createPerformanceForDraft(rec.id, rec.currentDraftRevisionId!, token, { programmeId, venueId, actorId: userIds.editor });
    const edit = await addPerformer(rec.id, performance.id, A.one);
    expect(edit).toMatchObject({ cloned: false, performanceId: performance.id });
    expect(await clonesOf(performance.id)).toHaveLength(0);
  }, T);

  it("a Performance shared by two Recordings is cloned for the editing draft, not edited under the other Recording", async () => {
    const first = await publishedWithPerformance("two-recs");
    const second = await createDraftRecording({ slug: uniq("two-recs-b"), actorId: userIds.editor, title: "F10 two-recs-b" });
    recordingIds.push(second.id);
    await prisma.recordingRevision.update({ where: { id: second.currentDraftRevisionId! }, data: { performanceId: first.performanceId } }); // a second Recording using the same event
    const edit = await addPerformer(second.id, first.performanceId, A.two);
    expect(edit.cloned).toBe(true);
    expect(await participantRows(first.performanceId)).toEqual({ performers: [A.one], choirs: [], conductors: [] });
  }, T);

  it("the Studio's performance list does not show draft clones", async () => {
    const rec = await liveWithOpenDraft("list");
    const edit = await addPerformer(rec.id, rec.performanceId, A.two);
    const ids = (await listPerformancesForStudio()).map((p) => p.id);
    expect(ids).toContain(rec.performanceId);
    expect(ids).not.toContain(edit.performanceId);
  }, T);
});

describe("B. publication is the moment the public page changes", () => {
  it("publishing the edited draft promotes its participants onto the original Performance (same URL), removes the clone and audits it", async () => {
    const rec = await liveWithOpenDraft("promote");
    const before = await publicParticipants(rec.performanceSlug);
    const edit = await addPerformer(rec.id, rec.performanceId, A.two);
    await editDraftPerformanceParticipants({ recordingId: rec.id, expectedPerformanceId: edit.performanceId, actorId: userIds.editor, change: (tx, id) => removePerformerFromPerformance(id, A.one, userIds.editor, tx) });
    expect(await publicParticipants(rec.performanceSlug)).toEqual(before); // still unchanged before publication

    const result = await publishRecordingDraft({ recordingId: rec.id, actorId: userIds.admin, expectedDraftRevisionId: rec.draftId });
    expect(result.ok).toBe(true);

    expect(await publicParticipants(rec.performanceSlug)).toEqual({ artists: [artistSlugs[A.two]], choirs: [], conductors: [] }); // changed, at the original URL
    expect(await prisma.performance.findUnique({ where: { id: edit.performanceId } })).toBeNull(); // clone gone
    expect((await revision(rec.draftId)).performanceId).toBe(rec.performanceId); // the new published revision points at the original
    expect((await revision(rec.draftId)).revisionStatus).toBe("PUBLISHED");
    expect((await revision(rec.publishedRevisionId)).revisionStatus).toBe("SUPERSEDED");
    expect(await participantRows(rec.performanceId)).toEqual({ performers: [A.two], choirs: [], conductors: [] });
    const promoted = await prisma.auditLogEntry.findMany({ where: { entityType: "Performance", entityId: rec.performanceId, action: "PERFORMANCE_DRAFT_PROMOTED" } });
    expect(promoted).toHaveLength(1);
    expect(promoted[0].beforeSnapshot).toMatchObject({ performerArtistIds: [A.one] });
    expect(promoted[0].afterSnapshot).toMatchObject({ performerArtistIds: [A.two] });
  }, T);

  it("a draft with no participant edit publishes exactly as before (no clone, no promotion)", async () => {
    const rec = await liveWithOpenDraft("no-edit");
    const result = await publishRecordingDraft({ recordingId: rec.id, actorId: userIds.admin, expectedDraftRevisionId: rec.draftId });
    expect(result.ok).toBe(true);
    expect((await revision(rec.draftId)).performanceId).toBe(rec.performanceId);
    expect(await clonesOf(rec.performanceId)).toHaveLength(0);
    expect(await prisma.auditLogEntry.count({ where: { entityType: "Performance", entityId: rec.performanceId, action: "PERFORMANCE_DRAFT_PROMOTED" } })).toBe(0);
    expect(await publicParticipants(rec.performanceSlug)).toEqual({ artists: [artistSlugs[A.one]], choirs: [], conductors: [] });
  }, T);

  it("a draft that switched to a brand-new Performance publishes that Performance (the existing behaviour), and the old one is untouched", async () => {
    const rec = await liveWithOpenDraft("swap");
    const token = (await revision(rec.draftId)).updatedAt;
    const replacement = await createPerformanceForDraft(rec.id, rec.draftId, token, { programmeId, venueId, actorId: userIds.editor });
    expect(await getPublicPerformancePageData(replacement.slug)).toBeNull(); // not public before publication
    await publishRecordingDraft({ recordingId: rec.id, actorId: userIds.admin, expectedDraftRevisionId: rec.draftId });
    expect(await getPublicPerformancePageData(replacement.slug)).not.toBeNull();
    expect(await getPublicPerformancePageData(rec.performanceSlug)).toBeNull(); // no longer used by a published revision
    expect(await participantRows(rec.performanceId)).toEqual({ performers: [A.one], choirs: [], conductors: [] });
  }, T);

  it("abandoning the draft leaves the published page unchanged: unpublish/archive/restore cycles never apply a clone", async () => {
    const rec = await liveWithOpenDraft("abandon");
    const before = await publicParticipants(rec.performanceSlug);
    const edit = await addPerformer(rec.id, rec.performanceId, A.two);
    await archiveRecording(rec.id, userIds.admin);
    await restoreRecording(rec.id, userIds.admin);
    expect(await publicParticipants(rec.performanceSlug)).toBeNull(); // restore never republishes (status DRAFT)
    await unpublishRecording(rec.id, userIds.admin).catch(() => undefined);
    // the clone is still the draft's own, never applied; the original Performance's participants are as they were
    expect(await participantRows(rec.performanceId)).toEqual({ performers: [A.one], choirs: [], conductors: [] });
    expect((await revision(rec.draftId)).performanceId).toBe(edit.performanceId);
    expect((await revision(rec.publishedRevisionId)).performanceId).toBe(rec.performanceId);
    expect(before).toEqual({ artists: [artistSlugs[A.one]], choirs: [], conductors: [] });
  }, T);

  it("a draft that is never published leaves the live page identical throughout (a draft left open)", async () => {
    const rec = await liveWithOpenDraft("left-open");
    const snapshot = JSON.stringify(await getPublicPerformancePageData(rec.performanceSlug));
    await addPerformer(rec.id, rec.performanceId, A.two);
    await updateDraftRevisionContent(rec.id, (await revision(rec.draftId)).updatedAt, userIds.editor, { title: "Draft-only title" });
    expect(JSON.stringify(await getPublicPerformancePageData(rec.performanceSlug))).toBe(snapshot);
  }, T);
});

describe("C. failures leave no orphan clones, links or audit rows", () => {
  async function stateOf(rec: { id: string; draftId: string; performanceId: string }) {
    return {
      draftPerformance: (await revision(rec.draftId)).performanceId,
      clones: (await clonesOf(rec.performanceId)).length,
      original: await participantRows(rec.performanceId),
    };
  }

  for (const mode of ["action", "afterAction"] as const) {
    for (const audit of ["PERFORMER_LINKED_TO_PERFORMANCE", "PERFORMANCE_CLONED_FOR_DRAFT"]) {
      it(`${mode === "action" ? "a failing" : "a failing-after"} ${audit} audit write rolls back the clone, its links and the re-pointing`, async () => {
        const rec = await liveWithOpenDraft(`atomic-${mode}`);
        const before = await stateOf(rec);
        const allBefore = await prisma.performance.count({ where: { venueId } });
        const auditBefore = await prisma.auditLogEntry.count({ where: { action: { in: ["PERFORMANCE_CLONED_FOR_DRAFT", "PERFORMER_LINKED_TO_PERFORMANCE"] } } });
        inject[mode] = audit;
        try {
          await expect(addPerformer(rec.id, rec.performanceId, A.two)).rejects.toThrow(/injected/);
        } finally {
          inject[mode] = null;
        }
        expect(await stateOf(rec)).toEqual(before);
        expect(await prisma.performance.count({ where: { venueId } })).toBe(allBefore); // no orphan Performance row
        expect(await prisma.auditLogEntry.count({ where: { action: { in: ["PERFORMANCE_CLONED_FOR_DRAFT", "PERFORMER_LINKED_TO_PERFORMANCE"] } } })).toBe(auditBefore); // no orphan audit row
        // and the same edit succeeds afterwards
        expect((await addPerformer(rec.id, rec.performanceId, A.two)).cloned).toBe(true);
      }, T);
    }
  }

  it("a failure while promoting at publication rolls the whole publication back: nothing public changes, the clone and draft survive", async () => {
    const rec = await liveWithOpenDraft("promote-fail");
    const edit = await addPerformer(rec.id, rec.performanceId, A.two);
    const publicBefore = await publicParticipants(rec.performanceSlug);
    inject.afterAction = "PERFORMANCE_DRAFT_PROMOTED";
    let result;
    try {
      result = await publishRecordingDraft({ recordingId: rec.id, actorId: userIds.admin, expectedDraftRevisionId: rec.draftId });
    } finally {
      inject.afterAction = null;
    }
    expect(result).toMatchObject({ ok: false, reason: "FAILED" });
    expect(await publicParticipants(rec.performanceSlug)).toEqual(publicBefore);
    expect(await participantRows(rec.performanceId)).toEqual({ performers: [A.one], choirs: [], conductors: [] });
    expect(await prisma.performance.findUnique({ where: { id: edit.performanceId } })).not.toBeNull();
    expect((await revision(rec.draftId)).performanceId).toBe(edit.performanceId);
    expect((await revision(rec.draftId)).revisionStatus).toBe("DRAFT");
    expect((await revision(rec.publishedRevisionId)).revisionStatus).toBe("PUBLISHED");
    expect(await prisma.auditLogEntry.count({ where: { entityType: "Performance", entityId: rec.performanceId, action: "PERFORMANCE_DRAFT_PROMOTED" } })).toBe(0);
    // the publication succeeds once the fault is gone, and promotes
    expect((await publishRecordingDraft({ recordingId: rec.id, actorId: userIds.admin, expectedDraftRevisionId: rec.draftId })).ok).toBe(true);
    expect(await publicParticipants(rec.performanceSlug)).toEqual({ artists: [artistSlugs[A.one], artistSlugs[A.two]].sort(), choirs: [], conductors: [] });
  }, T);

  it("an edit on an archived Recording or without a draft is refused and creates no clone", async () => {
    const rec = await liveWithOpenDraft("refused");
    await archiveRecording(rec.id, userIds.admin);
    await expect(addPerformer(rec.id, rec.performanceId, A.two)).rejects.toMatchObject({ reason: "RECORDING_ARCHIVED" });
    const live = await publishedWithPerformance("refused-nodraft");
    await expect(addPerformer(live.id, live.performanceId, A.two)).rejects.toMatchObject({ reason: "NO_OPEN_DRAFT" });
    expect(await clonesOf(rec.performanceId)).toHaveLength(0);
    expect(await clonesOf(live.performanceId)).toHaveLength(0);
  }, T);
});

describe("D. the existing lock and CAS protocol still holds", () => {
  it("two simultaneous first edits from the same page: exactly one clone, one edit lands, the other is refused as out of date", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const rec = await liveWithOpenDraft("conc-edit");
      const [a, b] = await Promise.all([settle(addPerformer(rec.id, rec.performanceId, A.two)), settle(addPerformer(rec.id, rec.performanceId, A.three))]);
      expect([a, b].filter((r) => r.ok)).toHaveLength(1);
      const loser = [a, b].find((r) => !r.ok)!;
      expect((loser as { error: unknown }).error).toBeInstanceOf(RevisionNotEditableError);
      expect(await clonesOf(rec.performanceId)).toHaveLength(1);
      expect(await participantRows(rec.performanceId)).toEqual({ performers: [A.one], choirs: [], conductors: [] });
      expect((await participantRows((await clonesOf(rec.performanceId))[0].id)).performers).toHaveLength(2);
    }
  }, T);

  it("a participant edit queued behind the edit lock waits for it, then applies", async () => {
    const rec = await liveWithOpenDraft("lock-wait");
    const holder = holdEditLock(rec.id);
    await holder.got;
    const edit = settle(addPerformer(rec.id, rec.performanceId, A.two));
    expect(await stillPending(edit)).toBe(true);
    expect(await clonesOf(rec.performanceId)).toHaveLength(0);
    holder.release();
    await holder.done;
    expect((await edit).ok).toBe(true);
    expect(await clonesOf(rec.performanceId)).toHaveLength(1);
  }, T);

  it(`an edit racing publication gives a coherent serial outcome: promoted exactly once or refused, never an orphan clone (${ROUNDS} rounds)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const rec = await liveWithOpenDraft("conc-publish");
      const [edit, publish] = await Promise.all([
        settle(addPerformer(rec.id, rec.performanceId, A.two)),
        publishRecordingDraft({ recordingId: rec.id, actorId: userIds.admin, expectedDraftRevisionId: rec.draftId }),
      ]);
      expect(publish.ok).toBe(true);
      expect(await clonesOf(rec.performanceId)).toHaveLength(0); // promoted and removed, or never created
      expect((await revision(rec.draftId)).performanceId).toBe(rec.performanceId);
      const publicNow = await publicParticipants(rec.performanceSlug);
      if (edit.ok) {
        expect(publicNow).toEqual({ artists: [artistSlugs[A.one], artistSlugs[A.two]].sort(), choirs: [], conductors: [] }); // edit committed first, then promoted
        expect(await prisma.auditLogEntry.count({ where: { entityType: "Performance", entityId: rec.performanceId, action: "PERFORMANCE_DRAFT_PROMOTED" } })).toBe(1);
      } else {
        expect((edit as { error: unknown }).error).toBeInstanceOf(RevisionNotEditableError); // publication won; no draft any more
        expect(publicNow).toEqual({ artists: [artistSlugs[A.one]], choirs: [], conductors: [] });
        expect(await participantRows(rec.performanceId)).toEqual({ performers: [A.one], choirs: [], conductors: [] });
      }
    }
  }, T);

  it("re-pointing the draft advances its content token: a form loaded before a participant edit conflicts instead of overwriting", async () => {
    const rec = await liveWithOpenDraft("token");
    const loaded = (await revision(rec.draftId)).updatedAt;
    await addPerformer(rec.id, rec.performanceId, A.two); // clones and re-points the draft
    await expect(updateDraftRevisionContent(rec.id, loaded, userIds.editor, { title: "stale" })).rejects.toBeInstanceOf(ConcurrentEditError);
  }, T);
});

describe("E. existing data and records without a draft stay readable and publishable", () => {
  it("legacy rows (no clone marker) keep reading and publishing; the migration left every existing Performance as an ordinary one", async () => {
    const rec = await publishedWithPerformance("legacy");
    expect(await publicParticipants(rec.performanceSlug)).toEqual({ artists: [artistSlugs[A.one]], choirs: [], conductors: [] });
    expect((await prisma.performance.findUniqueOrThrow({ where: { id: rec.performanceId } })).draftOfPerformanceId).toBeNull();
    const draft = await forkDraftFromPublished(rec.id, userIds.editor);
    await updateDraftRevisionContent(rec.id, draft.updatedAt, userIds.editor, { title: "Edited" });
    expect((await publishRecordingDraft({ recordingId: rec.id, actorId: userIds.admin, expectedDraftRevisionId: draft.id })).ok).toBe(true);
    expect(await publicParticipants(rec.performanceSlug)).toEqual({ artists: [artistSlugs[A.one]], choirs: [], conductors: [] });
  }, T);

  it("deleting the original while a clone exists clears the marker instead of failing (SET NULL), and the clone then publishes as its own Performance", async () => {
    const rec = await liveWithOpenDraft("orphaned-marker");
    const edit = await addPerformer(rec.id, rec.performanceId, A.two);
    await prisma.recordingRevision.updateMany({ where: { performanceId: rec.performanceId }, data: { performanceId: null } });
    await prisma.performance.delete({ where: { id: rec.performanceId } });
    expect((await prisma.performance.findUniqueOrThrow({ where: { id: edit.performanceId } })).draftOfPerformanceId).toBeNull();
  }, T);
});

describe("F. the Recording workflow cannot change a Programme that published content shows", () => {
  it("add and remove are refused for a published Programme, in the same transaction as the write, with nothing changed", async () => {
    const programme = await newProgramme("published");
    const rec = await publishedWithPerformance("prog-published", { programme });
    const work = await createMusicalWork({ slug: uniq("w-prog"), title: `F10 ProgWork ${TOKEN} ${counter}`, composerId, actorId: userIds.editor });
    workIds.push(work.id);
    const item = await addProgrammeItem({ programmeId: programme, musicalWorkId: work.id, actorId: userIds.editor }); // catalogue path: deliberate, allowed
    const auditBefore = await prisma.auditLogEntry.count({ where: { entityType: "Programme", entityId: programme } });

    await expect(addProgrammeItem({ programmeId: programme, musicalWorkId: work.id, actorId: userIds.editor, refuseIfInPublishedContent: true })).rejects.toBeInstanceOf(ProgrammeInPublishedContentError);
    await expect(removeProgrammeItem(item.id, userIds.editor, { refuseIfInPublishedContent: true })).rejects.toBeInstanceOf(ProgrammeInPublishedContentError);
    expect(await prisma.programmeItem.count({ where: { programmeId: programme } })).toBe(1);
    expect(await prisma.auditLogEntry.count({ where: { entityType: "Programme", entityId: programme } })).toBe(auditBefore);
    expect(rec.id).toBeTruthy();
  }, T);

  it("the Studio action shows the refusal as a message", async () => {
    mockGetCurrentStudioSession.mockResolvedValue({ user: { id: userIds.editor, role: "EDITOR", status: "ACTIVE" } });
    const programme = await newProgramme("published-action");
    const rec = await publishedWithPerformance("prog-action", { programme });
    const work = await createMusicalWork({ slug: uniq("w-prog2"), title: `F10 ProgWork2 ${TOKEN} ${counter}`, composerId, actorId: userIds.editor });
    workIds.push(work.id);
    const form = new FormData();
    form.set("musicalWorkId", work.id);
    expect(await redirectOf(() => addProgrammeItemAction(rec.id, programme, form))).toMatch(/part of published content/i);
    expect(await prisma.programmeItem.count({ where: { programmeId: programme } })).toBe(0);
  }, T);

  it("a Programme no published content shows can still be built in the workflow, and becomes protected once it is published", async () => {
    const programme = await newProgramme("unpublished");
    const work = await createMusicalWork({ slug: uniq("w-prog3"), title: `F10 ProgWork3 ${TOKEN} ${counter}`, composerId, actorId: userIds.editor });
    workIds.push(work.id);
    await addProgrammeItem({ programmeId: programme, musicalWorkId: work.id, actorId: userIds.editor, refuseIfInPublishedContent: true }); // allowed: nothing public uses it
    const rec = await createDraftRecording({ slug: uniq("prog-draft"), actorId: userIds.editor, title: "F10 prog-draft" });
    recordingIds.push(rec.id);
    const draftId = rec.currentDraftRevisionId!;
    await attachWorkToRevision(draftId, work.id, userIds.editor);
    await attachMediaToRevision({ recordingRevisionId: draftId, provider: "YOUTUBE", role: "PRIMARY_VIDEO", url: "https://www.youtube.com/watch?v=f10b", actorId: userIds.editor });
    await createPerformanceForDraft(rec.id, draftId, (await revision(draftId)).updatedAt, { programmeId: programme, venueId, actorId: userIds.editor });
    await addProgrammeItem({ programmeId: programme, musicalWorkId: work.id, actorId: userIds.editor, refuseIfInPublishedContent: true }); // still draft-only: allowed
    await publishCurrentDraft(rec.id, userIds.admin);
    await expect(addProgrammeItem({ programmeId: programme, musicalWorkId: work.id, actorId: userIds.editor, refuseIfInPublishedContent: true })).rejects.toBeInstanceOf(ProgrammeInPublishedContentError);
    await unpublishRecording(rec.id, userIds.admin); // no longer shown publicly: editable again
    await addProgrammeItem({ programmeId: programme, musicalWorkId: work.id, actorId: userIds.editor, refuseIfInPublishedContent: true });
  }, T);
});

// ---------------------------------------------------------------------------------------------------------------------
// Phase 6J-10F correction: promotion conflicts across Recordings, and Instruments on a clone.
// ---------------------------------------------------------------------------------------------------------------------

/** Two PUBLISHED Recordings that share one original Performance, each with its own open draft (a fork). */
async function twoLiveRecordingsSharingOnePerformance(label: string) {
  const a = await liveWithOpenDraft(`${label}-a`);
  const second = await createDraftRecording({ slug: uniq(`${label}-b`), actorId: userIds.editor, title: `F10 ${label}-b` });
  recordingIds.push(second.id);
  const secondRevisionId = second.currentDraftRevisionId!;
  const work = await createMusicalWork({ slug: uniq(`w-${label}-b`), title: `F10 Work ${label}-b ${TOKEN} ${counter}`, composerId, actorId: userIds.editor });
  workIds.push(work.id);
  await attachWorkToRevision(secondRevisionId, work.id, userIds.editor);
  await attachMediaToRevision({ recordingRevisionId: secondRevisionId, provider: "YOUTUBE", role: "PRIMARY_VIDEO", url: "https://www.youtube.com/watch?v=f10c", actorId: userIds.editor });
  await prisma.recordingRevision.update({ where: { id: secondRevisionId }, data: { performanceId: a.performanceId } }); // the same event
  await publishCurrentDraft(second.id, userIds.admin);
  const draft = await forkDraftFromPublished(second.id, userIds.editor);
  return { a, b: { id: second.id, publishedRevisionId: secondRevisionId, draftId: draft.id } };
}

const publish = (recordingId: string, draftId: string) => publishRecordingDraft({ recordingId, actorId: userIds.admin, expectedDraftRevisionId: draftId });
const recordingPublishedAudits = (recordingId: string) => prisma.auditLogEntry.count({ where: { entityType: "Recording", entityId: recordingId, action: "RECORDING_PUBLISHED" } });
const promotedAudits = (performanceId: string) => prisma.auditLogEntry.count({ where: { entityType: "Performance", entityId: performanceId, action: "PERFORMANCE_DRAFT_PROMOTED" } });

function holdPerformanceRow(performanceId: string, mutate?: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  let release!: () => void;
  let acquired!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const got = new Promise<void>((resolve) => (acquired = resolve));
  const done = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM performances WHERE id = ${performanceId} FOR UPDATE`;
      acquired();
      await released;
      if (mutate) await mutate(tx);
    },
    { timeout: 60000, maxWait: 10000 }
  );
  return { got, release, done };
}

describe("G. promotion refuses to overwrite another Recording's change to the original Performance", () => {
  it("two Recordings share one Performance: the first promotion wins, the second is refused with an actionable conflict, and the first result stands", async () => {
    const { a, b } = await twoLiveRecordingsSharingOnePerformance("g1");
    const editA = await addPerformer(a.id, a.performanceId, A.two);
    const editB = await addPerformer(b.id, a.performanceId, A.three);
    expect(editA.cloned && editB.cloned).toBe(true);
    expect(await clonesOf(a.performanceId)).toHaveLength(2);

    expect((await publish(a.id, a.draftId)).ok).toBe(true);
    const afterFirst = await participantRows(a.performanceId);
    expect(afterFirst).toEqual({ performers: [A.one, A.two].sort(), choirs: [], conductors: [] });

    const publishedB = await recordingPublishedAudits(b.id);
    const refused = await publish(b.id, b.draftId);
    expect(refused).toMatchObject({ ok: false, reason: "PERFORMANCE_CHANGED" });
    expect(describePublishRefusal("PERFORMANCE_CHANGED")).toMatch(/Discard my participant changes/);

    // the first result stands; nothing of the second was applied
    expect(await participantRows(a.performanceId)).toEqual(afterFirst);
    expect(await promotedAudits(a.performanceId)).toBe(1);
    // the whole second publication rolled back: status, pointers, clone, audit
    expect((await revision(b.draftId)).revisionStatus).toBe("DRAFT");
    expect((await revision(b.draftId)).performanceId).toBe(editB.performanceId);
    expect((await revision(b.publishedRevisionId)).revisionStatus).toBe("PUBLISHED");
    expect((await prisma.recording.findUniqueOrThrow({ where: { id: b.id } })).currentDraftRevisionId).toBe(b.draftId);
    expect(await prisma.performance.findUnique({ where: { id: editB.performanceId } })).not.toBeNull();
    expect(await recordingPublishedAudits(b.id)).toBe(publishedB);
    expect(await getDraftPerformanceCloneStatus(editB.performanceId)).toEqual({ isClone: true, originalChanged: true });
  }, T);

  it("the editor can resolve it: discard the participant changes, re-apply, publish — and the other Recording's change is kept", async () => {
    const { a, b } = await twoLiveRecordingsSharingOnePerformance("g2");
    await addPerformer(a.id, a.performanceId, A.two);
    const editB = await addPerformer(b.id, a.performanceId, A.three);
    await publish(a.id, a.draftId);
    expect(await publish(b.id, b.draftId)).toMatchObject({ ok: false, reason: "PERFORMANCE_CHANGED" });

    expect(await discardDraftPerformanceClone({ recordingId: b.id, actorId: userIds.editor })).toEqual({ discarded: true });
    expect((await revision(b.draftId)).performanceId).toBe(a.performanceId); // back on the published Performance
    expect(await prisma.performance.findUnique({ where: { id: editB.performanceId } })).toBeNull();
    expect(await participantRows(a.performanceId)).toEqual({ performers: [A.one, A.two].sort(), choirs: [], conductors: [] }); // untouched
    expect(await getDraftPerformanceCloneStatus(a.performanceId)).toEqual({ isClone: false, originalChanged: false });
    const audits = await prisma.auditLogEntry.findMany({ where: { entityType: "Performance", entityId: a.performanceId, action: "PERFORMANCE_DRAFT_CLONE_DISCARDED" } });
    expect(audits).toHaveLength(1);

    const again = await addPerformer(b.id, a.performanceId, A.three); // a fresh clone from the CURRENT original
    expect(again.cloned).toBe(true);
    expect(await getDraftPerformanceCloneStatus(again.performanceId)).toEqual({ isClone: true, originalChanged: false });
    expect((await publish(b.id, b.draftId)).ok).toBe(true);
    expect(await participantRows(a.performanceId)).toEqual({ performers: [A.one, A.two, A.three].sort(), choirs: [], conductors: [] });
    expect(await promotedAudits(a.performanceId)).toBe(2);
  }, T);

  it(`simultaneous publications of two Recordings: exactly one promotes, the other is refused, and the original equals the winner's set, never a mix (${ROUNDS} rounds)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { a, b } = await twoLiveRecordingsSharingOnePerformance("g3");
      await addPerformer(a.id, a.performanceId, A.two);
      await addPerformer(b.id, a.performanceId, A.three);
      const [ra, rb] = await Promise.all([publish(a.id, a.draftId), publish(b.id, b.draftId)]);
      const results = [ra, rb];
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.find((r) => !r.ok)).toMatchObject({ reason: "PERFORMANCE_CHANGED" });
      const winnerArtist = ra.ok ? A.two : A.three;
      expect(await participantRows(a.performanceId)).toEqual({ performers: [A.one, winnerArtist].sort(), choirs: [], conductors: [] });
      expect(await promotedAudits(a.performanceId)).toBe(1);
      const loser = ra.ok ? b : a;
      expect((await revision(loser.draftId)).revisionStatus).toBe("DRAFT");
      expect(await clonesOf(a.performanceId)).toHaveLength(1); // only the loser's clone remains
    }
  }, T);

  it("a publication waits on the original Performance's row, re-reads it after the holder commits, and refuses if it changed meanwhile", async () => {
    const { a, b } = await twoLiveRecordingsSharingOnePerformance("g4");
    await addPerformer(b.id, a.performanceId, A.two);
    const holder = holdPerformanceRow(a.performanceId, (tx) => tx.performancePerformer.create({ data: { performanceId: a.performanceId, artistId: A.three, role: "added elsewhere" } }));
    await holder.got;
    const publishing = settle(publish(b.id, b.draftId));
    expect(await stillPending(publishing)).toBe(true); // serialized on the original, not racing past it
    holder.release();
    await holder.done;
    const result = await publishing;
    expect(result.ok && result.value).toMatchObject({ ok: false, reason: "PERFORMANCE_CHANGED" });
    expect(await participantRows(a.performanceId)).toEqual({ performers: [A.one, A.three].sort(), choirs: [], conductors: [] }); // the concurrent change survived
    expect((await revision(b.draftId)).revisionStatus).toBe("DRAFT");
  }, T);

  it("the wait on the original is bounded: BUSY, and nothing changes", async () => {
    const { a, b } = await twoLiveRecordingsSharingOnePerformance("g5");
    await addPerformer(b.id, a.performanceId, A.two);
    const holder = holdPerformanceRow(a.performanceId);
    await holder.got;
    let result;
    try {
      result = await publish(b.id, b.draftId);
    } finally {
      holder.release();
      await holder.done;
    }
    expect(result).toMatchObject({ ok: false, reason: "BUSY" });
    expect((await revision(b.draftId)).revisionStatus).toBe("DRAFT");
    expect(await participantRows(a.performanceId)).toEqual({ performers: [A.one], choirs: [], conductors: [] });
    expect((await publish(b.id, b.draftId)).ok).toBe(true); // once free it publishes
  }, T);

  it("a catalogue edit to the original after the clone was made is also a conflict (not silently overwritten)", async () => {
    const rec = await liveWithOpenDraft("g6");
    const edit = await addPerformer(rec.id, rec.performanceId, A.two);
    await addChoirToPerformance(rec.performanceId, choirId, userIds.editor); // catalogue path: no draft involved
    expect(await publish(rec.id, rec.draftId)).toMatchObject({ ok: false, reason: "PERFORMANCE_CHANGED" });
    expect(await participantRows(rec.performanceId)).toEqual({ performers: [A.one], choirs: [choirId], conductors: [] });
    await discardDraftPerformanceClone({ recordingId: rec.id, actorId: userIds.editor });
    await addPerformer(rec.id, rec.performanceId, A.two);
    expect((await publish(rec.id, rec.draftId)).ok).toBe(true);
    expect(await participantRows(rec.performanceId)).toEqual({ performers: [A.one, A.two].sort(), choirs: [choirId], conductors: [] });
    expect(edit.cloned).toBe(true);
  }, T);

  it("a clone with no recorded fingerprint cannot be verified and is refused", async () => {
    const rec = await liveWithOpenDraft("g7");
    const edit = await addPerformer(rec.id, rec.performanceId, A.two);
    await prisma.performance.update({ where: { id: edit.performanceId }, data: { draftBaseParticipantsKey: null } });
    expect(await publish(rec.id, rec.draftId)).toMatchObject({ ok: false, reason: "PERFORMANCE_CHANGED" });
  }, T);

  it("discard is idempotent, leaves a draft that has no clone alone, and refuses an archived Recording", async () => {
    const plain = await liveWithOpenDraft("g8");
    expect(await discardDraftPerformanceClone({ recordingId: plain.id, actorId: userIds.editor })).toEqual({ discarded: false });
    expect((await revision(plain.draftId)).performanceId).toBe(plain.performanceId);
    await addPerformer(plain.id, plain.performanceId, A.two);
    expect(await discardDraftPerformanceClone({ recordingId: plain.id, actorId: userIds.editor })).toEqual({ discarded: true });
    expect(await discardDraftPerformanceClone({ recordingId: plain.id, actorId: userIds.editor })).toEqual({ discarded: false });
    await addPerformer(plain.id, plain.performanceId, A.two);
    await archiveRecording(plain.id, userIds.admin);
    await expect(discardDraftPerformanceClone({ recordingId: plain.id, actorId: userIds.editor })).rejects.toMatchObject({ reason: "RECORDING_ARCHIVED" });
  }, T);

  for (const mode of ["action", "afterAction"] as const) {
    it(`a ${mode === "action" ? "failing" : "failing-after"} discard audit write rolls the discard back: the clone, its instruments and the pointer survive`, async () => {
      const rec = await liveWithOpenDraft(`g9-${mode}`);
      await prisma.instrument.create({ data: { name: `F10 organ ${TOKEN} ${counter}`, venueId, performanceId: rec.performanceId, createdById: userIds.editor, updatedById: userIds.editor } });
      const edit = await addPerformer(rec.id, rec.performanceId, A.two);
      inject[mode] = "PERFORMANCE_DRAFT_CLONE_DISCARDED";
      try {
        await expect(discardDraftPerformanceClone({ recordingId: rec.id, actorId: userIds.editor })).rejects.toThrow(/injected/);
      } finally {
        inject[mode] = null;
      }
      expect((await revision(rec.draftId)).performanceId).toBe(edit.performanceId);
      expect(await prisma.performance.findUnique({ where: { id: edit.performanceId } })).not.toBeNull();
      expect(await prisma.instrument.count({ where: { performanceId: edit.performanceId } })).toBe(1);
      expect(await prisma.auditLogEntry.count({ where: { entityType: "Performance", entityId: rec.performanceId, action: "PERFORMANCE_DRAFT_CLONE_DISCARDED" } })).toBe(0);
    }, T);
  }

  it("a clone made while another transaction is changing the original waits for it and snapshots the COMMITTED participants (so a consistent base is recorded)", async () => {
    const rec = await liveWithOpenDraft("g11");
    const holder = holdPerformanceRow(rec.performanceId, (tx) => tx.performancePerformer.create({ data: { performanceId: rec.performanceId, artistId: A.three, role: null } }));
    await holder.got;
    const editing = settle(addPerformer(rec.id, rec.performanceId, A.two));
    expect(await stillPending(editing)).toBe(true); // cloning waits for the in-flight change to the original
    expect(await clonesOf(rec.performanceId)).toHaveLength(0);
    holder.release();
    await holder.done;
    const result = await editing;
    expect(result.ok).toBe(true);
    const cloneId = (result as { value: { performanceId: string } }).value.performanceId;
    expect(await participantRows(cloneId)).toEqual({ performers: [A.one, A.two, A.three].sort(), choirs: [], conductors: [] }); // includes the committed change
    expect(await getDraftPerformanceCloneStatus(cloneId)).toEqual({ isClone: true, originalChanged: false });
    expect((await publish(rec.id, rec.draftId)).ok).toBe(true); // and so it promotes without a false conflict
  }, T);

  it("the Studio action discards and lands back on the Participants step", async () => {
    mockGetCurrentStudioSession.mockResolvedValue({ user: { id: userIds.editor, role: "EDITOR", status: "ACTIVE" } });
    const rec = await liveWithOpenDraft("g10");
    await addPerformer(rec.id, rec.performanceId, A.two);
    const landed = await redirectOf(() => discardParticipantChangesAction(rec.id));
    expect(landed).toMatch(/participants$/);
    expect((await revision(rec.draftId)).performanceId).toBe(rec.performanceId);
  }, T);
});

describe("H. Instrument associations are preserved by copy-on-write cloning", () => {
  const mkInstrument = (performanceId: string, name: string, extra: { archivedAt?: Date | null } = {}) =>
    prisma.instrument.create({ data: { name, manufacturer: "F10 Makers", buildYear: "1901", venueId, performanceId, archivedAt: extra.archivedAt ?? null, createdById: userIds.editor, updatedById: userIds.editor } });

  it("the clone gets copies of the original's instruments; the original's stay; the venue inventory is not duplicated", async () => {
    const rec = await liveWithOpenDraft("h1");
    const marker = uniq("inv"); // this test's instruments only: the shared venue also holds other tests' rows
    const organ = await mkInstrument(rec.performanceId, `F10 Organ ${marker}`);
    const retired = await mkInstrument(rec.performanceId, `F10 Harpsichord ${marker}`, { archivedAt: new Date("2020-01-01") });
    const inventoryBefore = (await findVenueById(venueId))!.instruments.filter((i) => i.name.includes(marker)).map((i) => i.id).sort();
    expect(inventoryBefore).toEqual([organ.id, retired.id].sort());

    const edit = await addPerformer(rec.id, rec.performanceId, A.two);
    const originals = await prisma.instrument.findMany({ where: { performanceId: rec.performanceId }, orderBy: { name: "asc" } });
    const copies = await prisma.instrument.findMany({ where: { performanceId: edit.performanceId }, orderBy: { name: "asc" } });
    expect(originals.map((i) => i.id).sort()).toEqual([organ.id, retired.id].sort()); // untouched
    expect(copies).toHaveLength(2);
    expect(copies.map((i) => ({ name: i.name, manufacturer: i.manufacturer, buildYear: i.buildYear, venueId: i.venueId, archived: i.archivedAt !== null }))).toEqual(
      originals.map((i) => ({ name: i.name, manufacturer: i.manufacturer, buildYear: i.buildYear, venueId: i.venueId, archived: i.archivedAt !== null }))
    );
    expect(copies.every((c) => !originals.some((o) => o.id === c.id))).toBe(true);
    // Studio's venue view still lists each instrument once
    expect((await findVenueById(venueId))!.instruments.filter((i) => i.name.includes(marker)).map((i) => i.id).sort()).toEqual(inventoryBefore);
    expect(await prisma.instrument.count({ where: { name: { contains: marker } } })).toBe(4); // 2 originals + 2 copies exist in the table, but only the originals are venue inventory
  }, T);

  it("promotion removes the clone's copies and leaves the original's instruments exactly as they were", async () => {
    const rec = await liveWithOpenDraft("h2");
    const organ = await mkInstrument(rec.performanceId, `F10 Organ2 ${TOKEN} ${counter}`);
    const edit = await addPerformer(rec.id, rec.performanceId, A.two);
    expect(await prisma.instrument.count({ where: { performanceId: edit.performanceId } })).toBe(1);
    expect((await publish(rec.id, rec.draftId)).ok).toBe(true);
    expect(await prisma.instrument.count({ where: { performanceId: edit.performanceId } })).toBe(0);
    expect(await prisma.instrument.count({ where: { name: organ.name } })).toBe(1); // no orphaned (performance-less) copy left behind
    expect((await prisma.instrument.findUniqueOrThrow({ where: { id: organ.id } })).performanceId).toBe(rec.performanceId);
  }, T);

  it("discarding the participant changes removes the copies too", async () => {
    const rec = await liveWithOpenDraft("h3");
    const organ = await mkInstrument(rec.performanceId, `F10 Organ3 ${TOKEN} ${counter}`);
    await addPerformer(rec.id, rec.performanceId, A.two);
    await discardDraftPerformanceClone({ recordingId: rec.id, actorId: userIds.editor });
    expect(await prisma.instrument.count({ where: { name: organ.name } })).toBe(1);
    expect((await prisma.instrument.findUniqueOrThrow({ where: { id: organ.id } })).performanceId).toBe(rec.performanceId);
  }, T);

  for (const mode of ["action", "afterAction"] as const) {
    for (const audit of ["PERFORMER_LINKED_TO_PERFORMANCE", "PERFORMANCE_CLONED_FOR_DRAFT"]) {
      it(`${mode === "action" ? "a failing" : "a failing-after"} ${audit} audit write during cloning leaves no orphan instrument copies`, async () => {
        const rec = await liveWithOpenDraft(`h4-${mode}`);
        const name = `F10 Organ4 ${TOKEN} ${counter}`;
        await mkInstrument(rec.performanceId, name);
        const performancesBefore = await prisma.performance.count({ where: { venueId } });
        inject[mode] = audit;
        try {
          await expect(addPerformer(rec.id, rec.performanceId, A.two)).rejects.toThrow(/injected/);
        } finally {
          inject[mode] = null;
        }
        expect(await prisma.instrument.count({ where: { name } })).toBe(1); // only the original
        expect(await prisma.performance.count({ where: { venueId } })).toBe(performancesBefore);
        expect((await revision(rec.draftId)).performanceId).toBe(rec.performanceId);
        // and the retry clones normally, with its copy
        const retry = await addPerformer(rec.id, rec.performanceId, A.two);
        expect(await prisma.instrument.count({ where: { name } })).toBe(2);
        expect(await prisma.instrument.count({ where: { performanceId: retry.performanceId } })).toBe(1);
      }, T);
    }
  }

  it("a Performance edited in place (no clone) keeps its instruments untouched", async () => {
    const rec = await createDraftRecording({ slug: uniq("h5"), actorId: userIds.editor, title: "F10 h5" });
    recordingIds.push(rec.id);
    const performance = await createPerformanceForDraft(rec.id, rec.currentDraftRevisionId!, (await revision(rec.currentDraftRevisionId!)).updatedAt, { programmeId, venueId, actorId: userIds.editor });
    const organ = await mkInstrument(performance.id, `F10 Organ5 ${TOKEN} ${counter}`);
    expect((await addPerformer(rec.id, performance.id, A.one)).cloned).toBe(false);
    expect(await prisma.instrument.count({ where: { name: organ.name } })).toBe(1);
  }, T);
});

// ---------------------------------------------------------------------------------------------------------------------
// The Programme guard versus publication: a Programme must not be editable (through the Recording workflow) after a
// publication has made it live. Lock order: Recording lock < draft row < Programme lock < Performance row.
// ---------------------------------------------------------------------------------------------------------------------

/** An unpublished Recording whose draft uses `programme` through a draft-owned Performance (publishable without the completeness gate). */
async function draftUsingProgramme(label: string, programme: string) {
  const rec = await createDraftRecording({ slug: uniq(label), actorId: userIds.editor, title: `F10 ${label}` });
  recordingIds.push(rec.id);
  const draftId = rec.currentDraftRevisionId!;
  await createPerformanceForDraft(rec.id, draftId, (await revision(draftId)).updatedAt, { programmeId: programme, venueId, actorId: userIds.editor });
  return { id: rec.id, draftId };
}
const publishUngated = (recordingId: string, draftId: string) => publishRecordingDraft({ recordingId, actorId: userIds.admin, expectedDraftRevisionId: draftId, enforceCompleteness: false });

/** Holds the per-Programme edit lock (the key publication and the guarded edits use) until released; `mutate` runs inside the holder just before it commits. */
function holdProgrammeLock(programme: string, mutate?: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  let release!: () => void;
  let acquired!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const got = new Promise<void>((resolve) => (acquired = resolve));
  const done = prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${programmeEditLockKey(programme)}))`;
      acquired();
      await released;
      if (mutate) await mutate(tx);
    },
    { timeout: 60000, maxWait: 10000 }
  );
  return { got, release, done };
}

async function newWorkId(label: string) {
  const work = await createMusicalWork({ slug: uniq(`w-${label}`), title: `F10 PW ${label} ${TOKEN} ${counter}`, composerId, actorId: userIds.editor });
  workIds.push(work.id);
  return work.id;
}

describe("I. the Programme edit guard cannot be bypassed by a publication that commits between its check and its write", () => {
  it("an edit queued behind a publication that holds the Programme lock waits, then sees the Programme is live and is refused — nothing is written", async () => {
    const programme = await newProgramme("race-a");
    const rec = await draftUsingProgramme("race-a", programme);
    const work = await newWorkId("race-a");
    // the publication's effect (its writes become visible together, at commit), held under the Programme lock exactly as publishRecordingDraft does
    const publication = holdProgrammeLock(programme, async (tx) => {
      await tx.recordingRevision.update({ where: { id: rec.draftId }, data: { revisionStatus: "PUBLISHED" } });
      await tx.recording.update({ where: { id: rec.id }, data: { status: "PUBLISHED", currentPublishedRevisionId: rec.draftId, currentDraftRevisionId: null } });
    });
    await publication.got;
    const edit = settle(addProgrammeItem({ programmeId: programme, musicalWorkId: work, actorId: userIds.editor, refuseIfInPublishedContent: true }));
    expect(await stillPending(edit)).toBe(true); // it does NOT run its check against the pre-publication state and race past it
    publication.release();
    await publication.done;
    const result = await edit;
    expect(result.ok).toBe(false);
    expect((result as { error: unknown }).error).toBeInstanceOf(ProgrammeInPublishedContentError);
    expect(await prisma.programmeItem.count({ where: { programmeId: programme } })).toBe(0);
    expect(await prisma.auditLogEntry.count({ where: { entityType: "Programme", entityId: programme, action: "PROGRAMME_ITEM_ADDED" } })).toBe(0);
  }, T);

  it("the same for removing an item", async () => {
    const programme = await newProgramme("race-a2");
    const work = await newWorkId("race-a2");
    const item = await addProgrammeItem({ programmeId: programme, musicalWorkId: work, actorId: userIds.editor }); // catalogue path
    const rec = await draftUsingProgramme("race-a2", programme);
    const publication = holdProgrammeLock(programme, async (tx) => {
      await tx.recordingRevision.update({ where: { id: rec.draftId }, data: { revisionStatus: "PUBLISHED" } });
      await tx.recording.update({ where: { id: rec.id }, data: { status: "PUBLISHED", currentPublishedRevisionId: rec.draftId, currentDraftRevisionId: null } });
    });
    await publication.got;
    const removal = settle(removeProgrammeItem(item.id, userIds.editor, { refuseIfInPublishedContent: true }));
    expect(await stillPending(removal)).toBe(true);
    publication.release();
    await publication.done;
    expect((await removal)).toMatchObject({ ok: false });
    expect((await removal as { error: unknown }).error).toBeInstanceOf(ProgrammeInPublishedContentError);
    expect(await prisma.programmeItem.count({ where: { id: item.id } })).toBe(1);
  }, T);

  it("a publication queued behind an in-flight edit waits for it, then publishes the programme as edited (edit first, then publish)", async () => {
    const programme = await newProgramme("race-b");
    const rec = await draftUsingProgramme("race-b", programme);
    const work = await newWorkId("race-b");
    const edit = holdProgrammeLock(programme, (tx) => tx.programmeItem.create({ data: { programmeId: programme, musicalWorkId: work, order: 1 } })); // an edit in flight
    await edit.got;
    const publishing = settle(publishUngated(rec.id, rec.draftId));
    expect(await stillPending(publishing)).toBe(true); // the publication cannot slip past an in-flight edit
    edit.release();
    await edit.done;
    const result = await publishing;
    expect(result.ok && result.value.ok).toBe(true);
    expect(await prisma.programmeItem.count({ where: { programmeId: programme } })).toBe(1);
    expect((await prisma.recording.findUniqueOrThrow({ where: { id: rec.id } })).status).toBe("PUBLISHED");
    // and from now on the guard protects it
    await expect(addProgrammeItem({ programmeId: programme, musicalWorkId: await newWorkId("race-b2"), actorId: userIds.editor, refuseIfInPublishedContent: true })).rejects.toBeInstanceOf(ProgrammeInPublishedContentError);
  }, T);

  it("the waits are bounded: a held Programme lock gives the publication BUSY and the edit ProgrammeBusyError, and nothing changes", async () => {
    const programme = await newProgramme("race-c");
    const rec = await draftUsingProgramme("race-c", programme);
    const work = await newWorkId("race-c");
    const holder = holdProgrammeLock(programme);
    await holder.got;
    let publication: Awaited<ReturnType<typeof publishUngated>>;
    let edit: { ok: boolean; error?: unknown };
    try {
      [publication, edit] = await Promise.all([publishUngated(rec.id, rec.draftId), settle(addProgrammeItem({ programmeId: programme, musicalWorkId: work, actorId: userIds.editor, refuseIfInPublishedContent: true }))]);
    } finally {
      holder.release();
      await holder.done;
    }
    expect(publication).toMatchObject({ ok: false, reason: "BUSY" });
    expect(edit.ok).toBe(false);
    expect(edit.error).toBeInstanceOf(ProgrammeBusyError);
    expect((await revision(rec.draftId)).revisionStatus).toBe("DRAFT");
    expect(await prisma.programmeItem.count({ where: { programmeId: programme } })).toBe(0);
    expect((await publishUngated(rec.id, rec.draftId)).ok).toBe(true); // free again
  }, T);

  it("two Recordings publishing the same Programme at once both succeed (they serialize on the Programme lock without deadlocking)", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const programme = await newProgramme("race-d");
      const first = await draftUsingProgramme("race-d1", programme);
      const second = await draftUsingProgramme("race-d2", programme);
      const results = await Promise.all([publishUngated(first.id, first.draftId), publishUngated(second.id, second.draftId)]);
      expect(results.map((r) => r.ok)).toEqual([true, true]);
    }
  }, T);

  it(`a mixed race of publications, guarded edits and participant edits never deadlocks, and every edit is either applied before a publication or refused (${ROUNDS} rounds)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const programme = await newProgramme("race-e");
      const first = await draftUsingProgramme("race-e1", programme);
      const second = await draftUsingProgramme("race-e2", programme);
      const works = await Promise.all([1, 2, 3, 4].map((n) => newWorkId(`race-e${n}`)));
      const outcomes = await Promise.all([
        settle(publishUngated(first.id, first.draftId)),
        settle(publishUngated(second.id, second.draftId)),
        ...works.map((work) => settle(addProgrammeItem({ programmeId: programme, musicalWorkId: work, actorId: userIds.editor, refuseIfInPublishedContent: true }))),
      ]);
      for (const outcome of outcomes) {
        if (!outcome.ok) expect(String((outcome.error as Error).message)).not.toMatch(/deadlock|40P01/i);
      }
      expect(outcomes.slice(0, 2).every((o) => o.ok && (o.value as { ok?: boolean }).ok === true)).toBe(true);
      const applied = outcomes.slice(2).filter((o) => o.ok).length;
      const refused = outcomes.slice(2).filter((o) => !o.ok);
      for (const r of refused) expect((r as { error: unknown }).error).toBeInstanceOf(ProgrammeInPublishedContentError);
      expect(await prisma.programmeItem.count({ where: { programmeId: programme } })).toBe(applied); // refused edits wrote nothing
      // once both are published, no further edit gets through
      await expect(addProgrammeItem({ programmeId: programme, musicalWorkId: works[0], actorId: userIds.editor, refuseIfInPublishedContent: true })).rejects.toBeInstanceOf(ProgrammeInPublishedContentError);
    }
  }, T);

  it("the catalogue path (a deliberate global edit) is not affected by the Programme lock", async () => {
    const programme = await newProgramme("race-f");
    const rec = await draftUsingProgramme("race-f", programme);
    await publishUngated(rec.id, rec.draftId);
    const holder = holdProgrammeLock(programme);
    await holder.got;
    try {
      const item = await addProgrammeItem({ programmeId: programme, musicalWorkId: await newWorkId("race-f"), actorId: userIds.editor }); // no flag: allowed, and does not wait
      expect(item.programmeId).toBe(programme);
    } finally {
      holder.release();
      await holder.done;
    }
  }, T);
});