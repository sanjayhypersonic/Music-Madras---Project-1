/**
 * Music Madras Knowledge Engine (MMKE) - Search Interfaces
 * Designs unified input payloads and semantic response structures for multi-modal archival search.
 */

import { Composer, MusicalWork, Venue, VideoResource } from './entities';

/**
 * Supported search strategy modes.
 */
export type SearchStrategy =
  | 'KEYWORD'          // Standard full-text matching in database
  | 'ENTITY'           // Filter-based exact relational queries on graph nodes
  | 'SEMANTIC'         // Vector database similarity search (e.g. searching "somber organ music" matches late German Romantics)
  | 'NATURAL_LANGUAGE' // Plain english questions e.g. "which chapel did we perform in last summer?"
  | 'AI_SEARCH';       // Multi-hop, context-aware query combining AI synthesis and archives

/**
 * Structured inputs submitted to the search system.
 */
export interface SearchQueryPayload {
  queryText: string;
  strategy: SearchStrategy;
  
  // Scopes to restrict searching ranges
  filters?: {
    eras?: ('Renaissance' | 'Baroque' | 'Classical' | 'Romantic' | 'Modern' | 'Contemporary')[];
    instrumentTypes?: string[];
    venueId?: string;
    composers?: string[];
    yearsRange?: { startYear: number; endYear: number };
  };
  
  limit?: number;
  offset?: number;
}

/**
 * Single matching result node.
 */
export interface SearchResultNode {
  score: number; // Search match confidence or TF-IDF/cosine similarity rank
  entityId: string;
  entityType: 'COMPOSER' | 'WORK' | 'PERFORMANCE' | 'VENUE' | 'VIDEO' | 'PLAYLIST' | 'GUIDE';
  
  // Highlighted fields matching the query string
  title: string;
  snippet: string; // Dynamic text chunk showing matched tokens (HTML or Markdown formatting)
  
  // Hydrated item references if immediately loaded (lazy optional properties)
  hydratedData?: {
    composer?: Composer;
    work?: MusicalWork;
    venue?: Venue;
    video?: VideoResource;
  };
}

/**
 * Encapsulated return block of a search execution.
 */
export interface SearchResponse {
  payload: SearchQueryPayload;
  totalMatches: number;
  tookMs: number;
  results: SearchResultNode[];
  
  // Suggestive smart filters or spelling corrections
  suggestions?: string[];
  semanticSummary?: string; // AI synthesised sentence explaining findings: e.g. "We found 3 Bach chorales performed on Pipe Organ at St. Thomas' Cathedral"
}

/**
 * Interface representing the MMKE unified search router.
 */
export interface IMMKESearchEngine {
  /**
   * Dispatches and handles a full search across all entity nodes and indexes.
   */
  search(payload: SearchQueryPayload): Promise<SearchResponse>;

  /**
   * Autocomplete or semantic typeahead prediction helper.
   */
  suggestTypeahead(partialText: string, limit?: number): Promise<string[]>;

  /**
   * Refreshes indices (semantic embedding updates, index rebuilds) behind-the-scenes.
   */
  reindex(entityType?: string): Promise<{ success: boolean; itemsIndexed: number }>;
}
