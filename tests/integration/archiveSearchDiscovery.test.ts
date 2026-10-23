import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../modules/db/client";
import {
  searchArchiveAll,
  searchCollections,
  searchLearningGuides,
  searchOccasions,
  searchRecordings,
  searchVenues,
} from "../../modules/db/repositories/archiveSearchRepository";
import { filterPublicOccasionIds, getPublicOccasionPageData } from "../../modules/db/repositories/occasionPageRepository";
import { attachOccasionToEntity, createOccasion } from "../../modules/db/repositories/occasionRepository";
import { attachOccasionToRevision } from "../../modules/db/repositories/recordingRevisionRelationshipsRepository";
import { createCollection, publishCollection } from "../../modules/db/repositories/collectionRepository";
import { createVenue } from "../../modules/db/repositories/venueRepository";
import { createDraftRecording, forkDraftFromPublished, publishCurrentDraft, publishRecordingDraft, updateDraftRevisionContent } from "../../modules/db/repositories/recordingRepository";
import { publishedRecordingAtVenue, type PublishedContentHandle } from "./helpers/publishedContent";

// Unified archive search (Collections, Learning Guides and Occasions added; relevance ranking for every named type) against the isolated test database.
// Proved here: only publicly visible records can be found (drafts, archived and not-yet-public items never leak, not even into counts); a Recording is
// found only through its PUBLISHED revision; ranking puts an exact title first and is stable across pages; wildcards in a query are literal; the set-based
// public-Occasion check equals the Occasion page's own rule; each record appears once. Synthetic fixtures only; nothing touches production.

const TAG = "phase7srch";
const TOKEN = randomUUID().replace(/-/g, "").slice(0, 8);
const TERM = `Zq${TOKEN}`; // a search term no other fixture contains
const T = 120000;
const users = {} as Record<"editor" | "admin", string>;
const handles: PublishedContentHandle[] = [];
const collectionIds: string[] = [];
const guideIds: string[] = [];
const occasionIds: string[] = [];
const recordingIds: string[] = [];
const venueIds: string[] = [];
let counter = 0;

const uniq = (label: string) => `${TAG}-${label}-${TOKEN}-${++counter}`;
async function collection(title: string, opts: { publish?: boolean; archive?: boolean } = {}) {
  const c = await createCollection({ slug: uniq("c"), title, actorId: users.admin });
  collectionIds.push(c.id);
  if (opts.publish) await publishCollection(c.id, users.admin);
  if (opts.archive) await prisma.collection.update({ where: { id: c.id }, data: { archivedAt: new Date() } });
  return c;
}
async function guide(title: string, status: "DRAFT" | "PUBLISHED", archived = false) {
  const g = await prisma.learningGuide.create({ data: { slug: uniq("g"), title, status, archivedAt: archived ? new Date() : null, createdById: users.admin, updatedById: users.admin } });
  guideIds.push(g.id);
  return g;
}
async function occasion(name: string, description: string | null = null) {
  const o = await createOccasion({ slug: uniq("o"), name, description: description ?? undefined, actorId: users.editor });
  occasionIds.push(o.id);
  return o;
}
const titles = (items: Array<{ title?: string | null; name?: string }>) => items.map((i) => i.title ?? i.name);

beforeAll(async () => {
  for (const [who, role] of [["editor", "EDITOR"], ["admin", "ADMINISTRATOR"]] as const) {
    users[who] = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `${TAG}-${who}-${TOKEN}@musicmadras.test`, name: `Srch ${who}`, role, status: "ACTIVE" } })).id;
  }
}, T);

