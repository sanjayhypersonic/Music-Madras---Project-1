import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../modules/db/client";
import { approveSource, createSource, disableSource, rejectSource } from "../../modules/db/repositories/sourceRepository";
import { WikipediaSourceRetrievalAdapter } from "../../modules/ai/retrieval/wikipedia/wikipediaSourceRetrievalAdapter";
import { FakeWikipediaRestClient } from "../../modules/ai/retrieval/wikipedia/fakeWikipediaRestClient";
import type { WikipediaFetchResult, WikipediaRestClient } from "../../modules/ai/retrieval/wikipedia/wikipediaRestClient";

// Phase 6H-9 — proves WikipediaSourceRetrievalAdapter's full logic (approval
// gating, URL-bound page resolution, fingerprinting, change detection,
// Citation persistence, audit) against the real database, with NO real
// network dependency — every test injects FakeWikipediaRestClient. This is
// the "controlled retrieval" half of the brief's required coverage
// (A-N); the end-to-end RecordingContext integration is covered separately
// in tests/integration/externalEvidenceContextPipeline.test.ts.

const TEST_TAG = "phase6h9-wikipedia";
const WIKIPEDIA_URL = "https://en.wikipedia.org/wiki/Test_Composer_Page";

function uniqueName(base: string): string {
  return `${TEST_TAG} ${base} ${randomUUID().slice(0, 8)}`;
}

async function createTestUser() {
  return prisma.studioUser.create({
    data: { id: randomUUID(), email: `${TEST_TAG}-${randomUUID().slice(0, 8)}@musicmadras.test`, name: "Phase 6H-9 Test User", role: "EDITOR", status: "ACTIVE" },
  });
}

async function cleanupSource(sourceId: string) {
  await prisma.citation.deleteMany({ where: { sourceId } });
  await prisma.entitySource.deleteMany({ where: { sourceId } });
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Source", entityId: sourceId } });
  await prisma.source.delete({ where: { id: sourceId } }).catch(() => {});
}

/** Wraps FakeWikipediaRestClient to count real invocations — proves "rejected before any network call." */
class CountingWikipediaRestClient implements WikipediaRestClient {
  calls = 0;
  constructor(private readonly inner: WikipediaRestClient) {}
  async fetchSummary(pageTitle: string): Promise<WikipediaFetchResult> {
    this.calls += 1;
    return this.inner.fetchSummary(pageTitle);
  }
}

