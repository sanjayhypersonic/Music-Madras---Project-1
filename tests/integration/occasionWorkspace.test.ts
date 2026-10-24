import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../modules/db/client";
import { loadOccasionWorkspace, type OccasionWorkspace } from "../../modules/db/repositories/occasionWorkspaceRepository";
import { getPublicOccasionPageData } from "../../modules/db/repositories/occasionPageRepository";
import { archiveOccasion, attachOccasionToEntity, createOccasion } from "../../modules/db/repositories/occasionRepository";
import { attachOccasionToRevision, detachOccasionFromRevision } from "../../modules/db/repositories/recordingRevisionRelationshipsRepository";
import { createCollection, publishCollection } from "../../modules/db/repositories/collectionRepository";
import { createVenue } from "../../modules/db/repositories/venueRepository";
import { createProgramme } from "../../modules/db/repositories/programmeRepository";
import { createPerformance } from "../../modules/db/repositories/performanceRepository";
import { archiveRecording, createDraftRecording, forkDraftFromPublished, publishCurrentDraft, publishRecordingDraft, unpublishRecording } from "../../modules/db/repositories/recordingRepository";
import { publishRecordingFor, publishedRecordingAtVenue, type PublishedContentHandle } from "./helpers/publishedContent";
import { imposeRecordingHold, liftRecordingHold } from "../../modules/db/repositories/recordingHoldRepository";

// The Studio Occasion workspace against the isolated test database: every connected item with its status and reason, the verdicts equal to what the PUBLIC page
// actually lists, Recording occasions read from the right revisions (never the frozen legacy rows), and nothing written by loading it. Synthetic fixtures only.

const TAG = "phase7ows";
const TOKEN = randomUUID().replace(/-/g, "").slice(0, 8);
const T = 120000;
const users = {} as Record<"editor" | "admin", string>;
const handles: PublishedContentHandle[] = [];
const occasionIds: string[] = [];
const collectionIds: string[] = [];
const recordingIds: string[] = [];
const venueIds: string[] = [];
const draftOnly: Array<{ programmeId: string; performanceId: string }> = [];
let counter = 0;

const uniq = (label: string) => `${TAG}-${label}-${TOKEN}-${++counter}`;
async function newOccasion(archived = false) {
  const o = await createOccasion({ slug: uniq("o"), name: `Workspace Occasion ${uniq("n")}`, description: "About it", actorId: users.editor });
  occasionIds.push(o.id);
  if (archived) await archiveOccasion(o.id, users.admin);
  return o;
}
async function venue() {
  const v = await createVenue({ slug: uniq("v"), name: `Workspace Venue ${uniq("vn")}`, type: "CHURCH", actorId: users.admin });
  venueIds.push(v.id);
  return v.id;
}
async function liveAtNewVenue() {
  const h = await publishedRecordingAtVenue({ actorId: users.admin, venueId: await venue() });
  handles.push(h);
  return h;
}
async function collection(title: string, opts: { publish?: boolean; archive?: boolean } = {}) {
  const c = await createCollection({ slug: uniq("c"), title, actorId: users.admin });
  collectionIds.push(c.id);
  if (opts.publish) await publishCollection(c.id, users.admin);
  if (opts.archive) await prisma.collection.update({ where: { id: c.id }, data: { archivedAt: new Date() } });
  return c;
}
async function recording(title: string) {
  const r = await createDraftRecording({ slug: uniq("rec"), actorId: users.editor, title });
  recordingIds.push(r.id);
  return r;
}
const tag = (type: "PROGRAMME" | "PERFORMANCE" | "COLLECTION", id: string, occasionId: string) => attachOccasionToEntity({ entityType: type, entityId: id, occasionId, actorId: users.editor });
const find = (w: OccasionWorkspace, kind: string, id: string) => w.connections.find((c) => c.kind === kind && c.id === id);
const surface = async () =>
  JSON.stringify({
    links: await prisma.entityOccasion.count(),
    revisionLinks: await prisma.recordingRevisionOccasion.count(),
    occasions: await prisma.occasion.findMany({ orderBy: { id: "asc" }, select: { id: true, updatedAt: true, archivedAt: true } }),
    recordings: await prisma.recording.findMany({ orderBy: { id: "asc" }, select: { id: true, updatedAt: true, status: true, currentDraftRevisionId: true } }),
    revisions: await prisma.recordingRevision.count(),
    audits: await prisma.auditLogEntry.count(),
  });

