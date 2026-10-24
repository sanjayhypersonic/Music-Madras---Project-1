import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

// Must be at the true top level — vi.mock is hoisted above every import.
const mockGetCurrentStudioSession = vi.fn();
vi.mock("../../modules/auth/authService", () => ({ getCurrentStudioSession: () => mockGetCurrentStudioSession() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { prisma } from "../../modules/db/client";
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import { attachMediaToRevision } from "../../modules/db/repositories/mediaResourceRepository";
import { attachWorkToRevision, createDraftRecording, findPublishedRecordingBySlug, forkDraftFromPublished, updateDraftRevisionContent } from "../../modules/db/repositories/recordingRepository";
import { archiveAction, publishAction, restoreAction, submitForReviewAction, unpublishAction } from "../../app/(studio)/studio/(protected)/recordings/[id]/review/actions";

// Launch workflow: the Review & Publish lifecycle, role by role, through the real server actions against the isolated test database. Each role may do exactly
// what the policy gives it; a refusal changes nothing and writes no audit entry; a success redirects with a fixed notice CODE; the public Museum follows
// publication only (a draft edit never reaches it); an invalid transition is refused safely. Synthetic fixtures, removed afterwards.

const T = 120000;
const TOKEN = randomUUID().slice(0, 8);
const ROLES = { contributor: "CONTRIBUTOR", editor: "EDITOR", reviewer: "REVIEWER", admin: "ADMINISTRATOR" } as const;
type Who = keyof typeof ROLES;
const userIds = {} as Record<Who, string>;
const recordingIds: string[] = [];
let workId: string;
let composerId: string;

const as = (who: Who) => mockGetCurrentStudioSession.mockResolvedValue({ user: { id: userIds[who], role: ROLES[who], status: "ACTIVE" } });

async function newRecording(label: string, options: { complete?: boolean } = {}) {
  const complete = options.complete !== false;
  const recording = await createDraftRecording({ slug: `rlr-${label}-${TOKEN}-${randomUUID().slice(0, 6)}`, actorId: userIds.contributor, title: complete ? `Lifecycle ${label} ${TOKEN}` : undefined });
  recordingIds.push(recording.id);
  const draftId = recording.currentDraftRevisionId!;
  if (complete) {
    await attachWorkToRevision(draftId, workId, userIds.editor);
    await attachMediaToRevision({ recordingRevisionId: draftId, provider: "YOUTUBE", role: "PRIMARY_VIDEO", url: `https://www.youtube.com/watch?v=rlr${label}`, actorId: userIds.editor });
  }
  return { id: recording.id, slug: recording.slug, draftId };
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

const snapshot = async (id: string) => {
  const r = await prisma.recording.findUniqueOrThrow({ where: { id } });
  const audits = await prisma.auditLogEntry.findMany({ where: { entityType: "Recording", entityId: id } });
  return { status: r.status, draft: r.currentDraftRevisionId, published: r.currentPublishedRevisionId, audits: audits.map((a) => a.action).sort() };
};
const isPublic = async (slug: string) => (await findPublishedRecordingBySlug(slug)) !== null;

beforeAll(async () => {
  for (const who of Object.keys(ROLES) as Who[]) {
    userIds[who] = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `rlr-${who}-${TOKEN}@musicmadras.test`, name: `RLR ${who}`, role: ROLES[who], status: "ACTIVE" } })).id;
  }
  composerId = (await createComposer({ slug: `rlr-composer-${TOKEN}`, name: `RLR Composer ${TOKEN}`, actorId: userIds.editor })).id;
  workId = (await createMusicalWork({ slug: `rlr-work-${TOKEN}`, title: `RLR Work ${TOKEN}`, composerId, actorId: userIds.editor })).id;
}, T);