afterAll(async () => {
  for (const handle of handles) await handle.cleanup();
  if (recordingIds.length > 0) {
    const revisionIds = (await prisma.recordingRevision.findMany({ where: { recordingId: { in: recordingIds } }, select: { id: true } })).map((r) => r.id);
    await prisma.auditLogEntry.deleteMany({ where: { entityId: { in: [...recordingIds, ...revisionIds] } } });
    await prisma.recording.updateMany({ where: { id: { in: recordingIds } }, data: { currentDraftRevisionId: null, currentPublishedRevisionId: null } });
    await prisma.recording.deleteMany({ where: { id: { in: recordingIds } } });
  }
  if (occasionIds.length > 0) await prisma.entityOccasion.deleteMany({ where: { occasionId: { in: occasionIds } } });
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityId: { in: [...collectionIds, ...guideIds, ...occasionIds, ...venueIds] } }, { actorId: { in: Object.values(users).filter(Boolean) } }] } });
  if (collectionIds.length > 0) await prisma.collection.deleteMany({ where: { id: { in: collectionIds } } });
  if (guideIds.length > 0) await prisma.learningGuide.deleteMany({ where: { id: { in: guideIds } } });
  if (occasionIds.length > 0) await prisma.occasion.deleteMany({ where: { id: { in: occasionIds } } });
  if (venueIds.length > 0) await prisma.venue.deleteMany({ where: { id: { in: venueIds } } });
  await prisma.studioUser.deleteMany({ where: { id: { in: Object.values(users).filter(Boolean) } } });
}, T);

describe("Collections: only public ones are found, in relevance order", () => {
  it("finds published, non-archived Collections; a draft, an archived one and an unrelated one are not found, and counts do not reveal them", async () => {
    const exact = await collection(TERM, { publish: true });
    await collection(`${TERM} Cantatas`, { publish: true });
    await collection(`The ${TERM} Choir`, { publish: true });
    await collection(`Aa${TERM}bb`, { publish: true });
    await collection(`${TERM} draft only`); // draft
    await collection(`${TERM} archived`, { publish: true, archive: true });
    await collection("Something else entirely", { publish: true });

    const result = await searchCollections(TERM);
    expect(titles(result.items)).toEqual([TERM, `${TERM} Cantatas`, `The ${TERM} Choir`, `Aa${TERM}bb`]); // exact, prefix, word prefix, contains
    expect(result.total).toBe(4); // the draft and the archived Collection are not even counted
    expect(result.items[0].id).toBe(exact.id);
    expect(result.items[0]).toMatchObject({ entityType: "collection", slug: expect.any(String) });
  }, T);

  it("pages through the ranked results without repeating or skipping a record", async () => {
    const term = `Pg${TOKEN}`;
    for (const title of [`${term} E`, `${term} B`, `${term}`, `${term} D`, `${term} A`]) await collection(title, { publish: true });
    const all = titles((await searchCollections(term, 1, 50)).items);
    expect(all).toEqual([term, `${term} A`, `${term} B`, `${term} D`, `${term} E`]);
    const paged: Array<string | null | undefined> = [];
    for (const page of [1, 2, 3]) paged.push(...titles((await searchCollections(term, page, 2)).items));
    expect(paged).toEqual(all);
    expect(new Set(paged).size).toBe(paged.length);
    expect(titles((await searchCollections(term, 9, 2)).items)).toEqual([]);
  }, T);

  it("treats % and _ in a query as literal characters, not wildcards", async () => {
    await collection(`${TERM} 100% pure`, { publish: true });
    await collection(`${TERM} 100 percent`, { publish: true });
    expect(titles((await searchCollections(`${TERM} 100%`)).items)).toEqual([`${TERM} 100% pure`]);
    expect(titles((await searchCollections(`${TERM}_100`)).items)).toEqual([]);
    expect((await searchCollections("%")).items.every((c) => `${c.title} ${c.description ?? ""}`.includes("%"))).toBe(true);
  }, T);
});

describe("Learning guides: only published, non-archived guides are found", () => {
  it("finds a published guide by title; a draft and an archived guide are invisible, including in counts", async () => {
    const published = await guide(`${TERM} Guide to Fugue`, "PUBLISHED");
    await guide(`${TERM} Draft Guide`, "DRAFT");
    await guide(`${TERM} Archived Guide`, "PUBLISHED", true);
    const result = await searchLearningGuides(TERM);
    expect(result.total).toBe(1);
    expect(result.items).toEqual([expect.objectContaining({ entityType: "guide", id: published.id, slug: published.slug, title: `${TERM} Guide to Fugue` })]);
  }, T);
});

