import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../modules/db/client";
import { getSiteOrigin } from "../../modules/config/siteOrigin";
import sitemap from "../../app/sitemap";
import { getPublicOccasionPageData, listPublicOccasionSitemapEntries } from "../../modules/db/repositories/occasionPageRepository";
import { getPublicOrganisationPageData } from "../../modules/db/repositories/entityRelationshipsRepository";
import { archiveOccasion, attachOccasionToEntity, createOccasion } from "../../modules/db/repositories/occasionRepository";
import { attachOccasionToRevision } from "../../modules/db/repositories/recordingRevisionRelationshipsRepository";
import { createCollection, publishCollection } from "../../modules/db/repositories/collectionRepository";
import { createOrganisation } from "../../modules/db/repositories/organisationRepository";
import { createVenue } from "../../modules/db/repositories/venueRepository";
import { createProgramme } from "../../modules/db/repositories/programmeRepository";
import { createPerformance } from "../../modules/db/repositories/performanceRepository";
import { createDraftRecording, forkDraftFromPublished, publishCurrentDraft, publishRecordingDraft, unpublishRecording } from "../../modules/db/repositories/recordingRepository";
import { publishedRecordingAtVenue, type PublishedContentHandle } from "./helpers/publishedContent";

// Public Occasion pages (/occasions/[slug]) against the isolated test database. What is proved:
//   - an Occasion is public only while it is active AND something public is attached (never an empty page, never a draft);
//   - each way of attaching one — Performance, Programme, Collection, a Recording's PUBLISHED revision — is filtered by the shared eligibility rules;
//   - a draft revision's occasion never appears until publication; an unpublished Recording drops out;
//   - the frozen legacy Recording-level rows are never read;
//   - the sitemap lists exactly the Occasions that have a page, and every Occasion the Organisation page surfaces has one (so its link never 404s).
// Synthetic fixtures only; nothing touches production.

const TAG = "phase7occ";
const TOKEN = randomUUID().slice(0, 8);
const T = 120000;
const SITE_ORIGIN = getSiteOrigin();
const users = {} as Record<"editor" | "admin", string>;
const handles: PublishedContentHandle[] = [];
const occasionIds: string[] = [];
const recordingIds: string[] = [];
const collectionIds: string[] = [];
const draftOnly: Array<{ programmeId: string; performanceId: string }> = [];
let organisationId: string;
let organisationSlug: string;
let venueId: string;
let counter = 0;

const uniq = (label: string) => `${TAG}-${label}-${TOKEN}-${++counter}`;
async function newOccasion(label = "o") {
  const occasion = await createOccasion({ slug: uniq(label), name: `Occ ${uniq(label)}`, description: `About ${label}`, actorId: users.editor });
  occasionIds.push(occasion.id);
  return occasion;
}
const tag = (entityType: "PROGRAMME" | "PERFORMANCE" | "COLLECTION", entityId: string, occasionId: string) => attachOccasionToEntity({ entityType, entityId, occasionId, actorId: users.editor });
async function liveRecordingAtVenue() {
  const handle = await publishedRecordingAtVenue({ actorId: users.admin, venueId });
  handles.push(handle);
  return handle;
}
const page = (slug: string) => getPublicOccasionPageData(slug);
const sitemapSlugs = async () => (await listPublicOccasionSitemapEntries()).map((e) => e.slug);

beforeAll(async () => {
  for (const [who, role] of [["editor", "EDITOR"], ["admin", "ADMINISTRATOR"]] as const) {
    users[who] = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `${TAG}-${who}-${TOKEN}@musicmadras.test`, name: `Occ ${who}`, role, status: "ACTIVE" } })).id;
  }
  const organisation = await createOrganisation({ slug: uniq("org"), name: `Occ Organisation ${TOKEN}`, actorId: users.admin });
  organisationId = organisation.id;
  organisationSlug = organisation.slug;
  venueId = (await createVenue({ slug: uniq("venue"), name: `Occ Venue ${TOKEN}`, type: "CHURCH", organisationId, actorId: users.admin })).id;
}, T);

