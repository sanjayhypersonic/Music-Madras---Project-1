import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../modules/db/client";
import { getPublicOrganisationPageData } from "../../modules/db/repositories/entityRelationshipsRepository";
import { createOrganisation } from "../../modules/db/repositories/organisationRepository";
import { createVenue } from "../../modules/db/repositories/venueRepository";
import { archiveOccasion, createOccasion } from "../../modules/db/repositories/occasionRepository";
import { createRightsInformation } from "../../modules/db/repositories/rightsInformationRepository";
import { approveSource, createSource } from "../../modules/db/repositories/sourceRepository";
import { getRecordingContext } from "../../modules/db/repositories/recordingContextRepository";
import {
  RevisionRelationshipDataError,
  loadPublishedRecordingRelationships,
  loadRecordingRelationshipWorkspace,
} from "../../modules/db/repositories/recordingRelationshipReadersRepository";
import {
  attachOccasionToRevision,
  attachRightsToRevision,
  attachSourceToRevision,
  detachOccasionFromRevision,
  detachRightsFromRevision,
  detachSourceFromRevision,
} from "../../modules/db/repositories/recordingRevisionRelationshipsRepository";
import { RecordingBusyError, RevisionNotEditableError, archiveRecording, createDraftRecording, forkDraftFromPublished, publishRecordingDraft } from "../../modules/db/repositories/recordingRepository";
import { publishedRecordingAtVenue, type PublishedContentHandle } from "./helpers/publishedContent";

// Phase 6L — the revision-scoped relationship CUTOVER, against the isolated test database: a Recording's Sources, Rights information and Occasions are
// those of its revisions. Proved here through the real repositories, the real public Organisation aggregation and the real AI context assembler:
//   - a draft edit cannot change the published relationship set (Organisation page, AI context, the verified published reader) until publication;
//   - publication swaps the visible set atomically with the pointer, also under concurrent reads and concurrent attaches;
//   - detach semantics: draft-only detaches stay in the draft; a published detach is canonical and the next draft does not get the link back;
//   - the Studio workspace states (published / draft-only / removed-in-draft), read-only without an open draft, read-only when archived;
//   - source approval and archived-Occasion filters are unchanged; legacy rows are never read (no fallback);
//   - inconsistent revision data is an explicit error, never a silently incomplete set.
// Synthetic fixtures only. Nothing here touches production.

const TAG = "phase6l";
const TOKEN = randomUUID().slice(0, 8);
const T = 120000;
const users = {} as Record<"editor" | "admin", string>;
const handles: PublishedContentHandle[] = [];
const sourceIds: string[] = [];
const rightsIds: string[] = [];
const occasionIds: string[] = [];
const extraRecordingIds: string[] = [];
let organisationId: string;
let organisationSlug: string;
let venueId: string;
let counter = 0;

const uniq = (label: string) => `${TAG}-${label}-${TOKEN}-${++counter}`;
async function newSource(approved = true) {
  const source = await createSource({ title: `L Source ${uniq("s")}`, url: "https://example.org/l-source", actorId: users.editor });
  sourceIds.push(source.id);
  if (approved) await approveSource(source.id, users.admin);
  return source.id;
}
async function newRights() {
  const rights = await createRightsInformation({ holder: `L Holder ${uniq("r")}`, actorId: users.editor });
  rightsIds.push(rights.id);
  return rights.id;
}
async function newOccasion() {
  const occasion = await createOccasion({ slug: uniq("o"), name: `L Occasion ${uniq("on")}`, actorId: users.editor });
  occasionIds.push(occasion.id);
  return occasion.id;
}
const sorted = (ids: string[]) => [...ids].sort();

/** A published Recording at the test venue (so the public Organisation page lists it), with no relationships yet. */
async function newLiveRecording() {
  const handle = await publishedRecordingAtVenue({ actorId: users.admin, venueId });
  handles.push(handle);
  return handle.recordingId;
}
const pointers = (recordingId: string) => prisma.recording.findUniqueOrThrow({ where: { id: recordingId }, select: { currentDraftRevisionId: true, currentPublishedRevisionId: true } });
const startDraft = async (recordingId: string) => (await forkDraftFromPublished(recordingId, users.editor)).id;
const publish = (recordingId: string, draftId: string) => publishRecordingDraft({ recordingId, actorId: users.admin, expectedDraftRevisionId: draftId, enforceCompleteness: false });