describe("WikipediaSourceRetrievalAdapter against a real database", () => {
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

  it("A. retrieves successfully for an APPROVED Wikipedia source", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("Approved"), url: WIKIPEDIA_URL, actorId: user.id });
    sourceId = source.id;
    await approveSource(source.id, user.id);

    const client = new FakeWikipediaRestClient({ summary: { extract: "A real extract." } });
    const adapter = new WikipediaSourceRetrievalAdapter(client);
    const result = await adapter.retrieve({ sourceId: source.id, actorId: user.id });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.citations).toEqual([{ id: expect.any(String), text: "A real extract." }]);
      expect(result.contentFingerprint).not.toBeNull();
    }
  });

  it("B. rejects an UNREVIEWED source before any network call", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("Unreviewed"), url: WIKIPEDIA_URL, actorId: user.id });
    sourceId = source.id;

    const client = new CountingWikipediaRestClient(new FakeWikipediaRestClient());
    const result = await new WikipediaSourceRetrievalAdapter(client).retrieve({ sourceId: source.id, actorId: user.id });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("SOURCE_NOT_APPROVED");
    expect(client.calls).toBe(0);
  });

  it("C. rejects a REJECTED source before any network call", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("Rejected"), url: WIKIPEDIA_URL, actorId: user.id });
    sourceId = source.id;
    await rejectSource(source.id, user.id);

    const client = new CountingWikipediaRestClient(new FakeWikipediaRestClient());
    const result = await new WikipediaSourceRetrievalAdapter(client).retrieve({ sourceId: source.id, actorId: user.id });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("SOURCE_NOT_APPROVED");
    expect(client.calls).toBe(0);
  });

  it("D. rejects a DISABLED source before any network call", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("Disabled"), url: WIKIPEDIA_URL, actorId: user.id });
    sourceId = source.id;
    await approveSource(source.id, user.id);
    await disableSource(source.id, user.id);

    const client = new CountingWikipediaRestClient(new FakeWikipediaRestClient());
    const result = await new WikipediaSourceRetrievalAdapter(client).retrieve({ sourceId: source.id, actorId: user.id });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("SOURCE_NOT_APPROVED");
    expect(client.calls).toBe(0);
  });

  it("E/F. an unregistered (nonexistent) Source id cannot be retrieved — arbitrary ids never bypass the registry", async () => {
    const user = await createTestUser();
    userId = user.id;
    const client = new CountingWikipediaRestClient(new FakeWikipediaRestClient());
    const result = await new WikipediaSourceRetrievalAdapter(client).retrieve({ sourceId: randomUUID(), actorId: user.id });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("SOURCE_NOT_FOUND");
    expect(client.calls).toBe(0);
  });

  it("E. retrieval is bound to the registered Source's url — the exact page title is derived, never supplied by the caller", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("Bound"), url: "https://en.wikipedia.org/wiki/Specific_Registered_Page", actorId: user.id });
    sourceId = source.id;
    await approveSource(source.id, user.id);

    let receivedTitle: string | null = null;
    const spyClient: WikipediaRestClient = {
      async fetchSummary(pageTitle) {
        receivedTitle = pageTitle;
        return { ok: true, summary: { title: pageTitle, description: null, extract: "x", canonicalUrl: null } };
      },
    };
    await new WikipediaSourceRetrievalAdapter(spyClient).retrieve({ sourceId: source.id, actorId: user.id });
    expect(receivedTitle).toBe("Specific_Registered_Page");
  });

  it("a Source whose url is not a recognized Wikipedia page is rejected as UNSUPPORTED_PROVIDER, never network-called (no arbitrary-URL bypass)", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("NotWikipedia"), url: "https://example.org/arbitrary-page", actorId: user.id });
    sourceId = source.id;
    await approveSource(source.id, user.id);

    const client = new CountingWikipediaRestClient(new FakeWikipediaRestClient());
    const result = await new WikipediaSourceRetrievalAdapter(client).retrieve({ sourceId: source.id, actorId: user.id });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("UNSUPPORTED_PROVIDER");
    expect(client.calls).toBe(0);
  });

  it("H/I. invalid/nonexistent page returns a controlled EXTERNAL_PAGE_NOT_FOUND failure", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("PageNotFound"), url: WIKIPEDIA_URL, actorId: user.id });
    sourceId = source.id;
    await approveSource(source.id, user.id);

    const client = new FakeWikipediaRestClient({ mode: "EXTERNAL_PAGE_NOT_FOUND" });
    const result = await new WikipediaSourceRetrievalAdapter(client).retrieve({ sourceId: source.id, actorId: user.id });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("EXTERNAL_PAGE_NOT_FOUND");
  });

  it("network/API failure is handled as a typed TIMEOUT failure, not a throw", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("Timeout"), url: WIKIPEDIA_URL, actorId: user.id });
    sourceId = source.id;
    await approveSource(source.id, user.id);

    const client = new FakeWikipediaRestClient({ mode: "TIMEOUT" });
    const result = await new WikipediaSourceRetrievalAdapter(client).retrieve({ sourceId: source.id, actorId: user.id });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("TIMEOUT");
  });

  it("network/API failure is handled as a typed UNAVAILABLE failure, not a throw", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("Unavailable"), url: WIKIPEDIA_URL, actorId: user.id });
    sourceId = source.id;
    await approveSource(source.id, user.id);

    const client = new FakeWikipediaRestClient({ mode: "UNAVAILABLE" });
    const result = await new WikipediaSourceRetrievalAdapter(client).retrieve({ sourceId: source.id, actorId: user.id });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("UNAVAILABLE");
  });

  it("N. malformed content fails safely as MALFORMED_RESPONSE, never partially persisted", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("Malformed"), url: WIKIPEDIA_URL, actorId: user.id });
    sourceId = source.id;
    await approveSource(source.id, user.id);

    const client = new FakeWikipediaRestClient({ mode: "MALFORMED_RESPONSE" });
    const result = await new WikipediaSourceRetrievalAdapter(client).retrieve({ sourceId: source.id, actorId: user.id });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("MALFORMED_RESPONSE");
    const citations = await prisma.citation.findMany({ where: { sourceId: source.id } });
    expect(citations).toHaveLength(0);
  });

  it("fails closed with MISSING_ACTOR when no actorId is supplied — never attributes a write to nobody", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("NoActor"), url: WIKIPEDIA_URL, actorId: user.id });
    sourceId = source.id;
    await approveSource(source.id, user.id);

    const client = new CountingWikipediaRestClient(new FakeWikipediaRestClient());
    const result = await new WikipediaSourceRetrievalAdapter(client).retrieve({ sourceId: source.id });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("MISSING_ACTOR");
    expect(client.calls).toBe(0);
  });

  it("G/H/I/10. retrieved evidence retains source identity, provenance, and is preserved verbatim as a real Citation", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("Provenance"), url: WIKIPEDIA_URL, actorId: user.id });
    sourceId = source.id;
    await approveSource(source.id, user.id);

    const client = new FakeWikipediaRestClient({ summary: { extract: "Verbatim retrieved text." } });
    const result = await new WikipediaSourceRetrievalAdapter(client).retrieve({ sourceId: source.id, actorId: user.id });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sourceId).toBe(source.id);
    const citation = await prisma.citation.findUnique({ where: { id: result.citations[0].id } });
    expect(citation?.sourceId).toBe(source.id);
    expect(citation?.text).toBe("Verbatim retrieved text.");
  });

  it("11. retrieval timestamp is recorded on the Source", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("Timestamp"), url: WIKIPEDIA_URL, actorId: user.id });
    sourceId = source.id;
    await approveSource(source.id, user.id);
    expect(source.lastRetrievedAt).toBeNull();

    await new WikipediaSourceRetrievalAdapter(new FakeWikipediaRestClient()).retrieve({ sourceId: source.id, actorId: user.id });
    const reloaded = await prisma.source.findUnique({ where: { id: source.id } });
    expect(reloaded?.lastRetrievedAt).not.toBeNull();
  });

  it("J/K. fingerprint is deterministic — identical content retrieved twice produces an UNCHANGED status with the same fingerprint", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("Deterministic"), url: WIKIPEDIA_URL, actorId: user.id });
    sourceId = source.id;
    await approveSource(source.id, user.id);

    const client = new FakeWikipediaRestClient({ summary: { extract: "Stable content." } });
    const adapter = new WikipediaSourceRetrievalAdapter(client);

    const first = await adapter.retrieve({ sourceId: source.id, actorId: user.id });
    const second = await adapter.retrieve({ sourceId: source.id, actorId: user.id });

    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.changeStatus).toBe("FIRST_RETRIEVAL");
      expect(second.changeStatus).toBe("UNCHANGED");
      expect(first.contentFingerprint).toBe(second.contentFingerprint);
    }
  });

  it("L. changed content produces a CHANGED status with a different fingerprint", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("Changed"), url: WIKIPEDIA_URL, actorId: user.id });
    sourceId = source.id;
    await approveSource(source.id, user.id);

    const adapter1 = new WikipediaSourceRetrievalAdapter(new FakeWikipediaRestClient({ summary: { extract: "Original content." } }));
    const before = await adapter1.retrieve({ sourceId: source.id, actorId: user.id });

    const adapter2 = new WikipediaSourceRetrievalAdapter(new FakeWikipediaRestClient({ summary: { extract: "Updated content." } }));
    const after = await adapter2.retrieve({ sourceId: source.id, actorId: user.id });

    expect(before.ok && after.ok).toBe(true);
    if (before.ok && after.ok) {
      expect(after.changeStatus).toBe("CHANGED");
      expect(before.contentFingerprint).not.toBe(after.contentFingerprint);
    }
  });

  it("audits EXTERNAL_SOURCE_RETRIEVAL_SUCCEEDED and EXTERNAL_SOURCE_CONTENT_CHANGED on a changed retrieval", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("AuditChanged"), url: WIKIPEDIA_URL, actorId: user.id });
    sourceId = source.id;
    await approveSource(source.id, user.id);

    await new WikipediaSourceRetrievalAdapter(new FakeWikipediaRestClient({ summary: { extract: "First." } })).retrieve({ sourceId: source.id, actorId: user.id });
    await new WikipediaSourceRetrievalAdapter(new FakeWikipediaRestClient({ summary: { extract: "Second, different." } })).retrieve({ sourceId: source.id, actorId: user.id });

    const succeeded = await prisma.auditLogEntry.findMany({ where: { entityType: "Source", entityId: source.id, action: "EXTERNAL_SOURCE_RETRIEVAL_SUCCEEDED" } });
    const changed = await prisma.auditLogEntry.findMany({ where: { entityType: "Source", entityId: source.id, action: "EXTERNAL_SOURCE_CONTENT_CHANGED" } });
    expect(succeeded).toHaveLength(2);
    expect(changed).toHaveLength(1);
  });

  it("audits EXTERNAL_SOURCE_RETRIEVAL_FAILED on a network failure", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("AuditFailed"), url: WIKIPEDIA_URL, actorId: user.id });
    sourceId = source.id;
    await approveSource(source.id, user.id);

    await new WikipediaSourceRetrievalAdapter(new FakeWikipediaRestClient({ mode: "UNAVAILABLE" })).retrieve({ sourceId: source.id, actorId: user.id });

    const failed = await prisma.auditLogEntry.findMany({ where: { entityType: "Source", entityId: source.id, action: "EXTERNAL_SOURCE_RETRIEVAL_FAILED" } });
    expect(failed).toHaveLength(1);
  });

  it("15/16/17. a changed retrieval never regenerates AI content, modifies canonical MMKE, or publishes anything — only the Source/Citation rows change", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("NoSideEffects"), url: WIKIPEDIA_URL, actorId: user.id });
    sourceId = source.id;
    await approveSource(source.id, user.id);

    const countsBefore = await Promise.all([
      prisma.composer.count(),
      prisma.musicalWork.count(),
      prisma.recording.count(),
      prisma.contentSuggestion.count(),
      prisma.contentGenerationRequest.count(),
    ]);

    await new WikipediaSourceRetrievalAdapter(new FakeWikipediaRestClient({ summary: { extract: "Some content." } })).retrieve({ sourceId: source.id, actorId: user.id });

    const countsAfter = await Promise.all([
      prisma.composer.count(),
      prisma.musicalWork.count(),
      prisma.recording.count(),
      prisma.contentSuggestion.count(),
      prisma.contentGenerationRequest.count(),
    ]);

    expect(countsAfter).toEqual(countsBefore);
  });
});
