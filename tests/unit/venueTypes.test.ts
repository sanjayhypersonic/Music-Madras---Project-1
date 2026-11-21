import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { CATALOGUE_VENUE_TYPES, isCatalogueVenueType, VENUE_TYPE_LABELS, VENUE_TYPE_LIST, venueSchemaType, venueTypeLabel } from "../../modules/mmke/catalogue/venueTypes";
import { VENUE_TYPE_WORDS } from "../../modules/ai/structuredOutput/validateVideoCreditsOutput";
import { VIDEO_VENUE_TYPES } from "../../modules/ai/prompts/videoCredits/videoCreditsPromptV1";
import { CATALOGUE_VENUE_TYPES as CREDITS_TOOL_TYPES, parseVenueType } from "../../modules/jobs/videoCreditsApproved";

// The catalogue's venue types in one place (modules/mmke/catalogue/venueTypes.ts), including INDOOR_AUDITORIUM (2026-11-21).

describe("catalogue venue types", () => {
  it("are exactly the Prisma VenueType enum, in order", () => {
    const schema = readFileSync(path.resolve(__dirname, "../../prisma/schema.prisma"), "utf8");
    const block = /enum VenueType \{([^}]*)\}/.exec(schema)?.[1] ?? "";
    expect(block.split(/\s+/).filter(Boolean)).toEqual([...CATALOGUE_VENUE_TYPES]);
  });

  it("include INDOOR_AUDITORIUM, labelled 'Indoor Auditorium', an EventVenue in JSON-LD", () => {
    expect(CATALOGUE_VENUE_TYPES).toContain("INDOOR_AUDITORIUM");
    expect(VENUE_TYPE_LABELS.INDOOR_AUDITORIUM).toBe("Indoor Auditorium");
    expect(venueTypeLabel("INDOOR_AUDITORIUM")).toBe("Indoor Auditorium");
    expect(venueSchemaType("INDOOR_AUDITORIUM")).toBe("EventVenue");
    expect(VENUE_TYPE_LIST).toBe("CHURCH, CATHEDRAL, CONCERT_HALL, STUDIO, OUTDOOR or INDOOR_AUDITORIUM");
  });

  it("label every type and map every type to a schema.org Place type; unknown values fall back safely", () => {
    expect(CATALOGUE_VENUE_TYPES.map(venueTypeLabel)).toEqual(["Church", "Cathedral", "Concert Hall", "Studio", "Outdoor", "Indoor Auditorium"]);
    expect(CATALOGUE_VENUE_TYPES.map(venueSchemaType)).toEqual(["Church", "Church", "MusicVenue", "Place", "Place", "EventVenue"]);
    expect(venueTypeLabel(null)).toBeNull();
    expect(venueTypeLabel("TEMPLE")).toBe("TEMPLE");
    expect(venueSchemaType(undefined)).toBe("Place");
    expect(isCatalogueVenueType("indoor_auditorium")).toBe(false);
  });

  it("are the list the credits tools, the v2 prompt and the validators accept, and each has words that state it", () => {
    expect([...CREDITS_TOOL_TYPES]).toEqual([...CATALOGUE_VENUE_TYPES]);
    expect([...VIDEO_VENUE_TYPES]).toEqual([...CATALOGUE_VENUE_TYPES]);
    for (const t of CATALOGUE_VENUE_TYPES) expect(VENUE_TYPE_WORDS[t].length).toBeGreaterThan(0);
    expect(parseVenueType(" indoor auditorium ")).toBe("INDOOR_AUDITORIUM");
  });
});
