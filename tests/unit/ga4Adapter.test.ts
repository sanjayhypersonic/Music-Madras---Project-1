import { describe, expect, it, vi } from "vitest";
import { Ga4Adapter } from "../../modules/analytics/providers/ga4/ga4Adapter";

describe("Ga4Adapter — safe by default (brief §6: 'do NOT send production events yet')", () => {
  it("never makes a network call when unconfigured", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const adapter = new Ga4Adapter({});
    const result = await adapter.send({ name: "recording_view", occurredAt: new Date() });

    expect(result).toEqual({ delivered: false, provider: "ga4", reason: "not_configured" });
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it("is also unconfigured with only a measurementId and no apiSecret", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const adapter = new Ga4Adapter({ measurementId: "G-EXAMPLE" });

    const result = await adapter.send({ name: "recording_view", occurredAt: new Date() });

    expect(result.delivered).toBe(false);
    expect(result.reason).toBe("not_configured");
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it("reports the correct provider name", () => {
    const adapter = new Ga4Adapter({});
    expect(adapter.providerName).toBe("ga4");
  });
});
