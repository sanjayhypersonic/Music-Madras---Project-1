import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../modules/db/client";
import { loadPublicationPreview, loadRevisionSnapshot } from "../../modules/db/repositories/recordingRevisionComparisonRepository";
import { attachOccasionToRevision, attachSourceToRevision, detachSourceFromRevision } from "../../modules/db/repositories/recordingRevisionRelationshipsRepository";
import { createOccasion } from "../../modules/db/repositories/occasionRepository";
import { approveSource, createSource } from "../../modules/db/repositories/sourceRepository";
import { createDraftRecording, forkDraftFromPublished, publishCurrentDraft, publishRecordingDraft, updateDraftRevisionContent } from "../../modules/db/repositories/recordingRepository";
import { seedMediaOnRevision } from "./helpers/seedRevisionRows";

// The Review & Publish preview against the isolated test database: what publishing would change, read from the correct revisions, without writing anything.
// Proved: first publication is its own mode; an update shows changed fields and added/removed relationships (Sources, Rights information, Occasions from the
// REVISION-SCOPED tables, never the frozen legacy rows); media differences are shown with availability notes; loading the preview mutates nothing and never
// creates a draft; inconsistent pointers refuse the comparison; and the snapshot taken before publishing equals the published revision afterwards.
// Synthetic fixtures only; nothing touches production.

const TAG = "phase7prev";
const TOKEN = randomUUID().replace(/-/g, "").slice(0, 8);
const T = 120000;
const users = {} as Record<"editor" | "admin", string>;
const recordingIds: string[] = [];
const sourceIds: string[] = [];
const occasionIds: string[] = [];
const videoIds: string[] = [];
let counter = 0;

const uniq = (label: string) => `${TAG}-${label}-${TOKEN}-${++counter}`;
async function newSource(approved = true) {
  const source = await createSource({ title: `Prev Source ${uniq("s")}`, actorId: users.editor });
  sourceIds.push(source.id);
  if (approved) await approveSource(source.id, users.admin);
  return source;
}
async function newOccasion() {
  const occasion = await createOccasion({ slug: uniq("o"), name: `Prev Occasion ${uniq("on")}`, actorId: users.editor });
  occasionIds.push(occasion.id);
  return occasion;
}
async function newRecording(title: string) {
  const recording = await createDraftRecording({ slug: uniq("rec"), actorId: users.editor, title });
  recordingIds.push(recording.id);
  return recording;
}
const changeOf = (items: Array<{ id: string; change: string }>) => Object.fromEntries(items.map((i) => [i.id, i.change]));

/** Everything a preview must not touch, as one comparable value. */
async function writeSurface(recordingId: string) {
  const revisions = await prisma.recordingRevision.findMany({ where: { recordingId }, orderBy: { id: "asc" } });
  const revisionIds = revisions.map((r) => r.id);
  return JSON.stringify({
    recording: await prisma.recording.findUniqueOrThrow({ where: { id: recordingId } }),
    revisions,
    sources: await prisma.recordingRevisionSource.findMany({ where: { revisionId: { in: revisionIds } }, orderBy: [{ revisionId: "asc" }, { sourceId: "asc" }] }),
    rights: await prisma.recordingRevisionRights.count({ where: { revisionId: { in: revisionIds } } }),
    occasions: await prisma.recordingRevisionOccasion.findMany({ where: { revisionId: { in: revisionIds } }, orderBy: [{ revisionId: "asc" }, { occasionId: "asc" }] }),
    media: await prisma.mediaResource.count({ where: { recordingRevisionId: { in: revisionIds } } }),
    audits: await prisma.auditLogEntry.count({ where: { entityId: { in: [recordingId, ...revisionIds] } } }),
  });
}

beforeAll(async () => {
  for (const [who, role] of [["editor", "EDITOR"], ["admin", "ADMINISTRATOR"]] as const) {
    users[who] = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `${TAG}-${who}-${TOKEN}@musicmadras.test`, name: `Prev ${who}`, role, status: "ACTIVE" } })).id;
  }
}, T);

afterAll(async () => {
  if (recordingIds.length > 0) {
    const revisionIds = (await prisma.recordingRevision.findMany({ where: { recordingId: { in: recordingIds } }, select: { id: true } })).map((r) => r.id);
    await prisma.entitySource.deleteMany({ where: { entityId: { in: recordingIds } } });
    await prisma.auditLogEntry.deleteMany({ where: { entityId: { in: [...recordingIds, ...revisionIds] } } });
    await prisma.recording.updateMany({ where: { id: { in: recordingIds } }, data: { currentDraftRevisionId: null, currentPublishedRevisionId: null } });
    await prisma.recording.deleteMany({ where: { id: { in: recordingIds } } });
  }
  if (videoIds.length > 0) await prisma.youTubeVideo.deleteMany({ where: { id: { in: videoIds } } });
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityId: { in: [...sourceIds, ...occasionIds] } }, { actorId: { in: Object.values(users).filter(Boolean) } }] } });
  if (sourceIds.length > 0) await prisma.source.deleteMany({ where: { id: { in: sourceIds } } });
  if (occasionIds.length > 0) await prisma.occasion.deleteMany({ where: { id: { in: occasionIds } } });
  await prisma.studioUser.deleteMany({ where: { id: { in: Object.values(users).filter(Boolean) } } });
}, T);

