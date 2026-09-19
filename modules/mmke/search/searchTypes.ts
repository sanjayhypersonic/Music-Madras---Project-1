// Catalogue search foundation (ADR §8, brief §14) — a small, framework-
// and-database-agnostic contract. Deliberately not the full
// semantic/AI/natural-language search the legacy prototype only ever
// specified as an interface (legacy-prototype/src/mmke/types/search.ts,
// IMMKESearchEngine) and never implemented — this is real keyword search
// only, structured so a dedicated provider (e.g. a vector/semantic search
// service) can implement the same interface later without callers
// changing.

export type CatalogueEntityType = "COMPOSER" | "MUSICAL_WORK" | "RECORDING" | "VENUE" | "COLLECTION";

export interface CatalogueSearchQuery {
  text: string;
  entityTypes?: CatalogueEntityType[];
  limit?: number;
}

export interface CatalogueSearchResult {
  entityType: CatalogueEntityType;
  entityId: string;
  title: string;
  slug: string;
}

export interface CatalogueSearchProvider {
  search(query: CatalogueSearchQuery): Promise<CatalogueSearchResult[]>;
}
