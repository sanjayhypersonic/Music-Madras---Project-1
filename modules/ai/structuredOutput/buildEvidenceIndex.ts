import type { RecordingContext } from "../../mmke/contentIntelligence/recordingContextContract";
import type { ContentSuggestionEvidenceRef } from "../../mmke/contentIntelligence/contentSuggestionEvidence";

// Phase 6H-5 — walks a RecordingContext once and builds an id -> evidence
// reference index. The model may only cite an entity id that is actually
// present in the context it was given (brief: "the model may only reason
// over evidence actually supplied to it") — this index is how that is
// verified. An id absent from this index is never trusted as evidence,
// full stop.

export function buildEvidenceIndex(context: RecordingContext): Map<string, ContentSuggestionEvidenceRef> {
  const index = new Map<string, ContentSuggestionEvidenceRef>();

  const add = (entityId: string, ref: ContentSuggestionEvidenceRef) => {
    if (!index.has(entityId)) index.set(entityId, ref);
  };

  for (const work of context.works) {
    add(work.id, { sourceType: "CANONICAL_MMKE", entityType: "MusicalWork", entityId: work.id, field: "works" });
    add(work.composer.id, { sourceType: "CANONICAL_MMKE", entityType: "Composer", entityId: work.composer.id, field: "composers" });
  }
  for (const composer of context.composers) {
    add(composer.id, { sourceType: "CANONICAL_MMKE", entityType: "Composer", entityId: composer.id, field: "composers" });
  }

  if (context.performance) {
    add(context.performance.id, { sourceType: "CANONICAL_MMKE", entityType: "Performance", entityId: context.performance.id, field: "performance" });
    add(context.performance.venue.id, { sourceType: "CANONICAL_MMKE", entityType: "Venue", entityId: context.performance.venue.id, field: "venue" });
    if (context.performance.venue.organisation) {
      add(context.performance.venue.organisation.id, {
        sourceType: "CANONICAL_MMKE",
        entityType: "Organisation",
        entityId: context.performance.venue.organisation.id,
        field: "venue",
      });
    }
    for (const performer of context.performance.performers) {
      add(performer.id, { sourceType: "CANONICAL_MMKE", entityType: "Artist", entityId: performer.id, field: "participants" });
    }
    for (const choir of context.performance.choirs) {
      add(choir.id, { sourceType: "CANONICAL_MMKE", entityType: "Choir", entityId: choir.id, field: "participants" });
    }
    for (const conductor of context.performance.conductors) {
      add(conductor.id, { sourceType: "CANONICAL_MMKE", entityType: "Conductor", entityId: conductor.id, field: "participants" });
    }
  }

  for (const video of context.media) {
    add(video.id, { sourceType: "YOUTUBE_METADATA", entityType: "YouTubeVideo", entityId: video.id, field: "media" });
  }
  for (const collection of context.collections) {
    add(collection.id, { sourceType: "CANONICAL_MMKE", entityType: "Collection", entityId: collection.id, field: "collections" });
  }
  for (const guide of context.learningGuides) {
    add(guide.id, { sourceType: "CANONICAL_MMKE", entityType: "LearningGuide", entityId: guide.id, field: "learningGuides" });
  }
  for (const source of context.provenance.sources) {
    add(source.id, { sourceType: "APPROVED_EXTERNAL_SOURCE", entityType: "Source", entityId: source.id, field: "provenance" });
    // Phase 6H-8 — each Citation is its own citable evidence unit, distinct
    // from its parent Source, so the model can point at a specific excerpt
    // rather than only "this Source exists." Only ever reachable here
    // because context.provenance.sources itself only ever contains
    // already-APPROVED sources (recordingContextRepository.ts).
    for (const citation of source.citations) {
      add(citation.id, { sourceType: "APPROVED_EXTERNAL_SOURCE", entityType: "Citation", entityId: citation.id, field: "provenance" });
    }
  }
  for (const rights of context.provenance.rights) {
    add(rights.id, { sourceType: "APPROVED_EXTERNAL_SOURCE", entityType: "RightsInformation", entityId: rights.id, field: "provenance" });
  }

  return index;
}
