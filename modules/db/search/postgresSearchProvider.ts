import { prisma } from "../client";
import type {
  CatalogueEntityType,
  CatalogueSearchProvider,
  CatalogueSearchQuery,
  CatalogueSearchResult,
} from "../../mmke/search/searchTypes";

// Concrete, Postgres-backed implementation of CatalogueSearchProvider
// (ADR §8, brief §14). Uses simple case-insensitive `contains` matching
// for now — the ADR's stated upgrade path is Postgres trigram search
// (`pg_trgm`), which needs a live database to enable as an extension and
// is deferred until one exists (see docs/phase-2-mmke-domain.md). Swapping
// to trigram matching, or to an entirely different provider later, only
// means changing this file — callers depend on CatalogueSearchProvider,
// not on this implementation.

const ALL_ENTITY_TYPES: CatalogueEntityType[] = [
  "COMPOSER",
  "MUSICAL_WORK",
  "RECORDING",
  "VENUE",
  "COLLECTION",
];

export class PostgresCatalogueSearchProvider implements CatalogueSearchProvider {
  async search(query: CatalogueSearchQuery): Promise<CatalogueSearchResult[]> {
    const entityTypes = query.entityTypes?.length ? query.entityTypes : ALL_ENTITY_TYPES;
    const limit = query.limit ?? 20;
    const text = query.text.trim();

    if (!text) {
      return [];
    }

    const resultsPerType = await Promise.all(
      entityTypes.map((entityType) => this.searchEntityType(entityType, text, limit))
    );

    return resultsPerType.flat().slice(0, limit);
  }

  private async searchEntityType(
    entityType: CatalogueEntityType,
    text: string,
    limit: number
  ): Promise<CatalogueSearchResult[]> {
    switch (entityType) {
      case "COMPOSER": {
        const rows = await prisma.composer.findMany({
          where: { archivedAt: null, name: { contains: text, mode: "insensitive" } },
          select: { id: true, name: true, slug: true },
          take: limit,
        });
        return rows.map((row) => ({ entityType, entityId: row.id, title: row.name, slug: row.slug }));
      }
      case "MUSICAL_WORK": {
        const rows = await prisma.musicalWork.findMany({
          where: { archivedAt: null, title: { contains: text, mode: "insensitive" } },
          select: { id: true, title: true, slug: true },
          take: limit,
        });
        return rows.map((row) => ({ entityType, entityId: row.id, title: row.title, slug: row.slug }));
      }
      case "VENUE": {
        const rows = await prisma.venue.findMany({
          where: { archivedAt: null, name: { contains: text, mode: "insensitive" } },
          select: { id: true, name: true, slug: true },
          take: limit,
        });
        return rows.map((row) => ({ entityType, entityId: row.id, title: row.name, slug: row.slug }));
      }
      case "COLLECTION": {
        const rows = await prisma.collection.findMany({
          where: { archivedAt: null, title: { contains: text, mode: "insensitive" } },
          select: { id: true, title: true, slug: true },
          take: limit,
        });
        return rows.map((row) => ({ entityType, entityId: row.id, title: row.title, slug: row.slug }));
      }
      case "RECORDING": {
        const rows = await prisma.recording.findMany({
          where: {
            currentPublishedRevision: { title: { contains: text, mode: "insensitive" } },
          },
          select: { id: true, slug: true, currentPublishedRevision: { select: { title: true } } },
          take: limit,
        });
        return rows.map((row) => ({
          entityType,
          entityId: row.id,
          title: row.currentPublishedRevision?.title ?? "(untitled)",
          slug: row.slug,
        }));
      }
      default:
        return [];
    }
  }
}