afterAll(async () => {
  for (const handle of handles) await handle.cleanup();
  for (const d of draftOnly) {
    await prisma.auditLogEntry.deleteMany({ where: { entityId: { in: [d.performanceId, d.programmeId] } } });
    await prisma.performance.deleteMany({ where: { id: d.performanceId } });
    await prisma.programme.deleteMany({ where: { id: d.programmeId } });
  }
  if (recordingIds.length > 0) {
    const revisionIds = (await prisma.recordingRevision.findMany({ where: { recordingId: { in: recordingIds } }, select: { id: true } })).map((r) => r.id);
    await prisma.auditLogEntry.deleteMany({ where: { entityId: { in: [...recordingIds, ...revisionIds] } } });
    await prisma.recording.updateMany({ where: { id: { in: recordingIds } }, data: { currentDraftRevisionId: null, currentPublishedRevisionId: null } });
    await prisma.recording.deleteMany({ where: { id: { in: recordingIds } } });
  }
  if (occasionIds.length > 0) await prisma.entityOccasion.deleteMany({ where: { occasionId: { in: occasionIds } } });
  if (collectionIds.length > 0) {
    await prisma.auditLogEntry.deleteMany({ where: { entityId: { in: collectionIds } } });
    await prisma.collection.deleteMany({ where: { id: { in: collectionIds } } });
  }
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityId: { in: [...occasionIds, venueId, organisationId].filter((id): id is string => typeof id === "string") } }, { actorId: { in: Object.values(users).filter(Boolean) } }] } });
  if (occasionIds.length > 0) await prisma.occasion.deleteMany({ where: { id: { in: occasionIds } } });
  // Guarded: `where: { id: undefined }` matches EVERY row in Prisma, and these are unset when setup failed part-way.
  if (venueId) await prisma.venue.deleteMany({ where: { id: venueId } });
  if (organisationId) await prisma.organisation.deleteMany({ where: { id: organisationId } });
  await prisma.studioUser.deleteMany({ where: { id: { in: Object.values(users).filter(Boolean) } } });
}, T);

describe("an Occasion is public only while it is active and something public is attached", () => {
  it("an Occasion with nothing attached has no page and is not in the sitemap; an unknown slug has none either", async () => {
    const occasion = await newOccasion("empty");
    expect(await page(occasion.slug)).toBeNull();
    expect(await sitemapSlugs()).not.toContain(occasion.slug);
    expect(await page(`${TAG}-no-such-occasion-${TOKEN}`)).toBeNull();
  }, T);

  it("an archived Occasion has no page, however much is attached to it", async () => {
    const occasion = await newOccasion("archived");
    const live = await liveRecordingAtVenue();
    await tag("PERFORMANCE", live.performanceId!, occasion.id);
    expect(await page(occasion.slug)).not.toBeNull();
    await archiveOccasion(occasion.id, users.admin);
    expect(await page(occasion.slug)).toBeNull();
    expect(await sitemapSlugs()).not.toContain(occasion.slug);
  }, T);
});

describe("each way of attaching an Occasion is filtered by the shared eligibility rules", () => {
  it("a Performance with a published Recording is listed, with its venue, its Programme and the Recording; a Performance reachable from no published Recording is not", async () => {
    const occasion = await newOccasion("perf");
    const live = await liveRecordingAtVenue();
    const programme = await createProgramme({ slug: uniq("prog"), title: `Occ unpublished programme ${TOKEN}`, actorId: users.admin });
    const performance = await createPerformance({ programmeId: programme.id, venueId, actorId: users.admin });
    draftOnly.push({ programmeId: programme.id, performanceId: performance.id }); // no Recording publishes it: not eligible
    await tag("PERFORMANCE", live.performanceId!, occasion.id);
    await tag("PERFORMANCE", performance.id, occasion.id);

    const data = (await page(occasion.slug))!;
    expect(data.name).toBe(occasion.name);
    expect(data.description).toBe("About perf");
    expect(data.performances.map((p) => p.id)).toEqual([live.performanceId]);
    expect(data.performances[0]).toMatchObject({ venueName: `Occ Venue ${TOKEN}` });
    expect(data.recordings.map((r) => r.id)).toEqual([live.recordingId]); // the published Recording of the listed Performance
  }, T);

  it("a Performance that is only attached but never published leaves the Occasion without a page", async () => {
    const occasion = await newOccasion("perf-unpublished");
    const programme = await createProgramme({ slug: uniq("prog"), title: `Occ lonely programme ${TOKEN}`, actorId: users.admin });
    const performance = await createPerformance({ programmeId: programme.id, venueId, actorId: users.admin });
    draftOnly.push({ programmeId: programme.id, performanceId: performance.id });
    await tag("PERFORMANCE", performance.id, occasion.id);
    await tag("PROGRAMME", programme.id, occasion.id);
    expect(await page(occasion.slug)).toBeNull();
    expect(await sitemapSlugs()).not.toContain(occasion.slug);
  }, T);

  it("an attached Programme lists itself and its eligible Performances", async () => {
    const occasion = await newOccasion("prog");
    const live = await liveRecordingAtVenue();
    await tag("PROGRAMME", live.programmeId!, occasion.id);
    const data = (await page(occasion.slug))!;
    expect(data.programmes.map((p) => p.id)).toEqual([live.programmeId]);
    expect(data.performances.map((p) => p.id)).toEqual([live.performanceId]);
  }, T);

  it("a published Collection is listed; a draft Collection is not, and an Occasion with only a draft Collection has no page", async () => {
    const occasion = await newOccasion("coll");
    const draftCollection = await createCollection({ slug: uniq("cd"), title: `Occ draft collection ${TOKEN}`, actorId: users.admin });
    collectionIds.push(draftCollection.id);
    await tag("COLLECTION", draftCollection.id, occasion.id);
    expect(await page(occasion.slug)).toBeNull();

    const publishedCollection = await createCollection({ slug: uniq("cp"), title: `Occ published collection ${TOKEN}`, actorId: users.admin });
    collectionIds.push(publishedCollection.id);
    await publishCollection(publishedCollection.id, users.admin);
    await tag("COLLECTION", publishedCollection.id, occasion.id);
    expect((await page(occasion.slug))!.collections.map((c) => c.id)).toEqual([publishedCollection.id]);
  }, T);
});