beforeAll(async () => {
  for (const [who, role] of [["editor", "EDITOR"], ["admin", "ADMINISTRATOR"]] as const) {
    users[who] = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `${TAG}-${who}-${TOKEN}@musicmadras.test`, name: `Ows ${who}`, role, status: "ACTIVE" } })).id;
  }
}, T);

afterAll(async () => {
  for (const h of handles) await h.cleanup();
  for (const d of draftOnly) {
    await prisma.auditLogEntry.deleteMany({ where: { entityId: { in: [d.performanceId, d.programmeId] } } });
    await prisma.performance.deleteMany({ where: { id: d.performanceId } });
    await prisma.programme.deleteMany({ where: { id: d.programmeId } });
  }
  if (recordingIds.length > 0) {
    const revisionIds = (await prisma.recordingRevision.findMany({ where: { recordingId: { in: recordingIds } }, select: { id: true } })).map((r) => r.id);
    await prisma.entityOccasion.deleteMany({ where: { entityId: { in: recordingIds } } });
    await prisma.auditLogEntry.deleteMany({ where: { entityId: { in: [...recordingIds, ...revisionIds] } } });
    await prisma.recording.updateMany({ where: { id: { in: recordingIds } }, data: { currentDraftRevisionId: null, currentPublishedRevisionId: null } });
    await prisma.recording.deleteMany({ where: { id: { in: recordingIds } } });
  }
  if (occasionIds.length > 0) await prisma.entityOccasion.deleteMany({ where: { occasionId: { in: occasionIds } } });
  if (collectionIds.length > 0) {
    await prisma.auditLogEntry.deleteMany({ where: { entityId: { in: collectionIds } } });
    await prisma.collection.deleteMany({ where: { id: { in: collectionIds } } });
  }
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityId: { in: [...occasionIds, ...venueIds] } }, { actorId: { in: Object.values(users).filter(Boolean) } }] } });
  if (occasionIds.length > 0) await prisma.occasion.deleteMany({ where: { id: { in: occasionIds } } });
  if (venueIds.length > 0) await prisma.venue.deleteMany({ where: { id: { in: venueIds } } });
  await prisma.studioUser.deleteMany({ where: { id: { in: Object.values(users).filter(Boolean) } } });
}, T);

