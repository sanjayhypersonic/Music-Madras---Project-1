import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

// Must be at the true top level — vi.mock is hoisted above every import.
const mockGetCurrentStudioSession = vi.fn();
vi.mock("../../modules/auth/authService", () => ({
  getCurrentStudioSession: () => mockGetCurrentStudioSession(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// Fault injection: when `inject.action` names an audit action, writing THAT audit entry fails after the
// operation's other writes have already run inside its transaction. Everything else passes through.
const inject = vi.hoisted(() => ({ action: null as string | null }));
vi.mock("../../modules/audit/writeAuditLog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../modules/audit/writeAuditLog")>();
  return {
    ...actual,
    writeAuditLog: (input: Parameters<typeof actual.writeAuditLog>[0], client?: Parameters<typeof actual.writeAuditLog>[1]) =>
      inject.action !== null && input.action === inject.action ? Promise.reject(new Error("injected audit failure")) : actual.writeAuditLog(input, client),
  };
});

import type { Prisma } from "@prisma/client";
import { prisma } from "../../modules/db/client";
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import { attachMediaToRevision, attachRightsToMedia } from "../../modules/db/repositories/mediaResourceRepository";
import { createProgramme } from "../../modules/db/repositories/programmeRepository";
import { createVenue } from "../../modules/db/repositories/venueRepository";
import { createRightsInformation } from "../../modules/db/repositories/rightsInformationRepository";
import {
  ConcurrentEditError,
  RecordingBusyError,
  RevisionNotEditableError,
  archiveRecording,
  attachWorkToRevision,
  createDraftRecording,
  createPerformanceForDraft,
  detachWorkFromRevision,
  forkDraftFromPublished,
  publishCurrentDraft,
  publishRecordingDraft,
  updateDraftRevisionContent,
  withEditableDraftRevision,
} from "../../modules/db/repositories/recordingRepository";
import { createPerformanceAction } from "../../app/(studio)/studio/(protected)/recordings/[id]/performance/actions";

// Phase 6J-10C — true draft compare-and-swap and revision-safe child writes.
//
// The CAS tests do not rely on timing. "Window" tests run updateDraftRevisionContent inside a caller-owned
// transaction whose first read (the Recording row) is followed by a barrier hook: the hook commits a competing
// change from ANOTHER connection, and only then does the save issue its conditional UPDATE. That is exactly the
// check-then-write window the old implementation had, made deterministic. "Row-lock" tests hold the draft row
// lock from outside, so the writers provably queue on the UPDATE itself and re-evaluate it after the holder commits.

const T = 120000;
const TOKEN = randomUUID().slice(0, 8);
const ROUNDS = 8;

const userIds = {} as { admin: string; editor: string };
const recordingIds: string[] = [];
const workIds: string[] = [];
const rightsIds: string[] = [];
const performanceProgrammeIds: string[] = [];
const venueIds: string[] = [];
let composerId: string;
let rightsId: string;
let counter = 0;

const uniq = (label: string) => `c10-${label}-${TOKEN}-${++counter}-${randomUUID().slice(0, 4)}`;

async function newWork(label: string) {
  const work = await createMusicalWork({ slug: uniq(`w-${label}`), title: `C10 Work ${label} ${TOKEN} ${counter}`, composerId, actorId: userIds.editor });
  workIds.push(work.id);
  return work.id;
}

/** A recording with a complete, open DRAFT (one work, one media) — optionally already published/forked. */
async function newRecording(label: string) {
  const recording = await createDraftRecording({ slug: uniq(label), actorId: userIds.editor, title: `C10 ${label}` });
  recordingIds.push(recording.id);
  const draftId = recording.currentDraftRevisionId!;
  const baseWork = await newWork(`${label}-base`);
  await attachWorkToRevision(draftId, baseWork, userIds.editor);
  const media = await attachMediaToRevision({ recordingRevisionId: draftId, provider: "YOUTUBE", role: "PRIMARY_VIDEO", url: "https://www.youtube.com/watch?v=c10", actorId: userIds.editor });
  return { id: recording.id, draftId, baseWork, mediaId: media.id };
}

/** Published, no open draft. */
async function liveOnly(label: string) {
  const rec = await newRecording(label);
  await publishCurrentDraft(rec.id, userIds.admin);
  return { ...rec, publishedId: rec.draftId };
}

/** Published revision #1 plus an open second draft (the edit-after-publish shape). */
async function liveWithOpenDraft(label: string) {
  const rec = await liveOnly(label);
  const draft = await forkDraftFromPublished(rec.id, userIds.editor);
  return { ...rec, draftId: draft.id };
}

async function revisionRow(id: string) {
  return prisma.recordingRevision.findUniqueOrThrow({ where: { id } });
}

async function childState(revisionId: string) {
  const [works, media, audits] = await Promise.all([
    prisma.recordingRevisionWork.findMany({ where: { revisionId }, orderBy: { order: "asc" } }),
    prisma.mediaResource.findMany({ where: { recordingRevisionId: revisionId }, orderBy: { id: "asc" } }),
    prisma.auditLogEntry.findMany({ where: { OR: [{ entityType: "RecordingRevision", entityId: revisionId }, { entityType: "MediaResource", entityId: { in: (await prisma.mediaResource.findMany({ where: { recordingRevisionId: revisionId }, select: { id: true } })).map((m) => m.id) } }] } }),
  ]);
  return {
    works: works.map((w) => `${w.musicalWorkId}:${w.order}`),
    media: media.map((m) => `${m.id}:${m.rightsInformationId ?? "-"}`),
    audits: audits.length,
    auditCount: (action: string) => audits.filter((a) => a.action === action).length,
  };
}

/**
 * Holds the draft revision ROW lock from outside until released. `mutate` (optional) runs inside the holding
 * transaction when it is released, just before it commits — i.e. a change that becomes visible to the queued
 * writers only at the moment they are woken.
 */
function holdRevisionRow(revisionId: string, mutate?: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  let release!: () => void;
  let acquired!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const got = new Promise<void>((resolve) => (acquired = resolve));
  const done = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM recording_revisions WHERE id = ${revisionId} FOR UPDATE`;
      acquired();
      await released;
      if (mutate) await mutate(tx);
    },
    { timeout: 60000, maxWait: 10000 }
  );
  return { got, release, done };
}

/** Holds the per-Recording edit lock (the exact key publish/apply/lifecycle use) until released. */
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

/**
 * Runs updateDraftRevisionContent in a caller-owned transaction and calls `hook` right after the function's
 * first read of the Recording row — i.e. between its check and its write. The hook commits on another connection.
 */
async function saveWithWindow(
  recordingId: string,
  token: Date,
  patch: Parameters<typeof updateDraftRevisionContent>[3],
  hook: () => Promise<void>,
  options?: { expectedRevisionId?: string }
) {
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
      return updateDraftRevisionContent(recordingId, token, userIds.editor, patch, proxied, options);
    },
    { timeout: 30000, maxWait: 10000 }
  );
}

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
    userIds[key] = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `c10-${key}-${TOKEN}@musicmadras.test`, name: `C10 ${key}`, role, status: "ACTIVE" } })).id;
  }
  composerId = (await createComposer({ slug: `c10-composer-${TOKEN}`, name: `C10 Composer ${TOKEN}`, actorId: userIds.editor })).id;
  const rights = await createRightsInformation({ holder: `C10 holder ${TOKEN}`, actorId: userIds.editor });
  rightsId = rights.id;
  rightsIds.push(rights.id);
}, T);

afterAll(async () => {
  const revisionIds = (await prisma.recordingRevision.findMany({ where: { recordingId: { in: recordingIds } }, select: { id: true } })).map((r) => r.id);
  const mediaIds = (await prisma.mediaResource.findMany({ where: { recordingRevisionId: { in: revisionIds } }, select: { id: true } })).map((m) => m.id);
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityId: { in: [...recordingIds, ...revisionIds, ...mediaIds] } }, { actorId: { in: Object.values(userIds) } }] } });
  await prisma.mediaResource.deleteMany({ where: { recordingRevisionId: { in: revisionIds } } });
  await prisma.recording.deleteMany({ where: { id: { in: recordingIds } } });
  await prisma.performance.deleteMany({ where: { programmeId: { in: performanceProgrammeIds } } });
  await prisma.programme.deleteMany({ where: { id: { in: performanceProgrammeIds } } });
  await prisma.venue.deleteMany({ where: { id: { in: venueIds } } });
  await prisma.rightsInformation.deleteMany({ where: { id: { in: rightsIds } } });
  await prisma.musicalWork.deleteMany({ where: { id: { in: workIds } } });
  await prisma.composer.deleteMany({ where: { id: composerId } });
  await prisma.studioUser.deleteMany({ where: { id: { in: Object.values(userIds) } } });
}, T);

describe("A. draft content save is a database-enforced compare-and-swap", () => {
  it("a successful save advances the token strictly; the old token can never be reused (no ABA, even within one millisecond)", async () => {
    const rec = await newRecording("cas-token");
    let token = (await revisionRow(rec.draftId)).updatedAt;
    const seen = [token.getTime()];
    for (let i = 0; i < 25; i++) {
      const saved = await updateDraftRevisionContent(rec.id, token, userIds.editor, { title: `C10 save ${i}` });
      expect(saved.updatedAt.getTime()).toBeGreaterThan(token.getTime());
      expect(saved.title).toBe(`C10 save ${i}`);
      seen.push(saved.updatedAt.getTime());
      token = saved.updatedAt;
    }
    expect(new Set(seen).size).toBe(seen.length); // every token distinct
    // every earlier token is dead
    for (const old of seen.slice(0, -1)) {
      await expect(updateDraftRevisionContent(rec.id, new Date(old), userIds.editor, { title: "stale overwrite" })).rejects.toBeInstanceOf(ConcurrentEditError);
    }
    const final = await revisionRow(rec.draftId);
    expect(final.title).toBe("C10 save 24");
    expect(final.updatedAt.getTime()).toBe(token.getTime());
  }, T);

  it("two writers with the SAME token queued on the row lock: exactly one wins, the other gets ConcurrentEditError and changes nothing", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const rec = await newRecording("cas-rowlock");
      const before = await revisionRow(rec.draftId);
      const holder = holdRevisionRow(rec.draftId);
      await holder.got;

      const a = updateDraftRevisionContent(rec.id, before.updatedAt, userIds.editor, { title: `A wins? ${round}` });
      const b = updateDraftRevisionContent(rec.id, before.updatedAt, userIds.editor, { title: `B wins? ${round}` });
      const aOutcome = a.then((v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e }));
      const bOutcome = b.then((v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e }));
      // Both are provably waiting on the UPDATE (the old code would have already written).
      expect(await stillPending(a)).toBe(true);
      expect(await stillPending(b)).toBe(true);
      expect((await revisionRow(rec.draftId)).title).toBe(before.title);

      holder.release();
      await holder.done;
      const [ra, rb] = await Promise.all([aOutcome, bOutcome]);
      const winners = [ra, rb].filter((r) => r.ok);
      const losers = [ra, rb].filter((r) => !r.ok);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect((losers[0] as { e: unknown }).e).toBeInstanceOf(ConcurrentEditError);

      const winner = (winners[0] as { v: { title: string | null; updatedAt: Date } }).v;
      const final = await revisionRow(rec.draftId);
      expect(final.title).toBe(winner.title); // the loser's text never landed
      expect(final.updatedAt.getTime()).toBe(winner.updatedAt.getTime()); // the winner's token is the final token
      expect(final.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    }
  }, T);

  it("eight unsynchronised writers with the same token: exactly one wins", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const rec = await newRecording("cas-eight");
      const before = await revisionRow(rec.draftId);
      const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => updateDraftRevisionContent(rec.id, before.updatedAt, userIds.editor, { title: `W${i} ${round}` })));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of results.filter((x) => x.status === "rejected")) expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ConcurrentEditError);
      const winner = (results.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ title: string | null }>).value;
      expect((await revisionRow(rec.draftId)).title).toBe(winner.title);
    }
  }, T);

  it("another writer commits between the check and the write: the save is refused and the winner's content and token survive", async () => {
    const rec = await newRecording("window-token");
    const before = await revisionRow(rec.draftId);
    let winnerToken!: Date;
    await expect(
      saveWithWindow(rec.id, before.updatedAt, { title: "LATE SAVE" }, async () => {
        winnerToken = (await updateDraftRevisionContent(rec.id, before.updatedAt, userIds.editor, { title: "WINNER" })).updatedAt;
      })
    ).rejects.toBeInstanceOf(ConcurrentEditError);
    const final = await revisionRow(rec.draftId);
    expect(final.title).toBe("WINNER");
    expect(final.updatedAt.getTime()).toBe(winnerToken.getTime());
  }, T);

  it("the revision becomes non-DRAFT between the check and the write (token untouched): refused, nothing written", async () => {
    const rec = await newRecording("window-status");
    const before = await revisionRow(rec.draftId);
    await expect(
      saveWithWindow(rec.id, before.updatedAt, { title: "LATE SAVE" }, async () => {
        // status only — the token deliberately stays equal, so ONLY the DRAFT condition can refuse this save
        await prisma.recordingRevision.updateMany({ where: { id: rec.draftId }, data: { revisionStatus: "PUBLISHED", updatedAt: before.updatedAt } });
      })
    ).rejects.toBeInstanceOf(ConcurrentEditError);
    const final = await revisionRow(rec.draftId);
    expect(final.title).toBe(before.title);
    expect(final.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(final.revisionStatus).toBe("PUBLISHED");
  }, T);

  it("the revision stops being the Recording's current draft between the check and the write (still DRAFT, same token): refused", async () => {
    const rec = await newRecording("window-pointer");
    const before = await revisionRow(rec.draftId);
    await expect(
      saveWithWindow(rec.id, before.updatedAt, { title: "LATE SAVE" }, async () => {
        await prisma.recording.update({ where: { id: rec.id }, data: { currentDraftRevisionId: null } });
      })
    ).rejects.toBeInstanceOf(ConcurrentEditError);
    const final = await revisionRow(rec.draftId);
    expect(final.title).toBe(before.title);
    expect(final.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(final.revisionStatus).toBe("DRAFT");
  }, T);

  it("the Recording is archived between the check and the write: refused, nothing written", async () => {
    const rec = await newRecording("window-archived");
    const before = await revisionRow(rec.draftId);
    await expect(
      saveWithWindow(rec.id, before.updatedAt, { title: "LATE SAVE" }, async () => {
        await prisma.recording.update({ where: { id: rec.id }, data: { status: "ARCHIVED" } });
      })
    ).rejects.toBeInstanceOf(ConcurrentEditError);
    const final = await revisionRow(rec.draftId);
    expect(final.title).toBe(before.title);
    expect(final.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  }, T);

  it("a save queued on the row lock while the revision is published underneath it does not modify the published revision", async () => {
    const rec = await newRecording("rowlock-publish");
    const before = await revisionRow(rec.draftId);
    // while the save waits, the draft is published inside the holding transaction (status only; the token stays
    // equal, so only the DRAFT condition can refuse the save once the lock is released)
    const holder = holdRevisionRow(rec.draftId, (tx) => tx.recordingRevision.updateMany({ where: { id: rec.draftId }, data: { revisionStatus: "PUBLISHED", updatedAt: before.updatedAt } }));
    await holder.got;
    const save = updateDraftRevisionContent(rec.id, before.updatedAt, userIds.editor, { title: "SAVE AFTER PUBLISH" }).then(() => "saved" as const, (e) => e as unknown);
    expect(await stillPending(save)).toBe(true);
    holder.release();
    await holder.done;
    expect(await save).toBeInstanceOf(ConcurrentEditError);
    const final = await revisionRow(rec.draftId);
    expect(final.title).toBe(before.title);
    expect(final.revisionStatus).toBe("PUBLISHED");
  }, T);

  it("a save with a token loaded before a real publication cannot modify the revision afterwards (content, token and audit unchanged)", async () => {
    const rec = await newRecording("stale-after-publish");
    const loaded = await revisionRow(rec.draftId);
    const published = await publishRecordingDraft({ recordingId: rec.id, actorId: userIds.admin, expectedDraftRevisionId: rec.draftId });
    expect(published.ok).toBe(true);
    const afterPublish = await revisionRow(rec.draftId);

    await expect(updateDraftRevisionContent(rec.id, loaded.updatedAt, userIds.editor, { title: "STALE" })).rejects.toThrow(/no open draft/i);
    await expect(updateDraftRevisionContent(rec.id, afterPublish.updatedAt, userIds.editor, { title: "STALE" })).rejects.toThrow(/no open draft/i);

    const final = await revisionRow(rec.draftId);
    expect(final.title).toBe(afterPublish.title);
    expect(final.updatedAt.getTime()).toBe(afterPublish.updatedAt.getTime());
    expect(final.revisionStatus).toBe("PUBLISHED");
  }, T);

  it("a save naming a revision that is not the current draft is a conflict, not a redirect to another revision", async () => {
    const rec = await liveWithOpenDraft("expected-revision");
    const draft = await revisionRow(rec.draftId);
    // the editor still has the PUBLISHED revision's id (a stale page): refused even with the draft's own token
    await expect(updateDraftRevisionContent(rec.id, draft.updatedAt, userIds.editor, { title: "WRONG TARGET" }, undefined, { expectedRevisionId: rec.publishedId })).rejects.toBeInstanceOf(ConcurrentEditError);
    expect((await revisionRow(rec.draftId)).title).toBe(draft.title);
    expect((await revisionRow(rec.publishedId)).title).toBe(`C10 expected-revision`);
    // and with the right id it works
    const ok = await updateDraftRevisionContent(rec.id, draft.updatedAt, userIds.editor, { title: "RIGHT TARGET" }, undefined, { expectedRevisionId: rec.draftId });
    expect(ok.title).toBe("RIGHT TARGET");
  }, T);

  it("keeps its error contracts for an archived Recording and for a Recording with no open draft", async () => {
    const archived = await newRecording("contract-archived");
    const token = (await revisionRow(archived.draftId)).updatedAt;
    await archiveRecording(archived.id, userIds.admin);
    await expect(updateDraftRevisionContent(archived.id, token, userIds.editor, { title: "x" })).rejects.toThrow(/archived/i);

    const live = await liveOnly("contract-nodraft");
    await expect(updateDraftRevisionContent(live.id, new Date(), userIds.editor, { title: "x" })).rejects.toThrow(/no open draft/i);
  }, T);

  it("a competing apply-style caller-owned transaction and a Studio-style save serialize on the token (one wins)", async () => {
    const rec = await newRecording("apply-vs-save");
    const before = await revisionRow(rec.draftId);
    const results = await Promise.allSettled([
      prisma.$transaction((tx) => updateDraftRevisionContent(rec.id, before.updatedAt, userIds.editor, { description: "from a transaction" }, tx)),
      updateDraftRevisionContent(rec.id, before.updatedAt, userIds.editor, { description: "from a plain save" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const winner = (results.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ description: string | null }>).value;
    expect((await revisionRow(rec.draftId)).description).toBe(winner.description);
  }, T);
});

describe("B. every revision child write is draft-safe at the repository boundary", () => {
  it("works and media on the CURRENT draft still work; each writes its audit row in the same transaction", async () => {
    const rec = await newRecording("child-ok");
    const extra = await newWork("child-ok-extra");
    const before = await childState(rec.draftId);

    await attachWorkToRevision(rec.draftId, extra, userIds.editor);
    const media = await attachMediaToRevision({ recordingRevisionId: rec.draftId, provider: "UPLOAD", role: "THUMBNAIL", url: "https://example.org/c10.png", actorId: userIds.editor });
    await attachRightsToMedia(media.id, rightsId, userIds.editor);
    await detachWorkFromRevision(rec.draftId, extra, userIds.editor);

    const after = await childState(rec.draftId);
    expect(after.works).toHaveLength(before.works.length); // attached then detached
    expect(after.media).toHaveLength(before.media.length + 1);
    expect(after.media.some((m) => m.startsWith(`${media.id}:${rightsId}`))).toBe(true);
    expect(after.auditCount("WORK_ATTACHED_TO_RECORDING_REVISION")).toBe(before.auditCount("WORK_ATTACHED_TO_RECORDING_REVISION") + 1);
    expect(after.auditCount("WORK_DETACHED_FROM_RECORDING_REVISION")).toBe(1);
    expect(after.auditCount("MEDIA_ATTACHED_TO_RECORDING_REVISION")).toBe(before.auditCount("MEDIA_ATTACHED_TO_RECORDING_REVISION") + 1);
    expect(after.auditCount("RIGHTS_ATTACHED_TO_MEDIA_RESOURCE")).toBe(1);
  }, T);

  type Target = { name: string; reason: "STALE_REVISION" | "RECORDING_ARCHIVED"; build: () => Promise<{ revisionId: string; mediaId: string; workId: string; recordingId: string }> };
  const targets: Target[] = [
    {
      name: "the PUBLISHED revision of a live Recording with no open draft",
      reason: "STALE_REVISION",
      build: async () => {
        const r = await liveOnly("t-live");
        return { revisionId: r.publishedId, mediaId: r.mediaId, workId: r.baseWork, recordingId: r.id };
      },
    },
    {
      name: "the PUBLISHED revision while a second draft is open",
      reason: "STALE_REVISION",
      build: async () => {
        const r = await liveWithOpenDraft("t-live-draft");
        return { revisionId: r.publishedId, mediaId: r.mediaId, workId: r.baseWork, recordingId: r.id };
      },
    },
    {
      name: "a SUPERSEDED revision",
      reason: "STALE_REVISION",
      build: async () => {
        const r = await liveWithOpenDraft("t-superseded");
        await publishRecordingDraft({ recordingId: r.id, actorId: userIds.admin, expectedDraftRevisionId: r.draftId, enforceCompleteness: false });
        expect((await revisionRow(r.publishedId)).revisionStatus).toBe("SUPERSEDED");
        return { revisionId: r.publishedId, mediaId: r.mediaId, workId: r.baseWork, recordingId: r.id };
      },
    },
    {
      name: "a DRAFT revision that is not the Recording's current draft (stale draft pointer)",
      reason: "STALE_REVISION",
      build: async () => {
        const r = await newRecording("t-stray");
        const stray = await prisma.recordingRevision.create({ data: { recordingId: r.id, revisionNumber: 900, revisionStatus: "DRAFT", createdById: userIds.editor, updatedById: userIds.editor } });
        const media = await prisma.mediaResource.create({ data: { recordingRevisionId: stray.id, provider: "UPLOAD", role: "THUMBNAIL", url: "https://example.org/stray.png" } });
        const work = await newWork("t-stray");
        await prisma.recordingRevisionWork.create({ data: { revisionId: stray.id, musicalWorkId: work, order: 1 } });
        return { revisionId: stray.id, mediaId: media.id, workId: work, recordingId: r.id };
      },
    },
    {
      name: "the open draft of an ARCHIVED Recording",
      reason: "RECORDING_ARCHIVED",
      build: async () => {
        const r = await newRecording("t-archived");
        await archiveRecording(r.id, userIds.admin);
        return { revisionId: r.draftId, mediaId: r.mediaId, workId: r.baseWork, recordingId: r.id };
      },
    },
    {
      name: "a revision that does not exist",
      reason: "STALE_REVISION",
      build: async () => ({ revisionId: randomUUID(), mediaId: randomUUID(), workId: randomUUID(), recordingId: randomUUID() }),
    },
  ];

  for (const target of targets) {
    it(`refuses every child write to ${target.name}; no row and no audit changes`, async () => {
      const t = await target.build();
      const spare = await newWork("t-spare");
      const exists = await prisma.recordingRevision.findUnique({ where: { id: t.revisionId }, select: { id: true } });
      const before = exists ? await childState(t.revisionId) : null;
      const refusal = async (run: () => Promise<unknown>) => {
        const err = await run().then(() => null, (e: unknown) => e);
        expect(err).toBeInstanceOf(RevisionNotEditableError);
        expect((err as RevisionNotEditableError).reason).toBe(target.reason);
      };

      await refusal(() => attachWorkToRevision(t.revisionId, spare, userIds.editor));
      await refusal(() => detachWorkFromRevision(t.revisionId, t.workId, userIds.editor));
      await refusal(() => attachMediaToRevision({ recordingRevisionId: t.revisionId, provider: "UPLOAD", role: "THUMBNAIL", url: "https://example.org/refused.png", actorId: userIds.editor }));
      if (exists) await refusal(() => attachRightsToMedia(t.mediaId, rightsId, userIds.editor));

      if (before) {
        const after = await childState(t.revisionId);
        expect(after.works).toEqual(before.works);
        expect(after.media).toEqual(before.media);
        expect(after.audits).toBe(before.audits);
      }
    }, T);
  }

  it("a stale draft id cannot receive child changes after the draft was published", async () => {
    const rec = await newRecording("stale-draft-child");
    const spare = await newWork("stale-draft-child");
    await publishRecordingDraft({ recordingId: rec.id, actorId: userIds.admin, expectedDraftRevisionId: rec.draftId });
    const before = await childState(rec.draftId);
    await expect(attachWorkToRevision(rec.draftId, spare, userIds.editor)).rejects.toBeInstanceOf(RevisionNotEditableError);
    await expect(attachMediaToRevision({ recordingRevisionId: rec.draftId, provider: "UPLOAD", role: "THUMBNAIL", url: "https://example.org/late.png", actorId: userIds.editor })).rejects.toBeInstanceOf(RevisionNotEditableError);
    const after = await childState(rec.draftId);
    expect(after).toMatchObject({ works: before.works, media: before.media, audits: before.audits });
  }, T);

  it("a refused child write after rejection leaves no success audit and a later legitimate write still works", async () => {
    const rec = await liveWithOpenDraft("refusal-then-ok");
    const spare = await newWork("refusal-then-ok");
    await expect(attachWorkToRevision(rec.publishedId, spare, userIds.editor)).rejects.toBeInstanceOf(RevisionNotEditableError);
    expect((await childState(rec.publishedId)).auditCount("WORK_ATTACHED_TO_RECORDING_REVISION")).toBe(1); // only the original fixture attach
    await attachWorkToRevision(rec.draftId, spare, userIds.editor); // the real draft is unaffected
    expect((await childState(rec.draftId)).works.map((w) => w.split(":")[0])).toContain(spare);
    expect((await childState(rec.publishedId)).works.map((w) => w.split(":")[0])).not.toContain(spare);
  }, T);

  describe("atomicity: a failed child mutation leaves no partial link and no success audit", () => {
    it("attach work: audit failure rolls the link back", async () => {
      const rec = await newRecording("atomic-attach");
      const spare = await newWork("atomic-attach");
      const before = await childState(rec.draftId);
      inject.action = "WORK_ATTACHED_TO_RECORDING_REVISION";
      try {
        await expect(attachWorkToRevision(rec.draftId, spare, userIds.editor)).rejects.toThrow(/injected audit failure/);
      } finally {
        inject.action = null;
      }
      expect(await childState(rec.draftId)).toMatchObject({ works: before.works, audits: before.audits });
    }, T);

    it("detach work: audit failure keeps the link", async () => {
      const rec = await newRecording("atomic-detach");
      const before = await childState(rec.draftId);
      inject.action = "WORK_DETACHED_FROM_RECORDING_REVISION";
      try {
        await expect(detachWorkFromRevision(rec.draftId, rec.baseWork, userIds.editor)).rejects.toThrow(/injected audit failure/);
      } finally {
        inject.action = null;
      }
      expect(await childState(rec.draftId)).toMatchObject({ works: before.works, audits: before.audits });
    }, T);

    it("attach media: audit failure leaves no MediaResource", async () => {
      const rec = await newRecording("atomic-media");
      const before = await childState(rec.draftId);
      inject.action = "MEDIA_ATTACHED_TO_RECORDING_REVISION";
      try {
        await expect(attachMediaToRevision({ recordingRevisionId: rec.draftId, provider: "UPLOAD", role: "THUMBNAIL", url: "https://example.org/atomic.png", actorId: userIds.editor })).rejects.toThrow(/injected audit failure/);
      } finally {
        inject.action = null;
      }
      expect(await childState(rec.draftId)).toMatchObject({ media: before.media, audits: before.audits });
    }, T);

    it("attach rights: audit failure leaves the media's rights link unchanged", async () => {
      const rec = await newRecording("atomic-rights");
      const before = await childState(rec.draftId);
      inject.action = "RIGHTS_ATTACHED_TO_MEDIA_RESOURCE";
      try {
        await expect(attachRightsToMedia(rec.mediaId, rightsId, userIds.editor)).rejects.toThrow(/injected audit failure/);
      } finally {
        inject.action = null;
      }
      expect(await childState(rec.draftId)).toMatchObject({ media: before.media, audits: before.audits });
    }, T);

    it("a duplicate attach and an unknown work id are rejected without a partial link or audit", async () => {
      const rec = await newRecording("atomic-invalid");
      const before = await childState(rec.draftId);
      await expect(attachWorkToRevision(rec.draftId, rec.baseWork, userIds.editor)).rejects.toThrow(/already attached/i);
      await expect(attachWorkToRevision(rec.draftId, randomUUID(), userIds.editor)).rejects.toThrow();
      await expect(detachWorkFromRevision(rec.draftId, randomUUID(), userIds.editor)).rejects.toThrow();
      expect(await childState(rec.draftId)).toMatchObject({ works: before.works, audits: before.audits });
    }, T);
  });

  describe("coordination with the per-Recording edit lock", () => {
    it("concurrent attaches of DIFFERENT works all succeed with distinct orders and one audit each", async () => {
      const rec = await newRecording("conc-distinct");
      const spares = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => newWork(`conc-distinct-${n}`)));
      const before = await childState(rec.draftId);
      const results = await Promise.allSettled(spares.map((w) => attachWorkToRevision(rec.draftId, w, userIds.editor)));
      expect(results.map((r) => r.status)).toEqual(spares.map(() => "fulfilled"));
      const after = await childState(rec.draftId);
      expect(after.works).toHaveLength(before.works.length + spares.length);
      const orders = after.works.map((w) => Number(w.split(":")[1]));
      expect(new Set(orders).size).toBe(orders.length); // the lock serialized the order computation
      expect(after.auditCount("WORK_ATTACHED_TO_RECORDING_REVISION")).toBe(before.auditCount("WORK_ATTACHED_TO_RECORDING_REVISION") + spares.length);
    }, T);

    it("concurrent attaches of the SAME work: one wins, the rest get the explicit 'already attached' refusal (never a raw unique-constraint error)", async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const rec = await newRecording("conc-same");
        const spare = await newWork("conc-same");
        const results = await Promise.allSettled([1, 2, 3, 4, 5].map(() => attachWorkToRevision(rec.draftId, spare, userIds.editor)));
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        for (const r of results.filter((x) => x.status === "rejected")) expect(String((r as PromiseRejectedResult).reason?.message)).toMatch(/already attached/i);
        expect((await childState(rec.draftId)).works.filter((w) => w.startsWith(spare))).toHaveLength(1);
      }
    }, T);

    it("a child write waits for the edit lock (same lock as publish/apply) and then completes", async () => {
      const rec = await newRecording("lock-wait");
      const spare = await newWork("lock-wait");
      const holder = holdEditLock(rec.id);
      await holder.got;
      const attach = attachWorkToRevision(rec.draftId, spare, userIds.editor);
      expect(await stillPending(attach)).toBe(true);
      expect((await childState(rec.draftId)).works.map((w) => w.split(":")[0])).not.toContain(spare);
      holder.release();
      await holder.done;
      await attach;
      expect((await childState(rec.draftId)).works.map((w) => w.split(":")[0])).toContain(spare);
    }, T);

    it("the wait for the edit lock is bounded: RecordingBusyError, nothing written", async () => {
      const rec = await newRecording("lock-bounded");
      const spare = await newWork("lock-bounded");
      const before = await childState(rec.draftId);
      const holder = holdEditLock(rec.id);
      await holder.got;
      try {
        await expect(attachWorkToRevision(rec.draftId, spare, userIds.editor)).rejects.toBeInstanceOf(RecordingBusyError);
        await expect(attachMediaToRevision({ recordingRevisionId: rec.draftId, provider: "UPLOAD", role: "THUMBNAIL", url: "https://example.org/busy.png", actorId: userIds.editor })).rejects.toBeInstanceOf(RecordingBusyError);
      } finally {
        holder.release();
        await holder.done;
      }
      expect(await childState(rec.draftId)).toMatchObject({ works: before.works, media: before.media, audits: before.audits });
    }, T);
  });
});

describe("C. child writes and content saves racing publication", () => {
  it("deterministic: a child write holding the lock first is included in the publication; publication waits for it; later writes are refused", async () => {
    const rec = await newRecording("pub-after-child");
    const spare = await newWork("pub-after-child");
    let proceed!: () => void;
    const gate = new Promise<void>((resolve) => (proceed = resolve));
    let inside!: () => void;
    const entered = new Promise<void>((resolve) => (inside = resolve));

    const child = withEditableDraftRevision(rec.draftId, async (tx) => {
      inside();
      await gate;
      await tx.recordingRevisionWork.create({ data: { revisionId: rec.draftId, musicalWorkId: spare, order: 99 } });
    });
    await entered;
    const publish = publishRecordingDraft({ recordingId: rec.id, actorId: userIds.admin, expectedDraftRevisionId: rec.draftId });
    expect(await stillPending(publish)).toBe(true); // publication cannot slip past an in-flight child write
    proceed();
    await child;
    const result = await publish;
    expect(result.ok).toBe(true);

    const published = await childState(rec.draftId);
    expect(published.works.map((w) => w.split(":")[0])).toContain(spare); // the published revision contains it, exactly once
    const frozen = { works: published.works, media: published.media, audits: published.audits };
    await expect(attachWorkToRevision(rec.draftId, await newWork("pub-after-child-2"), userIds.editor)).rejects.toBeInstanceOf(RevisionNotEditableError);
    expect(await childState(rec.draftId)).toMatchObject(frozen); // never changes after publication
    expect(await prisma.recording.findUniqueOrThrow({ where: { id: rec.id } })).toMatchObject({ status: "PUBLISHED", currentPublishedRevisionId: rec.draftId, currentDraftRevisionId: null });
  }, T);

  it("deterministic: content save + child write issued while publication holds the lock are both refused afterwards", async () => {
    const rec = await newRecording("pub-then-writes");
    const spare = await newWork("pub-then-writes");
    const loaded = await revisionRow(rec.draftId);
    const holder = holdEditLock(rec.id);
    await holder.got;
    const publish = publishRecordingDraft({ recordingId: rec.id, actorId: userIds.admin, expectedDraftRevisionId: rec.draftId });
    const attach = attachWorkToRevision(rec.draftId, spare, userIds.editor).then(() => "ok" as const, (e: unknown) => e);
    expect(await stillPending(publish)).toBe(true);
    expect(await stillPending(attach.then(() => 0))).toBe(true);
    holder.release();
    await holder.done;
    const [pub, att] = await Promise.all([publish, attach]);
    expect(pub.ok).toBe(true);
    // The queue order of the two lock waiters is up to PostgreSQL; whichever way it fell, the outcome is coherent:
    const childAfter = await childState(rec.draftId);
    const hasSpare = childAfter.works.some((w) => w.startsWith(spare));
    if (att === "ok") expect(hasSpare).toBe(true);
    else {
      expect(att).toBeInstanceOf(RevisionNotEditableError);
      expect(hasSpare).toBe(false);
    }
    expect(childAfter.auditCount("WORK_ATTACHED_TO_RECORDING_REVISION")).toBe(att === "ok" ? 2 : 1);

    await expect(updateDraftRevisionContent(rec.id, loaded.updatedAt, userIds.editor, { title: "STALE CONTENT" })).rejects.toThrow();
    const frozen = await childState(rec.draftId);
    expect(frozen.works).toEqual(childAfter.works);
    expect((await revisionRow(rec.draftId)).title).toBe(loaded.title);
  }, T);

  it(`racing publish against an attach, a media attach and a content save (${ROUNDS} rounds): a coherent serial outcome, and the published revision never changes afterwards`, async () => {
    let attachedBeforePublish = 0;
    let refusedAfterPublish = 0;
    for (let round = 0; round < ROUNDS; round++) {
      const rec = await newRecording("race");
      const spare = await newWork("race");
      const loaded = await revisionRow(rec.draftId);
      const [pub, att, med, sav] = await Promise.allSettled([
        publishRecordingDraft({ recordingId: rec.id, actorId: userIds.admin, expectedDraftRevisionId: rec.draftId }),
        attachWorkToRevision(rec.draftId, spare, userIds.editor),
        attachMediaToRevision({ recordingRevisionId: rec.draftId, provider: "UPLOAD", role: "THUMBNAIL", url: "https://example.org/race.png", actorId: userIds.editor }),
        updateDraftRevisionContent(rec.id, loaded.updatedAt, userIds.editor, { description: `race ${round}` }),
      ]);
      expect(pub.status === "fulfilled" && pub.value.ok).toBe(true);

      const recording = await prisma.recording.findUniqueOrThrow({ where: { id: rec.id } });
      expect(recording).toMatchObject({ status: "PUBLISHED", currentPublishedRevisionId: rec.draftId, currentDraftRevisionId: null });
      expect((await revisionRow(rec.draftId)).revisionStatus).toBe("PUBLISHED");

      // Every outcome is either "done before the publication, and part of what was published" or "refused".
      const s = await childState(rec.draftId);
      const workIn = s.works.some((w) => w.startsWith(spare));
      if (att.status === "fulfilled") {
        attachedBeforePublish++;
        expect(workIn).toBe(true);
        expect(s.auditCount("WORK_ATTACHED_TO_RECORDING_REVISION")).toBe(2);
      } else {
        refusedAfterPublish++;
        expect(att.reason).toBeInstanceOf(RevisionNotEditableError);
        expect(workIn).toBe(false);
        expect(s.auditCount("WORK_ATTACHED_TO_RECORDING_REVISION")).toBe(1);
      }
      const mediaIn = s.media.length === 2;
      expect(med.status === "fulfilled").toBe(mediaIn);
      if (med.status === "rejected") expect(med.reason).toBeInstanceOf(RevisionNotEditableError);
      const description = (await revisionRow(rec.draftId)).description;
      if (sav.status === "fulfilled") expect(description).toBe(`race ${round}`);
      else {
        expect(sav.reason).toBeInstanceOf(Error);
        expect(description).toBe(loaded.description);
      }

      // Nothing can change the published revision after the fact.
      const snapshot = { ...s, token: (await revisionRow(rec.draftId)).updatedAt.getTime() };
      await expect(attachWorkToRevision(rec.draftId, await newWork("race-late"), userIds.editor)).rejects.toBeInstanceOf(RevisionNotEditableError);
      await expect(updateDraftRevisionContent(rec.id, new Date(snapshot.token), userIds.editor, { title: "late" })).rejects.toThrow();
      const again = await childState(rec.draftId);
      expect({ works: again.works, media: again.media, audits: again.audits, token: (await revisionRow(rec.draftId)).updatedAt.getTime() }).toEqual({ works: snapshot.works, media: snapshot.media, audits: snapshot.audits, token: snapshot.token });
    }
    // Informational only: both interleavings are legal; the assertions above hold for whichever the scheduler picks.
    expect(attachedBeforePublish + refusedAfterPublish).toBe(ROUNDS);
  }, T);
});

describe("D. Performance creation for a draft is atomic with the CAS (no orphan rows)", () => {
  async function programmeAndVenue(label: string) {
    const programme = await createProgramme({ slug: uniq(`prog-${label}`), title: `C10 Programme ${label} ${TOKEN} ${counter}`, actorId: userIds.editor });
    performanceProgrammeIds.push(programme.id);
    const venue = await createVenue({ slug: uniq(`venue-${label}`), name: `C10 Venue ${label} ${TOKEN} ${randomUUID().slice(0, 4)}`, type: "CHURCH", actorId: userIds.editor });
    venueIds.push(venue.id);
    return { programme, venue };
  }

  it("creates the Performance and links it to the draft in one step", async () => {
    const rec = await newRecording("perf-ok");
    const { programme, venue } = await programmeAndVenue("ok");
    const draft = await revisionRow(rec.draftId);
    const performance = await createPerformanceForDraft(rec.id, rec.draftId, draft.updatedAt, { programmeId: programme.id, venueId: venue.id, actorId: userIds.editor });
    const after = await revisionRow(rec.draftId);
    expect(after.performanceId).toBe(performance.id);
    expect(after.updatedAt.getTime()).toBeGreaterThan(draft.updatedAt.getTime());
    expect(await prisma.auditLogEntry.count({ where: { action: "PERFORMANCE_CREATED", entityId: performance.id } })).toBe(1);
  }, T);

  it("a stale token or a stale revision id is refused and leaves NO orphan Performance and no creation audit", async () => {
    const rec = await liveWithOpenDraft("perf-stale");
    const { programme, venue } = await programmeAndVenue("stale");
    const draft = await revisionRow(rec.draftId);
    await updateDraftRevisionContent(rec.id, draft.updatedAt, userIds.editor, { title: "someone else saved first" });
    const createdAudits = () => prisma.auditLogEntry.count({ where: { action: "PERFORMANCE_CREATED", actorId: userIds.editor } });
    const auditsBefore = await createdAudits();

    await expect(createPerformanceForDraft(rec.id, rec.draftId, draft.updatedAt, { programmeId: programme.id, venueId: venue.id, actorId: userIds.editor })).rejects.toBeInstanceOf(ConcurrentEditError);
    const fresh = await revisionRow(rec.draftId);
    await expect(createPerformanceForDraft(rec.id, rec.publishedId, fresh.updatedAt, { programmeId: programme.id, venueId: venue.id, actorId: userIds.editor })).rejects.toBeInstanceOf(ConcurrentEditError);

    expect(await prisma.performance.count({ where: { programmeId: programme.id } })).toBe(0);
    expect(await createdAudits()).toBe(auditsBefore);
    expect((await revisionRow(rec.draftId)).performanceId).toBeNull();
  }, T);

  it("the Studio action reports a stale form as a message, not an error, and creates nothing", async () => {
    mockGetCurrentStudioSession.mockResolvedValue({ user: { id: userIds.editor, role: "EDITOR", status: "ACTIVE" } });
    const rec = await liveWithOpenDraft("perf-action");
    const { programme, venue } = await programmeAndVenue("action");
    const draft = await revisionRow(rec.draftId);
    await updateDraftRevisionContent(rec.id, draft.updatedAt, userIds.editor, { title: "edited elsewhere" });
    const form = new FormData();
    form.set("programmeId", programme.id);
    form.set("venueId", venue.id);

    const message = await redirectOf(() => createPerformanceAction(rec.id, rec.draftId, draft.updatedAt.toISOString(), form));
    expect(message).toMatch(/edited by someone else|reload/i);
    expect(await prisma.performance.count({ where: { programmeId: programme.id } })).toBe(0);

    const freshToken = (await revisionRow(rec.draftId)).updatedAt.toISOString();
    const stalePage = await redirectOf(() => createPerformanceAction(rec.id, rec.publishedId, freshToken, form));
    expect(stalePage).toMatch(/out of date/i);
    expect(await prisma.performance.count({ where: { programmeId: programme.id } })).toBe(0);
  }, T);
});
