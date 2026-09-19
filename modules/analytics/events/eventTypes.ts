// Music Madras internal analytics event taxonomy (ADR-adjacent, brief §2-3).
// This is a controlled vocabulary — no arbitrary strings are allowed as
// event names or parameter keys anywhere in the application. The
// authoritative human-readable reference is docs/analytics-event-taxonomy.md;
// this file is the type-level enforcement of that same document.
//
// No Prisma import here (ADR §3 boundary rule) — this is a pure contract
// the rest of the application (eventually: Museum/Studio UI, later phases)
// and the provider adapters both depend on.

export const ANALYTICS_EVENT_NAMES = [
  "page_view",
  "entity_view",
  "catalogue_search",
  "search_result_select",
  "recording_view",
  "programme_view",
  "musical_work_view",
  "composer_view",
  "artist_view",
  "collection_view",
  "educational_content_view",
  "learning_guide_view",
  "youtube_click",
  "youtube_play_intent",
  "playlist_view",
  "playlist_item_select",
  "sheet_music_request_started",
  "sheet_music_request_submitted",
  "outbound_link",
  "media_interaction",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];

// Canonical MMKE entity types an event may reference. Deliberately a plain
// string union, not the Prisma-generated model names, so this module never
// imports Prisma. `entity_view` is the generic event for entity types with
// no dedicated `*_view` event above (e.g. Venue); the dedicated events
// exist for the content types the product explicitly cares about
// measuring by name.
export const CANONICAL_ENTITY_TYPES = [
  "Recording",
  "Programme",
  "MusicalWork",
  "Composer",
  "Artist",
  "Choir",
  "Conductor",
  "Venue",
  "Collection",
  "EducationalContent",
  "LearningGuide",
  "YouTubeVideo",
  "YouTubePlaylist",
] as const;

export type CanonicalEntityType = (typeof CANONICAL_ENTITY_TYPES)[number];

/**
 * Canonical identity context for an event (brief §4). Analytics never
 * relies solely on a URL — an event about an entity carries the entity's
 * stable MMKE id, which survives URL/slug changes. The MMKE database
 * remains the source of truth; this is a reference, not a copy of the
 * entity's data.
 */
export interface EntityContext {
  entityType?: CanonicalEntityType;
  entityId?: string;
  recordingId?: string;
  programmeId?: string;
  musicalWorkId?: string;
  composerId?: string;
  collectionId?: string;
  educationalContentId?: string;
  youtubeVideoId?: string;
}

export interface PageContext {
  path: string;
  title?: string;
  referrer?: string;
}

export type AnalyticsParamValue = string | number | boolean;

/**
 * A single Music Madras analytics event. `sessionId` is an anonymous,
 * session-scoped identifier (brief §5) — this model has no concept of a
 * persistent user identity, and nothing here is designed to store one.
 */
export interface AnalyticsEvent {
  name: AnalyticsEventName;
  occurredAt: Date;
  sessionId?: string;
  entity?: EntityContext;
  page?: PageContext;
  params?: Record<string, AnalyticsParamValue>;
}

export function isAnalyticsEventName(value: string): value is AnalyticsEventName {
  return (ANALYTICS_EVENT_NAMES as readonly string[]).includes(value);
}

export function isCanonicalEntityType(value: string): value is CanonicalEntityType {
  return (CANONICAL_ENTITY_TYPES as readonly string[]).includes(value);
}