type Links = { sources?: string[]; rights?: string[]; occasions?: string[] };
async function attachAll(revisionId: string, links: Links) {
  for (const id of links.sources ?? []) await attachSourceToRevision(revisionId, id, users.editor);
  for (const id of links.rights ?? []) await attachRightsToRevision(revisionId, id, users.editor);
  for (const id of links.occasions ?? []) await attachOccasionToRevision(revisionId, id, users.editor);
}
/** A live Recording whose published version carries `links` (fork, attach, publish: the real workflow). */
async function liveWith(links: Links) {
  const recordingId = await newLiveRecording();
  const draftId = await startDraft(recordingId);
  await attachAll(draftId, links);
  expect((await publish(recordingId, draftId)).ok).toBe(true);
  return { recordingId, publishedRevisionId: draftId };
}
async function publishedSets(recordingId: string) {
  const sets = (await loadPublishedRecordingRelationships([recordingId])).byRecording.get(recordingId);
  return { revisionId: sets?.revisionId ?? null, sources: sorted(sets?.sources.map((l) => l.sourceId) ?? []), rights: sorted(sets?.rights.map((l) => l.rightsInformationId) ?? []), occasions: sorted(sets?.occasions.map((l) => l.occasionId) ?? []) };
}
async function orgPage() {
  const page = await getPublicOrganisationPageData(organisationSlug);
  if (!page) throw new Error("the test Organisation page is not public");
  return { sources: page.sources.map((s) => s.id), rights: page.rights.map((r) => r.id), occasions: page.occasions.map((o) => o.id) };
}
const mine = (all: string[], own: string[]) => sorted(all.filter((id) => own.includes(id)));

beforeAll(async () => {
  for (const [who, role] of [["editor", "EDITOR"], ["admin", "ADMINISTRATOR"]] as const) {
    users[who] = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `${TAG}-${who}-${TOKEN}@musicmadras.test`, name: `L ${who}`, role, status: "ACTIVE" } })).id;
  }
  const organisation = await createOrganisation({ slug: uniq("org"), name: `L Organisation ${TOKEN}`, actorId: users.admin });
  organisationId = organisation.id;
  organisationSlug = organisation.slug;
  venueId = (await createVenue({ slug: uniq("venue"), name: `L Venue ${TOKEN}`, type: "CHURCH", organisationId, actorId: users.admin })).id;
}, T);

afterAll(async () => {
  for (const handle of handles) await handle.cleanup(); // recordings first: revision-scoped links are RESTRICT on the catalogue rows
  if (extraRecordingIds.length > 0) {
    const revisionIds = (await prisma.recordingRevision.findMany({ where: { recordingId: { in: extraRecordingIds } }, select: { id: true } })).map((r) => r.id);
    await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityId: { in: [...extraRecordingIds, ...revisionIds] } }] } });
    await prisma.recording.updateMany({ where: { id: { in: extraRecordingIds } }, data: { currentDraftRevisionId: null, currentPublishedRevisionId: null } });
    await prisma.recording.deleteMany({ where: { id: { in: extraRecordingIds } } });
  }
  await prisma.entitySource.deleteMany({ where: { sourceId: { in: sourceIds } } });
  const revisionAudit = await prisma.auditLogEntry.findMany({ where: { actorId: { in: Object.values(users) }, entityType: "RecordingRevision" }, select: { id: true } });
  await prisma.auditLogEntry.deleteMany({ where: { id: { in: revisionAudit.map((a) => a.id) } } });
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityId: { in: [...sourceIds, ...rightsIds, ...occasionIds, venueId, organisationId].filter((id): id is string => typeof id === "string") } }, { actorId: { in: Object.values(users) } }] } });
  await prisma.source.deleteMany({ where: { id: { in: sourceIds } } });
  await prisma.rightsInformation.deleteMany({ where: { id: { in: rightsIds } } });
  await prisma.occasion.deleteMany({ where: { id: { in: occasionIds } } });
  // Guarded: `where: { id: undefined }` matches EVERY row in Prisma, and these are unset when setup failed part-way.
  if (venueId) await prisma.venue.deleteMany({ where: { id: venueId } });
  if (organisationId) await prisma.organisation.deleteMany({ where: { id: organisationId } });
  await prisma.studioUser.deleteMany({ where: { id: { in: Object.values(users) } } });
}, T);

