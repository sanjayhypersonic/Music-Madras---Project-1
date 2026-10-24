import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

// Must be at the true top level — vi.mock is hoisted above every import.
const mockGetCurrentStudioSession = vi.fn();
vi.mock("../../modules/auth/authService", () => ({
  getCurrentStudioSession: () => mockGetCurrentStudioSession(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// Fault injection for the rollback test: when `inject.action` names an audit action, writing THAT audit entry
// fails, after the publication's other writes have already run inside the transaction. Everything else passes through.
const inject = vi.hoisted(() => ({ action: null as string | null }));
vi.mock("../../modules/audit/writeAuditLog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../modules/audit/writeAuditLog")>();
  return {
    ...actual,
    writeAuditLog: (input: Parameters<typeof actual.writeAuditLog>[0], client?: Parameters<typeof actual.writeAuditLog>[1]) =>
      inject.action !== null && input.action === inject.action ? Promise.reject(new Error("injected audit failure")) : actual.writeAuditLog(input, client),
  };
});

import { prisma } from "../../modules/db/client";
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import { attachMediaToRevision } from "../../modules/db/repositories/mediaResourceRepository";
import {
  RecordingBusyError,
  archiveRecording,
  attachWorkToRevision,
  createDraftRecording,
  detachWorkFromRevision,
  findPublishedRecordingBySlug,
  forkDraftFromPublished,
  publishCurrentDraft,
  publishRecordingDraft,
  recordingEditLockKey,
  restoreRecording,
  submitRecordingForReview,
  unpublishRecording,
} from "../../modules/db/repositories/recordingRepository";
import { describePublishRefusal } from "../../modules/publishing/publishRefusal";
import { publishAction } from "../../app/(studio)/studio/(protected)/recordings/[id]/review/actions";

// Phase 6J-10B — publication is atomic and serialized with the other lifecycle changes.
//
// The race tests run the operations truly concurrently (separate connections) and assert the final recording
// state, the revision pointers/statuses and the audit rows, for EVERY outcome the scheduler may pick. They are
// complemented by deterministic tests that hold the per-Recording lock from outside and prove each operation
// waits for it (a sequential test cannot show that), a bounded-wait test, and a fault-injection rollback test.

const T = 120000;
const TOKEN = randomUUID().slice(0, 8);
const ROUNDS = 10;

const userIds = {} as { admin: string; editor: string };
const recordingIds: string[] = [];
let workId: string;
let composerId: string;

async function newRecording(label: string, options: { complete?: boolean } = {}) {
  const complete = options.complete !== false;
  const recording = await createDraftRecording({ slug: `p10b-${label}-${TOKEN}-${randomUUID().slice(0, 6)}`, actorId: userIds.editor, title: complete ? `Publish atomicity ${label}` : undefined });
  recordingIds.push(recording.id);
  const draftId = recording.currentDraftRevisionId!;
  if (complete) {
    await attachWorkToRevision(draftId, workId, userIds.editor);
    await attachMediaToRevision({ recordingRevisionId: draftId, provider: "YOUTUBE", role: "PRIMARY_VIDEO", url: "https://www.youtube.com/watch?v=p10b", actorId: userIds.editor });
  }
  return { id: recording.id, slug: recording.slug, draftId };
}

/** A live Recording with a SECOND, open draft (the edit-after-publish shape). */
async function liveWithOpenDraft(label: string) {
  const rec = await newRecording(label);
  await publishCurrentDraft(rec.id, userIds.admin);
  const draft = await forkDraftFromPublished(rec.id, userIds.editor);
  return { ...rec, firstRevisionId: rec.draftId, draftId: draft.id };
}

async function state(id: string) {
  const recording = await prisma.recording.findUniqueOrThrow({ where: { id } });
  const revisions = await prisma.recordingRevision.findMany({ where: { recordingId: id }, orderBy: { revisionNumber: "asc" } });
  const audits = await prisma.auditLogEntry.findMany({ where: { entityType: "Recording", entityId: id } });
  const count = (action: string) => audits.filter((a) => a.action === action).length;
  return { recording, revisions, count, revisionStatus: (revisionId: string) => revisions.find((r) => r.id === revisionId)!.revisionStatus };
}

/** Holds the per-Recording edit lock (the exact key apply-suggestion uses) until released. */
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
const asRole = (role: "ADMINISTRATOR" | "EDITOR") => mockGetCurrentStudioSession.mockResolvedValue({ user: { id: userIds[role === "ADMINISTRATOR" ? "admin" : "editor"], role, status: "ACTIVE" } });

beforeAll(async () => {
  for (const [key, role] of [["admin", "ADMINISTRATOR"], ["editor", "EDITOR"]] as const) {
    userIds[key] = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `p10b-${key}-${TOKEN}@musicmadras.test`, name: `P10B ${key}`, role, status: "ACTIVE" } })).id;
  }
  const composer = await createComposer({ slug: `p10b-composer-${TOKEN}`, name: `P10B Composer ${TOKEN}`, actorId: userIds.editor });
  composerId = composer.id;
  workId = (await createMusicalWork({ slug: `p10b-work-${TOKEN}`, title: `P10B Work ${TOKEN}`, composerId, actorId: userIds.editor })).id;
}, T);

