import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../modules/db/client";
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import { createProgramme, addProgrammeItem } from "../../modules/db/repositories/programmeRepository";
import { createVenue } from "../../modules/db/repositories/venueRepository";
import { createOrganisation } from "../../modules/db/repositories/organisationRepository";
import { createPerformance } from "../../modules/db/repositories/performanceRepository";
import { createDraftRecording, attachWorkToRevision, publishCurrentDraft, updateDraftRevisionContent } from "../../modules/db/repositories/recordingRepository";
import { approveSource, attachSourceToEntity, createSource } from "../../modules/db/repositories/sourceRepository";
import { getRecordingContext } from "../../modules/db/repositories/recordingContextRepository";
import { buildEvidenceIndex } from "../../modules/ai/structuredOutput/buildEvidenceIndex";
import { WikipediaSourceRetrievalAdapter } from "../../modules/ai/retrieval/wikipedia/wikipediaSourceRetrievalAdapter";
import { FakeWikipediaRestClient } from "../../modules/ai/retrieval/wikipedia/fakeWikipediaRestClient";

// Phase 6H-9 — proves the full, real pipeline this phase exists to
// establish, end to end against the real database:
//
//   registered Source -> APPROVED -> explicit EntitySource association
//     -> Wikipedia retrieval -> normalized Citation
//     -> RecordingContext (via the UNCHANGED, 6H-8 CitationBackedSourceRetrievalAdapter)
//     -> buildEvidenceIndex
//
// with zero changes to recordingContextRepository.ts, assembleRecordingContext.ts,
// or buildEvidenceIndex.ts required for this phase — the only new wiring is
// the explicit Wikipedia retrieval action that populates the Citation this
// existing pathway already reads.

const TEST_TAG = "phase6h9-pipeline";

function uniqueSlug(base: string): string {
  return `${TEST_TAG}-${base}-${randomUUID().slice(0, 8)}`;
}

async function createTestUser() {
  return prisma.studioUser.create({
    data: { id: randomUUID(), email: `${TEST_TAG}-${randomUUID().slice(0, 8)}@musicmadras.test`, name: "Phase 6H-9 Test User", role: "EDITOR", status: "ACTIVE" },
  });
}

interface Fixture {
  user: { id: string };
  composer: { id: string; name: string };
  work: { id: string };
  organisation: { id: string };
  venue: { id: string };
  programme: { id: string };
  performance: { id: string };
  recordingId: string;
}

// Every named entity below is randomized, not just Organisation/Composer:
// Composer, Venue, and (per the existing createComposer/createVenue
// duplicate-name guard) any other named entity with such a guard will throw
// DuplicateEntityError if two fixtures — in this file or, since vitest runs
// separate test files in parallel against the same shared database, in a
// DIFFERENT integration test file — ever use the exact same literal name at
// the same time. A hardcoded "Test Work"/"Test Programme" title is safe
// here only because those are not globally duplicate-guarded; Venue is, so
// it is randomized like Composer.
async function createPublishedRecordingFixture(): Promise<Fixture> {
  const user = await createTestUser();
  const organisation = await createOrganisation({ slug: uniqueSlug("organisation"), name: `Test Organisation ${randomUUID().slice(0, 8)}`, actorId: user.id });
  const composer = await createComposer({ slug: uniqueSlug("composer"), name: `Test Composer ${randomUUID().slice(0, 8)}`, actorId: user.id });
  const work = await createMusicalWork({ slug: uniqueSlug("work"), title: "Test Work", composerId: composer.id, actorId: user.id });
  const programme = await createProgramme({ slug: uniqueSlug("programme"), title: "Test Programme", actorId: user.id });
  await addProgrammeItem({ programmeId: programme.id, musicalWorkId: work.id, movement: "I. Allegro", actorId: user.id });
  const venue = await createVenue({ slug: uniqueSlug("venue"), name: `Test Venue ${randomUUID().slice(0, 8)}`, type: "CHURCH", organisationId: organisation.id, actorId: user.id });
  const performance = await createPerformance({ programmeId: programme.id, venueId: venue.id, performanceDate: new Date("2020-05-01"), actorId: user.id });

  const draft = await createDraftRecording({ slug: uniqueSlug("recording"), actorId: user.id, title: "Test Recording" });
  await updateDraftRevisionContent(draft.id, draft.currentDraftRevision!.updatedAt, user.id, { performanceId: performance.id });
  await attachWorkToRevision(draft.currentDraftRevision!.id, work.id, user.id);
  const published = await publishCurrentDraft(draft.id, user.id);

  return {
    user,
    composer: { id: composer.id, name: composer.name },
    work: { id: work.id },
    organisation: { id: organisation.id },
    venue: { id: venue.id },
    programme: { id: programme.id },
    performance: { id: performance.id },
    recordingId: published.id,
  };
}