describe("Occasions: only those with a public page are found", () => {
  it("returns an Occasion attached to a live Performance, and never one with nothing public attached, an archived one, or one known only from a frozen legacy row", async () => {
    const live = await publishedRecordingAtVenue({ actorId: users.admin, venueId: await newVenueId() });
    handles.push(live);
    const withPage = await occasion(`${TERM} Carol Service`, "A service of lessons and carols");
    await attachOccasionToEntity({ entityType: "PERFORMANCE", entityId: live.performanceId!, occasionId: withPage.id, actorId: users.editor });
    const empty = await occasion(`${TERM} Empty Occasion`);
    const archived = await occasion(`${TERM} Archived Occasion`);
    await attachOccasionToEntity({ entityType: "PERFORMANCE", entityId: live.performanceId!, occasionId: archived.id, actorId: users.editor });
    await prisma.occasion.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });
    const legacyOnly = await occasion(`${TERM} Legacy Only`);
    const recording = await createDraftRecording({ slug: uniq("rec"), actorId: users.editor, title: `${TERM} legacy recording` });
    recordingIds.push(recording.id);
    await publishCurrentDraft(recording.id, users.admin);
    await prisma.entityOccasion.create({ data: { entityType: "RECORDING", entityId: recording.id, occasionId: legacyOnly.id } });

    const result = await searchOccasions(TERM);
    expect(result.items.map((o) => o.id)).toEqual([withPage.id]);
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({ entityType: "occasion", slug: withPage.slug, name: `${TERM} Carol Service` });
    for (const hidden of [empty, archived, legacyOnly]) expect(result.items.map((o) => o.id)).not.toContain(hidden.id);
  }, T);

  it("the set-based public check agrees with the Occasion page's own rule for every kind of attachment (programme, performance, collection, published and draft revisions)", async () => {
    const venueId = await newVenueId();
    const live = await publishedRecordingAtVenue({ actorId: users.admin, venueId });
    handles.push(live);
    const byPerformance = await occasion(`${TERM} p1`);
    const byProgramme = await occasion(`${TERM} p2`);
    const byPublishedCollection = await occasion(`${TERM} p3`);
    const byDraftCollection = await occasion(`${TERM} p4`);
    const byPublishedRevision = await occasion(`${TERM} p5`);
    const byDraftRevision = await occasion(`${TERM} p6`);
    const unattached = await occasion(`${TERM} p7`);
    await attachOccasionToEntity({ entityType: "PERFORMANCE", entityId: live.performanceId!, occasionId: byPerformance.id, actorId: users.editor });
    await attachOccasionToEntity({ entityType: "PROGRAMME", entityId: live.programmeId!, occasionId: byProgramme.id, actorId: users.editor });
    const publishedCollection = await collection(`${TERM} pub coll`, { publish: true });
    const draftCollection = await collection(`${TERM} draft coll`);
    await attachOccasionToEntity({ entityType: "COLLECTION", entityId: publishedCollection.id, occasionId: byPublishedCollection.id, actorId: users.editor });
    await attachOccasionToEntity({ entityType: "COLLECTION", entityId: draftCollection.id, occasionId: byDraftCollection.id, actorId: users.editor });

    const recording = await createDraftRecording({ slug: uniq("rev-rec"), actorId: users.editor, title: `${TERM} revision recording` });
    recordingIds.push(recording.id);
    await attachOccasionToRevision(recording.currentDraftRevisionId!, byPublishedRevision.id, users.editor);
    await publishCurrentDraft(recording.id, users.admin); // its published revision carries byPublishedRevision
    const draftId = (await forkDraftFromPublished(recording.id, users.editor)).id;
    await attachOccasionToRevision(draftId, byDraftRevision.id, users.editor); // only a DRAFT revision carries this one

    const all = [byPerformance, byProgramme, byPublishedCollection, byDraftCollection, byPublishedRevision, byDraftRevision, unattached];
    const setBased = await filterPublicOccasionIds(all.map((o) => o.id));
    for (const o of all) expect(setBased.has(o.id), o.slug).toBe((await getPublicOccasionPageData(o.slug)) !== null);
    expect(all.filter((o) => setBased.has(o.id)).map((o) => o.id).sort()).toEqual([byPerformance.id, byProgramme.id, byPublishedCollection.id, byPublishedRevision.id].sort());
    const found = new Set((await searchOccasions(TERM, 1, 50)).items.map((o) => o.id));
    for (const o of [byPerformance, byProgramme, byPublishedCollection, byPublishedRevision]) expect(found.has(o.id), o.slug).toBe(true);
    for (const o of [byDraftCollection, byDraftRevision, unattached]) expect(found.has(o.id), o.slug).toBe(false);
  }, T);
});

