import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import { DuplicateEntityError, findExactNormalizedDuplicate } from "../../mmke/duplicate-detection/detectDuplicateName";
import type { Artist } from "@prisma/client";

export interface CreateArtistInput {
  name: string;
  instrument?: string;
  biography?: string;
  actorId: string;
}

export async function createArtist(input: CreateArtistInput): Promise<Artist> {
  const existing = await prisma.artist.findMany({ where: { archivedAt: null }, select: { name: true } });
  const duplicate = findExactNormalizedDuplicate(input.name, existing.map((a) => a.name));
  if (duplicate) {
    throw new DuplicateEntityError("Artist", duplicate);
  }

  const artist = await prisma.artist.create({
    data: {
      name: input.name,
      instrument: input.instrument,
      biography: input.biography,
      createdById: input.actorId,
      updatedById: input.actorId,
    },
  });

  await writeAuditLog({
    actorId: input.actorId,
    action: "ARTIST_CREATED",
    entityType: "Artist",
    entityId: artist.id,
    afterSnapshot: artist,
  });

  return artist;
}

export function findArtistById(id: string): Promise<Artist | null> {
  return prisma.artist.findUnique({ where: { id } });
}

export function listActiveArtists(): Promise<Artist[]> {
  return prisma.artist.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" } });
}