describe("a Recording's occasion is read from its PUBLISHED revision", () => {
  it("a draft revision's occasion never appears until publication; publication shows it; unpublishing the Recording removes it", async () => {
    const occasion = await newOccasion("revision");
    const recording = await createDraftRecording({ slug: uniq("rec"), actorId: users.editor, title: `Occ recording ${TOKEN}` });
    recordingIds.push(recording.id);
    await publishCurrentDraft(recording.id, users.admin); // published with no occasion
    expect(await page(occasion.slug)).toBeNull();

    const draftId = (await forkDraftFromPublished(recording.id, users.editor)).id;
    await attachOccasionToRevision(draftId, occasion.id, users.editor);
    expect(await page(occasion.slug)).toBeNull(); // the draft's occasion is not public

    expect((await publishRecordingDraft({ recordingId: recording.id, actorId: users.admin, expectedDraftRevisionId: draftId, enforceCompleteness: false })).ok).toBe(true);
    const data = (await page(occasion.slug))!;
    expect(data.recordings.map((r) => r.id)).toEqual([recording.id]);
    expect(data.recordings[0].title).toBe(`Occ recording ${TOKEN}`);

    await unpublishRecording(recording.id, users.admin);
    expect(await page(occasion.slug)).toBeNull();
  }, T);

  it("the frozen legacy Recording-level rows are never read: a legacy row alone does not make an Occasion public", async () => {
    const occasion = await newOccasion("legacy");
    const recording = await createDraftRecording({ slug: uniq("legacy-rec"), actorId: users.editor, title: `Occ legacy recording ${TOKEN}` });
    recordingIds.push(recording.id);
    await publishCurrentDraft(recording.id, users.admin);
    await prisma.entityOccasion.create({ data: { entityType: "RECORDING", entityId: recording.id, occasionId: occasion.id } });
    expect(await page(occasion.slug)).toBeNull();
    expect(await sitemapSlugs()).not.toContain(occasion.slug);
  }, T);
});

describe("the sitemap and the Organisation page agree with the Occasion page", () => {
  it("the sitemap lists exactly the Occasions that have a page, including through the app sitemap", async () => {
    const withPage = await newOccasion("map-yes");
    const withoutPage = await newOccasion("map-no");
    const live = await liveRecordingAtVenue();
    await tag("PERFORMANCE", live.performanceId!, withPage.id);

    const slugs = await sitemapSlugs();
    expect(slugs).toContain(withPage.slug);
    expect(slugs).not.toContain(withoutPage.slug);
    for (const slug of slugs) expect(await page(slug), slug).not.toBeNull(); // parity: nothing is listed that would 404

    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain(`${SITE_ORIGIN}/occasions/${withPage.slug}`);
    expect(urls).not.toContain(`${SITE_ORIGIN}/occasions/${withoutPage.slug}`);
  }, T);

  it("every Occasion the Organisation page surfaces carries its slug and has a public page (its link never 404s)", async () => {
    const occasion = await newOccasion("org");
    const live = await liveRecordingAtVenue();
    await tag("PERFORMANCE", live.performanceId!, occasion.id);
    const organisation = (await getPublicOrganisationPageData(organisationSlug))!;
    const surfaced = organisation.occasions.find((o) => o.id === occasion.id);
    expect(surfaced).toMatchObject({ id: occasion.id, slug: occasion.slug, name: occasion.name });
    for (const o of organisation.occasions) expect(await page(o.slug), o.slug).not.toBeNull();
  }, T);
});
