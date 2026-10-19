import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

// Must be at the true top level — vi.mock is hoisted above every import.
const mockGetCurrentStudioSession = vi.fn();
vi.mock("../../modules/auth/authService", () => ({
  getCurrentStudioSession: () => mockGetCurrentStudioSession(),
}));

import { Client } from "pg";
import { prisma } from "../../modules/db/client";
import { can } from "../../modules/auth/policy";
import { createCollection, publishCollection, unpublishCollection } from "../../modules/db/repositories/collectionRepository";
import { createDraftRecording, publishCurrentDraft } from "../../modules/db/repositories/recordingRepository";
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
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
import { addRecordingAction, addWorkAction, moveRecordingAction, moveWorkAction, removeRecordingAction, removeWorkAction } from "../../app/(studio)/studio/(protected)/catalogue/collections/[id]/actions";

// Phase 6J-12 — who may edit a Recording's relationships TODAY, pinned so that the cutover cannot change it by accident.
//
// Decision A (permission): every mutation in the Relationships step is guarded by CATALOGUE_WRITE (Editor, Reviewer,
// Administrator, Super Administrator, Founder), NOT by RECORDING_WRITE (which a Contributor also holds). The revision-scoped
// Source / Rights / Occasion writers that replace the legacy ones must keep CATALOGUE_WRITE.
//
// Decision B (Collection membership, Phase 6J-12A): the entry points below are the only mutation paths. A change is LIVE when
// the Collection and the Recording are both PUBLISHED (visitors see it at once); that, and only that, additionally needs
// RECORDING_PUBLISH. Every other state combination keeps CATALOGUE_WRITE alone. The decision is enforced server-side in the
// repository (one transaction, share locks), with the role passed in by each Server Action.

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

