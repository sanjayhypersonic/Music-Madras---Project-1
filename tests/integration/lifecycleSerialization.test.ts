import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

// Must be at the true top level — vi.mock is hoisted above every import.
const mockGetCurrentStudioSession = vi.fn();
vi.mock("../../modules/auth/authService", () => ({
  getCurrentStudioSession: () => mockGetCurrentStudioSession(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// Fault injection. `inject.action`: writing THAT audit entry fails, after the operation's other writes already ran
// inside its transaction. `inject.afterAction`: the audit entry IS written, and the operation then fails — so the
// audit row survives only if it was written outside the operation's transaction (the atomicity this must prevent).
// Everything else passes through.
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
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import { attachMediaToRevision } from "../../modules/db/repositories/mediaResourceRepository";
import { createProgramme } from "../../modules/db/repositories/programmeRepository";
import { createVenue } from "../../modules/db/repositories/venueRepository";
import {
  ConcurrentEditError,
  RecordingBusyError,
  RevisionNotEditableError,
  archiveRecording,
  attachWorkToRevision,
  createDraftRecording,
  createPerformanceForDraft,
  forkDraftFromPublished,
  publishCurrentDraft,
  restoreRecording,
  submitRecordingForReview,
  unpublishRecording,
  updateDraftRevisionContent,
} from "../../modules/db/repositories/recordingRepository";
import { saveSourceStep } from "../../app/(studio)/studio/(protected)/recordings/[id]/source/actions";
import { startNewDraftAction } from "../../app/(studio)/studio/(protected)/recordings/[id]/draftActions";

// Phase 6J-10D — lifecycle transaction and archived-fork hardening.
//
// Protocol under test (docs/recording-publication-safety.md): every operation that changes a Recording's
// lifecycle or its draft takes the per-Recording edit lock FIRST (bounded wait), then touches rows. Content saves,
// child writes, publish, submit, archive, restore, unpublish and fork all follow it, so none of them can interleave
// with another one on the same Recording; the conditional writes and the CAS in the UPDATE remain as the database-level
// backstop. Tests hold the edit lock or the draft row lock from OUTSIDE (explicit barriers, no sleeps as
// synchronisation) and exercise the real repository functions. `stillPending` only asserts that something IS blocked.

const T = 120000;
const TOKEN = randomUUID().slice(0, 8);
const ROUNDS = 8;

const userIds = {} as { admin: string; editor: string };
const recordingIds: string[] = [];
const workIds: string[] = [];
const programmeIds: string[] = [];
const venueIds: string[] = [];
let composerId: string;
let counter = 0;

const uniq = (label: string) => `d10-${label}-${TOKEN}-${++counter}-${randomUUID().slice(0, 4)}`;

async function newRecording(label: string) {
  const recording = await createDraftRecording({ slug: uniq(label), actorId: userIds.editor, title: `D10 ${label}` });
  recordingIds.push(recording.id);
  const draftId = recording.currentDraftRevisionId!;
  const work = await createMusicalWork({ slug: uniq(`w-${label}`), title: `D10 Work ${label} ${TOKEN} ${counter}`, composerId, actorId: userIds.editor });
  workIds.push(work.id);
  await attachWorkToRevision(draftId, work.id, userIds.editor);
  await attachMediaToRevision({ recordingRevisionId: draftId, provider: "YOUTUBE", role: "PRIMARY_VIDEO", url: "https://www.youtube.com/watch?v=d10", actorId: userIds.editor });
  return { id: recording.id, draftId };
}

async function liveOnly(label: string) {
  const rec = await newRecording(label);
  await publishCurrentDraft(rec.id, userIds.admin);
  return { id: rec.id, publishedId: rec.draftId };
}

async function archivedLive(label: string) {
  const rec = await liveOnly(label);
  await archiveRecording(rec.id, userIds.admin);
  return rec;
}

async function revisionRow(id: string) {
  return prisma.recordingRevision.findUniqueOrThrow({ where: { id } });
}

async function recState(id: string) {
  const [recording, revisions, audits] = await Promise.all([
    prisma.recording.findUniqueOrThrow({ where: { id } }),
    prisma.recordingRevision.findMany({ where: { recordingId: id }, orderBy: { revisionNumber: "asc" } }),
    prisma.auditLogEntry.findMany({ where: { entityType: "Recording", entityId: id } }),
  ]);
  return {
    status: recording.status,
    draftId: recording.currentDraftRevisionId,
    publishedId: recording.currentPublishedRevisionId,
    revisionCount: revisions.length,
    openDrafts: revisions.filter((r) => r.revisionStatus === "DRAFT").length,
    auditCount: (action: string) => audits.filter((a) => a.action === action).length,
    totalAudits: audits.length,
    revisions,
  };
}

/** The pointer/status invariants that must hold after ANY interleaving. */
async function expectCoherent(id: string) {
  const s = await recState(id);
  if (s.draftId) {
    const draft = s.revisions.find((r) => r.id === s.draftId);
    expect(draft, "current draft belongs to the Recording").toBeDefined();
    expect(draft!.revisionStatus).toBe("DRAFT");
  }
  expect(s.openDrafts).toBe(s.draftId ? 1 : 0); // never a second open draft, never an orphan DRAFT
  if (s.publishedId) expect(s.revisions.find((r) => r.id === s.publishedId)?.revisionStatus).toBe("PUBLISHED");
  return s;
}

/**
 * Holds the per-Recording edit lock from outside. `mutate` (optional) runs inside the holding transaction when it
 * is released, just before it commits: it models a lifecycle change that is committed at the moment the queued
 * operations are woken.
 */
function holdEditLock(recordingId: string, mutate?: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  let release!: () => void;
  let acquired!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const got = new Promise<void>((resolve) => (acquired = resolve));
  const done = prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`recording-edit:${recordingId}`}))`;
      acquired();
      await released;
      if (mutate) await mutate(tx);
    },
    { timeout: 60000, maxWait: 10000 }
  );
  return { got, release, done };
}

/** Holds the draft revision ROW lock from outside until released. */
function holdRevisionRow(revisionId: string) {
  let release!: () => void;
  let acquired!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const got = new Promise<void>((resolve) => (acquired = resolve));
  const done = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM recording_revisions WHERE id = ${revisionId} FOR UPDATE`;
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
const settle = <T,>(promise: Promise<T>) => promise.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));

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

