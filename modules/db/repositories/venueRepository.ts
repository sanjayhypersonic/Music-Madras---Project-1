import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import { DuplicateEntityError, findExactNormalizedDuplicate } from "../../mmke/duplicate-detection/detectDuplicateName";
import { SlugConflictError } from "../../mmke/slug/SlugConflictError";
import { isUniqueConstraintViolation } from "../isUniqueConstraintViolation";
import type { Organisation, Venue, VenueType } from "@prisma/client";

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

/**
 * Phase 6G-4E (brief §7): adds the same exact-normalized-name duplicate
 * guard Composer/Artist/Choir/Conductor already have — the 6G-4D preflight
 * found Venue was the one simple entity missing it. Scoped globally, not
 * per-city, matching the existing convention for the other entities
 * (fuzzy/similarity matching remains deferred project-wide, per
 * modules/mmke/duplicate-detection/README.md).
 */
export async function createVenue(input: CreateVenueInput): Promise<Venue> {
  const existing = await prisma.venue.findMany({
    where: { archivedAt: null },
    select: { name: true },
  });

  const duplicate = findExactNormalizedDuplicate(
    input.name,
    existing.map((v) => v.name)
  );
  if (duplicate) {
    throw new DuplicateEntityError("Venue", duplicate);
  }

  let venue: Venue;
  try {
    venue = await prisma.venue.create({
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
  } catch (err) {
    if (isUniqueConstraintViolation(err, "slug")) {
      throw new SlugConflictError(input.slug);
    }
    throw err;
  }

  await writeAuditLog({
    actorId: input.actorId,
    action: "VENUE_CREATED",
    entityType: "Venue",
    entityId: venue.id,
    afterSnapshot: venue,
  });

  return venue;
}

/**
 * Reassigns (or clears) a Venue's Organisation — a distinct relationship
 * operation from editing the Venue's own fields, exactly as it already
 * was before this phase; preserved unchanged (brief §5: "if the existing
 * implementation already uses these exact events, preserve them").
 */
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

export interface VenueWithOrganisation extends Venue {
  organisation: Organisation | null;
}

export function findVenueById(id: string) {
  return prisma.venue.findUnique({ where: { id }, // 6J-10F: instrument rows copied onto a draft's Performance clone are implementation detail, not venue inventory.
    include: {
      organisation: true,
      instruments: { where: { OR: [{ performanceId: null }, { performance: { draftOfPerformanceId: null } }] } },
    } });
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

/**
 * Studio-facing list (Phase 6G-4E, mirrors listComposersForStudio):
 * every Venue regardless of archived state, with its Organisation joined
 * (brief §3: "show Organisation where linked"), and an optional
 * case-insensitive name search.
 */
export function listVenuesForStudio(searchQuery?: string): Promise<VenueWithOrganisation[]> {
  return prisma.venue.findMany({
    where: searchQuery ? { name: { contains: searchQuery, mode: "insensitive" } } : undefined,
    include: { organisation: true },
    orderBy: { name: "asc" },
  });
}

/** For the Organisation detail page (Phase 6G-4E, brief §10: "display related Venues"). Every Venue regardless of archived state — the Organisation's own status doesn't hide its Venues from editorial view. */
export function listVenuesByOrganisation(organisationId: string): Promise<Venue[]> {
  return prisma.venue.findMany({
    where: { organisationId },
    orderBy: { name: "asc" },
  });
}

export interface UpdateVenueInput {
  name?: string;
  type?: VenueType;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  capacity?: number | null;
  acousticProfile?: string | null;
  actorId: string;
}

/**
 * Edits the Venue's own fields (brief §5) — deliberately never accepts
 * `slug` (kept immutable, mirroring updateComposer so existing links
 * never break) or `organisationId` (that relationship change goes
 * through linkVenueToOrganisation above, keeping its own distinct audit
 * event rather than folding it into a generic field edit).
 */
export async function updateVenue(id: string, input: UpdateVenueInput): Promise<Venue> {
  const before = await prisma.venue.findUnique({ where: { id } });
  if (!before) {
    throw new Error(`Venue ${id} does not exist.`);
  }

  const updated = await prisma.venue.update({
    where: { id },
    data: {
      name: input.name,
      type: input.type,
      address: input.address,
      city: input.city,
      country: input.country,
      capacity: input.capacity,
      acousticProfile: input.acousticProfile,
      updatedById: input.actorId,
    },
  });

  await writeAuditLog({
    actorId: input.actorId,
    action: "VENUE_UPDATED",
    entityType: "Venue",
    entityId: id,
    beforeSnapshot: before,
    afterSnapshot: updated,
  });

  return updated;
}

/**
 * Archiving/restoring (brief §12) reuses the existing archivedAt
 * convention — never deletes the row, never touches its Organisation
 * relationship (Venue.organisationId is simply preserved as-is).
 */
export async function archiveVenue(id: string, actorId: string): Promise<Venue> {
  const venue = await prisma.venue.update({
    where: { id },
    data: { archivedAt: new Date(), updatedById: actorId },
  });

  await writeAuditLog({
    actorId,
    action: "VENUE_ARCHIVED",
    entityType: "Venue",
    entityId: id,
  });

  return venue;
}

export async function restoreVenue(id: string, actorId: string): Promise<Venue> {
  const venue = await prisma.venue.update({
    where: { id },
    data: { archivedAt: null, updatedById: actorId },
  });

  await writeAuditLog({
    actorId,
    action: "VENUE_RESTORED",
    entityType: "Venue",
    entityId: id,
  });

  return venue;
}