describe("B. Collection membership: every mutation path, and the rule that guards LIVE changes", () => {
  const extra = {} as Record<"published2" | "inReview" | "archived", string>;
  const archivedPublishedCollection = { id: "" };
  const refusal = /needs permission to publish/i;
  let composerId: string;
  let workId: string;

  beforeAll(async () => {
    const mk = async (label: string) => (await createDraftRecording({ slug: `${TAG}-${label}-${TOKEN}`, actorId: userIds.EDITOR, title: `Perm ${label}` })).id;
    extra.published2 = await mk("pub2");
    await publishCurrentDraft(extra.published2, userIds.ADMINISTRATOR);
    extra.inReview = await mk("inreview");
    await prisma.recording.update({ where: { id: extra.inReview }, data: { status: "IN_REVIEW" } });
    extra.archived = await mk("archived");
    await prisma.recording.update({ where: { id: extra.archived }, data: { status: "ARCHIVED" } });
    recordingIds.push(extra.published2, extra.inReview, extra.archived);

    archivedPublishedCollection.id = (await createCollection({ slug: `${TAG}-ca-${TOKEN}`, title: "Perm archived published collection", actorId: userIds.ADMINISTRATOR })).id;
    await publishCollection(archivedPublishedCollection.id, userIds.ADMINISTRATOR);
    await prisma.collection.update({ where: { id: archivedPublishedCollection.id }, data: { archivedAt: new Date() } });
    collectionIds.push(archivedPublishedCollection.id);

    composerId = (await createComposer({ slug: `${TAG}-composer-${TOKEN}`, name: "Perm composer", actorId: userIds.EDITOR })).id;
    workId = (await createMusicalWork({ slug: `${TAG}-work-${TOKEN}`, title: "Perm work", composerId, actorId: userIds.EDITOR })).id;
  }, T);

  afterAll(async () => {
    await prisma.collectionWork.deleteMany({ where: { collectionId: { in: collectionIds } } });
    await prisma.auditLogEntry.deleteMany({ where: { entityId: { in: [workId, composerId] } } });
    await prisma.musicalWork.deleteMany({ where: { id: workId } });
    await prisma.composer.deleteMany({ where: { id: composerId } });
  }, T);

  const linkCount = (collectionId: string, recordingId: string) => prisma.collectionRecording.count({ where: { collectionId, recordingId } });
  const link = (collectionId: string, recordingId: string) => prisma.collectionRecording.create({ data: { collectionId, recordingId, order: 0 } });
  const unlink = (collectionId: string, recordingId: string) => prisma.collectionRecording.deleteMany({ where: { collectionId, recordingId } });

  it("a Contributor cannot add, remove or reorder Collection membership through ANY entry point, in any state", async () => {
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

  // Every publication-state combination: [label, recording, collection, live?]. A change is live only for published + published.
  const combos = (): [string, string, string, boolean][] => [
    ["draft Collection + draft Recording", rec.draft, col.draft, false],
    ["draft Collection + published Recording", rec.published, col.draft, false],
    ["published Collection + draft Recording", rec.draft, col.published, false],
    ["published Collection + IN_REVIEW Recording", extra.inReview, col.published, false],
    ["published Collection + ARCHIVED Recording", extra.archived, col.published, false],
    ["published Collection + published Recording", rec.published, col.published, true],
    ["published-but-archived Collection + published Recording (restoring it would publish the change at once)", rec.published, archivedPublishedCollection.id, true],
  ];

  const comboLabels = [
    ["draft Collection + draft Recording", false],
    ["draft Collection + published Recording", false],
    ["published Collection + draft Recording", false],
    ["published Collection + IN_REVIEW Recording", false],
    ["published Collection + ARCHIVED Recording", false],
    ["published Collection + published Recording", true],
    ["published-but-archived Collection + published Recording", true],
  ] as const;
  for (const [index, [comboLabel, comboLive]] of comboLabels.entries()) {
    it(`state combination ${index + 1} (${comboLabel}): an Editor is ${comboLive ? "REFUSED" : "allowed"} to add, remove and reorder`, async () => {
      const [label, recordingId, collectionId, live] = combos()[index];
      expect(live).toBe(comboLive);
      as("EDITOR");
      const auditsBefore = await prisma.auditLogEntry.count({ where: { entityType: "Collection", entityId: collectionId } });

      if (!live) {
        await redirectOf(() => addToCollectionAction(recordingId, form("collectionId", collectionId)));
        expect(await linkCount(collectionId, recordingId), label).toBe(1);
        await redirectOf(() => addRecordingAction(collectionId, form("recordingId", recordingId))); // duplicate: a no-op
        expect(await linkCount(collectionId, recordingId), label).toBe(1);
        await redirectOf(() => moveRecordingAction(collectionId, recordingId, 0));
        await redirectOf(() => removeRecordingAction(collectionId, recordingId));
        expect(await linkCount(collectionId, recordingId), label).toBe(0);
        return;
      }

      // LIVE: every entry point refuses the Editor and changes nothing (no row, no order change, no audit entry).
      expect(await redirectOf(() => addToCollectionAction(recordingId, form("collectionId", collectionId))), label).toMatch(refusal);
      expect(await redirectOf(() => addRecordingAction(collectionId, form("recordingId", recordingId))), label).toMatch(refusal);
      expect(await linkCount(collectionId, recordingId), label).toBe(0);
      await link(collectionId, recordingId); // a link that exists (made by an authorised publisher)
      expect(await redirectOf(() => removeRecordingAction(collectionId, recordingId)), label).toMatch(refusal);
      expect(await redirectOf(() => moveRecordingAction(collectionId, recordingId, 0)), label).toMatch(refusal);
      expect(await linkCount(collectionId, recordingId), label).toBe(1);
      expect(await prisma.auditLogEntry.count({ where: { entityType: "Collection", entityId: collectionId } }), label).toBe(auditsBefore);

      // An ADMINISTRATOR (RECORDING_PUBLISH) may do all of it, through every entry point.
      as("ADMINISTRATOR");
      await redirectOf(() => moveRecordingAction(collectionId, recordingId, 0));
      await redirectOf(() => removeRecordingAction(collectionId, recordingId));
      expect(await linkCount(collectionId, recordingId), label).toBe(0);
      await redirectOf(() => addToCollectionAction(recordingId, form("collectionId", collectionId)));
      expect(await linkCount(collectionId, recordingId), label).toBe(1);
      await redirectOf(() => removeRecordingAction(collectionId, recordingId));
      await redirectOf(() => addRecordingAction(collectionId, form("recordingId", recordingId)));
      expect(await linkCount(collectionId, recordingId), label).toBe(1);
      await unlink(collectionId, recordingId);
    }, T);
  }

  it("the rule follows the publication state at the moment of the change: unpublishing the Collection frees the Editor, republishing blocks again", async () => {
    await link(col.published, rec.published);
    as("EDITOR");
    expect(await redirectOf(() => removeRecordingAction(col.published, rec.published))).toMatch(refusal);
    await unpublishCollection(col.published, userIds.ADMINISTRATOR);
    await redirectOf(() => removeRecordingAction(col.published, rec.published));
    expect(await linkCount(col.published, rec.published)).toBe(0);
    await publishCollection(col.published, userIds.ADMINISTRATOR);
    expect(await redirectOf(() => addRecordingAction(col.published, form("recordingId", rec.published)))).toMatch(refusal);
    expect(await linkCount(col.published, rec.published)).toBe(0);
  }, T);

  it("REORDER: moving a PUBLISHED Recording in a published Collection is live (refused for an Editor); moving a draft Recording among them is not", async () => {
    await link(col.published, rec.published);
    await prisma.collectionRecording.create({ data: { collectionId: col.published, recordingId: extra.published2, order: 1 } });
    await prisma.collectionRecording.create({ data: { collectionId: col.published, recordingId: rec.draft, order: 2 } });
    const order = async () => (await prisma.collectionRecording.findMany({ where: { collectionId: col.published }, orderBy: { order: "asc" } })).map((l) => l.recordingId);
    const start = await order();
    as("EDITOR");
    expect(await redirectOf(() => moveRecordingAction(col.published, extra.published2, 0))).toMatch(refusal);
    expect(await order()).toEqual(start); // untouched
    await redirectOf(() => moveRecordingAction(col.published, rec.draft, 0)); // the moved Recording is not public: the published Recordings keep their relative order
    const afterDraftMove = await order();
    expect(afterDraftMove[0]).toBe(rec.draft);
    expect(afterDraftMove.filter((id) => id !== rec.draft)).toEqual(start.filter((id) => id !== rec.draft));
    as("ADMINISTRATOR");
    await redirectOf(() => moveRecordingAction(col.published, extra.published2, 0));
    expect((await order())[0]).toBe(extra.published2);
    await prisma.collectionRecording.deleteMany({ where: { collectionId: col.published } });
  }, T);

  it("WORK membership is not affected: an Editor can still add, reorder and remove Works in a published Collection", async () => {
    as("EDITOR");
    await redirectOf(() => addWorkAction(col.published, form("musicalWorkId", workId)));
    expect(await prisma.collectionWork.count({ where: { collectionId: col.published, musicalWorkId: workId } })).toBe(1);
    await redirectOf(() => moveWorkAction(col.published, workId, 0));
    await redirectOf(() => removeWorkAction(col.published, workId));
    expect(await prisma.collectionWork.count({ where: { collectionId: col.published, musicalWorkId: workId } })).toBe(0);
  }, T);

  it("the guard is atomic with the write: an Editor's add that overlaps an uncommitted publish waits for it, then sees the Collection as live and is refused", async () => {
    const raceCollection = (await createCollection({ slug: `${TAG}-race-${TOKEN}-${randomUUID().slice(0, 4)}`, title: "Perm race collection", actorId: userIds.ADMINISTRATOR })).id;
    collectionIds.push(raceCollection);
    const publisher = new Client({ connectionString: process.env.DATABASE_URL });
    await publisher.connect();
    try {
      await publisher.query("BEGIN");
      await publisher.query("update collections set status = 'PUBLISHED' where id = $1", [raceCollection]); // uncommitted: holds the row lock
      as("EDITOR");
      let settled = false;
      const add = redirectOf(() => addRecordingAction(raceCollection, form("recordingId", rec.published))).finally(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 800));
      expect(settled, "the add must wait for the publisher's row lock instead of deciding on the stale DRAFT state").toBe(false);
      await publisher.query("COMMIT");
      expect(await add).toMatch(/needs permission to publish/i);
      expect(await linkCount(raceCollection, rec.published)).toBe(0);
    } finally {
      await publisher.query("ROLLBACK").catch(() => undefined);
      await publisher.end();
    }
  }, T);
  it("the Recording step has no REMOVE-from-collection entry point; removal and ordering exist only on the Collection page", async () => {
    const actions = await import("../../app/(studio)/studio/(protected)/recordings/[id]/relationships/actions");
    expect(Object.keys(actions).sort()).toEqual(
      ["addToCollectionAction", "attachOccasionAction", "attachRightsAction", "attachSourceAction", "detachOccasionAction", "detachRightsAction", "detachSourceAction"].sort()
    );
  });

  it("every Studio call of the three Recording-membership functions passes the guard (no unguarded entry point exists under app/)", async () => {
    const { readFileSync, readdirSync } = await import("fs");
    const path = await import("path");
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === ".next" ? [] : walk(full);
        return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
      });
    const root = process.cwd();
    const callers = [...walk(path.join(root, "app")), ...walk(path.join(root, "modules")), ...walk(path.join(root, "scripts"))].filter((file) => !file.endsWith("collectionRepository.ts"));
    let calls = 0;
    for (const file of callers) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/(addRecordingToCollection|removeRecordingFromCollection|reorderCollectionRecordings)\(([^\n]*)/g)) {
        if (/^\s*(import|export)\b/.test(text.slice(text.lastIndexOf("\n", match.index) + 1, match.index))) continue;
        calls += 1;
        expect(match[2], `${path.relative(root, file)}: ${match[1]}`).toContain('canPublish: can(session!.user.role, "RECORDING_PUBLISH")');
      }
    }
    expect(calls).toBe(4); // addToCollectionAction, addRecordingAction, removeRecordingAction, moveRecordingAction
  });
});
