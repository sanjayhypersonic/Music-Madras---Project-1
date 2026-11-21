// The catalogue's VENUE TYPES (prisma/schema.prisma enum VenueType), in ONE place: the Studio venue forms and their server actions, the credits
// review and create tools, the video-credits v2 schema and validators, the staging content loader, and the public venue pages and their JSON-LD
// all read this list, its labels and its schema.org mapping. Pure, and safe to import from client and server code (type-only Prisma import).
//
// Adding a type: add it to the Prisma enum in a new additive migration (ALTER TYPE ... ADD VALUE), then here (the Record types below fail to
// compile until every map has it), then the words that state it (VENUE_TYPE_WORDS in modules/ai/structuredOutput/validateVideoCreditsOutput.ts).

import type { VenueType } from "@prisma/client";

export const CATALOGUE_VENUE_TYPES = ["CHURCH", "CATHEDRAL", "CONCERT_HALL", "STUDIO", "OUTDOOR", "INDOOR_AUDITORIUM"] as const satisfies readonly VenueType[];
export type CatalogueVenueType = (typeof CATALOGUE_VENUE_TYPES)[number];

/** The words shown to people (Studio forms and lists, public pages). */
export const VENUE_TYPE_LABELS: Readonly<Record<CatalogueVenueType, string>> = {
  CHURCH: "Church",
  CATHEDRAL: "Cathedral",
  CONCERT_HALL: "Concert Hall",
  STUDIO: "Studio",
  OUTDOOR: "Outdoor",
  INDOOR_AUDITORIUM: "Indoor Auditorium",
};

/**
 * The schema.org type of a venue's Place (every value is a subtype of Place): a church or cathedral is a Church, a concert hall a MusicVenue, an
 * indoor auditorium an EventVenue; a studio and an outdoor venue stay a plain Place (schema.org has no closer type).
 */
export const VENUE_SCHEMA_TYPES: Readonly<Record<CatalogueVenueType, string>> = {
  CHURCH: "Church",
  CATHEDRAL: "Church",
  CONCERT_HALL: "MusicVenue",
  STUDIO: "Place",
  OUTDOOR: "Place",
  INDOOR_AUDITORIUM: "EventVenue",
};

export const isCatalogueVenueType = (value: unknown): value is CatalogueVenueType => typeof value === "string" && (CATALOGUE_VENUE_TYPES as readonly string[]).includes(value);

/** The label for a stored type; an unknown value (never expected) is shown as stored rather than hidden. */
export const venueTypeLabel = (type: string | null | undefined): string | null => (type ? (isCatalogueVenueType(type) ? VENUE_TYPE_LABELS[type] : type) : null);

/** The schema.org type for a stored venue type; a missing or unknown one is a plain Place. */
export const venueSchemaType = (type: string | null | undefined): string => (type && isCatalogueVenueType(type) ? VENUE_SCHEMA_TYPES[type] : "Place");

/** "CHURCH, CATHEDRAL, … or INDOOR_AUDITORIUM": the allowed values, for messages. */
export const VENUE_TYPE_LIST = `${CATALOGUE_VENUE_TYPES.slice(0, -1).join(", ")} or ${CATALOGUE_VENUE_TYPES.at(-1)}`;