/** updateDraftRevisionContent inside a caller-owned transaction with a hook between its first read and its write. */
async function forkWithWindow(recordingId: string, hook: () => Promise<void>) {
  return prisma.$transaction(
    async (tx) => {
      const proxied = new Proxy(tx, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver);
          if (prop !== "recording") return value;
          return new Proxy(value as object, {
            get(t, p, r) {
              const v = Reflect.get(t, p, r);
              if (p !== "findUnique") return v;
              return async (...args: unknown[]) => {
                const out = await (v as (...a: unknown[]) => Promise<unknown>).apply(t, args);
                await hook();
                return out;
              };
            },
          });
        },
      }) as Prisma.TransactionClient;
      return forkDraftFromPublished(recordingId, userIds.editor, proxied);
    },
    { timeout: 30000, maxWait: 10000 }
  );
}

beforeAll(async () => {
  for (const [key, role] of [["admin", "ADMINISTRATOR"], ["editor", "EDITOR"]] as const) {
    userIds[key] = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `d10-${key}-${TOKEN}@musicmadras.test`, name: `D10 ${key}`, role, status: "ACTIVE" } })).id;
  }
  composerId = (await createComposer({ slug: `d10-composer-${TOKEN}`, name: `D10 Composer ${TOKEN}`, actorId: userIds.editor })).id;
}, T);