describe("a draft edit cannot change the published relationship set until publication", () => {
  it("Organisation page, verified published reader and AI context are unchanged by every kind of draft attach and detach; publication then swaps them together", async () => {
    const s1 = await newSource();
    const s2 = await newSource();
    const r1 = await newRights();
    const r2 = await newRights();
    const o1 = await newOccasion();
    const o2 = await newOccasion();
    const own = [s1, s2, r1, r2, o1, o2];
    const rec = await liveWith({ sources: [s1], rights: [r1], occasions: [o1] });

    const page0 = await orgPage();
    expect(mine(page0.sources, own)).toEqual([s1]);
    expect(mine(page0.rights, own)).toEqual([r1]);
    expect(mine(page0.occasions, own)).toEqual([o1]);
    const reader0 = await publishedSets(rec.recordingId);
    const context0 = JSON.stringify(await getRecordingContext(rec.recordingId, "PUBLISHED"));
    expect(context0).toContain(s1);
    expect(context0).not.toContain(s2);

    // A draft that adds a second of each kind and removes the first of each.
    const draftId = await startDraft(rec.recordingId);
    await attachAll(draftId, { sources: [s2], rights: [r2], occasions: [o2] });
    await detachSourceFromRevision(draftId, s1, users.editor);
    await detachRightsFromRevision(draftId, r1, users.editor);
    await detachOccasionFromRevision(draftId, o1, users.editor);

    // Nothing public moved: the page, the verified reader and the published AI context are exactly as before.
    const page1 = await orgPage();
    expect({ s: mine(page1.sources, own), r: mine(page1.rights, own), o: mine(page1.occasions, own) }).toEqual({ s: [s1], r: [r1], o: [o1] });
    expect(await publishedSets(rec.recordingId)).toEqual(reader0);
    expect(JSON.stringify(await getRecordingContext(rec.recordingId, "PUBLISHED"))).toBe(context0);
    // The DRAFT context, on the other hand, sees the draft's own set.
    const draftContext = JSON.stringify(await getRecordingContext(rec.recordingId, "DRAFT"));
    expect(draftContext).toContain(s2);
    expect(draftContext).not.toContain(s1);

    // Publication swaps what visitors see, and the superseded revision keeps its set unchanged.
    expect((await publish(rec.recordingId, draftId)).ok).toBe(true);
    const page2 = await orgPage();
    expect({ s: mine(page2.sources, own), r: mine(page2.rights, own), o: mine(page2.occasions, own) }).toEqual({ s: [s2], r: [r2], o: [o2] });
    expect(JSON.stringify(await getRecordingContext(rec.recordingId, "PUBLISHED"))).toContain(s2);
    const old = await prisma.recordingRevisionSource.findMany({ where: { revisionId: rec.publishedRevisionId } });
    expect(old.map((l) => l.sourceId)).toEqual([s1]);
  }, T);

  it("a published revision accepts no relationship write at all (attach or detach, any kind)", async () => {
    const s1 = await newSource();
    const s2 = await newSource();
    const rec = await liveWith({ sources: [s1] });
    const before = await publishedSets(rec.recordingId);
    const [rights, occasion] = [await newRights(), await newOccasion()]; // created first so no write promise sits unobserved while they are awaited
    const refused = [
      attachSourceToRevision(rec.publishedRevisionId, s2, users.editor),
      detachSourceFromRevision(rec.publishedRevisionId, s1, users.editor),
      attachRightsToRevision(rec.publishedRevisionId, rights, users.editor),
      attachOccasionToRevision(rec.publishedRevisionId, occasion, users.editor),
    ];
    for (const result of await Promise.allSettled(refused)) {
      expect(result.status).toBe("rejected");
      expect((result as PromiseRejectedResult).reason).toBeInstanceOf(RevisionNotEditableError);
    }
    expect(await publishedSets(rec.recordingId)).toEqual(before);
  }, T);
});

