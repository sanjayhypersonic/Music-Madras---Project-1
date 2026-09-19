/**
 * Music Madras Knowledge Engine (MMKE) - Educational Collections Framework
 * Standardizes metadata, steps, syllabus components, and listening guides for classical education.
 */

/**
 * Educational Collection categorization topics requested by the institution.
 */
export type EducationalCollectionTopic =
  | 'BEGINNERS_GUIDE'
  | 'SACRED_MUSIC'
  | 'CHRISTMAS'
  | 'LENT'
  | 'EASTER'
  | 'PIPE_ORGAN'
  | 'SYMPHONIES'
  | 'CHOIRS'
  | 'COMPOSERS'
  | 'LISTENING_JOURNEY'
  | 'HISTORICAL_PERIOD'
  | 'LEARNING_PATH';

/**
 * A chronological or pedagogical step inside a Learning Path/Journey.
 */
export interface CuratedLessonStep {
  stepNumber: number;
  title: string;
  shortObjective: string;
  
  // Content references
  associatedWorkId?: string; // Musical Work to analyze in this step
  associatedVideoId?: string; // YouTube video or performance showing the piece
  readingGuideSlug?: string; // Learning guide link
  
  // Assessment or focus query
  listeningFocusQuestions: string[]; // List of questions for active listening: e.g. ["Can you hear the cantus firmus in the pedal?"]
  estimatedMinutes: number;
}

/**
 * Represents a cohesive Educational Collection (e.g., "Syllabus: The Art of the Pipe Organ").
 */
export interface EducationalCollection {
  id: string;
  title: string;
  slug: string;
  topic: EducationalCollectionTopic;
  shortDescription: string;
  extendedSyllabusMarkdown: string;
  difficulty: 'NOVICE' | 'APPRENTICE' | 'SCHOLAR' | 'VIRTUOSO';
  
  // Meta metrics
  totalSteps: number;
  totalDurationHours: number;
  authorOrInstitution: string; // Curating organist, chorister or school
  
  // Steps list composing the learning track
  lessons: CuratedLessonStep[];
  
  // Related material
  prerequisiteCollectionIds?: string[];
  recommendedInstrumentIds?: string[]; // physical organs, pianos, etc. recommended for practicing
}

/**
 * Interface representing the primary Educational Registry provider.
 */
export interface IMKEEducationalManager {
  /**
   * Retrieves all educational collections matching a specific topic.
   */
  getCollectionsByTopic(topic: EducationalCollectionTopic): Promise<EducationalCollection[]>;

  /**
   * Retrieves a specific educational collection by its unique URL slug.
   */
  getCollectionBySlug(slug: string): Promise<EducationalCollection | null>;

  /**
   * Generates a step-by-step progress tracking instance for a student.
   */
  getLessonProgress(collectionId: string, completedStepNumbers: number[]): {
    nextStep: CuratedLessonStep | null;
    percentageComplete: number;
    completedLessons: CuratedLessonStep[];
    remainingLessons: CuratedLessonStep[];
  };
}
