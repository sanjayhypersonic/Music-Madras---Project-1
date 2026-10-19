import { prisma } from "../../../modules/db/client";
import type { MediaProvider, MediaResource, MediaRole } from "@prisma/client";

// TEST-ONLY fixture seeding.
//
// Since Phase 6J-10C the repository (attachMediaToRevision) refuses to write to any revision that is not
// the current editable draft, so a test can no longer use it to put media on an already-PUBLISHED revision.
// Several public-page tests need exactly that state (a live revision that already carries a video) as
// SETUP for what they assert about public visibility. They seed it directly here, bypassing the
// repository on purpose; nothing in production code imports this module. The behaviour the repository
// now enforces is covered by tests/integration/draftCasAndChildWrites.test.ts.

export interface SeedMediaInput {
  recordingRevisionId: string;
  provider: MediaProvider;
  role: MediaRole;
  url?: string;
  providerResourceId?: string;
  youtubeVideoId?: string;
  rightsInformationId?: string;
  /** Accepted for call-site compatibility with attachMediaToRevision; no audit row is written. */
  actorId?: string;
}

export async function seedMediaOnRevision(input: SeedMediaInput): Promise<MediaResource> {
  return prisma.mediaResource.create({
    data: {
      recordingRevisionId: input.recordingRevisionId,
      provider: input.provider,
      role: input.role,
      url: input.url,
      providerResourceId: input.providerResourceId,
      youtubeVideoId: input.youtubeVideoId,
      rightsInformationId: input.rightsInformationId,
    },
  });
}
