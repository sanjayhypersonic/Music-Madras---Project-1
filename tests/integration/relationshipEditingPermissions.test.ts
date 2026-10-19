import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

// Must be at the true top level — vi.mock is hoisted above every import.
const mockGetCurrentStudioSession = vi.fn();
vi.mock("../../modules/auth/authService", () => ({
  getCurrentStudioSession: () => mockGetCurrentStudioSession(),
}));

import { prisma } from "../../modules/db/client";
import { can } from "../../modules/auth/policy";
import { createCollection, publishCollection } from "../../modules/db/repositories/collectionRepository";
import { createDraftRecording, publishCurrentDraft } from "../../modules/db/repositories/recordingRepository";
import { createOccasion } from "../../modules/db/repositories/occasionRepository";
import { createRightsInformation } from "../../modules/db/repositories/rightsInformationRepository";
import { createSource } from "../../modules/db/repositories/sourceRepository";
import {
  addToCollectionAction,
  attachOccasionAction,
  attachRightsAction,
  attachSourceAction,
  detachOccasionAction,
  detachRightsAction,
  detachSourceAction,
} from "../../app/(studio)/studio/(protected)/recordings/[id]/relationships/actions";
import { addRecordingAction, moveRecordingAction, removeRecordingAction } from "../../app/(studio)/studio/(protected)/catalogue/collections/[id]/actions";

// Phase 6J-12 — who may edit a Recording's relationships TODAY, pinned so that the cutover cannot change it by accident.
//
// Decision A (permission): every mutation in the Relationships step is guarded by CATALOGUE_WRITE (Editor, Reviewer,
// Administrator, Super Administrator, Founder), NOT by RECORDING_WRITE (which a Contributor also holds). The revision-scoped
// Source / Rights / Occasion writers that replace the legacy ones must keep CATALOGUE_WRITE.
//
// Decision B (Collection membership): the entry points below are the only mutation paths. They are guarded by
// CATALOGUE_WRITE only, whatever the publication state of the Recording or the Collection, INCLUDING the combination that is
// visible to visitors immediately (published Collection + published Recording). Those characterisation tests describe the
// CURRENT behaviour; whether live membership changes should additionally need RECORDING_PUBLISH is an open product decision
// (docs/recording-publication-safety.md, section 13). If that decision is taken, the "live" expectations below are the ones to change.

const TAG = "phase6j12perm";
const TOKEN = randomUUID().slice(0, 8);
const T = 120000;

type Role = "CONTRIBUTOR" | "EDITOR" | "ADMINISTRATOR";
const userIds = {} as Record<Role, string>;
const recordingIds: string[] = [];
const collectionIds: string[] = [];
const rec = {} as Record<"draft" | "published", string>;
const col = {} as Record<"draft" | "published", string>;
let sourceId: string;
let rightsId: string;
let occasionId: string;

function as(role: Role) {
  mockGetCurrentStudioSession.mockResolvedValue({ user: { id: userIds[role], role, name: role, email: `${role}@example.test`, status: "ACTIVE" } });
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
const form = (name: string, value: string) => {
  const data = new FormData();
  data.set(name, value);
  return data;
};

async function counts() {
  return {
    memberships: await prisma.collectionRecording.count({ where: { collectionId: { in: collectionIds } } }),
    sources: await prisma.entitySource.count({ where: { entityId: { in: recordingIds } } }),
    rights: await prisma.entityRights.count({ where: { entityId: { in: recordingIds } } }),
    occasions: await prisma.entityOccasion.count({ where: { entityId: { in: recordingIds } } }),
    audits: await prisma.auditLogEntry.count({ where: { actorId: { in: Object.values(userIds) } } }),
  };
}

beforeAll(async () => {
  for (const role of ["CONTRIBUTOR", "EDITOR", "ADMINISTRATOR"] as const) {
    userIds[role] = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `${TAG}-${role.toLowerCase()}-${TOKEN}@musicmadras.test`, name: `Perm ${role}`, role, status: "ACTIVE" } })).id;
  }
  const draft = await createDraftRecording({ slug: `${TAG}-draft-${TOKEN}`, actorId: userIds.EDITOR, title: "Perm draft" });
  const published = await createDraftRecording({ slug: `${TAG}-pub-${TOKEN}`, actorId: userIds.EDITOR, title: "Perm published" });
  await publishCurrentDraft(published.id, userIds.ADMINISTRATOR);
  rec.draft = draft.id;
  rec.published = published.id;
  recordingIds.push(draft.id, published.id);

  col.draft = (await createCollection({ slug: `${TAG}-cd-${TOKEN}`, title: "Perm draft collection", actorId: userIds.ADMINISTRATOR })).id;
  col.published = (await createCollection({ slug: `${TAG}-cp-${TOKEN}`, title: "Perm published collection", actorId: userIds.ADMINISTRATOR })).id;
  await publishCollection(col.published, userIds.ADMINISTRATOR);
  collectionIds.push(col.draft, col.published);

  sourceId = (await createSource({ title: `Perm source ${TOKEN}`, actorId: userIds.EDITOR })).id;
  rightsId = (await createRightsInformation({ holder: `Perm holder ${TOKEN}`, actorId: userIds.EDITOR })).id;
  occasionId = (await createOccasion({ slug: `${TAG}-o-${TOKEN}`, name: `Perm occasion ${TOKEN}`, actorId: userIds.EDITOR })).id;
}, T);