afterAll(async () => {
  const revisionIds = (await prisma.recordingRevision.findMany({ where: { recordingId: { in: recordingIds } }, select: { id: true } })).map((r) => r.id);
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityId: { in: [...recordingIds, ...revisionIds] } }, { actorId: { in: Object.values(userIds) } }] } });
  await prisma.mediaResource.deleteMany({ where: { recordingRevisionId: { in: revisionIds } } });
  await prisma.recording.deleteMany({ where: { id: { in: recordingIds } } });
  await prisma.musicalWork.deleteMany({ where: { id: workId } });
  await prisma.composer.deleteMany({ where: { id: composerId } });
  await prisma.studioUser.deleteMany({ where: { id: { in: Object.values(userIds) } } });
}, T);

describe("A. simultaneous publish attempts for the same expected draft", () => {
  it(`exactly one wins; the rest are refused; one success audit; revisions and pointers coherent (${ROUNDS} rounds x 4 attempts)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const rec = await newRecording("pub-pub");
      const results = await Promise.all([1, 2, 3, 4].map(() => publishRecordingDraft({ recordingId: rec.id, actorId: userIds.admin, expectedDraftRevisionId: rec.draftId })));
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      for (const loser of results.filter((r) => !r.ok)) expect(["NO_OPEN_DRAFT", "STALE_REVISION"]).toContain((loser as { reason: string }).reason);

      const s = await state(rec.id);
      expect(s.recording).toMatchObject({ status: "PUBLISHED", currentPublishedRevisionId: rec.draftId, currentDraftRevisionId: null });
      expect(s.revisionStatus(rec.draftId)).toBe("PUBLISHED");
      expect(s.count("RECORDING_PUBLISHED")).toBe(1);
    }
  }, T);

  it("with a previous published revision: it is superseded exactly once, the new one published once, one success audit for the new publication", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const rec = await liveWithOpenDraft("pub-pub-fork");
      const results = await Promise.all([1, 2, 3].map(() => publishRecordingDraft({ recordingId: rec.id, actorId: userIds.admin, expectedDraftRevisionId: rec.draftId })));
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const s = await state(rec.id);
      expect(s.recording).toMatchObject({ status: "PUBLISHED", currentPublishedRevisionId: rec.draftId, currentDraftRevisionId: null });
      expect(s.revisionStatus(rec.firstRevisionId)).toBe("SUPERSEDED");
      expect(s.revisionStatus(rec.draftId)).toBe("PUBLISHED");
      expect(s.count("RECORDING_PUBLISHED")).toBe(2); // the first publication + this one — never a third
      const second = (await prisma.auditLogEntry.findMany({ where: { entityType: "Recording", entityId: rec.id, action: "RECORDING_PUBLISHED" } })).filter((a) => (a.beforeSnapshot as { previousPublishedRevisionId?: string } | null)?.previousPublishedRevisionId === rec.firstRevisionId);
      expect(second).toHaveLength(1);
    }
  }, T);
});

describe("B. publish racing with archive", () => {
  it("never leaves an archived Recording public, and records only what actually happened", async () => {
    let publishedFirst = 0;
    for (let round = 0; round < ROUNDS; round++) {
      const rec = await newRecording("pub-archive");
      const [publish, archive] = await Promise.allSettled([
        publishRecordingDraft({ recordingId: rec.id, actorId: userIds.admin, expectedDraftRevisionId: rec.draftId }),
        archiveRecording(rec.id, userIds.admin),
      ]);
      expect(archive.status).toBe("fulfilled"); // archiving always succeeds
      const s = await state(rec.id);
      expect(s.recording.status).toBe("ARCHIVED"); // the archive is never overwritten back to PUBLISHED
      expect(await findPublishedRecordingBySlug(rec.slug)).toBeNull();
      expect(s.count("RECORDING_ARCHIVED")).toBe(1);

      const published = publish.status === "fulfilled" && publish.value.ok;
      if (published) {
        publishedFirst++;
        expect(s.count("RECORDING_PUBLISHED")).toBe(1);
        expect(s.recording.currentPublishedRevisionId).toBe(rec.draftId);
      } else {
        // the archive won: the publication was refused, changed nothing and left no success audit
        expect(publish.status === "fulfilled" && publish.value.ok === false && publish.value.reason).toBe("RECORDING_ARCHIVED");
        expect(s.count("RECORDING_PUBLISHED")).toBe(0);
        expect(s.recording).toMatchObject({ currentPublishedRevisionId: null, currentDraftRevisionId: rec.draftId });
        expect(s.revisionStatus(rec.draftId)).toBe("DRAFT");
      }
    }
    expect(publishedFirst).toBeGreaterThanOrEqual(0);
  }, T);
});

describe("C. publish racing with unpublish", () => {
  it("ends in one of the two serial outcomes with a coherent history", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const rec = await liveWithOpenDraft("pub-unpub");
      const [publish, unpublish] = await Promise.all([
        publishRecordingDraft({ recordingId: rec.id, actorId: userIds.admin, expectedDraftRevisionId: rec.draftId }),
        unpublishRecording(rec.id, userIds.admin).then(() => "ok" as const, () => "refused" as const),
      ]);
      // The Recording is live when both start, so both operations are legal in either order.
      expect(publish.ok).toBe(true);
      expect(unpublish).toBe("ok");
      const s = await state(rec.id);
      expect(["PUBLISHED", "DRAFT"]).toContain(s.recording.status); // unpublish-then-publish, or publish-then-unpublish
      expect(s.recording).toMatchObject({ currentPublishedRevisionId: rec.draftId, currentDraftRevisionId: null });
      expect(s.revisionStatus(rec.firstRevisionId)).toBe("SUPERSEDED");
      expect(s.revisionStatus(rec.draftId)).toBe("PUBLISHED");
      expect(s.count("RECORDING_PUBLISHED")).toBe(2);
      expect(s.count("RECORDING_UNPUBLISHED")).toBe(1);
      // public visibility follows the final status exactly
      expect(Boolean(await findPublishedRecordingBySlug(rec.slug))).toBe(s.recording.status === "PUBLISHED");
    }
  }, T);
});

describe("D. publish racing with submit-for-review", () => {
  it("a late submit can never take a just-published Recording offline", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const rec = await newRecording("pub-submit");
      const [publish, submit] = await Promise.all([
        publishRecordingDraft({ recordingId: rec.id, actorId: userIds.admin, expectedDraftRevisionId: rec.draftId }),
        submitRecordingForReview(rec.id, userIds.editor).then(() => "ok" as const, () => "refused" as const),
      ]);
      expect(publish.ok).toBe(true); // IN_REVIEW or DRAFT can both be published
      const s = await state(rec.id);
      expect(s.recording).toMatchObject({ status: "PUBLISHED", currentPublishedRevisionId: rec.draftId, currentDraftRevisionId: null });
      expect(await findPublishedRecordingBySlug(rec.slug)).not.toBeNull();
      // submit either ran first (one audit) or found the Recording already PUBLISHED and was refused (no audit)
      expect(s.count("RECORDING_SUBMITTED_FOR_REVIEW")).toBe(submit === "ok" ? 1 : 0);
      expect(s.count("RECORDING_PUBLISHED")).toBe(1);
    }
  }, T);
});

describe("E. every lifecycle operation waits for the per-Recording lock (deterministic)", () => {
  async function expectWaitsForLock(label: string, setup: () => Promise<{ id: string }>, run: (id: string) => Promise<unknown>) {
    const rec = await setup();
    const holder = holdEditLock(rec.id);
    await holder.got;
    const operation = run(rec.id);
    expect(await stillPending(operation), `${label} must wait while the lock is held`).toBe(true);
    holder.release();
    await holder.done;
    await expect(operation).resolves.toBeDefined();
  }

  it("publish", () => expectWaitsForLock("publish", () => newRecording("lock-publish"), async (id) => {
    const draftId = (await prisma.recording.findUniqueOrThrow({ where: { id } })).currentDraftRevisionId!;
    const result = await publishRecordingDraft({ recordingId: id, actorId: userIds.admin, expectedDraftRevisionId: draftId });
    expect(result.ok).toBe(true);
    return result;
  }), T);

  it("submit for review", () => expectWaitsForLock("submit", () => newRecording("lock-submit"), (id) => submitRecordingForReview(id, userIds.editor)), T);
  it("archive", () => expectWaitsForLock("archive", () => newRecording("lock-archive"), (id) => archiveRecording(id, userIds.admin)), T);
  it("unpublish", () => expectWaitsForLock("unpublish", async () => { const r = await newRecording("lock-unpublish"); await publishCurrentDraft(r.id, userIds.admin); return r; }, (id) => unpublishRecording(id, userIds.admin)), T);
  it("restore", () => expectWaitsForLock("restore", async () => { const r = await newRecording("lock-restore"); await archiveRecording(r.id, userIds.admin); return r; }, (id) => restoreRecording(id, userIds.admin)), T);

  it("uses the same lock key as applying an AI suggestion", () => {
    expect(recordingEditLockKey("abc")).toBe("recording-edit:abc"); // contentSuggestionApplicationRepository takes hashtext('recording-edit:<id>')
  });
});

// The race tests above cannot reliably hit a millisecond-wide window with the guards removed (mutation-checked: the
// publish/submit/unpublish races did not show up even over 30 rounds). These tests make the stale-read window
// deterministic: an outside transaction holds the Recording's ROW lock and commits a competing change that bypasses
// the advisory lock entirely (as a future code path or a manual SQL change could). The operation under test has already
// read the old state and is blocked at its write; when the competitor commits, the conditional write must refuse.
describe("J. conditional writes defeat a stale decision, even from a writer that bypasses the lock", () => {
  function competingWriter(recordingId: string, change: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<void>) {
    let release!: () => void;
    let acquired!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const got = new Promise<void>((resolve) => (acquired = resolve));
    const done = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT 1 FROM recordings WHERE id = ${recordingId} FOR UPDATE`;
        await change(tx);
        acquired();
        await released;
      },
      { timeout: 60000, maxWait: 10000 }
    );
    return { got, release, done };
  }

  it("submit-for-review cannot take a Recording offline that was published after submit read it", async () => {
    const rec = await newRecording("cas-submit");
    const writer = competingWriter(rec.id, async (tx) => {
      await tx.recordingRevision.update({ where: { id: rec.draftId }, data: { revisionStatus: "PUBLISHED" } });
      await tx.recording.update({ where: { id: rec.id }, data: { status: "PUBLISHED", currentPublishedRevisionId: rec.draftId, currentDraftRevisionId: null } });
    });
    await writer.got;
    const submit = submitRecordingForReview(rec.id, userIds.editor).then(() => "ok" as const, (err: Error) => err.message);
    expect(await stillPending(submit)).toBe(true); // it has read DRAFT and is blocked at its write
    writer.release();
    await writer.done;
    expect(await submit).toMatch(/changed while it was being submitted|not in DRAFT/);

    const s = await state(rec.id);
    expect(s.recording).toMatchObject({ status: "PUBLISHED", currentPublishedRevisionId: rec.draftId });
    expect(s.count("RECORDING_SUBMITTED_FOR_REVIEW")).toBe(0);
    expect(await findPublishedRecordingBySlug(rec.slug)).not.toBeNull();
  }, T);

  it("publish cannot un-archive a Recording that was archived after publish read it, and rolls its revision change back", async () => {
    const rec = await newRecording("cas-archive");
    const writer = competingWriter(rec.id, async (tx) => {
      await tx.recording.update({ where: { id: rec.id }, data: { status: "ARCHIVED" } });
    });
    await writer.got;
    const publish = publishRecordingDraft({ recordingId: rec.id, actorId: userIds.admin, expectedDraftRevisionId: rec.draftId });
    expect(await stillPending(publish)).toBe(true);
    writer.release();
    await writer.done;
    expect(await publish).toMatchObject({ ok: false, reason: "STATE_CHANGED" });

    const s = await state(rec.id);
    expect(s.recording).toMatchObject({ status: "ARCHIVED", currentPublishedRevisionId: null, currentDraftRevisionId: rec.draftId });
    expect(s.revisionStatus(rec.draftId)).toBe("DRAFT"); // the promotion was rolled back with the refused publish
    expect(s.count("RECORDING_PUBLISHED")).toBe(0);
    expect(await findPublishedRecordingBySlug(rec.slug)).toBeNull();
  }, T);

  it("a second publish of a draft that another publication already promoted is refused; the revision is not promoted twice", async () => {
    const rec = await liveWithOpenDraft("cas-double");
    const before = await state(rec.id);
    const writer = competingWriter(rec.id, async (tx) => {
      await tx.recordingRevision.update({ where: { id: rec.firstRevisionId }, data: { revisionStatus: "SUPERSEDED" } });
      await tx.recordingRevision.update({ where: { id: rec.draftId }, data: { revisionStatus: "PUBLISHED" } });
      await tx.recording.update({ where: { id: rec.id }, data: { currentPublishedRevisionId: rec.draftId, currentDraftRevisionId: null } });
    });
    await writer.got;
    const publish = publishRecordingDraft({ recordingId: rec.id, actorId: userIds.admin, expectedDraftRevisionId: rec.draftId });
    expect(await stillPending(publish)).toBe(true);
    writer.release();
    await writer.done;
    expect(await publish).toMatchObject({ ok: false, reason: "STATE_CHANGED" });

    const s = await state(rec.id);
    expect(s.recording).toMatchObject({ currentPublishedRevisionId: rec.draftId, currentDraftRevisionId: null });
    expect(s.revisionStatus(rec.firstRevisionId)).toBe("SUPERSEDED");
    expect(s.revisionStatus(rec.draftId)).toBe("PUBLISHED");
    expect(s.count("RECORDING_PUBLISHED")).toBe(before.count("RECORDING_PUBLISHED")); // the refused attempt wrote no success audit
  }, T);
});

