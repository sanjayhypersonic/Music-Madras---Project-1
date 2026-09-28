import {
  deriveRelatedParticipants,
  toCollection,
  toPerformance,
  toProgramme,
  toRecording,
  toVideo,
  type RawCollection,
  type RawPerformance,
  type RawProgramme,
  type RawRecording,
  type RawVideo,
} from "../entityPage/assembleEntityPageData";
import type { OrganisationPageData, OrganisationPageOccasion, OrganisationPageRights, OrganisationPageSource, OrganisationPageVenue } from "./organisationPageContract";

// Phase 6G-14 — pure mapping from already-loaded relationship data into
// the OrganisationPageData contract (ADR §3 boundary rule: no Prisma
// import here; modules/db/repositories/entityRelationshipsRepository.ts
// does the actual querying). Reuses assembleEntityPageData.ts's own
// mapping helpers wherever the underlying shape is identical — Organisation's
// performances/programmes/recordings/videos/collections all come from the
// same resolveRelatedContent output every other entity page already uses.

export interface AssembleOrganisationPageDataInput {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  venues: OrganisationPageVenue[];
  programmes: RawProgramme[];
  performances: RawPerformance[];
  recordings: RawRecording[];
  videos: RawVideo[];
  collections: RawCollection[];
  occasions: OrganisationPageOccasion[];
  sources: OrganisationPageSource[];
  rights: OrganisationPageRights[];
}

export function assembleOrganisationPageData(input: AssembleOrganisationPageDataInput): OrganisationPageData {
  return {
    id: input.id,
    slug: input.slug,
    name: input.name,
    description: input.description,
    venues: input.venues,
    programmes: input.programmes.map(toProgramme),
    performances: input.performances.map(toPerformance),
    recordings: input.recordings.map(toRecording),
    collections: input.collections.map(toCollection),
    occasions: input.occasions,
    relatedParticipants: deriveRelatedParticipants(input.performances),
    videos: input.videos.map(toVideo),
    sources: input.sources,
    rights: input.rights,
  };
}
