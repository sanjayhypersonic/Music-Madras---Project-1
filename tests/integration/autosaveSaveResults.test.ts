import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

// Must be at the true top level — vi.mock is hoisted above every import.
const mockGetCurrentStudioSession = vi.fn();
vi.mock("../../modules/auth/authService", () => ({
  getCurrentStudioSession: () => mockGetCurrentStudioSession(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { prisma } from "../../modules/db/client";
import { archiveRecording, createDraftRecording, forkDraftFromPublished, publishCurrentDraft } from "../../modules/db/repositories/recordingRepository";
import { saveSourceStep } from "../../app/(studio)/studio/(protected)/recordings/[id]/source/actions";
import { saveSeoStep } from "../../app/(studio)/studio/(protected)/recordings/[id]/seo/actions";
import { saveEducationalStep } from "../../app/(studio)/studio/(protected)/recordings/[id]/educational/actions";
import type { AutosaveSaveResult } from "../../modules/studio/autosave/autosaveTypes";

// Phase 6J-10E — the Studio autosave Server Actions report WHY a save was refused (a kind the client controller acts
// on), never a raw error, and never write through a refusal. The client lifecycle itself is tested in
// tests/unit/autosaveController.test.ts; this proves the server half of the contract against the real repository.

const T = 120000;
const TOKEN = randomUUID().slice(0, 8);
const userIds = {} as { admin: string; editor: string };
const recordingIds: string[] = [];

const STEPS = [
  { name: "source", save: saveSourceStep, patch: { title: "New title", description: "New description" } as Record<string, string>, field: "title" as const, expected: "New title" },
  { name: "seo", save: saveSeoStep, patch: { seoMetaTitle: "SEO title", seoMetaDescription: "", seoCanonicalPath: "" } as Record<string, string>, field: "seoMetaTitle" as const, expected: "SEO title" },
  { name: "educational", save: saveEducationalStep, patch: { educationalDifficultyLevel: "Easy", educationalListeningGuide: "", educationalAnalysis: "" } as Record<string, string>, field: "educationalDifficultyLevel" as const, expected: "Easy" },
];

async function newDraft(label: string) {
  const recording = await createDraftRecording({ slug: `e10-${label}-${TOKEN}-${randomUUID().slice(0, 6)}`, actorId: userIds.editor, title: `E10 ${label}` });
  recordingIds.push(recording.id);
  const revision = await prisma.recordingRevision.findUniqueOrThrow({ where: { id: recording.currentDraftRevisionId! } });
  return { id: recording.id, revisionId: revision.id, token: revision.updatedAt.toISOString() };
}

const asEditor = () => mockGetCurrentStudioSession.mockResolvedValue({ user: { id: userIds.editor, role: "EDITOR", status: "ACTIVE" } });
const row = (id: string) => prisma.recordingRevision.findUniqueOrThrow({ where: { id } });

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

beforeAll(async () => {
  for (const [key, role] of [["admin", "ADMINISTRATOR"], ["editor", "EDITOR"]] as const) {
    userIds[key] = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `e10-${key}-${TOKEN}@musicmadras.test`, name: `E10 ${key}`, role, status: "ACTIVE" } })).id;
  }
}, T);

afterAll(async () => {
  const revisionIds = (await prisma.recordingRevision.findMany({ where: { recordingId: { in: recordingIds } }, select: { id: true } })).map((r) => r.id);
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityId: { in: [...recordingIds, ...revisionIds] } }, { actorId: { in: Object.values(userIds) } }] } });
  await prisma.recording.deleteMany({ where: { id: { in: recordingIds } } });
  await prisma.studioUser.deleteMany({ where: { id: { in: Object.values(userIds) } } });
}, T);

function expectSafe(result: AutosaveSaveResult) {
  if (!result.ok) expect(result.error).not.toMatch(/prisma|invocation|constraint|sql|stack/i);
}