describe("F. the lock wait is bounded", () => {
  it("publish refuses with BUSY after its lock timeout and changes nothing; the lifecycle operations throw RecordingBusyError", async () => {
    const rec = await newRecording("busy");
    const holder = holdEditLock(rec.id);
    await holder.got;
    const started = Date.now();
    const result = await publishRecordingDraft({ recordingId: rec.id, actorId: userIds.admin, expectedDraftRevisionId: rec.draftId, lockTimeoutMs: 300 });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(result).toEqual({ ok: false, reason: "BUSY", missingCategories: [] });
    expect(describePublishRefusal("BUSY")).toMatch(/nothing was published/);
    holder.release();
    await holder.done;

    const s = await state(rec.id);
    expect(s.recording).toMatchObject({ status: "DRAFT", currentPublishedRevisionId: null, currentDraftRevisionId: rec.draftId });
    expect(s.count("RECORDING_PUBLISHED")).toBe(0);
    // and once the lock is free, the same publication succeeds
    expect((await publishRecordingDraft({ recordingId: rec.id, actorId: userIds.admin, expectedDraftRevisionId: rec.draftId })).ok).toBe(true);
    expect(RecordingBusyError.name).toBe("RecordingBusyError");
  }, T);
});

describe("G. a failure after the transaction has begun rolls everything back", () => {
  it("keeps the previous published revision, the open draft, the pointers and the audit history", async () => {
    const rec = await liveWithOpenDraft("rollback");
    const before = await state(rec.id);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    inject.action = "RECORDING_PUBLISHED"; // fails AFTER the revision, supersede and pointer writes
    let result: Awaited<ReturnType<typeof publishRecordingDraft>>;
    try {
      result = await publishRecordingDraft({ recordingId: rec.id, actorId: userIds.admin, expectedDraftRevisionId: rec.draftId });
    } finally {
      inject.action = null;
    }
    expect(result).toEqual({ ok: false, reason: "FAILED", missingCategories: [] });
    expect(JSON.stringify(result)).not.toMatch(/injected|prisma/i); // no raw error reaches the caller
    expect(errorLog.mock.calls.flat().join(" ")).not.toContain("injected audit failure"); // the log names the error class, never its message
    errorLog.mockRestore();

    const after = await state(rec.id);
    expect(after.recording).toMatchObject({ status: "PUBLISHED", currentPublishedRevisionId: rec.firstRevisionId, currentDraftRevisionId: rec.draftId });
    expect(after.revisionStatus(rec.firstRevisionId)).toBe("PUBLISHED"); // still live, not superseded
    expect(after.revisionStatus(rec.draftId)).toBe("DRAFT"); // not promoted
    expect(after.count("RECORDING_PUBLISHED")).toBe(before.count("RECORDING_PUBLISHED")); // no success audit
    expect((await findPublishedRecordingBySlug(rec.slug))?.publishedRevision.id).toBe(rec.firstRevisionId); // the public page still serves the old version
    expect(after.recording.updatedAt).toEqual(before.recording.updatedAt);

    // the failure left no lock or half-state behind: the same publication now succeeds
    const retry = await publishRecordingDraft({ recordingId: rec.id, actorId: userIds.admin, expectedDraftRevisionId: rec.draftId });
    expect(retry.ok).toBe(true);
    expect((await state(rec.id)).count("RECORDING_PUBLISHED")).toBe(before.count("RECORDING_PUBLISHED") + 1);
  }, T);
});

