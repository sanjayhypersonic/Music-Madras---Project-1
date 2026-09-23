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

/**
 * Studio-facing list (Phase 6G-4F, mirrors listComposersForStudio/
 * listVenuesForStudio): every Artist regardless of archived state, with
 * an optional case-insensitive name search against the canonical record
 * only — never YouTube titles/descriptions.
 */
export function listArtistsForStudio(searchQuery?: string): Promise<Artist[]> {
  return prisma.artist.findMany({
    where: searchQuery ? { name: { contains: searchQuery, mode: "insensitive" } } : undefined,
    orderBy: { name: "asc" },
  });
}

export interface UpdateArtistInput {
  name?: string;
  instrument?: string | null;
  biography?: string | null;
  actorId: string;
}

/**
 * Edits the canonical Artist record in place (brief §7) — mirrors
 * updateComposer/updateVenue/updateOrganisation exactly: no re-check of
 * duplicate names on edit, matching the established pattern (brief §28:
 * "prefer consistency ... over abstraction"). The duplicate guard remains
 * create-time only, same as every other simple entity.
 */
export async function updateArtist(id: string, input: UpdateArtistInput): Promise<Artist> {
  const before = await prisma.artist.findUnique({ where: { id } });
  if (!before) {
    throw new Error(`Artist ${id} does not exist.`);
  }

  const updated = await prisma.artist.update({
    where: { id },
    data: {
      name: input.name,
      instrument: input.instrument,
      biography: input.biography,
      updatedById: input.actorId,
    },
  });

  await writeAuditLog({
    actorId: input.actorId,
    action: "ARTIST_UPDATED",
    entityType: "Artist",
    entityId: id,
    beforeSnapshot: before,
    afterSnapshot: updated,
  });

  return updated;
}

/**
 * Archiving/restoring (brief §7/§15) reuses the existing archivedAt
 * convention — never deletes the row, never touches PerformancePerformer
 * (Performance <-> Artist relationships are untouched either way).
 */
export async function archiveArtist(id: string, actorId: string): Promise<Artist> {
  const artist = await prisma.artist.update({
    where: { id },
    data: { archivedAt: new Date(), updatedById: actorId },
  });

  await writeAuditLog({
    actorId,
    action: "ARTIST_ARCHIVED",
    entityType: "Artist",
    entityId: id,
  });

  return artist;
}

export async function restoreArtist(id: string, actorId: string): Promise<Artist> {
  const artist = await prisma.artist.update({
    where: { id },
    data: { archivedAt: null, updatedById: actorId },
  });

  await writeAuditLog({
    actorId,
    action: "ARTIST_RESTORED",
    entityType: "Artist",
    entityId: id,
  });

  return artist;
}
