import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import { DuplicateEntityError, findExactNormalizedDuplicate } from "../../mmke/duplicate-detection/detectDuplicateName";
import { SlugConflictError } from "../../mmke/slug/SlugConflictError";
import { isUniqueConstraintViolation } from "../isUniqueConstraintViolation";
import type { Composer } from "@prisma/client";

// Repository foundation for Composer — a simple direct-edit entity (ADR
// §4), not part of the Draft/Revision model. Demonstrates the module
// boundary (only modules/db imports Prisma) and Phase 2's duplicate-name
// guard (brief §42) — the fuzzy/similarity part of duplicate detection is
// still deferred; see modules/mmke/duplicate-detection/README.md.

export interface CreateComposerInput {
  slug: string;
  name: string;
  bornDate?: string;
  diedDate?: string;
  era?: string;
  biography?: string;
  actorId: string;
}

export async function createComposer(input: CreateComposerInput): Promise<Composer> {
  const existing = await prisma.composer.findMany({
    where: { archivedAt: null },
    select: { name: true },
  });

  const duplicate = findExactNormalizedDuplicate(
    input.name,
    existing.map((c) => c.name)
  );
  if (duplicate) {
    throw new DuplicateEntityError("Composer", duplicate);
  }

  let composer: Composer;
  try {
    composer = await prisma.composer.create({
      data: {
        slug: input.slug,
        name: input.name,
        bornDate: input.bornDate,
        diedDate: input.diedDate,
        era: input.era,
        biography: input.biography,
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
    action: "COMPOSER_CREATED",
    entityType: "Composer",
    entityId: composer.id,
    afterSnapshot: composer,
  });

  return composer;
}

export function findComposerById(id: string): Promise<Composer | null> {
  return prisma.composer.findUnique({ where: { id } });
}

export function findComposerBySlug(slug: string): Promise<Composer | null> {
  return prisma.composer.findUnique({ where: { slug } });
}

export function listActiveComposers(): Promise<Composer[]> {
  return prisma.composer.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
  });
}

export interface ComposerForStudio extends Composer {
  _count: { works: number };
}

/**
 * Studio-facing list (Phase 6G-4C, brief §7): every Composer regardless
 * of archived state, with a cheap direct-relation work count (a single
 * aggregated query, not one query per row — brief §7's "prefer simple
 * repository-level aggregation"). An optional case-insensitive name
 * search, since the brief asks for search on the Studio list.
 */
export function listComposersForStudio(searchQuery?: string): Promise<ComposerForStudio[]> {
  return prisma.composer.findMany({
    where: searchQuery ? { name: { contains: searchQuery, mode: "insensitive" } } : undefined,
    include: { _count: { select: { works: true } } },
    orderBy: { name: "asc" },
  });
}

export interface UpdateComposerInput {
  name?: string;
  bornDate?: string | null;
  diedDate?: string | null;
  era?: string | null;
  biography?: string | null;
  actorId: string;
}

/**
 * Edits the canonical Composer record in place (brief §9) — deliberately
 * never accepts `slug`: the brief explicitly prefers an immutable slug
 * for this first implementation so existing /composers/[slug] URLs never
 * silently break from an edit.
 */
export async function updateComposer(id: string, input: UpdateComposerInput): Promise<Composer> {
  const before = await prisma.composer.findUnique({ where: { id } });
  if (!before) {
    throw new Error(`Composer ${id} does not exist.`);
  }

  const updated = await prisma.composer.update({
    where: { id },
    data: {
      name: input.name,
      bornDate: input.bornDate,
      diedDate: input.diedDate,
      era: input.era,
      biography: input.biography,
      updatedById: input.actorId,
    },
  });

  await writeAuditLog({
    actorId: input.actorId,
    action: "COMPOSER_UPDATED",
    entityType: "Composer",
    entityId: id,
    beforeSnapshot: before,
    afterSnapshot: updated,
  });

  return updated;
}

/**
 * Archiving/restoring (brief §10) reuses the existing archivedAt
 * convention every other simple entity already has — never deletes the
 * row, never cascades to Works or any other relationship. An archived
 * Composer is excluded from listActiveComposers and from the public
 * /composers/[slug] route (via getComposerEntityPageData's own
 * archivedAt check), but its Works and their catalogue relationships are
 * untouched.
 */
export async function archiveComposer(id: string, actorId: string): Promise<Composer> {
  const composer = await prisma.composer.update({
    where: { id },
    data: { archivedAt: new Date(), updatedById: actorId },
  });

  await writeAuditLog({
    actorId,
    action: "COMPOSER_ARCHIVED",
    entityType: "Composer",
    entityId: id,
  });

  return composer;
}

export async function restoreComposer(id: string, actorId: string): Promise<Composer> {
  const composer = await prisma.composer.update({
    where: { id },
    data: { archivedAt: null, updatedById: actorId },
  });

  await writeAuditLog({
    actorId,
    action: "COMPOSER_RESTORED",
    entityType: "Composer",
    entityId: id,
  });

  return composer;
}