describe("detach semantics", () => {
  it("a detach in an unpublished draft stays in that draft; once that draft is published the detach is canonical and the next draft does not get the link back", async () => {
    const s1 = await newSource();
    const s2 = await newSource();
    const rec = await liveWith({ sources: [s1, s2] });

    const draft1 = await startDraft(rec.recordingId);
    await detachSourceFromRevision(draft1, s1, users.editor);
    // The published set still has s1 (the draft-only detach is confined), and so does the Organisation page.
    expect((await publishedSets(rec.recordingId)).sources).toEqual(sorted([s1, s2]));
    expect(mine((await orgPage()).sources, [s1, s2])).toEqual(sorted([s1, s2]));

    expect((await publish(rec.recordingId, draft1)).ok).toBe(true);
    expect((await publishedSets(rec.recordingId)).sources).toEqual([s2]); // canonical now
    const draft2 = await startDraft(rec.recordingId);
    expect((await prisma.recordingRevisionSource.findMany({ where: { revisionId: draft2 } })).map((l) => l.sourceId)).toEqual([s2]); // s1 does not come back
    // The earlier, superseded revision keeps its own history.
    expect((await prisma.recordingRevisionSource.findMany({ where: { revisionId: rec.publishedRevisionId } })).map((l) => l.sourceId).sort()).toEqual(sorted([s1, s2]));
  }, T);
});

describe("the Studio workspace states", () => {
  it("marks each link published / draft-only / removed-in-draft, and counts the changes", async () => {
    const s1 = await newSource();
    const s2 = await newSource();
    const o1 = await newOccasion();
    const rec = await liveWith({ sources: [s1], occasions: [o1] });
    const draftId = await startDraft(rec.recordingId);
    await attachSourceToRevision(draftId, s2, users.editor);
    await detachOccasionFromRevision(draftId, o1, users.editor);

    const workspace = (await loadRecordingRelationshipWorkspace(rec.recordingId))!;
    expect(workspace.editable).toBe(true);
    expect(workspace.readOnlyReason).toBeNull();
    expect(workspace.draftRevisionId).toBe(draftId);
    expect(Object.fromEntries(workspace.sources.map((i) => [i.id, i.state]))).toEqual({ [s1]: "PUBLISHED", [s2]: "DRAFT_ONLY" });
    expect(Object.fromEntries(workspace.occasions.map((i) => [i.id, i.state]))).toEqual({ [o1]: "REMOVED_IN_DRAFT" });
    expect({ added: workspace.draftOnly, removed: workspace.removedInDraft }).toEqual({ added: 1, removed: 1 });
  }, T);

  it("with no open draft the published links are shown read-only (NO_DRAFT), and an explicit new draft makes it editable", async () => {
    const s1 = await newSource();
    const rec = await liveWith({ sources: [s1] });
    const readOnly = (await loadRecordingRelationshipWorkspace(rec.recordingId))!;
    expect(readOnly).toMatchObject({ editable: false, readOnlyReason: "NO_DRAFT", draftRevisionId: null, publishedRevisionId: rec.publishedRevisionId });
    expect(readOnly.sources.map((i) => [i.id, i.state])).toEqual([[s1, "PUBLISHED"]]);
    expect(readOnly.draftOnly + readOnly.removedInDraft).toBe(0);

    const draftId = await startDraft(rec.recordingId);
    const editable = (await loadRecordingRelationshipWorkspace(rec.recordingId))!;
    expect(editable).toMatchObject({ editable: true, draftRevisionId: draftId });
    expect(editable.sources.map((i) => [i.id, i.state])).toEqual([[s1, "PUBLISHED"]]); // the fork copied it: nothing is a change yet
  }, T);

  it("an archived Recording's links are read-only (ARCHIVED) even with an open draft", async () => {
    const s1 = await newSource();
    const rec = await liveWith({ sources: [s1] });
    await startDraft(rec.recordingId);
    await archiveRecording(rec.recordingId, users.admin);
    const workspace = (await loadRecordingRelationshipWorkspace(rec.recordingId))!;
    expect(workspace).toMatchObject({ editable: false, readOnlyReason: "ARCHIVED" });
    await expect(attachSourceToRevision(workspace.draftRevisionId!, await newSource(), users.editor)).rejects.toBeInstanceOf(RevisionNotEditableError);
  }, T);

  it("a never-published Recording shows its draft's links as draft-only (nothing is public yet)", async () => {
    const draft = await createDraftRecording({ slug: uniq("never"), actorId: users.editor, title: "L never published" });
    extraRecordingIds.push(draft.id);
    const s1 = await newSource();
    await attachSourceToRevision(draft.currentDraftRevision!.id, s1, users.editor);
    const workspace = (await loadRecordingRelationshipWorkspace(draft.id))!;
    expect(workspace).toMatchObject({ editable: true, publishedRevisionId: null });
    expect(workspace.sources.map((i) => [i.id, i.state])).toEqual([[s1, "DRAFT_ONLY"]]);
    expect(await loadRecordingRelationshipWorkspace(randomUUID())).toBeNull();
  }, T);
});

