import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../modules/db/client";
import { createComposer, archiveComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork, archiveMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import { addProgrammeItem, createProgramme } from "../../modules/db/repositories/programmeRepository";
import { archiveVenue, createVenue } from "../../modules/db/repositories/venueRepository";
import { createOrganisation, archiveOrganisation } from "../../modules/db/repositories/organisationRepository";
import { archiveArtist, createArtist } from "../../modules/db/repositories/artistRepository";
import { createChoir } from "../../modules/db/repositories/choirRepository";
import { createConductor } from "../../modules/db/repositories/conductorRepository";
import { addChoirToPerformance, addConductorToPerformance, addPerformerToPerformance, createPerformance } from "../../modules/db/repositories/performanceRepository";
import {
  archiveRecording,
  attachWorkToRevision,
  createDraftRecording,
  forkDraftFromPublished,
  publishCurrentDraft,
  unpublishRecording,
  updateDraftRevisionContent,
} from "../../modules/db/repositories/recordingRepository";
import { approveSource, attachSourceToEntity, createSource, rejectSource } from "../../modules/db/repositories/sourceRepository";
import { linkVenueToOrganisation } from "../../modules/db/repositories/venueRepository";
import {
  getArtistEntityPageData,
  getChoirEntityPageData,
  getComposerEntityPageData,
  getConductorEntityPageData,
  getPublicOrganisationPageData,
  getPublicPerformancePageData,
  getPublicProgrammePageData,
  getPublicRecordingPageData,
  getPublicWorkPageData,
  getVenueEntityPageData,
} from "../../modules/db/repositories/entityRelationshipsRepository";
import { searchArchiveAll } from "../../modules/db/repositories/archiveSearchRepository";
import {
  listPublicArtistSitemapEntries,
  listPublicChoirSitemapEntries,
  listPublicComposerSitemapEntries,
  listPublicConductorSitemapEntries,
  listPublicOrganisationSitemapEntries,
  listPublicPerformanceSitemapEntries,
  listPublicProgrammeSitemapEntries,
  listPublicRecordingSitemapEntries,
  listPublicVenueSitemapEntries,
  listPublicWorkSitemapEntries,
} from "../../modules/db/repositories/sitemapRepository";

// Phase 6J-1 — a canonical catalogue entity is publicly discoverable only
// while it is reachable from published archive content (publicEligibility.ts).
// This file proves that for every public surface: direct entity pages,
// archive search and the sitemap. Real database; every fixture carries a
// per-run token and is cleaned up. Assertions are scoped to this file's own
// records, never global counts.

const TAG = "phase6j1elig";
const TOKEN = randomUUID().slice(0, 8);
const T = 180000;

interface Graph {
  composer: { id: string; slug: string; name: string };
  work: { id: string; slug: string; title: string };
  programme: { id: string; slug: string; title: string };
  venue: { id: string; slug: string; name: string };
  organisation: { id: string; slug: string; name: string };
  performance: { id: string; slug: string };
  artist: { id: string; slug: string; name: string };
  choir: { id: string; slug: string; name: string };
  conductor: { id: string; slug: string; name: string };
}

let userId: string;
const recordingIds: string[] = [];
const graphs: Graph[] = [];
const sourceIds: string[] = [];

const slug = (base: string) => `${TAG}-${base}-${randomUUID().slice(0, 8)}`;

/** Builds a full catalogue graph through the real repositories — NO Recording yet. */
async function buildGraph(label: string): Promise<Graph> {
  const name = (kind: string) => `Elig ${kind} ${label} ${TOKEN}`;
  const composer = await createComposer({ slug: slug(`composer-${label}`), name: name("Composer"), actorId: userId });
  const work = await createMusicalWork({ slug: slug(`work-${label}`), title: name("Work"), composerId: composer.id, actorId: userId });
  const programme = await createProgramme({ slug: slug(`programme-${label}`), title: name("Programme"), actorId: userId });
  await addProgrammeItem({ programmeId: programme.id, musicalWorkId: work.id, actorId: userId });
  const organisation = await createOrganisation({ slug: slug(`org-${label}`), name: name("Organisation"), actorId: userId });
  const venue = await createVenue({ slug: slug(`venue-${label}`), name: name("Venue"), type: "CHURCH", actorId: userId });
  await linkVenueToOrganisation(venue.id, organisation.id, userId);
  const performance = await createPerformance({ programmeId: programme.id, venueId: venue.id, performanceDate: new Date("2021-03-03"), actorId: userId });
  const artist = await createArtist({ slug: slug(`artist-${label}`), name: name("Artist"), actorId: userId });
  const choir = await createChoir({ slug: slug(`choir-${label}`), name: name("Choir"), actorId: userId });
  const conductor = await createConductor({ slug: slug(`conductor-${label}`), name: name("Conductor"), actorId: userId });
  await addPerformerToPerformance(performance.id, artist.id, "Soloist", userId);
  await addChoirToPerformance(performance.id, choir.id, userId);
  await addConductorToPerformance(performance.id, conductor.id, userId);
  const graph: Graph = { composer, work, programme, venue, organisation, performance, artist, choir, conductor };
  graphs.push(graph);
  return graph;
}

/** A DRAFT Recording using the graph — exactly what the Studio recording wizard produces. */
async function draftRecordingFor(graph: Graph, title: string) {
  const draft = await createDraftRecording({ slug: slug("recording"), actorId: userId, title });
  recordingIds.push(draft.id);
  await updateDraftRevisionContent(draft.id, draft.currentDraftRevision!.updatedAt, userId, { performanceId: graph.performance.id });
  await attachWorkToRevision(draft.currentDraftRevision!.id, graph.work.id, userId);
  return draft;
}

async function publishedRecordingFor(graph: Graph, title: string) {
  const draft = await draftRecordingFor(graph, title);
  return publishCurrentDraft(draft.id, userId);
}

/** Every public surface's verdict on one graph. */
async function surfaces(graph: Graph) {
  const [
    composerPage,
    workPage,
    programmePage,
    performancePage,
    venuePage,
    organisationPage,
    artistPage,
    choirPage,
    conductorPage,
    search,
    sitemap,
  ] = await Promise.all([
    getComposerEntityPageData(graph.composer.slug),
    getPublicWorkPageData(graph.work.slug),
    getPublicProgrammePageData(graph.programme.slug),
    getPublicPerformancePageData(graph.performance.slug),
    getVenueEntityPageData(graph.venue.slug),
    getPublicOrganisationPageData(graph.organisation.slug),
    getArtistEntityPageData(graph.artist.slug),
    getChoirEntityPageData(graph.choir.slug),
    getConductorEntityPageData(graph.conductor.slug),
    searchArchiveAll(TOKEN, 100),
    Promise.all([
      listPublicComposerSitemapEntries(),
      listPublicWorkSitemapEntries(),
      listPublicProgrammeSitemapEntries(),
      listPublicPerformanceSitemapEntries(),
      listPublicVenueSitemapEntries(),
      listPublicOrganisationSitemapEntries(),
      listPublicArtistSitemapEntries(),
      listPublicChoirSitemapEntries(),
      listPublicConductorSitemapEntries(),
    ]),
  ]);

  const [sComposers, sWorks, sProgrammes, sPerformances, sVenues, sOrganisations, sArtists, sChoirs, sConductors] = sitemap;
  const has = (entries: { slug: string }[], s: string) => entries.some((e) => e.slug === s);
  return {
    pages: {
      composer: composerPage !== null,
      work: workPage !== null,
      programme: programmePage !== null,
      performance: performancePage !== null,
      venue: venuePage !== null,
      organisation: organisationPage !== null,
      artist: artistPage !== null,
      choir: choirPage !== null,
      conductor: conductorPage !== null,
    },
    search: {
      composer: search.composers.items.some((i) => i.slug === graph.composer.slug),
      work: search.works.items.some((i) => i.slug === graph.work.slug),
      programme: search.programmes.items.some((i) => i.slug === graph.programme.slug),
      performance: search.performances.items.some((i) => i.slug === graph.performance.slug),
      venue: search.venues.items.some((i) => i.slug === graph.venue.slug),
      organisation: search.organisations.items.some((i) => i.slug === graph.organisation.slug),
      artist: search.artists.items.some((i) => i.slug === graph.artist.slug),
      choir: search.choirs.items.some((i) => i.slug === graph.choir.slug),
      conductor: search.conductors.items.some((i) => i.slug === graph.conductor.slug),
    },
    sitemap: {
      composer: has(sComposers, graph.composer.slug),
      work: has(sWorks, graph.work.slug),
      programme: has(sProgrammes, graph.programme.slug),
      performance: has(sPerformances, graph.performance.slug),
      venue: has(sVenues, graph.venue.slug),
      organisation: has(sOrganisations, graph.organisation.slug),
      artist: has(sArtists, graph.artist.slug),
      choir: has(sChoirs, graph.choir.slug),
      conductor: has(sConductors, graph.conductor.slug),
    },
  };
}

const ALL_FALSE = {
  composer: false,
  work: false,
  programme: false,
  performance: false,
  venue: false,
  organisation: false,
  artist: false,
  choir: false,
  conductor: false,
};
const ALL_TRUE = Object.fromEntries(Object.keys(ALL_FALSE).map((k) => [k, true]));

async function cleanup() {
  if (recordingIds.length > 0) {
    const revisions = await prisma.recordingRevision.findMany({ where: { recordingId: { in: recordingIds } }, select: { id: true } });
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "Recording", entityId: { in: recordingIds } } });
    if (revisions.length > 0) await prisma.auditLogEntry.deleteMany({ where: { entityType: "RecordingRevision", entityId: { in: revisions.map((r) => r.id) } } });
    await prisma.entitySource.deleteMany({ where: { entityType: "RECORDING", entityId: { in: recordingIds } } });
    await prisma.recording.deleteMany({ where: { id: { in: recordingIds } } });
  }
  for (const sourceId of sourceIds) {
    await prisma.citation.deleteMany({ where: { sourceId } });
    await prisma.entitySource.deleteMany({ where: { sourceId } });
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "Source", entityId: sourceId } });
    await prisma.source.delete({ where: { id: sourceId } }).catch(() => {});
  }
  for (const g of graphs) {
    const del = async (type: string, id: string, model: { delete: (args: { where: { id: string } }) => Promise<unknown> }) => {
      await prisma.auditLogEntry.deleteMany({ where: { entityType: type, entityId: id } });
      await model.delete({ where: { id } }).catch(() => {});
    };
    await del("Performance", g.performance.id, prisma.performance);
    await del("Programme", g.programme.id, prisma.programme);
    await del("Venue", g.venue.id, prisma.venue);
    await del("Organisation", g.organisation.id, prisma.organisation);
    await del("Artist", g.artist.id, prisma.artist);
    await del("Choir", g.choir.id, prisma.choir);
    await del("Conductor", g.conductor.id, prisma.conductor);
    await del("MusicalWork", g.work.id, prisma.musicalWork);
    await del("Composer", g.composer.id, prisma.composer);
  }
  await prisma.auditLogEntry.deleteMany({ where: { actorId: userId } });
  await prisma.studioUser.deleteMany({ where: { id: userId } });
}

