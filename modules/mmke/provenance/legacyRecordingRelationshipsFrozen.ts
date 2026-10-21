// Phase 6L — Recording-level Source, RightsInformation and Occasion links are revision-scoped (recording_revision_sources / _rights / _occasions,
// modules/db/repositories/recordingRevisionRelationshipsRepository.ts). The legacy Recording-level rows (entity_sources / entity_rights /
// entity_occasions with entityType "RECORDING") are FROZEN: they are kept exactly as they are (history, and the input of the rollback re-projection),
// but nothing may write them any more, so a link can never again change a live page without going through a draft revision and a publication.
//
// Only the entity type "RECORDING" is frozen. Work, Composer, Performance, Programme and Collection links keep using the generic functions.
// The guard sits in the generic attach / detach functions themselves (sourceRepository, rightsInformationRepository, occasionRepository), so no caller
// can forget it. The backfill and re-projection tools write these tables with their own guarded SQL and do not go through these functions.

export const FROZEN_LEGACY_ENTITY_TYPE = "RECORDING";

export class LegacyRecordingRelationshipsFrozenError extends Error {
  constructor() {
    super(
      "A recording's sources, rights information and occasions belong to a draft revision and are not attached to the recording itself any more. Use the recording's Relationships step."
    );
    this.name = "LegacyRecordingRelationshipsFrozenError";
  }
}

/** Throws for the frozen entity type and does nothing for any other. Call before any read of the target or write. */
export function assertLegacyRecordingWriteAllowed(entityType: string): void {
  if (entityType === FROZEN_LEGACY_ENTITY_TYPE) throw new LegacyRecordingRelationshipsFrozenError();
}
