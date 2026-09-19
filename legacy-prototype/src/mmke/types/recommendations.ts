/**
 * Music Madras Knowledge Engine (MMKE) - Recommendation Engine Interfaces
 * Defines the contract, parameters, and algorithms of the future MMKE recommendation dispatcher.
 */

import { InstrumentType } from './entities';

/**
 * Supported recommendation media sources.
 */
export enum RecommendationSourcePlatform {
  MUSIC_MADRAS_YOUTUBE = 'MUSIC_MADRAS_YOUTUBE',
  YOUTUBE_UNLISTED = 'YOUTUBE_UNLISTED',
  YOUTUBE_PUBLIC = 'YOUTUBE_PUBLIC',
  YOUTUBE_MUSIC = 'YOUTUBE_MUSIC',
  SPOTIFY = 'SPOTIFY',
  APPLE_MUSIC = 'APPLE_MUSIC',
  EDUCATIONAL_RESOURCE = 'EDUCATIONAL_RESOURCE',
  LOCAL_ARCHIVE = 'LOCAL_ARCHIVE'
}

/**
 * Filter and query payload parameter structure to generate matching recommendations.
 */
export interface RecommendationQueryContext {
  userId?: string;
  sourceEntityId: string;
  sourceEntityType: 'COMPOSER' | 'WORK' | 'PERFORMANCE' | 'VIDEO' | 'PLAYLIST' | 'GUIDE';
  
  // Specific fine-tuning filters requested by the client
  preferredPlatforms?: RecommendationSourcePlatform[];
  preferredInstrumentTypes?: InstrumentType[];
  maxResults?: number;
  
  // Weights (0.0 to 1.0) to skew recommendation engine prioritization
  prioritizeHistoricalPeriod?: number; // Weight for Era match
  prioritizeInstrumentMatch?: number; // Weight for matching pipe organ, harpsichord, etc.
  prioritizeAcousticVenue?: number; // Weight for similar acoustic environment (reverberation etc.)
  includeEducationalMaterial?: boolean; // Flag to mix educational guides into recommended list
}

/**
 * Represents a compiled item suggested by the recommendation backend.
 */
export interface RecommendationResultItem {
  id: string; // Internal MMKE ID of recommendation entry
  title: string;
  description: string;
  thumbnailUrl?: string;
  
  // Unified external link context
  targetUrl: string;
  targetPlatform: RecommendationSourcePlatform;
  
  // Context metadata for classification
  category: 'VIDEO' | 'AUDIO_STREAM' | 'PLAYLIST' | 'LEARNING_PATH' | 'COMPOSER_PROFILE' | 'HISTORICAL_WORK';
  composerName?: string;
  instrumentType?: InstrumentType;
  
  // Relevance metrics
  confidenceScore: number; // 0.0 to 1.0 confidence matching criteria
  matchingSignals: string[]; // List of matching tags: e.g., ["Same Composer", "Baroque Era", "Pipe Organ Echo"]
  attributionExplanation: string; // Explanatory text (e.g., "Because you listened to Bach's Passacaglia in Madras, you might appreciate this Buxtehude Chaconne.")
}

/**
 * Core interface for the Recommendation Generator.
 * Implementation will encapsulate semantic query vectors, collaborative filtering, and metadata rulesets.
 */
export interface IMMKERecommendationEngine {
  /**
   * Generates recommendations based on the user's active listening or reading context.
   */
  getRecommendations(context: RecommendationQueryContext): Promise<RecommendationResultItem[]>;

  /**
   * Identifies related musical works by structural/analytical similarity.
   * e.g., mapping similar contrapuntal works, organ chorales, or choral masses.
   */
  getRelatedWorks(workId: string, limit?: number): Promise<RecommendationResultItem[]>;

  /**
   * Suggests similar composers based on stylistic periods, schools of counterpoint, or geographical connections.
   */
  getSimilarComposers(composerId: string, limit?: number): Promise<RecommendationResultItem[]>;

  /**
   * Returns a custom guided listening path mixing performances with educational literature.
   */
  getListeningJourney(topicSlug: string): Promise<RecommendationResultItem[]>;
}
