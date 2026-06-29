/**
 * Music Madras Knowledge Engine (MMKE) - Knowledge Card Specifications
 * Establishes structured presentation metadata and styling guidelines for future UI card implementations.
 * No UI is rendered; this module acts purely as a design token and visual specification cataloguer.
 */

/**
 * Visual themes supported by the Knowledge Card engine.
 */
export type CardVisualTheme =
  | 'MINIMAL_SERIF' // Classical editorial feel with large display typography, high contrast, warm alabaster
  | 'TECH_MONO'     // Analytical layout using monospace specs, thin borders, code indicators
  | 'CINEMATIC'     // Large background image overlay, glowing amber gradients, high elevation
  | 'SACRED_GOLD';  // Warm golden borders, elegant borders, deep maroon/stone accents

/**
 * Common layout structure that every Knowledge Card follows.
 */
export interface BaseCardSpecification {
  theme: CardVisualTheme;
  showMediaBadge: boolean;
  interactiveHoverAnimation: 'gently-lift' | 'scale-up' | 'glow-border' | 'none';
  containerTailwindClasses: string[];
}

/**
 * 1. Composer Card Specification
 */
export interface ComposerCardSpec extends BaseCardSpecification {
  entityType: 'COMPOSER';
  displayFields: {
    title: 'name';
    subTitle: 'era_and_nationality'; // e.g., "Baroque • German"
    lifespan: 'born_to_died'; // e.g., "1685 - 1750"
    metricCount: 'works_count'; // Number of associated works registered
    biographySnippetLength: number; // Max characters to display before ellipsis
  };
  recommendedLayout: 'grid-profile-split' | 'vertical-minimalist';
}

/**
 * 2. Musical Work Card Specification
 */
export interface MusicalWorkCardSpec extends BaseCardSpecification {
  entityType: 'MUSICAL_WORK';
  displayFields: {
    title: 'title';
    catalogNumber: 'catalogueNumber'; // e.g., "BWV 565"
    composerReference: 'composerId';
    durationBadge: boolean;
    tagsList: boolean;
  };
  actions: {
    showAnalyzeButton: boolean; // Directs to structural breakdown
    showListenButton: boolean; // Directs to live performance recordings
    showLearningGuideButton: boolean;
  };
}

/**
 * 3. Performance Card Specification
 */
export interface PerformanceCardSpec extends BaseCardSpecification {
  entityType: 'PERFORMANCE';
  displayFields: {
    workTitle: string;
    artistCredits: string[];
    venueName: string;
    acousticProfileSnippet: boolean;
    dateOfEvent: string;
  };
  visualAccents: {
    showLiveWaveformIndicator: boolean; // Pulsing green or red dot
  };
}

/**
 * 4. Recording Card Specification
 */
export interface RecordingCardSpec extends BaseCardSpecification {
  entityType: 'RECORDING';
  displayFields: {
    audioFormatBadge: 'AUDIO_ONLY' | 'VIDEO_HD' | 'VIDEO_4K';
    sampleRateIndicator: boolean; // Show sampling details for classical audiophiles
    durationTrack: boolean;
    engineerCredits: boolean;
  };
}

/**
 * 5. Venue Card Specification
 */
export interface VenueCardSpec extends BaseCardSpecification {
  entityType: 'VENUE';
  displayFields: {
    name: string;
    locationText: string;
    acousticDecayTime: boolean; // Show RT60 time e.g., "3.2s"
    organSummary: boolean; // Displays installed pipe organ model
  };
}

/**
 * 6. Choir Card Specification
 */
export interface ChoirCardSpec extends BaseCardSpecification {
  entityType: 'CHOIR';
  displayFields: {
    name: string;
    voiceConfiguration: string; // e.g., "SATB Mixed Voices"
    foundedAt: string;
    memberCount: boolean;
  };
}

/**
 * 7. Playlist Card Specification
 */
export interface PlaylistCardSpec extends BaseCardSpecification {
  entityType: 'PLAYLIST';
  displayFields: {
    title: string;
    description: string;
    videoCountBadge: boolean;
    platformIcon: 'youtube' | 'spotify' | 'apple';
  };
}

/**
 * 8. Educational Guide Card Specification
 */
export interface EducationalGuideCardSpec extends BaseCardSpecification {
  entityType: 'LEARNING_GUIDE';
  displayFields: {
    title: string;
    readingTimeBadge: boolean;
    difficultyLevelColor: 'green' | 'amber' | 'red' | 'purple'; // Beginner to Scholarly mapping
    workReference: boolean;
  };
}

/**
 * 9. Recommendation Card Specification
 */
export interface RecommendationCardSpec extends BaseCardSpecification {
  entityType: 'RECOMMENDATION';
  displayFields: {
    reasoningLabel: string; // Explains the connection (e.g. "Similar Organ Registration")
    confidencePercentage: boolean;
    matchingFeatures: string[];
  };
}
