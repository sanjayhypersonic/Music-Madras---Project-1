import type { AnalyticsEventName } from "./eventTypes";

// The small, documented vocabulary of parameters each event may carry
// (brief §7 — "avoid creating an uncontrolled collection of custom
// parameters"). This is intentionally an allowlist, not a denylist: a
// parameter key that isn't listed here for a given event is rejected,
// which is also what keeps privacy-sensitive fields (names, emails,
// messages, raw search queries) out structurally rather than by
// discipline — see validateAnalyticsEvent.ts and
// docs/analytics-event-taxonomy.md.

export type ParamType = "string" | "number" | "boolean";

export interface ParamSpec {
  type: ParamType;
  maxLength?: number; // only meaningful for type: "string"
}

export type EventParamSchema = Record<string, ParamSpec>;

const STRING_SHORT: ParamSpec = { type: "string", maxLength: 60 };
const STRING_HOST: ParamSpec = { type: "string", maxLength: 120 };

export const EVENT_PARAM_SCHEMAS: Record<AnalyticsEventName, EventParamSchema> = {
  page_view: { path: { type: "string", maxLength: 300 }, title: { ...STRING_HOST } },
  entity_view: {},
  // Deliberately no `query` param — raw search text may contain personal
  // information (brief §16) and is never sent to an analytics provider.
  // Only the shape of the result is measured.
  catalogue_search: { resultCount: { type: "number" } },
  search_result_select: { resultPosition: { type: "number" }, selectedEntityType: STRING_SHORT },
  recording_view: {},
  programme_view: {},
  musical_work_view: {},
  composer_view: {},
  artist_view: {},
  collection_view: {},
  educational_content_view: {},
  learning_guide_view: {},
  youtube_click: {},
  youtube_play_intent: {},
  playlist_view: {},
  playlist_item_select: { position: { type: "number" } },
  // Deliberately booleans only — never the requester's name, email, or
  // message (brief §17). The actual request record lives only in the
  // Music Madras database (SheetMusicRequest), never in analytics.
  sheet_music_request_started: {
    hasRecordingContext: { type: "boolean" },
    hasMusicalWorkContext: { type: "boolean" },
  },
  sheet_music_request_submitted: {
    hasRecordingContext: { type: "boolean" },
    hasMusicalWorkContext: { type: "boolean" },
  },
  // Host only, never the full destination URL (which could carry query
  // parameters with sensitive context).
  outbound_link: { destinationHost: STRING_HOST },
  media_interaction: { mediaType: STRING_SHORT, action: STRING_SHORT },
};
