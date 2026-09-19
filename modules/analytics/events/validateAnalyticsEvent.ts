import { isAnalyticsEventName, isCanonicalEntityType, type AnalyticsEvent } from "./eventTypes";
import { EVENT_PARAM_SCHEMAS } from "./eventParamSchemas";

export class InvalidAnalyticsEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAnalyticsEventError";
  }
}

// Defense-in-depth (brief §5): even though the per-event allowlist in
// eventParamSchemas.ts already excludes these by construction (they were
// never added to any schema), this is a second, independent check against
// obviously sensitive key *names* landing in a params object by mistake —
// e.g. if a future event's schema were edited carelessly. Belt and braces,
// not the primary mechanism.
const DENYLISTED_PARAM_KEY_PATTERN =
  /password|token|secret|apikey|api_key|email|message|note|ssn|passport|credential/i;

/**
 * Validates a Music Madras analytics event against the controlled
 * taxonomy (brief §3) and its per-event parameter schema (brief §7),
 * throwing InvalidAnalyticsEventError on the first problem found. Pure —
 * no I/O, no provider calls. Called by AnalyticsService before dispatching
 * to any provider adapter.
 */
export function validateAnalyticsEvent(event: AnalyticsEvent): void {
  if (!isAnalyticsEventName(event.name)) {
    throw new InvalidAnalyticsEventError(
      `"${event.name}" is not part of the Music Madras analytics event taxonomy. ` +
        `See docs/analytics-event-taxonomy.md.`
    );
  }

  if (event.entity?.entityType && !isCanonicalEntityType(event.entity.entityType)) {
    throw new InvalidAnalyticsEventError(
      `"${event.entity.entityType}" is not a recognized canonical entity type.`
    );
  }

  const schema = EVENT_PARAM_SCHEMAS[event.name];
  const params = event.params ?? {};

  for (const [key, value] of Object.entries(params)) {
    if (DENYLISTED_PARAM_KEY_PATTERN.test(key)) {
      throw new InvalidAnalyticsEventError(
        `Parameter "${key}" on event "${event.name}" looks like it may carry sensitive data and is never allowed in an analytics event.`
      );
    }

    const spec = schema[key];
    if (!spec) {
      throw new InvalidAnalyticsEventError(
        `Parameter "${key}" is not part of the allowed vocabulary for event "${event.name}". ` +
          `See docs/analytics-event-taxonomy.md.`
      );
    }

    if (typeof value !== spec.type) {
      throw new InvalidAnalyticsEventError(
        `Parameter "${key}" on event "${event.name}" must be of type "${spec.type}", got "${typeof value}".`
      );
    }

    if (spec.type === "string" && spec.maxLength && typeof value === "string" && value.length > spec.maxLength) {
      throw new InvalidAnalyticsEventError(
        `Parameter "${key}" on event "${event.name}" exceeds its maximum length of ${spec.maxLength} characters.`
      );
    }
  }
}
