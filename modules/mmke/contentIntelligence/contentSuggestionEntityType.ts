// Phase 6H-4 — the V1-supported set of canonical entity types a
// ContentSuggestion/ContentGenerationRequest may target. Pure, Prisma-free
// (ADR §3 boundary rule), mirroring modules/mmke/provenance/provenanceEntityType.ts
// exactly, including the reasoning: `targetEntityType`/`targetEntityId`
// reuse the same generic string-pair pattern EntitySource/EntityRights/
// EntityOccasion already use — NOT a new polymorphic framework — and the
// actual V1 surface is enforced here, at the application layer, never as a
// database enum, so it can grow later without a migration.
//
// Deliberately just Recording for V1 (6H-3 built the Recording Context
// Assembler; no other entity type has an equivalent context source yet) —
// never Composer/Work/Programme/Performance/Venue/Organisation/Collection/
// LearningGuide/YouTubeVideo, per the approved Phase 6H-4 scope.

export const CONTENT_SUGGESTION_ENTITY_TYPES = ["RECORDING"] as const;

export type ContentSuggestionEntityType = (typeof CONTENT_SUGGESTION_ENTITY_TYPES)[number];

export function isSupportedContentSuggestionEntityType(value: string): value is ContentSuggestionEntityType {
  return (CONTENT_SUGGESTION_ENTITY_TYPES as readonly string[]).includes(value);
}

export class UnsupportedContentSuggestionEntityTypeError extends Error {
  constructor(entityType: string) {
    super(
      `"${entityType}" is not a supported Content Suggestion target entity type. Supported types: ${CONTENT_SUGGESTION_ENTITY_TYPES.join(", ")}.`
    );
    this.name = "UnsupportedContentSuggestionEntityTypeError";
  }
}