afterAll(async () => {
  const revisionIds = (await prisma.recordingRevision.findMany({ where: { recordingId: { in: recordingIds } }, select: { id: true } })).map((r) => r.id);
  const mediaIds = (await prisma.mediaResource.findMany({ where: { recordingRevisionId: { in: revisionIds } }, select: { id: true } })).map((m) => m.id);
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityId: { in: [...recordingIds, ...revisionIds, ...mediaIds] } }, { actorId: { in: Object.values(userIds) } }] } });
  await prisma.mediaResource.deleteMany({ where: { recordingRevisionId: { in: revisionIds } } });
  await prisma.recording.deleteMany({ where: { id: { in: recordingIds } } });
  await prisma.performance.deleteMany({ where: { programmeId: { in: programmeIds } } });
  await prisma.programme.deleteMany({ where: { id: { in: programmeIds } } });
  await prisma.venue.deleteMany({ where: { id: { in: venueIds } } });
  await prisma.musicalWork.deleteMany({ where: { id: { in: workIds } } });
  await prisma.composer.deleteMany({ where: { id: composerId } });
  await prisma.studioUser.deleteMany({ where: { id: { in: Object.values(userIds) } } });
}, T);

describe("A. forking an archived Recording", () => {
  it("is refused with a typed error, and creates no revision, no draft pointer and no audit entry", async () => {
    const rec = await archivedLive("fork-archived");
    const before = await recState(rec.id);
    const err = await forkDraftFromPublished(rec.id, userIds.editor).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(RevisionNotEditableError);
    expect((err as RevisionNotEditableError).reason).toBe("RECORDING_ARCHIVED");
    const after = await recState(rec.id);
    expect(after).toMatchObject({ status: "ARCHIVED", draftId: null, revisionCount: before.revisionCount, totalAudits: before.totalAudits });
    expect(after.auditCount("RECORDING_DRAFT_FORKED_FROM_PUBLISHED")).toBe(0);
  }, T);

  it("is refused inside a caller-owned transaction too (the apply path), and that transaction leaves nothing behind", async () => {
    const rec = await archivedLive("fork-archived-tx");
    const before = await recState(rec.id);
    const err = await prisma.$transaction((tx) => forkDraftFromPublished(rec.id, userIds.editor, tx)).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(RevisionNotEditableError);
    const after = await recState(rec.id);
    expect({ status: after.status, draftId: after.draftId, revisionCount: after.revisionCount, totalAudits: after.totalAudits }).toEqual({ status: "ARCHIVED", draftId: null, revisionCount: before.revisionCount, totalAudits: before.totalAudits });
  }, T);

  it("does not rely on an earlier check: the Recording is archived between the fork's read and its writes — the fork rolls back completely", async () => {
    const rec = await liveOnly("fork-window");
    const before = await recState(rec.id);
    // another connection archives WITHOUT the lock (a writer that does not follow the protocol): only the
    // conditional pointer write can still refuse the fork, and the transaction must undo the new revision + copies.
    await expect(
      forkWithWindow(rec.id, async () => {
        await prisma.recording.update({ where: { id: rec.id }, data: { status: "ARCHIVED" } });
      })
    ).rejects.toThrow(/changed while a new draft was being started/);
    const after = await recState(rec.id);
    expect({ status: after.status, draftId: after.draftId, revisionCount: after.revisionCount, totalAudits: after.totalAudits }).toEqual({ status: "ARCHIVED", draftId: null, revisionCount: before.revisionCount, totalAudits: before.totalAudits });
    expect(await prisma.mediaResource.count({ where: { recordingRevision: { recordingId: rec.id } } })).toBe(1); // no copied media survived
  }, T);

  it("a fork queued behind an in-flight archive sees the archive and is refused", async () => {
    const rec = await liveOnly("fork-after-archive");
    const before = await recState(rec.id);
    const holder = holdEditLock(rec.id, (tx) => tx.recording.update({ where: { id: rec.id }, data: { status: "ARCHIVED" } }));
    await holder.got;
    const fork = settle(forkDraftFromPublished(rec.id, userIds.editor));
    expect(await stillPending(fork)).toBe(true); // it waits for the lock instead of reading stale state
    holder.release();
    await holder.done;
    const result = await fork;
    expect(result.ok).toBe(false);
    expect((result as { error: unknown }).error).toBeInstanceOf(RevisionNotEditableError);
    expect(await recState(rec.id)).toMatchObject({ status: "ARCHIVED", draftId: null, revisionCount: before.revisionCount });
  }, T);

  it("the wait for the edit lock is bounded: RecordingBusyError and nothing created", async () => {
    const rec = await liveOnly("fork-busy");
    const before = await recState(rec.id);
    const holder = holdEditLock(rec.id);
    await holder.got;
    try {
      await expect(forkDraftFromPublished(rec.id, userIds.editor)).rejects.toBeInstanceOf(RecordingBusyError);
    } finally {
      holder.release();
      await holder.done;
    }
    expect(await recState(rec.id)).toMatchObject({ status: "PUBLISHED", draftId: null, revisionCount: before.revisionCount, totalAudits: before.totalAudits });
  }, T);

  it("restore then fork works and yields exactly one coherent open draft (IN_REVIEW)", async () => {
    const rec = await archivedLive("restore-then-fork");
    await restoreRecording(rec.id, userIds.admin);
    const draft = await forkDraftFromPublished(rec.id, userIds.editor);
    const s = await expectCoherent(rec.id);
    expect(s).toMatchObject({ status: "IN_REVIEW", draftId: draft.id });
  }, T);

  it(`simultaneous forks: exactly one wins; the rest are refused with a plain message, never a raw database error (${ROUNDS} rounds x 4)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const rec = await liveOnly("fork-fork");
      const before = await recState(rec.id);
      const results = await Promise.all([1, 2, 3, 4].map(() => settle(forkDraftFromPublished(rec.id, userIds.editor))));
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      for (const loser of results.filter((r) => !r.ok)) {
        const message = String((loser as { error: Error }).error.message);
        expect(message).toMatch(/already has an open draft/i);
        expect(message).not.toMatch(/prisma|unique constraint|invocation/i);
      }
      const s = await expectCoherent(rec.id);
      expect(s.revisionCount).toBe(before.revisionCount + 1);
      expect(s.auditCount("RECORDING_DRAFT_FORKED_FROM_PUBLISHED")).toBe(1);
      expect(s.status).toBe("PUBLISHED");
    }
  }, T);

  it(`restore racing fork on an archived Recording: only valid outcomes, never a draft on an archived Recording (${ROUNDS} rounds)`, async () => {
    let forkWon = 0;
    for (let round = 0; round < ROUNDS; round++) {
      const rec = await archivedLive("restore-fork-race");
      const [restore, fork] = await Promise.all([settle(restoreRecording(rec.id, userIds.admin)), settle(forkDraftFromPublished(rec.id, userIds.editor))]);
      expect(restore.ok).toBe(true);
      const s = await expectCoherent(rec.id);
      if (fork.ok) {
        forkWon++;
        expect(s).toMatchObject({ status: "IN_REVIEW", revisionCount: 2 });
        expect(s.draftId).toBe((fork as { value: { id: string } }).value.id);
      } else {
        expect((fork as { error: unknown }).error).toBeInstanceOf(RevisionNotEditableError); // the fork ran while archived
        expect(s).toMatchObject({ status: "DRAFT", draftId: null, revisionCount: 1 });
        expect(s.auditCount("RECORDING_DRAFT_FORKED_FROM_PUBLISHED")).toBe(0);
      }
      expect(s.auditCount("RECORDING_RESTORED")).toBe(1);
    }
    expect(forkWon).toBeGreaterThanOrEqual(0);
  }, T);

  it(`archive racing fork on a live Recording: the archive always wins in the end, and no archived Recording ends with an unsaved-able orphan (${ROUNDS} rounds)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const rec = await liveOnly("archive-fork-race");
      const [archive, fork] = await Promise.all([settle(archiveRecording(rec.id, userIds.admin)), settle(forkDraftFromPublished(rec.id, userIds.editor))]);
      expect(archive.ok).toBe(true);
      const s = await expectCoherent(rec.id);
      expect(s.status).toBe("ARCHIVED");
      expect(s.auditCount("RECORDING_ARCHIVED")).toBe(1);
      if (fork.ok) expect(s.revisionCount).toBe(2); // fork first, then archive: a draft exists but the Recording is archived
      else {
        expect((fork as { error: unknown }).error).toBeInstanceOf(RevisionNotEditableError);
        expect(s).toMatchObject({ revisionCount: 1, draftId: null });
      }
      // whichever way it fell, an archived Recording accepts no further save
      if (s.draftId) {
        const token = (await revisionRow(s.draftId)).updatedAt;
        await expect(updateDraftRevisionContent(rec.id, token, userIds.editor, { title: "after archive" })).rejects.toBeInstanceOf(RevisionNotEditableError);
      }
    }
  }, T);
});