async function cleanupFixture(fixture: Fixture, sourceIds: string[]) {
  for (const sourceId of sourceIds) {
    await prisma.citation.deleteMany({ where: { sourceId } });
    await prisma.entitySource.deleteMany({ where: { sourceId } });
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "Source", entityId: sourceId } });
    await prisma.source.delete({ where: { id: sourceId } }).catch(() => {});
  }

  const revisions = await prisma.recordingRevision.findMany({ where: { recordingId: fixture.recordingId }, select: { id: true } });
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Recording", entityId: fixture.recordingId } });
  if (revisions.length > 0) {
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "RecordingRevision", entityId: { in: revisions.map((r) => r.id) } } });
  }
  await prisma.recording.delete({ where: { id: fixture.recordingId } }).catch(() => {});

  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Performance", entityId: fixture.performance.id } });
  await prisma.performance.delete({ where: { id: fixture.performance.id } }).catch(() => {}); // cascades PerformancePerformer

  // Programme (cascades ProgrammeItem) MUST be deleted before MusicalWork —
  // ProgrammeItem.musicalWorkId references it, so deleting MusicalWork
  // first throws a silently-caught FK error, leaving MusicalWork (and
  // therefore Composer, and therefore StudioUser) all orphaned. This exact
  // ordering bug produced real orphaned rows the first time this file ran;
  // fixed here, not just worked around.
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Programme", entityId: fixture.programme.id } });
  await prisma.programme.delete({ where: { id: fixture.programme.id } }).catch(() => {});
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Venue", entityId: fixture.venue.id } });
  await prisma.venue.delete({ where: { id: fixture.venue.id } }).catch(() => {});

  const work = await prisma.musicalWork.findUnique({ where: { id: fixture.work.id } });
  if (work) {
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "MusicalWork", entityId: fixture.work.id } });
    await prisma.musicalWork.delete({ where: { id: fixture.work.id } });
  }
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Composer", entityId: fixture.composer.id } });
  await prisma.composer.delete({ where: { id: fixture.composer.id } });

  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Organisation", entityId: fixture.organisation.id } });
  await prisma.organisation.delete({ where: { id: fixture.organisation.id } }).catch(() => {});

  await prisma.studioUser.deleteMany({ where: { id: fixture.user.id } });
}

