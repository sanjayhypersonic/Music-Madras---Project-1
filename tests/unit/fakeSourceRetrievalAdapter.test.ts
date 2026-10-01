import { describe, expect, it } from "vitest";
import { FakeSourceRetrievalAdapter } from "../../modules/ai/retrieval/fakeSourceRetrievalAdapter";

// Phase 6H-8 — deterministic, DB-free tests for the fake Source Retrieval
// Adapter used by higher-level tests to simulate retrieval outcomes without
// touching the database.

describe("FakeSourceRetrievalAdapter", () => {
  it("defaults to SUCCESS with no citations and no fingerprint — honest default, nothing conveniently pre-populated", async () => {
    const adapter = new FakeSourceRetrievalAdapter();
    const result = await adapter.retrieve({ sourceId: "source-1" });
    expect(result).toMatchObject({ ok: true, sourceId: "source-1", citations: [], contentFingerprint: null });
  });

  it("returns exactly the injected citations and fingerprint on SUCCESS", async () => {
    const adapter = new FakeSourceRetrievalAdapter({
      citations: [{ id: "citation-1", text: "An excerpt." }],
      contentFingerprint: "abc123",
    });
    const result = await adapter.retrieve({ sourceId: "source-1" });
    expect(result).toMatchObject({ ok: true, citations: [{ id: "citation-1", text: "An excerpt." }], contentFingerprint: "abc123" });
  });

  it("simulates SOURCE_NOT_APPROVED", async () => {
    const adapter = new FakeSourceRetrievalAdapter({ mode: "SOURCE_NOT_APPROVED" });
    const result = await adapter.retrieve({ sourceId: "source-1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("SOURCE_NOT_APPROVED");
  });

  it("simulates SOURCE_NOT_FOUND", async () => {
    const adapter = new FakeSourceRetrievalAdapter({ mode: "SOURCE_NOT_FOUND" });
    const result = await adapter.retrieve({ sourceId: "source-1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("SOURCE_NOT_FOUND");
  });

  it("simulates UNAVAILABLE", async () => {
    const adapter = new FakeSourceRetrievalAdapter({ mode: "UNAVAILABLE" });
    const result = await adapter.retrieve({ sourceId: "source-1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("UNAVAILABLE");
  });

  it("simulates TIMEOUT", async () => {
    const adapter = new FakeSourceRetrievalAdapter({ mode: "TIMEOUT" });
    const result = await adapter.retrieve({ sourceId: "source-1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("TIMEOUT");
  });

  it("always echoes back the requested sourceId, on both success and failure", async () => {
    const success = await new FakeSourceRetrievalAdapter().retrieve({ sourceId: "source-xyz" });
    const failure = await new FakeSourceRetrievalAdapter({ mode: "TIMEOUT" }).retrieve({ sourceId: "source-xyz" });
    expect(success.sourceId).toBe("source-xyz");
    expect(failure.sourceId).toBe("source-xyz");
  });

  it("always sets retrievedAt to a Date, regardless of outcome", async () => {
    const result = await new FakeSourceRetrievalAdapter({ mode: "UNAVAILABLE" }).retrieve({ sourceId: "source-1" });
    expect(result.retrievedAt).toBeInstanceOf(Date);
  });
});