beforeAll(async () => {
  const user = await prisma.studioUser.create({
    data: { id: randomUUID(), email: `${TAG}-${TOKEN}-integration-test@musicmadras.test`, name: "Phase 6J-1 Eligibility Test", role: "EDITOR", status: "ACTIVE" },
  });
  userId = user.id;
}, T);

afterAll(cleanup, T);

describe("A. A draft Recording workflow cannot expose its supporting entities", () => {
  it("every supporting entity stays undiscoverable on every public surface while the Recording is a draft", async () => {
    const graph = await buildGraph("draft");
    await draftRecordingFor(graph, `Elig Draft Recording ${TOKEN}`);

    const verdict = await surfaces(graph);
    expect(verdict.pages).toEqual(ALL_FALSE);
    expect(verdict.search).toEqual(ALL_FALSE);
    expect(verdict.sitemap).toEqual(ALL_FALSE);
  }, T);

  it("an IN_REVIEW (submitted, not yet published) Recording does not expose them either", async () => {
    const graph = await buildGraph("inreview");
    const draft = await draftRecordingFor(graph, `Elig InReview Recording ${TOKEN}`);
    await prisma.recording.update({ where: { id: draft.id }, data: { status: "IN_REVIEW" } });

    const verdict = await surfaces(graph);
    expect(verdict.pages).toEqual(ALL_FALSE);
    expect(verdict.search).toEqual(ALL_FALSE);
    expect(verdict.sitemap).toEqual(ALL_FALSE);
  }, T);
});