describe("filters are unchanged, and legacy rows are never read", () => {
  it("only APPROVED sources are public on the Organisation page and in the AI context; an archived Occasion is hidden from the page but stays on the revision", async () => {
    const approved = await newSource(true);
    const unreviewed = await newSource(false);
    const rejected = await newSource(false);
    await prisma.source.update({ where: { id: rejected }, data: { approvalState: "REJECTED" } });
    const o1 = await newOccasion();
    const o2 = await newOccasion();
    const rec = await liveWith({ sources: [approved, unreviewed, rejected], occasions: [o1, o2] });
    const own = [approved, unreviewed, rejected, o1, o2];

    const page = await orgPage();
    expect(mine(page.sources, own)).toEqual([approved]);
    expect(mine(page.occasions, own)).toEqual(sorted([o1, o2]));
    const context = JSON.stringify(await getRecordingContext(rec.recordingId, "PUBLISHED"));
    expect(context).toContain(approved);
    expect(context).not.toContain(unreviewed);
    expect(context).not.toContain(rejected);

    await archiveOccasion(o2, users.admin);
    expect(mine((await orgPage()).occasions, own)).toEqual([o1]); // hidden on the public page
    expect((await publishedSets(rec.recordingId)).occasions).toEqual(sorted([o1, o2])); // the revision still records it
  }, T);

  it("legacy Recording-level rows are history: neither the Organisation page, nor the published reader, nor the AI context shows them (no fallback)", async () => {
    const legacy = await newSource(true);
    const legacyRights = await newRights();
    const legacyOccasion = await newOccasion();
    const rec = await liveWith({});
    await prisma.entitySource.create({ data: { entityType: "RECORDING", entityId: rec.recordingId, sourceId: legacy } });
    await prisma.entityRights.create({ data: { entityType: "RECORDING", entityId: rec.recordingId, rightsInformationId: legacyRights } });
    await prisma.entityOccasion.create({ data: { entityType: "RECORDING", entityId: rec.recordingId, occasionId: legacyOccasion } });
    try {
      const page = await orgPage();
      expect(page.sources).not.toContain(legacy);
      expect(page.rights).not.toContain(legacyRights);
      expect(page.occasions).not.toContain(legacyOccasion);
      expect(await publishedSets(rec.recordingId)).toMatchObject({ sources: [], rights: [], occasions: [] });
      expect(JSON.stringify(await getRecordingContext(rec.recordingId, "PUBLISHED"))).not.toContain(legacy);
    } finally {
      await prisma.entitySource.deleteMany({ where: { entityId: rec.recordingId } });
      await prisma.entityRights.deleteMany({ where: { entityId: rec.recordingId } });
      await prisma.entityOccasion.deleteMany({ where: { entityId: rec.recordingId } });
    }
  }, T);
});