afterAll(async () => {
  const revisionIds = (await prisma.recordingRevision.findMany({ where: { recordingId: { in: recordingIds } }, select: { id: true } })).map((r) => r.id);
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityId: { in: [...recordingIds, ...revisionIds] } }, { actorId: { in: Object.values(userIds) } }] } });
  await prisma.mediaResource.deleteMany({ where: { recordingRevisionId: { in: revisionIds } } });
  await prisma.recording.updateMany({ where: { id: { in: recordingIds } }, data: { currentDraftRevisionId: null, currentPublishedRevisionId: null } });
  await prisma.recording.deleteMany({ where: { id: { in: recordingIds } } });
  await prisma.musicalWork.deleteMany({ where: { id: workId } });
  await prisma.composer.deleteMany({ where: { id: composerId } });
  await prisma.studioUser.deleteMany({ where: { id: { in: Object.values(userIds) } } });
}, T);

describe("the role matrix on a complete draft", () => {
  it("a Contributor can neither submit nor publish; nothing changes and nothing is audited by the refusal", async () => {
    const rec = await newRecording("contrib");
    const before = await snapshot(rec.id);
    as("contributor");
    expect(await redirectOf(() => submitForReviewAction(rec.id))).toContain("You do not have permission to submit for review.");
    expect(await redirectOf(() => publishAction(rec.id, rec.draftId))).toContain("You do not have permission to publish.");
    expect(await snapshot(rec.id)).toEqual(before);
    expect(await isPublic(rec.slug)).toBe(false);
  });

  it("an Editor and a Reviewer can submit (with the success notice and one audit entry) but cannot publish; the draft stays non-public", async () => {
    for (const who of ["editor", "reviewer"] as const) {
      const rec = await newRecording(`submit-${who}`);
      as(who);
      expect(await redirectOf(() => submitForReviewAction(rec.id))).toBe(`/studio/recordings/${rec.id}/review?notice=SUBMITTED`);
      let s = await snapshot(rec.id);
      expect(s.status).toBe("IN_REVIEW");
      expect(s.audits.filter((a) => a === "RECORDING_SUBMITTED_FOR_REVIEW")).toHaveLength(1);

      expect(await redirectOf(() => publishAction(rec.id, rec.draftId))).toContain("You do not have permission to publish.");
      s = await snapshot(rec.id);
      expect(s.status).toBe("IN_REVIEW");
      expect(s.published).toBeNull();
      expect(s.audits).not.toContain("RECORDING_PUBLISHED");
      expect(await isPublic(rec.slug)).toBe(false);
    }
  });

  it("submitting again, once it is in review, is refused as a changed status; no second audit entry", async () => {
    const rec = await newRecording("resubmit");
    as("editor");
    await redirectOf(() => submitForReviewAction(rec.id));
    const message = await redirectOf(() => submitForReviewAction(rec.id));
    expect(message).toContain("can no longer be submitted for review");
    expect(message).not.toContain("notice=");
    expect((await snapshot(rec.id)).audits.filter((a) => a === "RECORDING_SUBMITTED_FOR_REVIEW")).toHaveLength(1);
  });

  it("only an Administrator publishes; the published version is then public, with one audit entry", async () => {
    const rec = await newRecording("admin");
    as("editor");
    await redirectOf(() => submitForReviewAction(rec.id));
    as("admin");
    expect(await redirectOf(() => publishAction(rec.id, rec.draftId))).toBe(`/studio/recordings/${rec.id}/review?notice=PUBLISHED`);
    const s = await snapshot(rec.id);
    expect(s).toMatchObject({ status: "PUBLISHED", draft: null, published: rec.draftId });
    expect(s.audits.filter((a) => a === "RECORDING_PUBLISHED")).toHaveLength(1);
    expect(await isPublic(rec.slug)).toBe(true);
  });
});

