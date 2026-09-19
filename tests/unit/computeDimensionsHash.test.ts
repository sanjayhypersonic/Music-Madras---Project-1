import { describe, expect, it } from "vitest";
import { computeDimensionsHash } from "../../modules/analytics/youtube/computeDimensionsHash";

describe("computeDimensionsHash", () => {
  it("returns an empty string for undefined dimensions", () => {
    expect(computeDimensionsHash(undefined)).toBe("");
  });

  it("returns an empty string for an empty dimensions object", () => {
    expect(computeDimensionsHash({})).toBe("");
  });

  it("produces the same hash regardless of key order (idempotency, brief §10)", () => {
    const a = computeDimensionsHash({ country: "IN", device: "MOBILE" });
    const b = computeDimensionsHash({ device: "MOBILE", country: "IN" });
    expect(a).toBe(b);
  });

  it("produces a different hash for different dimension values", () => {
    const a = computeDimensionsHash({ country: "IN" });
    const b = computeDimensionsHash({ country: "US" });
    expect(a).not.toBe(b);
  });

  it("produces a different hash for a different set of dimension keys", () => {
    const a = computeDimensionsHash({ country: "IN" });
    const b = computeDimensionsHash({ country: "IN", device: "MOBILE" });
    expect(a).not.toBe(b);
  });
});