describe("B. Orphan / fixture entities (no published content reaches them) are hidden", () => {
  it("a complete catalogue graph with NO Recording at all is invisible on direct URLs, search and the sitemap", async () => {
    const graph = await buildGraph("orphan");

    const verdict = await surfaces(graph);
    expect(verdict.pages).toEqual(ALL_FALSE);
    expect(verdict.search).toEqual(ALL_FALSE);
    expect(verdict.sitemap).toEqual(ALL_FALSE);
  }, T);
});

describe("C. Publishing a Recording makes its related entities discoverable", () => {
  let graph: Graph;
  let recording: { id: string; slug: string };

  beforeAll(async () => {
    graph = await buildGraph("published");
    recording = await publishedRecordingFor(graph, `Elig Published Recording ${TOKEN}`);
  }, T);

  it("all nine entity types become discoverable on every surface", async () => {
    const verdict = await surfaces(graph);
    expect(verdict.pages).toEqual(ALL_TRUE);
    expect(verdict.search).toEqual(ALL_TRUE);
    expect(verdict.sitemap).toEqual(ALL_TRUE);
    expect((await listPublicRecordingSitemapEntries()).some((r) => r.slug === recording.slug)).toBe(true);
  }, T);

  it("the Recording page and the related-entity pages link to each other (existing published content keeps working)", async () => {
    const page = await getPublicRecordingPageData(recording.slug);
    expect(page).not.toBeNull();
    expect(page!.works.map((w) => w.slug)).toEqual([graph.work.slug]);
    expect(page!.performance?.slug).toBe(graph.performance.slug);
    expect(page!.programme?.slug).toBe(graph.programme.slug);
    expect(page!.performance?.venue?.organisation?.slug).toBe(graph.organisation.slug);

    const composer = await getComposerEntityPageData(graph.composer.slug);
    expect(composer!.relatedWorks?.map((w) => w.slug)).toEqual([graph.work.slug]);
    expect(composer!.relatedRecordings.map((r) => r.slug)).toContain(recording.slug);

    const venue = await getVenueEntityPageData(graph.venue.slug);
    expect(venue!.relatedPerformances.map((p) => p.slug)).toContain(graph.performance.slug);
  }, T);

  it("a new draft forked from the published Recording keeps its entities discoverable (the public page stays live)", async () => {
    await forkDraftFromPublished(recording.id, userId);
    const verdict = await surfaces(graph);
    expect(verdict.pages).toEqual(ALL_TRUE);
    expect(verdict.sitemap).toEqual(ALL_TRUE);
  }, T);

  it("unpublishing the Recording withdraws every entity again", async () => {
    await unpublishRecording(recording.id, userId);
    const verdict = await surfaces(graph);
    expect(verdict.pages).toEqual(ALL_FALSE);
    expect(verdict.search).toEqual(ALL_FALSE);
    expect(verdict.sitemap).toEqual(ALL_FALSE);
  }, T);

  it("archiving a Recording withdraws them too", async () => {
    const g = await buildGraph("archivedrec");
    const rec = await publishedRecordingFor(g, `Elig Archived Recording ${TOKEN}`);
    expect((await surfaces(g)).pages).toEqual(ALL_TRUE);
    await archiveRecording(rec.id, userId);
    expect((await surfaces(g)).pages).toEqual(ALL_FALSE);
  }, T);
});