describe("publication gate and invalid transitions", () => {
  it("an incomplete draft is refused with what is still required, and stays non-public", async () => {
    const rec = await newRecording("incomplete", { complete: false });
    as("admin");
    const message = await redirectOf(() => publishAction(rec.id, rec.draftId));
    expect(message).toContain("not ready to publish");
    expect(message).toContain("Still required:");
    expect(message).not.toContain("notice=");
    const s = await snapshot(rec.id);
    expect(s).toMatchObject({ status: "DRAFT", published: null });
    expect(s.audits).not.toContain("RECORDING_PUBLISHED");
    expect(await isPublic(rec.slug)).toBe(false);
  });

  it("a stale expected draft is refused, and a restore of a recording that is not archived is refused", async () => {
    const rec = await newRecording("stale");
    as("admin");
    expect(await redirectOf(() => publishAction(rec.id, randomUUID()))).not.toContain("notice=");
    expect((await snapshot(rec.id)).status).toBe("DRAFT");
    expect(await redirectOf(() => restoreAction(rec.id))).toContain("is not archived");
    expect(await redirectOf(() => unpublishAction(rec.id))).toContain("is not published");
  });
});

describe("a published recording: edits stay private until published; unpublish and archive follow the permission", () => {
  it("a draft edit after publication never reaches the public version", async () => {
    const rec = await newRecording("edit");
    as("admin");
    await redirectOf(() => publishAction(rec.id, rec.draftId));
    const live = (await findPublishedRecordingBySlug(rec.slug))!;
    const publishedTitle = live.publishedRevision.title;

    const draft = await forkDraftFromPublished(rec.id, userIds.contributor);
    await updateDraftRevisionContent(rec.id, draft.updatedAt, userIds.contributor, { title: `Changed in draft ${TOKEN}` });
    const after = (await findPublishedRecordingBySlug(rec.slug))!;
    expect(after.publishedRevision.id).toBe(live.publishedRevision.id);
    expect(after.publishedRevision.title).toBe(publishedTitle);
    expect((await snapshot(rec.id)).status).toBe("PUBLISHED");

    // The new draft only replaces the public version when an Administrator publishes it.
    as("editor");
    expect(await redirectOf(() => publishAction(rec.id, draft.id))).toContain("You do not have permission to publish.");
    expect((await findPublishedRecordingBySlug(rec.slug))!.publishedRevision.title).toBe(publishedTitle);
    as("admin");
    expect(await redirectOf(() => publishAction(rec.id, draft.id))).toContain("notice=PUBLISHED");
    expect((await findPublishedRecordingBySlug(rec.slug))!.publishedRevision.title).toBe(`Changed in draft ${TOKEN}`);
  });

  it("unpublish: denied for Editor (still public); allowed for Administrator (not public, audited); then archive and restore are permission-checked", async () => {
    const rec = await newRecording("unpub");
    as("admin");
    await redirectOf(() => publishAction(rec.id, rec.draftId));
    as("editor");
    expect(await redirectOf(() => unpublishAction(rec.id))).toContain("You do not have permission to unpublish.");
    expect(await redirectOf(() => archiveAction(rec.id))).toContain("You do not have permission to archive.");
    expect(await isPublic(rec.slug)).toBe(true);

    as("admin");
    expect(await redirectOf(() => unpublishAction(rec.id))).toBe(`/studio/recordings/${rec.id}/review?notice=UNPUBLISHED`);
    expect(await isPublic(rec.slug)).toBe(false);
    expect((await snapshot(rec.id)).audits).toContain("RECORDING_UNPUBLISHED");

    expect(await redirectOf(() => archiveAction(rec.id))).toBe("/studio/recordings");
    expect((await snapshot(rec.id)).status).toBe("ARCHIVED");
    as("editor");
    expect(await redirectOf(() => restoreAction(rec.id))).toContain("You do not have permission to restore.");
    as("admin");
    expect(await redirectOf(() => restoreAction(rec.id))).toBe(`/studio/recordings/${rec.id}/review?notice=RESTORED`);
    expect(await isPublic(rec.slug)).toBe(false);
  });

  it("with no session, every lifecycle action is refused", async () => {
    const rec = await newRecording("nosession");
    mockGetCurrentStudioSession.mockResolvedValue(null);
    for (const run of [() => submitForReviewAction(rec.id), () => publishAction(rec.id, rec.draftId), () => unpublishAction(rec.id), () => archiveAction(rec.id), () => restoreAction(rec.id)]) {
      expect(await redirectOf(run)).toContain("You do not have permission");
    }
    expect((await snapshot(rec.id)).status).toBe("DRAFT");
  });
});
