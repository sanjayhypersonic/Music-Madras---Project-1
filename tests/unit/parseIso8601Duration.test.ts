import { describe, expect, it } from "vitest";
import { parseIso8601Duration } from "../../modules/youtube/sync-engine/parseIso8601Duration";

describe("parseIso8601Duration", () => {
  it("parses minutes and seconds", () => {
    expect(parseIso8601Duration("PT4M13S")).toBe(4 * 60 + 13);
  });

  it("parses hours, minutes, and seconds together", () => {
    expect(parseIso8601Duration("PT1H2M3S")).toBe(3600 + 120 + 3);
  });

  it("parses seconds only", () => {
    expect(parseIso8601Duration("PT45S")).toBe(45);
  });

  it("parses hours only (a livestream-length video)", () => {
    expect(parseIso8601Duration("PT3H")).toBe(3 * 3600);
  });

  it("truncates fractional seconds", () => {
    expect(parseIso8601Duration("PT1M30.5S")).toBe(90);
  });

  it("returns null for null input", () => {
    expect(parseIso8601Duration(null)).toBeNull();
  });

  it("returns null for an unparseable string", () => {
    expect(parseIso8601Duration("not-a-duration")).toBeNull();
  });

  it("returns null for the bare 'P' with no components", () => {
    expect(parseIso8601Duration("P")).toBeNull();
  });
});
