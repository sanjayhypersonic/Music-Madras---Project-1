import { describe, expect, it } from "vitest";
import { toIso8601Duration } from "../../modules/mmke/catalogue/toIso8601Duration";

// Phase 6G-11 — the /videos/[slug] VideoObject JSON-LD's duration field
// must be a valid ISO 8601 duration (schema.org's own requirement), never
// the page's human-readable "5:32" display format.

describe("toIso8601Duration", () => {
  it("formats seconds only", () => {
    expect(toIso8601Duration(45)).toBe("PT45S");
  });

  it("formats minutes and seconds", () => {
    expect(toIso8601Duration(332)).toBe("PT5M32S");
  });

  it("formats hours, minutes and seconds", () => {
    expect(toIso8601Duration(3725)).toBe("PT1H2M5S");
  });

  it("formats an exact minute with no leftover seconds", () => {
    expect(toIso8601Duration(120)).toBe("PT2M");
  });

  it("formats zero as PT0S", () => {
    expect(toIso8601Duration(0)).toBe("PT0S");
  });
});