afterAll(async () => {
  await prisma.collectionRecording.deleteMany({ where: { collectionId: { in: collectionIds } } });
  await prisma.entitySource.deleteMany({ where: { entityId: { in: recordingIds } } });
  await prisma.entityRights.deleteMany({ where: { entityId: { in: recordingIds } } });
  await prisma.entityOccasion.deleteMany({ where: { entityId: { in: recordingIds } } });
  const revisionIds = (await prisma.recordingRevision.findMany({ where: { recordingId: { in: recordingIds } }, select: { id: true } })).map((r) => r.id);
  await prisma.auditLogEntry.deleteMany({
    where: { OR: [{ entityId: { in: [...recordingIds, ...revisionIds, ...collectionIds, sourceId, rightsId, occasionId] } }, { actorId: { in: Object.values(userIds) } }] },
  });
  await prisma.recording.updateMany({ where: { id: { in: recordingIds } }, data: { currentPublishedRevisionId: null, currentDraftRevisionId: null } });
  await prisma.recording.deleteMany({ where: { id: { in: recordingIds } } });
  await prisma.collection.deleteMany({ where: { id: { in: collectionIds } } });
  await prisma.source.deleteMany({ where: { id: sourceId } });
  await prisma.rightsInformation.deleteMany({ where: { id: rightsId } });
  await prisma.occasion.deleteMany({ where: { id: occasionId } });
  await prisma.studioUser.deleteMany({ where: { id: { in: Object.values(userIds) } } });
}, T);

describe("A. the permission model behind the Relationships step", () => {
  it("CATALOGUE_WRITE is held by Editor and above; RECORDING_WRITE is also held by Contributor — they are not the same gate", () => {
    const roles = ["CONTRIBUTOR", "EDITOR", "REVIEWER", "ADMINISTRATOR", "SUPER_ADMINISTRATOR", "FOUNDER"] as const;
    expect(roles.filter((role) => can(role, "CATALOGUE_WRITE"))).toEqual(["EDITOR", "REVIEWER", "ADMINISTRATOR", "SUPER_ADMINISTRATOR", "FOUNDER"]);
    expect(roles.filter((role) => can(role, "RECORDING_WRITE"))).toEqual([...roles]);
    expect(roles.filter((role) => can(role, "RECORDING_PUBLISH"))).toEqual(["ADMINISTRATOR", "SUPER_ADMINISTRATOR", "FOUNDER"]);
  });

  it("a Contributor can use none of the Relationships mutations: nothing is written and no audit entry is made", async () => {
    as("CONTRIBUTOR");
    const before = await counts();
    const target = rec.published;
    const results = await Promise.all([
      redirectOf(() => attachSourceAction(target, form("sourceId", sourceId))),
      redirectOf(() => detachSourceAction(target, sourceId)),
      redirectOf(() => attachRightsAction(target, form("rightsInformationId", rightsId))),
      redirectOf(() => detachRightsAction(target, rightsId)),
      redirectOf(() => attachOccasionAction(target, form("occasionId", occasionId))),
      redirectOf(() => detachOccasionAction(target, occasionId)),
      redirectOf(() => addToCollectionAction(target, form("collectionId", col.draft))),
    ]);
    for (const path of results) expect(path).toMatch(/do not have permission/i);
    expect(await counts()).toEqual(before);
  }, T);

  it("an Editor can attach and detach Source, Rights and Occasion (the workflow the cutover must keep working)", async () => {
    as("EDITOR");
    const target = rec.draft;
    await redirectOf(() => attachSourceAction(target, form("sourceId", sourceId)));
    await redirectOf(() => attachRightsAction(target, form("rightsInformationId", rightsId)));
    await redirectOf(() => attachOccasionAction(target, form("occasionId", occasionId)));
    expect(await counts()).toMatchObject({ sources: 1, rights: 1, occasions: 1 });
    await redirectOf(() => detachSourceAction(target, sourceId));
    await redirectOf(() => detachRightsAction(target, rightsId));
    await redirectOf(() => detachOccasionAction(target, occasionId));
    expect(await counts()).toMatchObject({ sources: 0, rights: 0, occasions: 0 });
  }, T);
});