describe("a first publication", () => {
  it("is shown as 'what will go live': nothing public yet, the draft's own fields and its revision-scoped links as NEW, nothing removed", async () => {
    const recording = await newRecording(`${TAG} First ${TOKEN}`);
    const source = await newSource();
    const occasion = await newOccasion();
    await attachSourceToRevision(recording.currentDraftRevisionId!, source.id, users.editor);
    await attachOccasionToRevision(recording.currentDraftRevisionId!, occasion.id, users.editor);

    const preview = (await loadPublicationPreview(recording.id))!;
    expect(preview.state).toBe("PREVIEW");
    if (preview.state !== "PREVIEW") return;
    expect(preview.publishedRevisionNumber).toBeNull();
    expect(preview.comparison).toMatchObject({ mode: "FIRST_PUBLICATION", publishedRevisionId: null, proposedRevisionId: recording.currentDraftRevisionId });
    expect(preview.comparison.fields.find((f) => f.key === "title")).toMatchObject({ published: null, proposed: `${TAG} First ${TOKEN}`, change: "ADDED" });
    expect(changeOf(preview.comparison.lists.find((l) => l.key === "sources")!.items)).toEqual({ [source.id]: "ADDED" });
    expect(changeOf(preview.comparison.lists.find((l) => l.key === "occasions")!.items)).toEqual({ [occasion.id]: "ADDED" });
    expect(preview.comparison.summary).toMatchObject({ removedItems: 0, changedItems: 0 });
  }, T);
});

describe("an update", () => {
  it("compares the PUBLISHED revision with the open draft: changed fields, and Sources and Occasions added and removed, each read from its own revision", async () => {
    const recording = await newRecording(`${TAG} Messiah ${TOKEN}`);
    const s1 = await newSource();
    const s2 = await newSource(false); // not approved: the proposed side says the public page would not show it
    const o1 = await newOccasion();
    const o2 = await newOccasion();
    const first = recording.currentDraftRevisionId!;
    await attachSourceToRevision(first, s1.id, users.editor);
    await attachOccasionToRevision(first, o1.id, users.editor);
    await publishCurrentDraft(recording.id, users.admin);

    // A frozen legacy Recording-level row: it exists only as history and must not appear on either side of the comparison.
    const legacy = await newSource();
    await prisma.entitySource.create({ data: { entityType: "RECORDING", entityId: recording.id, sourceId: legacy.id } });

    const draft = await forkDraftFromPublished(recording.id, users.editor);
    await updateDraftRevisionContent(recording.id, draft.updatedAt, users.editor, { title: `${TAG} Messiah (1998) ${TOKEN}` });
    await detachSourceFromRevision(draft.id, s1.id, users.editor);
    await attachSourceToRevision(draft.id, s2.id, users.editor);
    await attachOccasionToRevision(draft.id, o2.id, users.editor);

    const preview = (await loadPublicationPreview(recording.id))!;
    if (preview.state !== "PREVIEW") throw new Error("expected a preview");
    const { comparison } = preview;
    expect(comparison).toMatchObject({ mode: "UPDATE", publishedRevisionId: first, proposedRevisionId: draft.id });
    expect(preview.publishedRevisionNumber).toBeLessThan(preview.proposedRevisionNumber);

    expect(comparison.fields.find((f) => f.key === "title")).toMatchObject({ published: `${TAG} Messiah ${TOKEN}`, proposed: `${TAG} Messiah (1998) ${TOKEN}`, change: "CHANGED" });
    const sources = comparison.lists.find((l) => l.key === "sources")!;
    expect(changeOf(sources.items)).toEqual({ [s1.id]: "REMOVED", [s2.id]: "ADDED" });
    expect(sources.items.find((i) => i.id === s2.id)!.note).toMatch(/Not approved/);
    expect(changeOf(comparison.lists.find((l) => l.key === "occasions")!.items)).toEqual({ [o1.id]: "UNCHANGED", [o2.id]: "ADDED" });
    expect(JSON.stringify(comparison)).not.toContain(legacy.id); // the legacy row is on neither side
    expect(comparison.summary.hasChanges).toBe(true);
  }, T);

  it("shows media that differs: a newly attached video is ADDED, with a note when that YouTube video is private", async () => {
    const recording = await newRecording(`${TAG} Media ${TOKEN}`);
    await publishCurrentDraft(recording.id, users.admin);
    const draft = await forkDraftFromPublished(recording.id, users.editor);
    const video = await prisma.youTubeVideo.create({ data: { youtubeVideoId: `pv${TOKEN}`.slice(0, 11), title: `Prev video ${TOKEN}`, privacyStatus: "private", observabilityState: "OBSERVED" } });
    videoIds.push(video.id);
    await seedMediaOnRevision({ recordingRevisionId: draft.id, provider: "YOUTUBE", role: "PRIMARY_VIDEO", youtubeVideoId: video.id, actorId: users.editor });

    const preview = (await loadPublicationPreview(recording.id))!;
    if (preview.state !== "PREVIEW") throw new Error("expected a preview");
    const media = preview.comparison.lists.find((l) => l.key === "media")!;
    expect(media.items).toHaveLength(1);
    expect(media.items[0]).toMatchObject({ change: "ADDED" });
    expect(media.items[0].label).toContain(`Prev video ${TOKEN}`);
    expect(media.items[0].note).toMatch(/currently private/);
  }, T);

  it("what the preview showed is what publishing produces: the snapshot taken before publishing equals the published revision afterwards, and the preview then has nothing to propose", async () => {
    const recording = await newRecording(`${TAG} Predict ${TOKEN}`);
    const s1 = await newSource();
    await attachSourceToRevision(recording.currentDraftRevisionId!, s1.id, users.editor);
    await publishCurrentDraft(recording.id, users.admin);
    const draft = await forkDraftFromPublished(recording.id, users.editor);
    const o1 = await newOccasion();
    await attachOccasionToRevision(draft.id, o1.id, users.editor);
    await updateDraftRevisionContent(recording.id, draft.updatedAt, users.editor, { title: `${TAG} Predict (new) ${TOKEN}` });

    const beforePublish = (await loadRevisionSnapshot(draft.id))!;
    expect((await publishRecordingDraft({ recordingId: recording.id, actorId: users.admin, expectedDraftRevisionId: draft.id, enforceCompleteness: false })).ok).toBe(true);
    const afterPublish = (await loadRevisionSnapshot(draft.id))!;
    expect(afterPublish).toEqual(beforePublish);
    expect(await loadPublicationPreview(recording.id)).toEqual({ state: "NO_DRAFT", publishedRevisionId: draft.id });
  }, T);
});