describe("Phase 6H-9 — external Wikipedia evidence flowing through the existing RecordingContext pathway", () => {
  it(
    "O/S/20/21. an APPROVED, explicitly-associated Wikipedia source's retrieved citation reaches RecordingContext and the evidence index",
    async () => {
    const fixture = await createPublishedRecordingFixture();
    const source = await createSource({ title: "Test Composer — Wikipedia", url: "https://en.wikipedia.org/wiki/Test_Composer_Pipeline_Page", actorId: fixture.user.id });
    try {
      await attachSourceToEntity({ entityType: "WORK", entityId: fixture.work.id, sourceId: source.id, actorId: fixture.user.id });
      await approveSource(source.id, fixture.user.id);

      const adapter = new WikipediaSourceRetrievalAdapter(new FakeWikipediaRestClient({ summary: { extract: "Retrieved Wikipedia extract about the work." } }));
      const retrieval = await adapter.retrieve({ sourceId: source.id, actorId: fixture.user.id });
      expect(retrieval.ok).toBe(true);

      // No new wiring was added to the Context Assembler for this phase —
      // getRecordingContext still defaults to CitationBackedSourceRetrievalAdapter,
      // which now picks up the Citation the Wikipedia adapter just persisted.
      const result = await getRecordingContext(fixture.recordingId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const contextSource = result.context.provenance.sources.find((s) => s.id === source.id);
      expect(contextSource).toBeDefined();
      expect(contextSource?.approvalState).toBe("APPROVED");
      expect(contextSource?.citations.map((c) => c.text)).toContain("Retrieved Wikipedia extract about the work.");

      const index = buildEvidenceIndex(result.context);
      const citationId = contextSource!.citations[0].id;
      expect(index.get(citationId)).toEqual({ sourceType: "APPROVED_EXTERNAL_SOURCE", entityType: "Citation", entityId: citationId, field: "provenance" });
    } finally {
      await cleanupFixture(fixture, [source.id]);
    }
    },
    45000 // more DB round trips than any other test here (full fixture + retrieval + getRecordingContext); the shared default (20s) is tuned for lighter tests and occasionally too tight under elevated Neon latency.
  );

  it("P. an APPROVED Wikipedia source that is NOT attached to this Recording/Work/Composer never enters its RecordingContext", async () => {
    const fixture = await createPublishedRecordingFixture();
    const unassociatedSource = await createSource({ title: "Unassociated — Wikipedia", url: "https://en.wikipedia.org/wiki/Unassociated_Page", actorId: fixture.user.id });
    try {
      // Deliberately never attached to the fixture's Work/Composer/Recording.
      await approveSource(unassociatedSource.id, fixture.user.id);
      await new WikipediaSourceRetrievalAdapter(new FakeWikipediaRestClient()).retrieve({ sourceId: unassociatedSource.id, actorId: fixture.user.id });

      const result = await getRecordingContext(fixture.recordingId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.context.provenance.sources.map((s) => s.id)).not.toContain(unassociatedSource.id);
    } finally {
      await cleanupFixture(fixture, [unassociatedSource.id]);
    }
  }, 45000);

  it("Q. retrieved external evidence never changes canonical MMKE fields (Work title, Composer name)", async () => {
    const fixture = await createPublishedRecordingFixture();
    const source = await createSource({ title: "Canonical Protection — Wikipedia", url: "https://en.wikipedia.org/wiki/Canonical_Protection_Page", actorId: fixture.user.id });
    try {
      await attachSourceToEntity({ entityType: "WORK", entityId: fixture.work.id, sourceId: source.id, actorId: fixture.user.id });
      await approveSource(source.id, fixture.user.id);
      await new WikipediaSourceRetrievalAdapter(new FakeWikipediaRestClient({ summary: { extract: "A completely different composer biography that must never overwrite MMKE." } })).retrieve({
        sourceId: source.id,
        actorId: fixture.user.id,
      });

      const work = await prisma.musicalWork.findUnique({ where: { id: fixture.work.id } });
      const composer = await prisma.composer.findUnique({ where: { id: fixture.composer.id } });
      expect(work?.title).toBe("Test Work");
      expect(composer?.name).toBe(fixture.composer.name);
    } finally {
      await cleanupFixture(fixture, [source.id]);
    }
  }, 45000);

  it("Y. a retrieval attempt on an UNREVIEWED source never auto-approves it", async () => {
    const fixture = await createPublishedRecordingFixture();
    const source = await createSource({ title: "Never Auto-Approved — Wikipedia", url: "https://en.wikipedia.org/wiki/Never_Auto_Approved_Page", actorId: fixture.user.id });
    try {
      await attachSourceToEntity({ entityType: "WORK", entityId: fixture.work.id, sourceId: source.id, actorId: fixture.user.id });
      const result = await new WikipediaSourceRetrievalAdapter(new FakeWikipediaRestClient()).retrieve({ sourceId: source.id, actorId: fixture.user.id });
      expect(result.ok).toBe(false);

      const reloaded = await prisma.source.findUnique({ where: { id: source.id } });
      expect(reloaded?.approvalState).toBe("UNREVIEWED");
    } finally {
      await cleanupFixture(fixture, [source.id]);
    }
  }, 45000);

  it("X/W. no publication state or Recording field changes as a side effect of retrieval", async () => {
    const fixture = await createPublishedRecordingFixture();
    const source = await createSource({ title: "No Publication Side Effect — Wikipedia", url: "https://en.wikipedia.org/wiki/No_Publication_Page", actorId: fixture.user.id });
    try {
      await attachSourceToEntity({ entityType: "WORK", entityId: fixture.work.id, sourceId: source.id, actorId: fixture.user.id });
      await approveSource(source.id, fixture.user.id);

      const before = await prisma.recording.findUnique({ where: { id: fixture.recordingId } });
      await new WikipediaSourceRetrievalAdapter(new FakeWikipediaRestClient()).retrieve({ sourceId: source.id, actorId: fixture.user.id });
      const after = await prisma.recording.findUnique({ where: { id: fixture.recordingId } });

      expect(after?.status).toBe(before?.status);
      expect(after?.currentPublishedRevisionId).toBe(before?.currentPublishedRevisionId);
      expect(after?.updatedAt).toEqual(before?.updatedAt);
    } finally {
      await cleanupFixture(fixture, [source.id]);
    }
  }, 45000);
});