describe("ranking applies to the existing entity types too, and a Recording is found only through its published revision", () => {
  it("ranks a venue whose name starts with the query above one with a later word that starts with it, although the second sorts first alphabetically", async () => {
    const term = `Vn${TOKEN}`;
    for (const name of [`Aaa ${term}`, `${term} Hall`]) {
      const venue = await createVenue({ slug: uniq("v"), name, type: "CONCERT_HALL", actorId: users.admin });
      venueIds.push(venue.id);
      const live = await publishedRecordingAtVenue({ actorId: users.admin, venueId: venue.id });
      handles.push(live);
    }
    expect((await searchVenues(term)).items.map((v) => v.name)).toEqual([`${term} Hall`, `Aaa ${term}`]);
  }, T);

  it("finds a Recording by its PUBLISHED title only: a title that exists only on a draft revision is invisible", async () => {
    const publishedTitle = `${TERM} Published Title`;
    const draftOnlyTitle = `${TERM} Draft Only Retitle`;
    const recording = await createDraftRecording({ slug: uniq("title-rec"), actorId: users.editor, title: publishedTitle });
    recordingIds.push(recording.id);
    await publishCurrentDraft(recording.id, users.admin);
    const draft = await forkDraftFromPublished(recording.id, users.editor);
    await updateDraftRevisionContent(recording.id, draft.updatedAt, users.editor, { title: draftOnlyTitle });

    expect((await searchRecordings(`${TERM} Draft Only`)).items.map((r) => r.id)).not.toContain(recording.id);
    expect((await searchRecordings(`${TERM} Published`)).items.map((r) => r.id)).toContain(recording.id);

    expect((await publishRecordingDraft({ recordingId: recording.id, actorId: users.admin, expectedDraftRevisionId: draft.id, enforceCompleteness: false })).ok).toBe(true);
    expect((await searchRecordings(`${TERM} Draft Only`)).items.map((r) => r.id)).toContain(recording.id);
  }, T);
});

describe("the unified view", () => {
  it("returns each record once, under its own type, with all of the new types present", async () => {
    const all = await searchArchiveAll(TERM, 50);
    expect(all.collections.total).toBeGreaterThan(0);
    expect(all.guides.total).toBeGreaterThan(0);
    expect(all.occasions.total).toBeGreaterThan(0);
    const keys = [...all.collections.items, ...all.guides.items, ...all.occasions.items, ...all.recordings.items, ...all.venues.items].map((i) => `${i.entityType}:${i.id}`);
    expect(new Set(keys).size).toBe(keys.length);
    // No internal or administrative field is part of any result.
    expect(JSON.stringify(all)).not.toMatch(/createdById|updatedById|resolvedBy|archivedAt|status"/);
  }, T);

  it("a query nothing matches yields empty groups, and a hostile query is just text", async () => {
    const none = await searchArchiveAll(`${TOKEN}-no-such-thing`, 6);
    expect(none.collections.total + none.guides.total + none.occasions.total + none.recordings.total + none.venues.total).toBe(0);
    const hostile = await searchArchiveAll("'; DROP TABLE occasions; -- \\ %_", 6);
    expect(hostile.occasions.total).toBeGreaterThanOrEqual(0); // no error thrown, nothing dropped
    expect(await prisma.occasion.count()).toBeGreaterThan(0);
  }, T);
});

async function newVenueId(): Promise<string> {
  const venue = await createVenue({ slug: uniq("venue"), name: `Srch Venue ${uniq("n")}`, type: "CHURCH", actorId: users.admin });
  venueIds.push(venue.id);
  return venue.id;
}
