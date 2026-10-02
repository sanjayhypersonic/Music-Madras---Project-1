import { describe, expect, it } from "vitest";
import { FakeWikipediaRestClient } from "../../modules/ai/retrieval/wikipedia/fakeWikipediaRestClient";

// Phase 6H-9 — deterministic, DB-free, network-free tests for the fake
// Wikimedia REST client used by the adapter's integration tests.

describe("FakeWikipediaRestClient", () => {
  it("defaults to SUCCESS, echoing back the requested title", async () => {
    const client = new FakeWikipediaRestClient();
    const result = await client.fetchSummary("Some_Page");
    expect(result).toMatchObject({ ok: true, summary: { title: "Some_Page" } });
  });

  it("returns exactly the injected summary override fields on SUCCESS", async () => {
    const client = new FakeWikipediaRestClient({ summary: { extract: "A specific extract.", description: "A description." } });
    const result = await client.fetchSummary("Some_Page");
    expect(result).toMatchObject({ ok: true, summary: { extract: "A specific extract.", description: "A description." } });
  });

  it("simulates EXTERNAL_PAGE_NOT_FOUND", async () => {
    const client = new FakeWikipediaRestClient({ mode: "EXTERNAL_PAGE_NOT_FOUND" });
    const result = await client.fetchSummary("Nonexistent_Page");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("EXTERNAL_PAGE_NOT_FOUND");
  });

  it("simulates MALFORMED_RESPONSE", async () => {
    const client = new FakeWikipediaRestClient({ mode: "MALFORMED_RESPONSE" });
    const result = await client.fetchSummary("Some_Page");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("MALFORMED_RESPONSE");
  });

  it("simulates TIMEOUT", async () => {
    const client = new FakeWikipediaRestClient({ mode: "TIMEOUT" });
    const result = await client.fetchSummary("Some_Page");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("TIMEOUT");
  });

  it("simulates UNAVAILABLE", async () => {
    const client = new FakeWikipediaRestClient({ mode: "UNAVAILABLE" });
    const result = await client.fetchSummary("Some_Page");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("UNAVAILABLE");
  });
});