describe("B. content saves versus archive", () => {
  it("a save queued behind a competing transaction cannot save after the Recording is archived: the save commits first, archive follows", async () => {
    const rec = await newRecording("save-queued");
    const token = (await revisionRow(rec.draftId)).updatedAt;
    const holder = holdRevisionRow(rec.draftId);
    await holder.got;

    const save = settle(updateDraftRevisionContent(rec.id, token, userIds.editor, { title: "SAVED BEFORE ARCHIVE" }));
    expect(await stillPending(save)).toBe(true); // it holds the edit lock and waits on the row
    const archive = settle(archiveRecording(rec.id, userIds.admin));
    expect(await stillPending(archive)).toBe(true); // archive cannot interleave: the edit lock is held by the save
    expect((await revisionRow(rec.draftId)).title).not.toBe("SAVED BEFORE ARCHIVE");

    holder.release();
    await holder.done;
    const [s, a] = await Promise.all([save, archive]);
    expect(s.ok).toBe(true);
    expect(a.ok).toBe(true);
    const row = await revisionRow(rec.draftId);
    expect(row.title).toBe("SAVED BEFORE ARCHIVE");
    expect((await recState(rec.id)).status).toBe("ARCHIVED");
    // and nothing can save afterwards
    await expect(updateDraftRevisionContent(rec.id, row.updatedAt, userIds.editor, { title: "AFTER ARCHIVE" })).rejects.toBeInstanceOf(RevisionNotEditableError);
    expect((await revisionRow(rec.draftId)).title).toBe("SAVED BEFORE ARCHIVE");
  }, T);

  it("a save queued behind an in-flight archive is refused with a typed error and changes nothing", async () => {
    const rec = await newRecording("save-after-archive");
    const before = await revisionRow(rec.draftId);
    const holder = holdEditLock(rec.id, (tx) => tx.recording.update({ where: { id: rec.id }, data: { status: "ARCHIVED" } }));
    await holder.got;
    const save = settle(updateDraftRevisionContent(rec.id, before.updatedAt, userIds.editor, { title: "SAVE AFTER ARCHIVE" }));
    expect(await stillPending(save)).toBe(true);
    holder.release();
    await holder.done;
    const result = await save;
    expect(result.ok).toBe(false);
    expect((result as { error: unknown }).error).toBeInstanceOf(RevisionNotEditableError);
    expect((result as { error: RevisionNotEditableError }).error.reason).toBe("RECORDING_ARCHIVED");
    const after = await revisionRow(rec.draftId);
    expect(after.title).toBe(before.title);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  }, T);

  it(`a save racing an archive has only valid outcomes; no save commits after the archive (${ROUNDS} rounds)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const rec = await newRecording("save-archive-race");
      const before = await revisionRow(rec.draftId);
      const [save, archive] = await Promise.all([
        settle(updateDraftRevisionContent(rec.id, before.updatedAt, userIds.editor, { title: `RACE ${round}` })),
        settle(archiveRecording(rec.id, userIds.admin)),
      ]);
      expect(archive.ok).toBe(true);
      const after = await revisionRow(rec.draftId);
      if (save.ok) {
        // the save committed BEFORE the archive: its content and token are the final ones
        expect(after.title).toBe(`RACE ${round}`);
        expect(after.updatedAt.getTime()).toBe((save as { value: { updatedAt: Date } }).value.updatedAt.getTime());
      } else {
        expect((save as { error: unknown }).error).toBeInstanceOf(RevisionNotEditableError);
        expect(after.title).toBe(before.title);
        expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
      }
      // the settled state accepts no save with ANY token
      await expect(updateDraftRevisionContent(rec.id, after.updatedAt, userIds.editor, { title: "LATE" })).rejects.toBeInstanceOf(RevisionNotEditableError);
      expect((await revisionRow(rec.draftId)).updatedAt.getTime()).toBe(after.updatedAt.getTime());
      expect((await recState(rec.id)).status).toBe("ARCHIVED");
    }
  }, T);

  it("the wait for the edit lock is bounded: RecordingBusyError and nothing written", async () => {
    const rec = await newRecording("save-busy");
    const before = await revisionRow(rec.draftId);
    const holder = holdEditLock(rec.id);
    await holder.got;
    try {
      await expect(updateDraftRevisionContent(rec.id, before.updatedAt, userIds.editor, { title: "BUSY" })).rejects.toBeInstanceOf(RecordingBusyError);
    } finally {
      holder.release();
      await holder.done;
    }
    const after = await revisionRow(rec.draftId);
    expect(after.title).toBe(before.title);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  }, T);

  it("createPerformanceForDraft follows the same protocol: it waits for the edit lock, and refuses once the Recording is archived", async () => {
    const rec = await newRecording("perf-lock");
    const programme = await createProgramme({ slug: uniq("prog"), title: `D10 Programme ${TOKEN} ${counter}`, actorId: userIds.editor });
    programmeIds.push(programme.id);
    const venue = await createVenue({ slug: uniq("venue"), name: `D10 Venue ${TOKEN} ${randomUUID().slice(0, 4)}`, type: "CHURCH", actorId: userIds.editor });
    venueIds.push(venue.id);
    const before = await revisionRow(rec.draftId);

    const holder = holdEditLock(rec.id, (tx) => tx.recording.update({ where: { id: rec.id }, data: { status: "ARCHIVED" } }));
    await holder.got;
    const create = settle(createPerformanceForDraft(rec.id, rec.draftId, before.updatedAt, { programmeId: programme.id, venueId: venue.id, actorId: userIds.editor }));
    expect(await stillPending(create)).toBe(true);
    holder.release();
    await holder.done;
    const result = await create;
    expect(result.ok).toBe(false);
    expect((result as { error: unknown }).error).toBeInstanceOf(RevisionNotEditableError);
    expect(await prisma.performance.count({ where: { programmeId: programme.id } })).toBe(0); // no orphan row
    expect((await revisionRow(rec.draftId)).performanceId).toBeNull();
  }, T);

  it("after restore the draft is editable again with a valid token (the archive did not damage the pointers)", async () => {
    const rec = await newRecording("save-after-restore");
    const token = (await revisionRow(rec.draftId)).updatedAt;
    await archiveRecording(rec.id, userIds.admin);
    await expect(updateDraftRevisionContent(rec.id, token, userIds.editor, { title: "while archived" })).rejects.toBeInstanceOf(RevisionNotEditableError);
    await restoreRecording(rec.id, userIds.admin);
    const saved = await updateDraftRevisionContent(rec.id, token, userIds.editor, { title: "after restore" });
    expect(saved.title).toBe("after restore");
    await expectCoherent(rec.id);
  }, T);

  it("a stale token is still a ConcurrentEditError (the CAS semantics are unchanged by the lock)", async () => {
    const rec = await newRecording("save-stale");
    const token = (await revisionRow(rec.draftId)).updatedAt;
    await updateDraftRevisionContent(rec.id, token, userIds.editor, { title: "first" });
    await expect(updateDraftRevisionContent(rec.id, token, userIds.editor, { title: "second" })).rejects.toBeInstanceOf(ConcurrentEditError);
    expect((await revisionRow(rec.draftId)).title).toBe("first");
  }, T);
});

describe("C. lifecycle operations roll back as one unit and refuse safely", () => {
  // Runs the operation twice on fresh fixtures: (1) the audit write fails; (2) the audit write succeeds and the
  // operation fails right after it. In both, the state change, any new rows and the audit entry must all be gone.
  async function failsAtomically(action: string, build: () => Promise<{ id: string }>, run: (id: string) => Promise<unknown>) {
    let last!: { id: string };
    for (const mode of ["action", "afterAction"] as const) {
      const rec = await build();
      last = rec;
      const before = await recState(rec.id);
      inject[mode] = action;
      try {
        await expect(run(rec.id)).rejects.toThrow(mode === "action" ? /injected audit failure/ : /injected failure after audit write/);
      } finally {
        inject[mode] = null;
      }
      const after = await recState(rec.id);
      expect({ status: after.status, draftId: after.draftId, publishedId: after.publishedId, revisionCount: after.revisionCount, totalAudits: after.totalAudits })
        .toEqual({ status: before.status, draftId: before.draftId, publishedId: before.publishedId, revisionCount: before.revisionCount, totalAudits: before.totalAudits });
      expect(after.auditCount(action)).toBe(before.auditCount(action));
      await expectCoherent(rec.id);
    }
    return last;
  }

  it("submit for review: an audit failure leaves status and audit trail untouched", async () => {
    await failsAtomically("RECORDING_SUBMITTED_FOR_REVIEW", () => newRecording("atomic-submit"), (id) => submitRecordingForReview(id, userIds.editor));
  }, T);

  it("archive: an audit failure leaves the Recording unarchived", async () => {
    await failsAtomically("RECORDING_ARCHIVED", () => liveOnly("atomic-archive"), (id) => archiveRecording(id, userIds.admin));
  }, T);

  it("restore: an audit failure leaves the Recording archived", async () => {
    await failsAtomically("RECORDING_RESTORED", () => archivedLive("atomic-restore"), (id) => restoreRecording(id, userIds.admin));
  }, T);

  it("unpublish: an audit failure leaves the Recording published", async () => {
    await failsAtomically("RECORDING_UNPUBLISHED", () => liveOnly("atomic-unpublish"), (id) => unpublishRecording(id, userIds.admin));
  }, T);

  it("fork: an audit failure leaves no new revision, no copied works/media and no pointer change", async () => {
    const rec = await failsAtomically("RECORDING_DRAFT_FORKED_FROM_PUBLISHED", () => liveOnly("atomic-fork"), (id) => forkDraftFromPublished(id, userIds.editor));
    expect(await prisma.mediaResource.count({ where: { recordingRevision: { recordingId: rec.id } } })).toBe(1);
    expect(await prisma.recordingRevisionWork.count({ where: { revision: { recordingId: rec.id } } })).toBe(1);
  }, T);

  it("refusals change nothing and write no audit: submit on a live Recording, unpublish on a draft, restore on a non-archived one, fork with an open draft or nothing published", async () => {
    const live = await liveOnly("refuse-live");
    const draftOnly = await newRecording("refuse-draft");
    const liveBefore = await recState(live.id);
    const draftBefore = await recState(draftOnly.id);

    await expect(submitRecordingForReview(live.id, userIds.editor)).rejects.toThrow(/not in DRAFT status/);
    await expect(unpublishRecording(draftOnly.id, userIds.admin)).rejects.toThrow(/not PUBLISHED/);
    await expect(restoreRecording(live.id, userIds.admin)).rejects.toThrow(/not ARCHIVED/);
    await expect(forkDraftFromPublished(draftOnly.id, userIds.editor)).rejects.toThrow(/already has an open draft/);
    const noPublished = await createDraftRecording({ slug: uniq("nopub"), actorId: userIds.editor });
    recordingIds.push(noPublished.id);
    await prisma.recording.update({ where: { id: noPublished.id }, data: { currentDraftRevisionId: null } });
    await expect(forkDraftFromPublished(noPublished.id, userIds.editor)).rejects.toThrow(/no published revision/);
    await prisma.recording.update({ where: { id: noPublished.id }, data: { currentDraftRevisionId: noPublished.currentDraftRevisionId } });

    const liveAfter = await recState(live.id);
    const draftAfter = await recState(draftOnly.id);
    expect({ status: liveAfter.status, revisions: liveAfter.revisionCount, audits: liveAfter.totalAudits }).toEqual({ status: liveBefore.status, revisions: liveBefore.revisionCount, audits: liveBefore.totalAudits });
    expect({ status: draftAfter.status, revisions: draftAfter.revisionCount, audits: draftAfter.totalAudits }).toEqual({ status: draftBefore.status, revisions: draftBefore.revisionCount, audits: draftBefore.totalAudits });
  }, T);

  it("archive is idempotent (a double click writes one audit entry); simultaneous archives write exactly one", async () => {
    const rec = await liveOnly("archive-twice");
    await Promise.all([archiveRecording(rec.id, userIds.admin), archiveRecording(rec.id, userIds.admin), archiveRecording(rec.id, userIds.admin)]);
    await archiveRecording(rec.id, userIds.admin);
    expect((await recState(rec.id)).auditCount("RECORDING_ARCHIVED")).toBe(1);
  }, T);

  it(`archive racing unpublish: archive always ends archived, and the unpublish audit exists exactly when the unpublish succeeded (${ROUNDS} rounds)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const rec = await liveOnly("archive-unpublish");
      const [archive, unpublish] = await Promise.all([settle(archiveRecording(rec.id, userIds.admin)), settle(unpublishRecording(rec.id, userIds.admin))]);
      expect(archive.ok).toBe(true);
      const s = await expectCoherent(rec.id);
      expect(s.status).toBe("ARCHIVED");
      expect(s.auditCount("RECORDING_UNPUBLISHED")).toBe(unpublish.ok ? 1 : 0);
      expect(s.auditCount("RECORDING_ARCHIVED")).toBe(1);
    }
  }, T);
});