for (const step of STEPS) {
  describe(`${step.name} step autosave action`, () => {
    it("success returns the new token, which is the ONLY token the next save may use", async () => {
      asEditor();
      const rec = await newDraft(`${step.name}-ok`);
      const first = await step.save(rec.revisionId, rec.id, rec.token, step.patch);
      expect(first.ok).toBe(true);
      const token1 = (first as { updatedAt: string }).updatedAt;
      expect(new Date(token1).getTime()).toBeGreaterThan(new Date(rec.token).getTime());
      expect((await row(rec.revisionId)).updatedAt.toISOString()).toBe(token1);
      expect((await row(rec.revisionId))[step.field]).toBe(step.expected);

      const second = await step.save(rec.revisionId, rec.id, token1, { ...step.patch, [Object.keys(step.patch)[0]]: "Second" });
      expect(second.ok).toBe(true);
      expect(new Date((second as { updatedAt: string }).updatedAt).getTime()).toBeGreaterThan(new Date(token1).getTime());
    }, T);

    it("a stale token is CONFLICT and writes nothing (the editor's text stays client-side)", async () => {
      asEditor();
      const rec = await newDraft(`${step.name}-stale`);
      await step.save(rec.revisionId, rec.id, rec.token, step.patch); // someone else saved
      const before = await row(rec.revisionId);
      const result = await step.save(rec.revisionId, rec.id, rec.token, { ...step.patch, [Object.keys(step.patch)[0]]: "OVERWRITE" });
      expect(result).toMatchObject({ ok: false, kind: "CONFLICT" });
      expectSafe(result);
      const after = await row(rec.revisionId);
      expect(after[step.field]).toBe(step.expected);
      expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    }, T);

    it("a draft that was published and replaced while the form was open is CONFLICT; the new draft is not written", async () => {
      asEditor();
      const rec = await newDraft(`${step.name}-replaced`);
      await publishCurrentDraft(rec.id, userIds.admin);
      const newDraftRevision = await forkDraftFromPublished(rec.id, userIds.editor);
      const before = await row(newDraftRevision.id);
      const result = await step.save(rec.revisionId, rec.id, before.updatedAt.toISOString(), step.patch); // old revision id, new draft's token
      expect(result).toMatchObject({ ok: false, kind: "CONFLICT" });
      expect((await row(newDraftRevision.id))[step.field]).toBe(before[step.field]);
      expect((await row(rec.revisionId))[step.field]).not.toBe(step.expected); // the published revision was not written
    }, T);

    it("an archived Recording and a Recording with no open draft are NOT_EDITABLE", async () => {
      asEditor();
      const archived = await newDraft(`${step.name}-archived`);
      await archiveRecording(archived.id, userIds.admin);
      const a = await step.save(archived.revisionId, archived.id, archived.token, step.patch);
      expect(a).toMatchObject({ ok: false, kind: "NOT_EDITABLE" });
      expectSafe(a);

      const published = await newDraft(`${step.name}-published`);
      await publishCurrentDraft(published.id, userIds.admin);
      const b = await step.save(published.revisionId, published.id, published.token, step.patch);
      expect(b).toMatchObject({ ok: false, kind: "NOT_EDITABLE" });
      expect((await row(published.revisionId))[step.field]).not.toBe(step.expected);
    }, T);

    it("no session / no permission is FORBIDDEN and writes nothing", async () => {
      const rec = await newDraft(`${step.name}-forbidden`);
      mockGetCurrentStudioSession.mockResolvedValue(null);
      const result = await step.save(rec.revisionId, rec.id, rec.token, step.patch);
      expect(result).toMatchObject({ ok: false, kind: "FORBIDDEN" });
      expect((await row(rec.revisionId)).updatedAt.toISOString()).toBe(rec.token);
    }, T);
  });
}

describe("busy Recording", () => {
  it("is reported as BUSY (retry later) after the bounded wait, and writes nothing", async () => {
    asEditor();
    const rec = await newDraft("busy");
    const holder = holdEditLock(rec.id);
    await holder.got;
    let result: AutosaveSaveResult;
    try {
      result = await saveSourceStep(rec.revisionId, rec.id, rec.token, { title: "while busy", description: "" });
    } finally {
      holder.release();
      await holder.done;
    }
    expect(result).toMatchObject({ ok: false, kind: "BUSY" });
    expectSafe(result);
    expect((await row(rec.revisionId)).updatedAt.toISOString()).toBe(rec.token);
    // and once the Recording is free the same save, with the same token, succeeds
    expect((await saveSourceStep(rec.revisionId, rec.id, rec.token, { title: "after busy", description: "" })).ok).toBe(true);
  }, T);
});
