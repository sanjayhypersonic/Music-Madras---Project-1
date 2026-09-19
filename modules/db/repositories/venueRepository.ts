import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import type { Venue, VenueType } from "@prisma/client";

// Venue also represents Church (via `type`, ADR §4) — see the Phase 2
// discussion in docs/phase-2-mmke-domain.md §7 for why an optional link to
// Organisation was added instead of a separate Church table or a merge of
// Venue/Organisation.

export interface CreateVenueInput {
  slug: string;
  name: string;
  type: VenueType;
  address?: string;
  city?: string;
  country?: string;
  capacity?: number;
  acousticProfile?: string;
  organisationId?: string;
  actorId: string;
}

export async function createVenue(input: CreateVenueInput): Promise<Venue> {
  const venue = await prisma.venue.create({
    data: {
      slug: input.slug,
      name: input.name,
      type: input.type,
      address: input.address,
      city: input.city,
      country: input.country,
      capacity: input.capacity,
      acousticProfile: input.acousticProfile,
      organisationId: input.organisationId,
      createdById: input.actorId,
      updatedById: input.actorId,
    },
  });

  await writeAuditLog({
    actorId: input.actorId,
    action: "VENUE_CREATED",
    entityType: "Venue",
    entityId: venue.id,
    afterSnapshot: venue,
  });

  return venue;
}

export async function linkVenueToOrganisation(
  venueId: string,
  organisationId: string | null,
  actorId: string
): Promise<Venue> {
  const venue = await prisma.venue.update({
    where: { id: venueId },
    data: { organisationId, updatedById: actorId },
  });

  await writeAuditLog({
    actorId,
    action: organisationId ? "VENUE_LINKED_TO_ORGANISATION" : "VENUE_UNLINKED_FROM_ORGANISATION",
    entityType: "Venue",
    entityId: venueId,
    afterSnapshot: { organisationId },
  });

  return venue;
}

export function findVenueById(id: string) {
  return prisma.venue.findUnique({ where: { id }, include: { organisation: true, instruments: true } });
}

export function findVenueBySlug(slug: string): Promise<Venue | null> {
  return prisma.venue.findUnique({ where: { slug } });
}

export function listActiveVenues(): Promise<Venue[]> {
  return prisma.venue.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
  });
}