describe("inconsistent revision data is an explicit error, never a silently incomplete set", () => {
  it("a published pointer naming another Recording's revision, or a revision that is not PUBLISHED, throws; no pointer is simply 'not published'", async () => {
    const s1 = await newSource();
    const rec = await liveWith({ sources: [s1] });
    const original = (await pointers(rec.recordingId)).currentPublishedRevisionId!;
    const other = await newLiveRecording();
    const otherDraft = await startDraft(other); // a DRAFT revision of ANOTHER Recording
    const ownDraft = await startDraft(rec.recordingId); // a DRAFT revision of the SAME Recording (made while its pointers are still valid)

    try {
      await prisma.recording.update({ where: { id: rec.recordingId }, data: { currentPublishedRevisionId: otherDraft } });
      await expect(loadPublishedRecordingRelationships([rec.recordingId])).rejects.toMatchObject({ name: "RevisionRelationshipDataError", reason: "PUBLISHED_REVISION_OF_OTHER_RECORDING" });
      await expect(getRecordingContext(rec.recordingId, "PUBLISHED")).rejects.toBeInstanceOf(RevisionRelationshipDataError);
      await expect(loadRecordingRelationshipWorkspace(rec.recordingId)).rejects.toBeInstanceOf(RevisionRelationshipDataError);

      // The Recording's own DRAFT revision, used as if it were the published one.
      await prisma.recording.update({ where: { id: rec.recordingId }, data: { currentPublishedRevisionId: ownDraft } });
      await expect(loadPublishedRecordingRelationships([rec.recordingId])).rejects.toMatchObject({ reason: "PUBLISHED_REVISION_NOT_PUBLISHED" });
    } finally {
      await prisma.recording.update({ where: { id: rec.recordingId }, data: { currentPublishedRevisionId: original } });
    }
    expect((await publishedSets(rec.recordingId)).sources).toEqual([s1]); // intact once the pointer is right again

    const never = await createDraftRecording({ slug: uniq("nopointer"), actorId: users.editor, title: "L no pointer" });
    extraRecordingIds.push(never.id);
    const result = await loadPublishedRecordingRelationships([never.id, randomUUID()]);
    expect(result.byRecording.size).toBe(0);
    expect(result.notPublished).toHaveLength(2);
    const detail = await loadRecordingRelationshipWorkspace(rec.recordingId);
    expect(detail!.sources.map((i) => i.id)).toContain(s1);
  }, T);
});