describe("B. Collection membership: every mutation path, and what guards it today", () => {
  it("a Contributor cannot add, remove or reorder Collection membership through ANY entry point", async () => {
    as("CONTRIBUTOR");
    const before = await counts();
    for (const [recordingId, collectionId] of [[rec.draft, col.draft], [rec.published, col.published], [rec.published, col.draft], [rec.draft, col.published]]) {
      expect(await redirectOf(() => addToCollectionAction(recordingId, form("collectionId", collectionId)))).toMatch(/do not have permission/i);
      expect(await redirectOf(() => addRecordingAction(collectionId, form("recordingId", recordingId)))).toMatch(/do not have permission/i);
      expect(await redirectOf(() => removeRecordingAction(collectionId, recordingId))).toMatch(/do not have permission/i);
      expect(await redirectOf(() => moveRecordingAction(collectionId, recordingId, 0))).toMatch(/do not have permission/i);
    }
    expect(await counts()).toEqual(before);
  }, T);

  const states = [
    ["draft Collection + draft Recording", () => [rec.draft, col.draft], false],
    ["draft Collection + published Recording", () => [rec.published, col.draft], false],
    ["published Collection + draft Recording", () => [rec.draft, col.published], false],
    ["published Collection + published Recording (visible to visitors at once)", () => [rec.published, col.published], true],
  ] as const;

  for (const [label, pick, liveVisible] of states) {
    it(`CURRENT behaviour — ${label}: an Editor can add from the Recording step, and remove/reorder from the Collection page${liveVisible ? " (decision pending: see docs section 13)" : ""}`, async () => {
      as("EDITOR");
      const [recordingId, collectionId] = pick();
      await redirectOf(() => addToCollectionAction(recordingId, form("collectionId", collectionId)));
      expect(await prisma.collectionRecording.count({ where: { collectionId, recordingId } })).toBe(1);
      await redirectOf(() => addRecordingAction(collectionId, form("recordingId", recordingId))); // a duplicate is a no-op
      expect(await prisma.collectionRecording.count({ where: { collectionId, recordingId } })).toBe(1);
      await redirectOf(() => moveRecordingAction(collectionId, recordingId, 0));
      await redirectOf(() => removeRecordingAction(collectionId, recordingId));
      expect(await prisma.collectionRecording.count({ where: { collectionId, recordingId } })).toBe(0);
    }, T);
  }

  it("the Recording step has no REMOVE-from-collection entry point; removal and ordering exist only on the Collection page", async () => {
    const actions = await import("../../app/(studio)/studio/(protected)/recordings/[id]/relationships/actions");
    expect(Object.keys(actions).sort()).toEqual(
      ["addToCollectionAction", "attachOccasionAction", "attachRightsAction", "attachSourceAction", "detachOccasionAction", "detachRightsAction", "detachSourceAction"].sort()
    );
  });
});
