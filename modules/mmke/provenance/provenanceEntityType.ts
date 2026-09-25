// Phase 6G-13 — the V1-supported set of canonical entity types that a
// Source or RightsInformation may attach to via the existing generic
// EntitySource/EntityRights join tables. Pure, Prisma-free (ADR §3
// boundary rule). Shared by both sourceRepository.ts and
// rightsInformationRepository.ts since both dimensions attach to the
// identical entity-type set — this is the one piece of shared logic
// between them, never a shared "provenance" table or framework: Source,
// Citation, and RightsInformation remain three distinct concepts (see
// their own schema comments in prisma/schema.prisma).
//
// Deliberately just these three (Composer/Work/Recording) for V1 — never
// Programme/Performance/Collection/Occasion/Video/Venue/Artist/Choir/
// Conductor/Organisation, per the approved phase scope.
//
// Enforced here at the application layer, never as a database enum:
// EntitySource.entityType/EntityRights.entityType stay plain string
// columns (their existing, pre-Phase-6G-13 shape), so growing this set
// later is a change to this file, never a migration.

export const PROVENANCE_ENTITY_TYPES = ["COMPOSER", "WORK", "RECORDING"] as const;

export type ProvenanceEntityType = (typeof PROVENANCE_ENTITY_TYPES)[number];

export function isSupportedProvenanceEntityType(value: string): value is ProvenanceEntityType {
  return (PROVENANCE_ENTITY_TYPES as readonly string[]).includes(value);
}

export class UnsupportedProvenanceEntityTypeError extends Error {
  constructor(entityType: string) {
    super(
      `"${entityType}" is not a supported provenance entity type. Supported types: ${PROVENANCE_ENTITY_TYPES.join(", ")}.`
    );
    this.name = "UnsupportedProvenanceEntityTypeError";
  }
}