describe("one inconsistent Recording does not take down the Organisation page", () => {
  it("omits that Recording's unverified links (no legacy fallback), keeps the rest of the page, and logs the problem with ids and a reason code only", async () => {
    const goodSource = await newSource();
    const goodOccasion = await newOccasion();
    const badSource = await newSource();
    const badOccasion = await newOccasion();
    const legacyOnly = await newSource(); // a legacy row for the BAD Recording: it must not appear either (no fallback)
    const good = await liveWith({ sources: [goodSource], occasions: [goodOccasion] });
    const bad = await liveWith({ sources: [badSource], occasions: [badOccasion] });
    await prisma.entitySource.create({ data: { entityType: "RECORDING", entityId: bad.recordingId, sourceId: legacyOnly } });
    const ownDraft = await startDraft(bad.recordingId);
    const original = (await pointers(bad.recordingId)).currentPublishedRevisionId!;
    const own = [goodSource, goodOccasion, badSource, badOccasion, legacyOnly];
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      // Healthy: both Recordings contribute.
      const healthy = await orgPage();
      expect(mine(healthy.sources, own)).toEqual(sorted([goodSource, badSource]));

      // Corrupt ONE Recording's published pointer (it now names a revision that is a DRAFT).
      await prisma.recording.update({ where: { id: bad.recordingId }, data: { currentPublishedRevisionId: ownDraft } });
      const page = await orgPage(); // must not throw
      expect({ s: mine(page.sources, own), o: mine(page.occasions, own) }).toEqual({ s: [goodSource], o: [goodOccasion] }); // the good Recording still shows; the bad one's links are omitted
      expect(page.sources).not.toContain(legacyOnly); // and nothing came from the legacy rows instead

      // Observable: logged once per page build, with the recording id and the reason code, and nothing about the good Recording.
      const messages = logged.mock.calls.map((call) => String(call[0]));
      const mentioning = messages.filter((m) => m.includes(bad.recordingId));
      expect(mentioning.length).toBeGreaterThanOrEqual(1);
      expect(mentioning[0]).toContain("PUBLISHED_REVISION_NOT_PUBLISHED");
      expect(messages.some((m) => m.includes(good.recordingId))).toBe(false);

      // The reader reports it as a typed result in omit mode, and still throws by default (Studio and the AI context stay strict).
      const omitted = await loadPublishedRecordingRelationships([good.recordingId, bad.recordingId], undefined, { onInconsistent: "omit" });
      expect([...omitted.byRecording.keys()]).toEqual([good.recordingId]);
      expect(omitted.inconsistent).toEqual([{ recordingId: bad.recordingId, reason: "PUBLISHED_REVISION_NOT_PUBLISHED" }]);
      await expect(loadPublishedRecordingRelationships([good.recordingId, bad.recordingId])).rejects.toBeInstanceOf(RevisionRelationshipDataError);
    } finally {
      logged.mockRestore();
      await prisma.recording.update({ where: { id: bad.recordingId }, data: { currentPublishedRevisionId: original } });
      await prisma.entitySource.deleteMany({ where: { entityId: bad.recordingId } });
    }
    expect(mine((await orgPage()).sources, own)).toEqual(sorted([goodSource, badSource])); // intact once the pointer is right again
  }, T);
});
describe("concurrency: publication is atomic for readers and for writers", () => {
  it("40 concurrent reads during a publication each see EITHER the whole old set OR the whole new set, never a mixture", async () => {
    const [s1, s2, s3, s4] = [await newSource(), await newSource(), await newSource(), await newSource()];
    const rec = await liveWith({ sources: [s1, s2] });
    const draftId = await startDraft(rec.recordingId);
    await detachSourceFromRevision(draftId, s1, users.editor);
    await detachSourceFromRevision(draftId, s2, users.editor);
    await attachSourceToRevision(draftId, s3, users.editor);
    await attachSourceToRevision(draftId, s4, users.editor);

    const oldSet = JSON.stringify(sorted([s1, s2]));
    const newSet = JSON.stringify(sorted([s3, s4]));
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const reads = Array.from({ length: 40 }, async (_, i) => {
      await sleep(i * 3);
      return publishedSets(rec.recordingId);
    });
    const [published, ...results] = await Promise.all([publish(rec.recordingId, draftId), ...reads]);
    expect(published.ok).toBe(true);
    for (const read of results) {
      const set = JSON.stringify(read.sources);
      expect([oldSet, newSet]).toContain(set);
      expect(read.revisionId).toBe(set === oldSet ? rec.publishedRevisionId : draftId); // the set and the revision it belongs to agree
    }
    expect(JSON.stringify((await publishedSets(rec.recordingId)).sources)).toBe(newSet);
  }, T);

  it("an attach racing a publication either lands in the published set or is refused; it never reaches the published revision afterwards", async () => {
    for (let round = 0; round < 5; round += 1) {
      const base = await newSource();
      const racing = await newSource();
      const rec = await liveWith({ sources: [base] });
      const draftId = await startDraft(rec.recordingId);
      const [published, attach] = await Promise.allSettled([publish(rec.recordingId, draftId), attachSourceToRevision(draftId, racing, users.editor)]);
      expect(published.status).toBe("fulfilled");
      const settled = (await publishedSets(rec.recordingId)).sources;
      if (attach.status === "fulfilled") expect(settled).toEqual(sorted([base, racing]));
      else {
        expect(settled).toEqual([base]);
        expect([RevisionNotEditableError, RecordingBusyError].some((E) => (attach as PromiseRejectedResult).reason instanceof E)).toBe(true);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect((await publishedSets(rec.recordingId)).sources).toEqual(settled); // frozen from here on
    }
  }, T);
});