describe("D. Studio callers surface typed refusals, never raw errors", () => {
  it("an autosave on an archived Recording returns a message instead of throwing", async () => {
    mockGetCurrentStudioSession.mockResolvedValue({ user: { id: userIds.editor, role: "EDITOR", status: "ACTIVE" } });
    const rec = await newRecording("action-save-archived");
    const token = (await revisionRow(rec.draftId)).updatedAt;
    await archiveRecording(rec.id, userIds.admin);
    const result = await saveSourceStep(rec.draftId, rec.id, token.toISOString(), { title: "x" });
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(/archived/i);
    expect((result as { error: string }).error).not.toMatch(/prisma|invocation/i);
  }, T);

  it("'Start a new draft' on an archived Recording is refused with a message and creates nothing", async () => {
    mockGetCurrentStudioSession.mockResolvedValue({ user: { id: userIds.editor, role: "EDITOR", status: "ACTIVE" } });
    const rec = await archivedLive("action-fork-archived");
    const before = await recState(rec.id);
    expect(await redirectOf(() => startNewDraftAction(rec.id, "review"))).toMatch(/archived/i);
    expect(await recState(rec.id)).toMatchObject({ status: "ARCHIVED", draftId: null, revisionCount: before.revisionCount });
  }, T);

  it("a double-clicked 'Start a new draft' succeeds for both clicks (no error shown, one draft)", async () => {
    mockGetCurrentStudioSession.mockResolvedValue({ user: { id: userIds.editor, role: "EDITOR", status: "ACTIVE" } });
    for (let round = 0; round < 4; round++) {
      const rec = await liveOnly("action-fork-double");
      const [a, b] = await Promise.all([redirectOf(() => startNewDraftAction(rec.id, "review")), redirectOf(() => startNewDraftAction(rec.id, "review"))]);
      expect(a).not.toMatch(/error=/);
      expect(b).not.toMatch(/error=/);
      const s = await expectCoherent(rec.id);
      expect(s).toMatchObject({ revisionCount: 2, status: "PUBLISHED" });
      expect(s.auditCount("RECORDING_DRAFT_FORKED_FROM_PUBLISHED")).toBe(1);
    }
  }, T);

  it("a busy Recording is reported as busy, not as a missing published version", async () => {
    mockGetCurrentStudioSession.mockResolvedValue({ user: { id: userIds.editor, role: "EDITOR", status: "ACTIVE" } });
    const rec = await liveOnly("action-fork-busy");
    const holder = holdEditLock(rec.id);
    await holder.got;
    try {
      expect(await redirectOf(() => startNewDraftAction(rec.id, "review"))).toMatch(/being changed by someone else/i);
    } finally {
      holder.release();
      await holder.done;
    }
    expect((await recState(rec.id)).revisionCount).toBe(1);
  }, T);
});
