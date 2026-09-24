import { describe, expect, it } from "vitest";
import { generatePerformanceSlug } from "../../modules/mmke/slug/generatePerformanceSlug";

describe("generatePerformanceSlug", () => {
  it("builds a lowercase, hyphenated slug from programme title, venue name, and date", () => {
    const slug = generatePerformanceSlug({
      programmeTitle: "December Season Concert",
      venueName: "St. Mary's Church",
      performanceDate: new Date("2024-12-15T00:00:00.000Z"),
      performanceId: "abcdef12-3456-7890-abcd-ef1234567890",
    });
    expect(slug).toBe("december-season-concert-st-mary-s-church-2024-12-15-abcdef12");
  });

  it("omits the date segment entirely when performanceDate is null, never fabricating one", () => {
    const slug = generatePerformanceSlug({
      programmeTitle: "December Season Concert",
      venueName: "St. Mary's Church",
      performanceDate: null,
      performanceId: "abcdef12-3456-7890-abcd-ef1234567890",
    });
    expect(slug).toBe("december-season-concert-st-mary-s-church-abcdef12");
  });

  it("is deterministic — identical inputs always produce identical output", () => {
    const input = {
      programmeTitle: "Christmas Recital",
      venueName: "Music Academy",
      performanceDate: new Date("2023-01-01T00:00:00.000Z"),
      performanceId: "11111111-2222-3333-4444-555555555555",
    };
    expect(generatePerformanceSlug(input)).toBe(generatePerformanceSlug(input));
  });

  it("produces different slugs for two performances with identical Programme/Venue/date, since each has a different id (collision handling)", () => {
    const shared = {
      programmeTitle: "Christmas Recital",
      venueName: "Music Academy",
      performanceDate: new Date("2023-01-01T00:00:00.000Z"),
    };
    const slugOne = generatePerformanceSlug({ ...shared, performanceId: "11111111-0000-0000-0000-000000000000" });
    const slugTwo = generatePerformanceSlug({ ...shared, performanceId: "22222222-0000-0000-0000-000000000000" });
    expect(slugOne).not.toBe(slugTwo);
    expect(slugOne).toBe("christmas-recital-music-academy-2023-01-01-11111111");
    expect(slugTwo).toBe("christmas-recital-music-academy-2023-01-01-22222222");
  });
});