describe("D. Entities are reusable: one published Recording is enough, drafts do not hide them", () => {
  it("an entity used by both a draft and a published Recording stays discoverable", async () => {
    const graph = await buildGraph("shared");
    await publishedRecordingFor(graph, `Elig Shared Published ${TOKEN}`);
    await draftRecordingFor(graph, `Elig Shared Draft ${TOKEN}`);
    expect((await surfaces(graph)).pages).toEqual(ALL_TRUE);
  }, T);
});

describe("E. Archived related entities are omitted, never rendered as links that 404", () => {
  it("an archived participant is dropped from a published Performance and Recording page; an archived Work is dropped from the Recording", async () => {
    const graph = await buildGraph("archivedrel");
    const recording = await publishedRecordingFor(graph, `Elig ArchivedRel Recording ${TOKEN}`);
    await archiveArtist(graph.artist.id, userId);
    await archiveMusicalWork(graph.work.id, userId);

    const performance = await getPublicPerformancePageData(graph.performance.slug);
    expect(performance!.artists).toHaveLength(0);
    expect(performance!.choirs).toHaveLength(1);

    const page = await getPublicRecordingPageData(recording.slug);
    expect(page!.works).toHaveLength(0);
    expect(page!.performance?.artists).toHaveLength(0);
    expect(page!.performance?.choirs).toHaveLength(1);

    // The archived Work's own page is gone too, and the Programme no longer lists it.
    expect(await getPublicWorkPageData(graph.work.slug)).toBeNull();
    const programme = await getPublicProgrammePageData(graph.programme.slug);
    expect(programme!.items).toHaveLength(0);
  }, T);

  it("archiving a Venue withdraws its Performance and the Venue page, and the Recording drops the performance block", async () => {
    const graph = await buildGraph("archivedvenue");
    const recording = await publishedRecordingFor(graph, `Elig ArchivedVenue Recording ${TOKEN}`);
    await archiveVenue(graph.venue.id, userId);

    expect(await getVenueEntityPageData(graph.venue.slug)).toBeNull();
    expect(await getPublicPerformancePageData(graph.performance.slug)).toBeNull();
    const page = await getPublicRecordingPageData(recording.slug);
    expect(page!.performance).toBeNull();
    expect(page!.programme).toBeNull();
  }, T);

  it("archiving a Composer withdraws their Works everywhere", async () => {
    const graph = await buildGraph("archivedcomposer");
    const recording = await publishedRecordingFor(graph, `Elig ArchivedComposer Recording ${TOKEN}`);
    await archiveComposer(graph.composer.id, userId);

    expect(await getComposerEntityPageData(graph.composer.slug)).toBeNull();
    expect(await getPublicWorkPageData(graph.work.slug)).toBeNull();
    const page = await getPublicRecordingPageData(recording.slug);
    expect(page!.works).toHaveLength(0);
  }, T);

  it("an archived Organisation is not linked from the Venue or Recording page", async () => {
    const graph = await buildGraph("archivedorg");
    const recording = await publishedRecordingFor(graph, `Elig ArchivedOrg Recording ${TOKEN}`);
    await archiveOrganisation(graph.organisation.id, userId);

    expect(await getPublicOrganisationPageData(graph.organisation.slug)).toBeNull();
    const venue = await getVenueEntityPageData(graph.venue.slug);
    expect(venue!.venueDetails?.organisation).toBeNull();
    const page = await getPublicRecordingPageData(recording.slug);
    expect(page!.performance?.venue?.organisation).toBeNull();
  }, T);
});

describe("F. Only APPROVED Sources appear on the public Organisation page", () => {
  it("unreviewed and rejected Sources are hidden; an approved one is shown", async () => {
    const graph = await buildGraph("sources");
    const recording = await publishedRecordingFor(graph, `Elig Sources Recording ${TOKEN}`);

    const unreviewed = await createSource({ title: `Elig Unreviewed ${TOKEN}`, actorId: userId });
    const rejected = await createSource({ title: `Elig Rejected ${TOKEN}`, actorId: userId });
    const approved = await createSource({ title: `Elig Approved ${TOKEN}`, actorId: userId });
    sourceIds.push(unreviewed.id, rejected.id, approved.id);
    await rejectSource(rejected.id, userId);
    await approveSource(approved.id, userId);
    for (const source of [unreviewed, rejected, approved]) {
      await attachSourceToEntity({ sourceId: source.id, entityType: "RECORDING", entityId: recording.id, actorId: userId });
    }

    const page = await getPublicOrganisationPageData(graph.organisation.slug);
    expect(page).not.toBeNull();
    expect(page!.sources.map((s) => s.title)).toEqual([`Elig Approved ${TOKEN}`]);
  }, T);
});
