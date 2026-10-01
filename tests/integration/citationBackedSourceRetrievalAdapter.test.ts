import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../modules/db/client";
import { approveSource, createSource, disableSource, rejectSource } from "../../modules/db/repositories/sourceRepository";
import { createCitation } from "../../modules/db/repositories/citationRepository";
import { CitationBackedSourceRetrievalAdapter } from "../../modules/ai/retrieval/citationBackedSourceRetrievalAdapter";

// Phase 6H-8 — proves the only real Source Retrieval Adapter against the
// real database: it reads already-stored Citation rows (never a network
// call), re-checks approval state defensively, and produces a stable
// content fingerprint.

const TEST_TAG = "phase6h8-retrieval";

function uniqueName(base: string): string {
  return `${TEST_TAG} ${base} ${randomUUID().slice(0, 8)}`;
}

async function createTestUser() {
  return prisma.studioUser.create({
    data: { id: randomUUID(), email: `${TEST_TAG}-${randomUUID().slice(0, 8)}@musicmadras.test`, name: "Phase 6H-8 Test User", role: "EDITOR", status: "ACTIVE" },
  });
}

async function cleanupSource(sourceId: string) {
  await prisma.citation.deleteMany({ where: { sourceId } });
  await prisma.entitySource.deleteMany({ where: { sourceId } });
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Source", entityId: sourceId } });
  await prisma.source.delete({ where: { id: sourceId } }).catch(() => {});
}

describe("CitationBackedSourceRetrievalAdapter against a real database", () => {
  let sourceId: string | null = null;
  let userId: string | null = null;

  afterEach(async () => {
    if (sourceId) {
      await cleanupSource(sourceId).catch(() => {});
      sourceId = null;
    }
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  it("returns SOURCE_NOT_FOUND for an id that does not exist", async () => {
    const adapter = new CitationBackedSourceRetrievalAdapter();
    const result = await adapter.retrieve({ sourceId: randomUUID() });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("SOURCE_NOT_FOUND");
  });

  it("returns SOURCE_NOT_APPROVED for an UNREVIEWED Source, even though it exists", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("Unreviewed"), actorId: user.id });
    sourceId = source.id;

    const adapter = new CitationBackedSourceRetrievalAdapter();
    const result = await adapter.retrieve({ sourceId: source.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("SOURCE_NOT_APPROVED");
  });

  it("returns SOURCE_NOT_APPROVED for a REJECTED Source", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("Rejected"), actorId: user.id });
    sourceId = source.id;
    await rejectSource(source.id, user.id);

    const result = await new CitationBackedSourceRetrievalAdapter().retrieve({ sourceId: source.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("SOURCE_NOT_APPROVED");
  });

  it("returns SOURCE_NOT_APPROVED for a DISABLED Source (previously approved)", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("Disabled") , actorId: user.id });
    sourceId = source.id;
    await approveSource(source.id, user.id);
    await disableSource(source.id, user.id);

    const result = await new CitationBackedSourceRetrievalAdapter().retrieve({ sourceId: source.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("SOURCE_NOT_APPROVED");
  });

  it("returns an empty citations array with a null fingerprint for an APPROVED Source with no Citation rows yet", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("No Citations") , actorId: user.id });
    sourceId = source.id;
    await approveSource(source.id, user.id);

    const result = await new CitationBackedSourceRetrievalAdapter().retrieve({ sourceId: source.id });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.citations).toEqual([]);
      expect(result.contentFingerprint).toBeNull();
    }
  });

  it("returns an APPROVED Source's Citation text and a non-null content fingerprint", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("With Citations"), actorId: user.id });
    sourceId = source.id;
    await approveSource(source.id, user.id);
    const citation = await createCitation({ text: "A verified excerpt.", sourceId: source.id, actorId: user.id });

    const result = await new CitationBackedSourceRetrievalAdapter().retrieve({ sourceId: source.id });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.citations).toEqual([{ id: citation.id, text: "A verified excerpt." }]);
      expect(result.contentFingerprint).not.toBeNull();
    }
  });

  it("produces the same content fingerprint for the same Citation content across repeated retrievals (deterministic)", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("Deterministic Fingerprint"), actorId: user.id });
    sourceId = source.id;
    await approveSource(source.id, user.id);
    await createCitation({ text: "Stable content.", sourceId: source.id, actorId: user.id });

    const adapter = new CitationBackedSourceRetrievalAdapter();
    const first = await adapter.retrieve({ sourceId: source.id });
    const second = await adapter.retrieve({ sourceId: source.id });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.contentFingerprint).toBe(second.contentFingerprint);
    }
  });

  it("produces a different content fingerprint once Citation content changes", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("Changed Fingerprint"), actorId: user.id });
    sourceId = source.id;
    await approveSource(source.id, user.id);
    await createCitation({ text: "Original content.", sourceId: source.id, actorId: user.id });

    const adapter = new CitationBackedSourceRetrievalAdapter();
    const before = await adapter.retrieve({ sourceId: source.id });

    await createCitation({ text: "A second, additional excerpt.", sourceId: source.id, actorId: user.id });
    const after = await adapter.retrieve({ sourceId: source.id });

    expect(before.ok && after.ok).toBe(true);
    if (before.ok && after.ok) {
      expect(before.contentFingerprint).not.toBe(after.contentFingerprint);
    }
  });

  it("performs no database writes — row counts are unchanged after retrieval", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("Read Only"), actorId: user.id });
    sourceId = source.id;
    await approveSource(source.id, user.id);
    await createCitation({ text: "Some text.", sourceId: source.id, actorId: user.id });

    const countsBefore = await Promise.all([prisma.source.count(), prisma.citation.count(), prisma.auditLogEntry.count()]);
    await new CitationBackedSourceRetrievalAdapter().retrieve({ sourceId: source.id });
    const countsAfter = await Promise.all([prisma.source.count(), prisma.citation.count(), prisma.auditLogEntry.count()]);

    expect(countsAfter).toEqual(countsBefore);
  });
});
