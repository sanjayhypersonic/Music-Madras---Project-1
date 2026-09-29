import type { AnalyticsEvent, CanonicalEntityType, EntityContext } from "./eventTypes";

// Pure convenience constructors for the events a future Museum/Studio UI
// (later phase) will emit. None of these are wired into any route or
// component yet — Phase 3 is the contract, not the UI integration. Each
// still passes through validateAnalyticsEvent before being dispatched by
// AnalyticsService.

function baseEvent<TName extends AnalyticsEvent["name"]>(
  name: TName,
  sessionId?: string
): Pick<AnalyticsEvent, "name" | "occurredAt" | "sessionId"> {
  return { name, occurredAt: new Date(), sessionId };
}

export function createEntityViewEvent(
  entity: EntityContext & { entityType: CanonicalEntityType; entityId: string },
  sessionId?: string
): AnalyticsEvent {
  const dedicatedEventName = DEDICATED_VIEW_EVENT_BY_ENTITY_TYPE[entity.entityType];
  return {
    ...baseEvent(dedicatedEventName ?? "entity_view", sessionId),
    entity,
  };
}

const DEDICATED_VIEW_EVENT_BY_ENTITY_TYPE: Partial<Record<CanonicalEntityType, AnalyticsEvent["name"]>> = {
  Recording: "recording_view",
  Programme: "programme_view",
  MusicalWork: "musical_work_view",
  Composer: "composer_view",
  Artist: "artist_view",
  Collection: "collection_view",
  EducationalContent: "educational_content_view",
  LearningGuide: "learning_guide_view",
  YouTubeVideo: "video_view",
};

/**
 * Phase 6G-18: `entityType`/`page` are optional so the same event doubles
 * as the "browsed/filtered by category, no free-text query" signal — see
 * eventParamSchemas.ts's comment for why this isn't a second
 * `archive_filter` event.
 */
export function createCatalogueSearchEvent(
  resultCount: number,
  options: { entityType?: string; page?: number; sessionId?: string } = {}
): AnalyticsEvent {
  const { entityType, page, sessionId } = options;
  return {
    ...baseEvent("catalogue_search", sessionId),
    params: {
      resultCount,
      ...(entityType ? { entityType } : {}),
      ...(page !== undefined ? { page } : {}),
    },
  };
}

export function createSearchResultSelectEvent(
  resultPosition: number,
  selectedEntityType: CanonicalEntityType,
  entity: EntityContext,
  sessionId?: string
): AnalyticsEvent {
  return {
    ...baseEvent("search_result_select", sessionId),
    entity,
    params: { resultPosition, selectedEntityType },
  };
}

export function createYouTubeClickEvent(youtubeVideoId: string, sessionId?: string): AnalyticsEvent {
  return { ...baseEvent("youtube_click", sessionId), entity: { youtubeVideoId } };
}

export function createYouTubePlayIntentEvent(youtubeVideoId: string, sessionId?: string): AnalyticsEvent {
  return { ...baseEvent("youtube_play_intent", sessionId), entity: { youtubeVideoId } };
}

export function createSheetMusicRequestStartedEvent(
  context: { hasRecordingContext: boolean; hasMusicalWorkContext: boolean },
  entity: EntityContext,
  sessionId?: string
): AnalyticsEvent {
  return {
    ...baseEvent("sheet_music_request_started", sessionId),
    entity,
    params: context,
  };
}

export function createSheetMusicRequestSubmittedEvent(
  context: { hasRecordingContext: boolean; hasMusicalWorkContext: boolean },
  entity: EntityContext,
  sessionId?: string
): AnalyticsEvent {
  return {
    ...baseEvent("sheet_music_request_submitted", sessionId),
    entity,
    params: context,
  };
}

export function createOutboundLinkEvent(destinationHost: string, sessionId?: string): AnalyticsEvent {
  return { ...baseEvent("outbound_link", sessionId), params: { destinationHost } };
}