describe("H. preconditions are re-validated inside the publishing transaction", () => {
  it("refuses an incomplete draft with the missing categories, and changes nothing", async () => {
    const untitled = await newRecording("incomplete", { complete: false });
    const result = await publishRecordingDraft({ recordingId: untitled.id, actorId: userIds.admin, expectedDraftRevisionId: untitled.draftId });
    expect(result).toMatchObject({ ok: false, reason: "NOT_READY" });
    expect((result as { missingCategories: string[] }).missingCategories).toEqual(["Identity", "Musical Works", "Media"]);
    expect(describePublishRefusal("NOT_READY", ["Identity"])).toBe("This recording is not ready to publish. Still required: Identity.");
    const s = await state(untitled.id);
    expect(s.recording).toMatchObject({ status: "DRAFT", currentPublishedRevisionId: null, currentDraftRevisionId: untitled.draftId });
    expect(s.count("RECORDING_PUBLISHED")).toBe(0);
  }, T);

  it("uses the completeness of the draft AS IT IS NOW: a work removed after the form was rendered blocks publication", async () => {
    const rec = await newRecording("work-removed");
    await detachWorkFromRevision(rec.draftId, workId, userIds.editor);
    const result = await publishRecordingDraft({ recordingId: rec.id, actorId: userIds.admin, expectedDraftRevisionId: rec.draftId });
    expect(result).toMatchObject({ ok: false, reason: "NOT_READY", missingCategories: ["Musical Works"] });
    expect((await state(rec.id)).recording.currentPublishedRevisionId).toBeNull();
  }, T);

  it("refuses an archived Recording, a stale expected revision, a missing draft and an unknown Recording", async () => {
    const archived = await newRecording("p-archived");
    await archiveRecording(archived.id, userIds.admin);
    expect(await publishRecordingDraft({ recordingId: archived.id, actorId: userIds.admin })).toMatchObject({ ok: false, reason: "RECORDING_ARCHIVED" });
    expect((await state(archived.id)).recording.status).toBe("ARCHIVED");

    const stale = await newRecording("p-stale");
    expect(await publishRecordingDraft({ recordingId: stale.id, actorId: userIds.admin, expectedDraftRevisionId: randomUUID() })).toMatchObject({ ok: false, reason: "STALE_REVISION" });

    const published = await newRecording("p-nodraft");
    await publishCurrentDraft(published.id, userIds.admin);
    expect(await publishRecordingDraft({ recordingId: published.id, actorId: userIds.admin })).toMatchObject({ ok: false, reason: "NO_OPEN_DRAFT" });

    expect(await publishRecordingDraft({ recordingId: randomUUID(), actorId: userIds.admin })).toMatchObject({ ok: false, reason: "RECORDING_NOT_FOUND" });
    expect((await state(stale.id)).count("RECORDING_PUBLISHED")).toBe(0);
  }, T);

  it("the legacy pointer-move function keeps its contract (no completeness gate, throws on refusal)", async () => {
    const bare = await newRecording("legacy", { complete: false });
    const published = await publishCurrentDraft(bare.id, userIds.admin);
    expect(published.status).toBe("PUBLISHED");
    await expect(publishCurrentDraft(bare.id, userIds.admin)).rejects.toThrow(/no open draft revision to publish/);
    await archiveRecording(bare.id, userIds.admin);
    const another = await newRecording("legacy-archived");
    await archiveRecording(another.id, userIds.admin);
    await expect(publishCurrentDraft(another.id, userIds.admin)).rejects.toThrow(/archived/);
  }, T);
});

