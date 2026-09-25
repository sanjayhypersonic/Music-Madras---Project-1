// Phase 6G-12 — the V1-supported set of canonical entity types an
// Occasion may attach to. Pure, Prisma-free (ADR §3 boundary rule).
//
// Deliberately just these four (Programme/Performance/Recording/
// Collection) — never Work (occasion-agnostic: the same setting can be
// performed at any service) and never Video (its context is always
// derived transitively through its canonical Recording, never a second,
// independently-driftable link — see EntityOccasion's schema comment).
//
// Enforced here at the application layer, never as a database enum:
// EntityOccasion.entityType stays a plain string column (mirroring
// EntitySource/EntityRights/EntityEducationalContent), so growing this set
// later is a change to this file, never a migration.

export const OCCASION_ENTITY_TYPES = ["PROGRAMME", "PERFORMANCE", "RECORDING", "COLLECTION"] as const;

export type OccasionEntityType = (typeof OCCASION_ENTITY_TYPES)[number];

export function isSupportedOccasionEntityType(value: string): value is OccasionEntityType {
  return (OCCASION_ENTITY_TYPES as readonly string[]).includes(value);
}

export class UnsupportedOccasionEntityTypeError extends Error {
  constructor(entityType: string) {
    super(
      `"${entityType}" is not a supported Occasion entity type. Supported types: ${OCCASION_ENTITY_TYPES.join(", ")}.`
    );
    this.name = "UnsupportedOccasionEntityTypeError";
  }
}