describe("the preview is read-only and refuses to guess", () => {
  it("with no open draft there is nothing to compare, and none is created; loading the preview repeatedly changes nothing at all (no revision, link, media or audit row, no timestamp)", async () => {
    const recording = await newRecording(`${TAG} Readonly ${TOKEN}`);
    await publishCurrentDraft(recording.id, users.admin);
    const before = await writeSurface(recording.id);
    for (let i = 0; i < 3; i += 1) expect(await loadPublicationPreview(recording.id)).toMatchObject({ state: "NO_DRAFT" });
    expect(await writeSurface(recording.id)).toBe(before);
    expect((await prisma.recording.findUniqueOrThrow({ where: { id: recording.id } })).currentDraftRevisionId).toBeNull();

    const draft = await forkDraftFromPublished(recording.id, users.editor);
    await attachOccasionToRevision(draft.id, (await newOccasion()).id, users.editor);
    const withDraft = await writeSurface(recording.id);
    for (let i = 0; i < 3; i += 1) expect((await loadPublicationPreview(recording.id))!.state).toBe("PREVIEW");
    expect(await writeSurface(recording.id)).toBe(withDraft);
  }, T);

  it("an unknown Recording yields null; an inconsistent pointer refuses the comparison instead of comparing the wrong revisions", async () => {
    expect(await loadPublicationPreview(randomUUID())).toBeNull();

    const recording = await newRecording(`${TAG} Broken ${TOKEN}`);
    await publishCurrentDraft(recording.id, users.admin);
    const draft = await forkDraftFromPublished(recording.id, users.editor);
    const original = (await prisma.recording.findUniqueOrThrow({ where: { id: recording.id } })).currentPublishedRevisionId!;
    try {
      await prisma.recording.update({ where: { id: recording.id }, data: { currentPublishedRevisionId: draft.id } }); // "published" names the DRAFT revision
      await expect(loadPublicationPreview(recording.id)).rejects.toMatchObject({ name: "RevisionRelationshipDataError", reason: "PUBLISHED_REVISION_NOT_PUBLISHED" });
    } finally {
      await prisma.recording.update({ where: { id: recording.id }, data: { currentPublishedRevisionId: original } });
    }
    expect((await loadPublicationPreview(recording.id))!.state).toBe("PREVIEW"); // fine again once the pointer is right
  }, T);
});