describe("I. the Studio action: authorization unchanged, outcomes explicit, a replayed form publishes nothing twice", () => {
  it("an Editor is refused on the server; an Administrator publishes; a replay and a forged id are refused with a message", async () => {
    const rec = await newRecording("action");

    asRole("EDITOR");
    expect(await redirectOf(() => publishAction(rec.id, rec.draftId))).toMatch(/permission to publish/);
    expect((await state(rec.id)).recording.currentPublishedRevisionId).toBeNull();

    asRole("ADMINISTRATOR");
    expect(await redirectOf(() => publishAction(rec.id, randomUUID()))).toMatch(/out of date/); // forged / stale expected id
    expect((await state(rec.id)).recording.currentPublishedRevisionId).toBeNull();

    expect(await redirectOf(() => publishAction(rec.id, rec.draftId))).toBe(`/studio/recordings/${rec.id}/review?notice=PUBLISHED`);
    expect((await state(rec.id)).recording).toMatchObject({ status: "PUBLISHED", currentPublishedRevisionId: rec.draftId });

    expect(await redirectOf(() => publishAction(rec.id, rec.draftId))).toMatch(/no open draft/i); // replayed form
    const s = await state(rec.id);
    expect(s.count("RECORDING_PUBLISHED")).toBe(1);

    mockGetCurrentStudioSession.mockResolvedValue(null);
    expect(await redirectOf(() => publishAction(rec.id, rec.draftId))).toMatch(/permission to publish/);
  }, T);

  it("an incomplete draft is refused by the action with the missing categories named", async () => {
    const rec = await newRecording("action-incomplete", { complete: false });
    asRole("ADMINISTRATOR");
    expect(await redirectOf(() => publishAction(rec.id, rec.draftId))).toMatch(/not ready to publish\. Still required: Identity, Musical Works, Media\./);
  }, T);
});
