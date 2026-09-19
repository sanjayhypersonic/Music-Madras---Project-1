import type { AnalyticsEvent, AnalyticsParamValue } from "../../events/eventTypes";

// Music Madras Event -> GA4 Adapter -> GA4 Event (brief §6). The internal
// event model is never the same object sent to GA4 — this mapping is the
// one place that knowledge lives, so GA4's request shape can change
// without touching anything else in the application.
//
// GA4 Measurement Protocol constraints this mapping enforces (not
// invented — these are GA4's documented limits):
//   - event name: letters/digits/underscores, <=40 characters
//   - up to 25 parameters per event
//   - parameter name: <=40 characters
//   - parameter (string) value: <=100 characters
//
// Naming choice: internal event names are reused as GA4 event names
// unchanged (they are already snake_case and within the length limit) —
// EXCEPT this project does not attempt to reshape any internal event into
// one of GA4's own "recommended events" (e.g. `search`, `select_content`),
// because those carry specific expected parameters (like `search_term`)
// that this project deliberately never sends (brief §16). Using plain
// custom events for everything but `page_view` (which genuinely is GA4's
// own pageview event) is a simpler, more honest mapping than a partial,
// non-compliant imitation of a recommended event. See
// docs/analytics-event-taxonomy.md.

export interface Ga4Event {
  name: string;
  params: Record<string, string | number>;
}

const GA4_EVENT_NAME_MAX_LENGTH = 40;
const GA4_PARAM_NAME_MAX_LENGTH = 40;
const GA4_PARAM_STRING_VALUE_MAX_LENGTH = 100;
const GA4_MAX_PARAMS = 25;

function toGa4ParamValue(value: AnalyticsParamValue): string | number {
  if (typeof value === "boolean") {
    // GA4 has no native boolean parameter type; 1/0 is the documented
    // convention for boolean-shaped custom parameters.
    return value ? 1 : 0;
  }
  if (typeof value === "string" && value.length > GA4_PARAM_STRING_VALUE_MAX_LENGTH) {
    return value.slice(0, GA4_PARAM_STRING_VALUE_MAX_LENGTH);
  }
  return value;
}

export function mapToGa4Event(event: AnalyticsEvent): Ga4Event {
  if (event.name.length > GA4_EVENT_NAME_MAX_LENGTH) {
    throw new Error(`Event name "${event.name}" exceeds GA4's ${GA4_EVENT_NAME_MAX_LENGTH}-character limit.`);
  }

  const params: Record<string, string | number> = {};

  // Flatten entity context into GA4-safe, snake_case parameter names.
  if (event.entity) {
    for (const [key, value] of Object.entries(event.entity)) {
      if (value === undefined) continue;
      params[camelToSnake(key)] = toGa4ParamValue(value as AnalyticsParamValue);
    }
  }

  if (event.page) {
    if (event.page.path) params.page_path = toGa4ParamValue(event.page.path);
    if (event.page.title) params.page_title = toGa4ParamValue(event.page.title);
    if (event.page.referrer) params.page_referrer = toGa4ParamValue(event.page.referrer);
  }

  if (event.params) {
    for (const [key, value] of Object.entries(event.params)) {
      params[camelToSnake(key)] = toGa4ParamValue(value);
    }
  }

  const paramEntries = Object.entries(params);
  if (paramEntries.length > GA4_MAX_PARAMS) {
    throw new Error(
      `Event "${event.name}" maps to ${paramEntries.length} GA4 parameters, exceeding the limit of ${GA4_MAX_PARAMS}.`
    );
  }
  for (const [key] of paramEntries) {
    if (key.length > GA4_PARAM_NAME_MAX_LENGTH) {
      throw new Error(`GA4 parameter name "${key}" exceeds the ${GA4_PARAM_NAME_MAX_LENGTH}-character limit.`);
    }
  }

  return { name: event.name, params };
}

function camelToSnake(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}