describe("every kind of connection, with its status and reason", () => {
  it("lists performances, programmes, collections and recordings; each gets the right status, the right reason, and (when public) its public link", async () => {
    const o = await newOccasion();
    const live = await liveAtNewVenue(); // an eligible performance and programme, with a published recording
    const liveProgrammeOnly = await liveAtNewVenue(); // its programme is attached, its performance only through the programme
    const programmeB = await createProgramme({ slug: uniq("prog"), title: `Workspace draft programme ${TOKEN}`, actorId: users.admin });
    const performanceB = await createPerformance({ programmeId: programmeB.id, venueId: await venue(), actorId: users.admin });
    draftOnly.push({ programmeId: programmeB.id, performanceId: performanceB.id }); // no published recording uses it
    const published = await collection(`Workspace published collection ${TOKEN}`, { publish: true });
    const draft = await collection(`Workspace draft collection ${TOKEN}`);
    const archived = await collection(`Workspace archived collection ${TOKEN}`, { publish: true, archive: true });

    await tag("PERFORMANCE", live.performanceId!, o.id);
    await tag("PERFORMANCE", performanceB.id, o.id);
    await tag("PROGRAMME", liveProgrammeOnly.programmeId!, o.id);
    await tag("PROGRAMME", programmeB.id, o.id);
    for (const c of [published, draft, archived]) await tag("COLLECTION", c.id, o.id);

    // R1: published, its published revision carries the occasion. R2: the occasion only in the open draft. R3: published then unpublished. R4: archived.
    // R5: an OLDER revision carried it, the current published one does not. R6: only a frozen legacy row.
    const r1 = await recording(`Workspace R1 ${TOKEN}`);
    await attachOccasionToRevision(r1.currentDraftRevisionId!, o.id, users.editor);
    await publishCurrentDraft(r1.id, users.admin);
    const r2 = await recording(`Workspace R2 ${TOKEN}`);
    await publishCurrentDraft(r2.id, users.admin);
    await attachOccasionToRevision((await forkDraftFromPublished(r2.id, users.editor)).id, o.id, users.editor);
    const r3 = await recording(`Workspace R3 ${TOKEN}`);
    await attachOccasionToRevision(r3.currentDraftRevisionId!, o.id, users.editor);
    await publishCurrentDraft(r3.id, users.admin);
    await unpublishRecording(r3.id, users.admin);
    const r4 = await recording(`Workspace R4 ${TOKEN}`);
    await attachOccasionToRevision(r4.currentDraftRevisionId!, o.id, users.editor);
    await publishCurrentDraft(r4.id, users.admin);
    await archiveRecording(r4.id, users.admin);
    const r5 = await recording(`Workspace R5 ${TOKEN}`);
    await attachOccasionToRevision(r5.currentDraftRevisionId!, o.id, users.editor);
    await publishCurrentDraft(r5.id, users.admin);
    const r5draft = await forkDraftFromPublished(r5.id, users.editor);
    await detachOccasionFromRevision(r5draft.id, o.id, users.editor);
    expect((await publishRecordingDraft({ recordingId: r5.id, actorId: users.admin, expectedDraftRevisionId: r5draft.id, enforceCompleteness: false })).ok).toBe(true);
    const r6 = await recording(`Workspace R6 ${TOKEN}`);
    await publishCurrentDraft(r6.id, users.admin);
    await prisma.entityOccasion.create({ data: { entityType: "RECORDING", entityId: r6.id, occasionId: o.id } });

    const w = (await loadOccasionWorkspace(o.id))!;

    // Performances
    expect(find(w, "PERFORMANCE", live.performanceId!)).toMatchObject({ status: "VISIBLE", via: "DIRECT", publicHref: expect.stringMatching(/^\/performances\//), studioHref: `/studio/catalogue/performances/${live.performanceId}` });
    expect(find(w, "PERFORMANCE", performanceB.id)).toMatchObject({ status: "DRAFT", publicHref: null, reason: expect.stringMatching(/no published recording/) });
    expect(find(w, "PERFORMANCE", liveProgrammeOnly.performanceId!)).toMatchObject({ status: "VISIBLE", via: "VIA_PROGRAMME", manageHref: `/studio/catalogue/programmes/${liveProgrammeOnly.programmeId}` });
    // Programmes
    expect(find(w, "PROGRAMME", liveProgrammeOnly.programmeId!)).toMatchObject({ status: "VISIBLE", publicHref: expect.stringMatching(/^\/programmes\//) });
    expect(find(w, "PROGRAMME", programmeB.id)).toMatchObject({ status: "DRAFT", reason: expect.stringMatching(/none of its performances is public/) });
    // Collections
    expect(find(w, "COLLECTION", published.id)).toMatchObject({ status: "VISIBLE", publicHref: expect.stringMatching(/^\/collections\//) });
    expect(find(w, "COLLECTION", draft.id)).toMatchObject({ status: "DRAFT", reason: expect.stringMatching(/still a draft/) });
    expect(find(w, "COLLECTION", archived.id)).toMatchObject({ status: "ARCHIVED", publicHref: null });
    // Recordings (revision-scoped)
    expect(find(w, "RECORDING", r1.id)).toMatchObject({ status: "VISIBLE", via: "PUBLISHED_REVISION", publicHref: expect.stringMatching(/^\/recordings\//), manageHref: `/studio/recordings/${r1.id}/relationships` });
    expect(find(w, "RECORDING", r2.id)).toMatchObject({ status: "DRAFT", via: "DRAFT_REVISION_ONLY", publicHref: null, reason: expect.stringMatching(/only in the open draft revision/) });
    expect(find(w, "RECORDING", r3.id)).toMatchObject({ status: "EXCLUDED", reason: expect.stringMatching(/not published/) });
    expect(find(w, "RECORDING", r4.id)).toMatchObject({ status: "ARCHIVED" });
    expect(find(w, "RECORDING", r5.id)).toMatchObject({ status: "EXCLUDED", via: "OLDER_REVISION_ONLY", reason: expect.stringMatching(/older revision/) });
    // The recording of the attached live performance is reached through that performance, and is visible.
    expect(find(w, "RECORDING", live.recordingId)).toMatchObject({ status: "VISIBLE", via: "VIA_PERFORMANCE" });
    // A frozen legacy row connects nothing.
    expect(find(w, "RECORDING", r6.id)).toBeUndefined();

    // Headline and counts agree with the items.
    expect(w.publicPage).toMatchObject({ state: "PUBLIC", href: `/occasions/${o.slug}` });
    expect(w.counts.visible).toBe(w.connections.filter((c) => c.status === "VISIBLE").length);
    expect(w.counts.linked).toBe(w.connections.length);
    expect(w.truncated).toBe(false);
  }, T);

  it("what the workspace calls visible is EXACTLY what the public page lists (performances, programmes, collections, recordings)", async () => {
    const o = await newOccasion();
    const live = await liveAtNewVenue();
    const live2 = await liveAtNewVenue();
    const published = await collection(`Workspace parity collection ${TOKEN}`, { publish: true });
    await collection(`Workspace parity draft ${TOKEN}`);
    await tag("PERFORMANCE", live.performanceId!, o.id);
    await tag("PROGRAMME", live2.programmeId!, o.id);
    await tag("COLLECTION", published.id, o.id);
    const rec = await recording(`Workspace parity recording ${TOKEN}`);
    await attachOccasionToRevision(rec.currentDraftRevisionId!, o.id, users.editor);
    await publishCurrentDraft(rec.id, users.admin);

    const w = (await loadOccasionWorkspace(o.id))!;
    const page = (await getPublicOccasionPageData(o.slug))!;
    const visibleOf = (kind: string) => w.connections.filter((c) => c.kind === kind && c.status === "VISIBLE").map((c) => c.id).sort();
    expect(visibleOf("PERFORMANCE")).toEqual(page.performances.map((p) => p.id).sort());
    expect(visibleOf("PROGRAMME")).toEqual(page.programmes.map((p) => p.id).sort());
    expect(visibleOf("COLLECTION")).toEqual(page.collections.map((c) => c.id).sort());
    expect(visibleOf("RECORDING")).toEqual(page.recordings.map((r) => r.id).sort());
    expect(w.publicPage.state).toBe("PUBLIC");
  }, T);
});

describe("a performance whose only published Recording is held (R-20)", () => {
  const reasonOf = (w: OccasionWorkspace, kind: string, id: string) => find(w, kind, id)?.reason ?? "";

  it("says the Recording is held, not that no Recording is published; never-published and unpublished recordings still say 'no published recording'; lifting the hold shows it", async () => {
    const o = await newOccasion();
    const held = await liveAtNewVenue(); // its only published recording will be held
    const heldViaProgramme = await liveAtNewVenue(); // same, reached through its attached programme
    const unpublished = await liveAtNewVenue(); // its only recording is unpublished
    await unpublishRecording(unpublished.recordingId, users.admin);
    const programmeB = await createProgramme({ slug: uniq("prog"), title: `Workspace no-recording programme ${TOKEN}`, actorId: users.admin });
    const performanceB = await createPerformance({ programmeId: programmeB.id, venueId: await venue(), actorId: users.admin });
    draftOnly.push({ programmeId: programmeB.id, performanceId: performanceB.id }); // no recording at all
    await tag("PERFORMANCE", held.performanceId!, o.id);
    await tag("PROGRAMME", heldViaProgramme.programmeId!, o.id);
    await tag("PERFORMANCE", unpublished.performanceId!, o.id);
    await tag("PERFORMANCE", performanceB.id, o.id);

    const before = await loadOccasionWorkspace(o.id);
    expect(find(before!, "PERFORMANCE", held.performanceId!)).toMatchObject({ status: "VISIBLE" });

    await imposeRecordingHold({ recordingId: held.recordingId, reason: "RIGHTS", actorId: users.admin });
    await imposeRecordingHold({ recordingId: heldViaProgramme.recordingId, reason: "PRIVACY", actorId: users.admin });
    const during = await loadOccasionWorkspace(o.id);

    for (const [kind, id] of [["PERFORMANCE", held.performanceId!], ["PERFORMANCE", heldViaProgramme.performanceId!], ["PROGRAMME", heldViaProgramme.programmeId!]] as const) {
      expect(find(during!, kind, id), `${kind} ${id}`).toMatchObject({ status: "EXCLUDED", publicHref: null });
      expect(reasonOf(during!, kind, id), `${kind} ${id}`).toMatch(/under a Recording hold/);
      expect(reasonOf(during!, kind, id), `${kind} ${id}`).not.toMatch(/no published recording uses/);
    }
    // the other two are NOT held, and keep their honest "no published recording" wording
    for (const id of [unpublished.performanceId!, performanceB.id]) {
      expect(find(during!, "PERFORMANCE", id)).toMatchObject({ status: "DRAFT" });
      expect(reasonOf(during!, "PERFORMANCE", id)).toMatch(/no published recording uses this performance/);
      expect(reasonOf(during!, "PERFORMANCE", id)).not.toMatch(/hold/);
    }
    // the verdicts still equal the public page: nothing held is on it
    expect(await getPublicOccasionPageData(o.slug)).toBeNull();

    await liftRecordingHold({ recordingId: held.recordingId, actorId: users.admin });
    await liftRecordingHold({ recordingId: heldViaProgramme.recordingId, actorId: users.admin });
    const after = await loadOccasionWorkspace(o.id);
    expect(find(after!, "PERFORMANCE", held.performanceId!)).toMatchObject({ status: "VISIBLE" });
    expect(find(after!, "PROGRAMME", heldViaProgramme.programmeId!)).toMatchObject({ status: "VISIBLE" });
    expect(reasonOf(after!, "PERFORMANCE", held.performanceId!)).not.toMatch(/hold/);
  }, T);

  it("a performance with one held and one visible published recording is VISIBLE (the hold only matters when it is the reason)", async () => {
    const o = await newOccasion();
    const first = await liveAtNewVenue();
    const second = await publishRecordingFor({ actorId: users.admin, performanceId: first.performanceId! });
    handles.push(second);
    await tag("PERFORMANCE", first.performanceId!, o.id);
    await imposeRecordingHold({ recordingId: first.recordingId, reason: "OTHER", actorId: users.admin });
    const w = await loadOccasionWorkspace(o.id);
    expect(find(w!, "PERFORMANCE", first.performanceId!)).toMatchObject({ status: "VISIBLE" });
    await liftRecordingHold({ recordingId: first.recordingId, actorId: users.admin });
  }, T);

  it("explaining a hold writes nothing: no hold, publication or audit row changes by loading the workspace", async () => {
    const o = await newOccasion();
    const live = await liveAtNewVenue();
    await tag("PERFORMANCE", live.performanceId!, o.id);
    await imposeRecordingHold({ recordingId: live.recordingId, reason: "COPYRIGHT", actorId: users.admin });
    const state = async () => JSON.stringify({ rec: await prisma.recording.findUniqueOrThrow({ where: { id: live.recordingId } }), audits: await prisma.auditLogEntry.count() });
    const before = await state();
    await loadOccasionWorkspace(o.id);
    await loadOccasionWorkspace(o.id);
    expect(await state()).toBe(before);
    await liftRecordingHold({ recordingId: live.recordingId, actorId: users.admin });
  }, T);
});
describe("the Occasion's own state", () => {
  it("an occasion with nothing attached has no page and says why; an unknown id is null", async () => {
    const o = await newOccasion();
    const w = (await loadOccasionWorkspace(o.id))!;
    expect(w.connections).toEqual([]);
    expect(w.publicPage).toMatchObject({ state: "NOT_PUBLIC", href: null, reason: expect.stringMatching(/nothing is attached/) });
    expect(await getPublicOccasionPageData(o.slug)).toBeNull();
    expect(await loadOccasionWorkspace(randomUUID())).toBeNull();
  }, T);

  it("an occasion with only drafts attached has no page; the page appears when one attached item becomes public (workspace and page agree throughout)", async () => {
    const o = await newOccasion();
    const c = await collection(`Workspace becomes public ${TOKEN}`);
    await tag("COLLECTION", c.id, o.id);
    let w = (await loadOccasionWorkspace(o.id))!;
    expect(w.publicPage).toMatchObject({ state: "NOT_PUBLIC", reason: expect.stringMatching(/draft, archived or otherwise not public/) });
    expect(await getPublicOccasionPageData(o.slug)).toBeNull();
    await publishCollection(c.id, users.admin);
    w = (await loadOccasionWorkspace(o.id))!;
    expect(w.publicPage.state).toBe("PUBLIC");
    expect(find(w, "COLLECTION", c.id)!.status).toBe("VISIBLE");
    expect(await getPublicOccasionPageData(o.slug)).not.toBeNull();
  }, T);

  it("an archived occasion has no page: every item says so and keeps its own verdict as context", async () => {
    const o = await newOccasion();
    const c = await collection(`Workspace archived-occasion collection ${TOKEN}`, { publish: true });
    await tag("COLLECTION", c.id, o.id);
    await archiveOccasion(o.id, users.admin);
    const w = (await loadOccasionWorkspace(o.id))!;
    expect(w.occasion.archivedAt).not.toBeNull();
    expect(w.publicPage).toMatchObject({ state: "NOT_PUBLIC", href: null, reason: expect.stringMatching(/archived/) });
    expect(find(w, "COLLECTION", c.id)).toMatchObject({ status: "OCCASION_ARCHIVED", publicHref: null, reason: expect.stringMatching(/the collection is published/) });
    expect(w.counts.visible).toBe(0);
    expect(await getPublicOccasionPageData(o.slug)).toBeNull();
  }, T);
});

describe("loading the workspace changes nothing", () => {
  it("repeated loads write no link, revision, recording, occasion or audit row and create no draft", async () => {
    const o = await newOccasion();
    const live = await liveAtNewVenue();
    const rec = await recording(`Workspace readonly ${TOKEN}`);
    await attachOccasionToRevision(rec.currentDraftRevisionId!, o.id, users.editor);
    await publishCurrentDraft(rec.id, users.admin);
    await tag("PERFORMANCE", live.performanceId!, o.id);
    const before = await surface();
    for (let i = 0; i < 3; i += 1) expect(await loadOccasionWorkspace(o.id)).not.toBeNull();
    expect(await surface()).toBe(before);
    expect((await prisma.recording.findUniqueOrThrow({ where: { id: rec.id } })).currentDraftRevisionId).toBeNull(); // no draft was started to show the recording
  }, T);
});
