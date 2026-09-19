/**
 * Music Madras Knowledge Engine (MMKE) - Entity Models
 * Core entity specifications defining the archival, educational, and heritage elements of classical music.
 */

/**
 * Supported instruments in the classical music archive.
 */
export enum InstrumentType {
  PIPE_ORGAN = 'PIPE_ORGAN',
  PIANO = 'PIANO',
  HARPSICHORD = 'HARPSICHORD',
  VIOLIN = 'VIOLIN',
  CELLO = 'CELLO',
  FLUTE = 'FLUTE',
  CHOIR_VOICE = 'CHOIR_VOICE',
  OTHER = 'OTHER'
}

/**
 * Represents a historical or contemporary classical music Composer.
 * Relationship: Composer -> MusicalWorks
 */
export interface Composer {
  id: string;
  name: string;
  born: string; // ISO date or historical year string (e.g., "1685")
  died: string | null; // null if contemporary
  nationality: string;
  biography: string;
  era: 'Renaissance' | 'Baroque' | 'Classical' | 'Romantic' | 'Modern' | 'Contemporary';
  notableInstruments: InstrumentType[];
  worksIds: string[]; // Relationship identifier array
  externalUrls?: {
    wikipedia?: string;
    imslp?: string;
    spotify?: string;
  };
}

/**
 * Represents a distinct musical composition (e.g., "Toccata and Fugue in D minor").
 * Relationship: Works -> Performances, Works -> Educational Guides, Works -> Similar Works
 */
export interface MusicalWork {
  id: string;
  title: string;
  subtitle?: string;
  composerId: string; // Belongs to Composer
  catalogueNumber?: string; // e.g., "BWV 565", "Op. 67"
  compositionYear?: string;
  keySignature?: string;
  durationMinutes: number;
  description: string;
  performanceIds: string[]; // Relationship identifier array
  educationalGuideIds: string[]; // Learning guides associated with this work
  similarWorkIds: string[]; // Similar Works relationship identifiers
  tags: string[];
}

/**
 * Represents a specific live performance event of a MusicalWork.
 * Relationship: Performances -> Recordings, Churches/Choirs/Conductors/Venues -> Performances
 */
export interface Performance {
  id: string;
  workId: string; // Performance of which Work
  performanceDate: string; // ISO date string
  venueId: string; // Venue/Church where it occurred
  choirId?: string; // Optional performing choir
  conductorId?: string; // Optional conducting lead
  performerIds: string[]; // Artists executing the performance
  recordingIds: string[]; // Master or backup audio/video recordings
  programNotes?: string;
  isPublic: boolean;
}

/**
 * Represents a captured high-fidelity media recording (audio or video stream).
 * Relationship: Recordings -> Videos
 */
export interface Recording {
  id: string;
  performanceId: string; // Source performance
  format: 'AUDIO_ONLY' | 'VIDEO_HD' | 'VIDEO_4K' | 'MASTER_MULTITRACK';
  recordingDate: string;
  sampleRateHz?: number;
  bitDepth?: number;
  engineerName?: string;
  videoResourceId?: string; // Maps to YouTube video or file path
  audioResourceUrl?: string; // Stream file link
  durationSeconds: number;
  copyrightOwner: string;
}

/**
 * Represents a curated video or playlist asset (including YouTube metadata).
 * Relationship: Videos -> Playlists
 */
export interface VideoResource {
  id: string;
  title: string;
  description: string;
  platform: 'YOUTUBE' | 'YOUTUBE_UNLISTED' | 'YOUTUBE_MUSIC' | 'LOCAL_STREAM' | 'OTHER';
  externalVideoId: string; // YouTube video ID or platform equivalent
  thumbnailUrl: string;
  publishedAt: string;
  durationSeconds: number;
  viewCount?: number;
  likeCount?: number;
  associatedRecordingId?: string; // Maps back to the physical Recording
}

/**
 * Represents a playlist container combining multiple VideoResources.
 */
export interface Playlist {
  id: string;
  title: string;
  description: string;
  platform: 'YOUTUBE' | 'YOUTUBE_UNLISTED' | 'YOUTUBE_MUSIC' | 'SPOTIFY' | 'APPLE_MUSIC';
  externalPlaylistId: string;
  videoIds: string[]; // Connected video IDs in order
  thumbnailUrl: string;
  curatorId: string; // Maps to Curator / Organisation
}

/**
 * Represents a sacred or secular performance physical Venue (Churches, Cathedrals, Concert Halls).
 * Relationship: Venue/Church -> Performances
 */
export interface Venue {
  id: string;
  name: string;
  type: 'CHURCH' | 'CATHEDRAL' | 'CONCERT_HALL' | 'STUDIO' | 'OUTDOOR';
  address: string;
  city: string;
  country: string;
  capacity?: number;
  acousticProfile?: string; // e.g., "Reverberant (4.5s RT60)", "Dry"
  organSpecsId?: string; // Linked instrument specification if any
  website?: string;
}

/**
 * Represents a performing Choir or vocal ensemble.
 */
export interface Choir {
  id: string;
  name: string;
  baseVenueId?: string; // Associated primary church/hall
  directorName: string;
  foundedYear?: string;
  description: string;
  memberCount: number;
  voiceType: 'SATB' | 'SA' | 'TB' | 'UNISEX';
  performanceIds: string[];
}

/**
 * Represents an ensemble, choral, or orchestral Conductor.
 */
export interface Conductor {
  id: string;
  name: string;
  biography: string;
  associatedOrganisations: string[]; // e.g., ["Music Madras Choir", "Royal College of Organists"]
  performanceIds: string[];
}

/**
 * Represents an individual musical artist or instrumentalist.
 */
export interface Artist {
  id: string;
  name: string;
  instrument: InstrumentType;
  secondaryInstruments?: InstrumentType[];
  biography: string;
  website?: string;
  performanceIds: string[];
}

/**
 * Represents a specific physical instrument of high historical or craft value (e.g., Henry Willis & Sons Pipe Organ).
 */
export interface Instrument {
  id: string;
  name: string;
  manufacturer: string;
  buildYear: string;
  specifications: {
    stopsCount: number;
    manualsCount: number;
    actionType: 'TRACKER' | 'PNEUMATIC' | 'ELECTRO_PNEUMATIC' | 'DIGITAL';
    temperament?: string; // e.g., "Equal Temperament", "Werckmeister III"
  };
  installationVenueId: string; // Physical location of the instrument
  description: string;
}

/**
 * Represents a curated Educational Guide or collection resource.
 */
export interface LearningGuide {
  id: string;
  title: string;
  slug: string;
  difficultyLevel: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED' | 'SCHOLARLY';
  contentMarkdown: string; // Educational reading content
  associatedWorkIds: string[]; // Linked Musical Works being taught
  associatedVideoIds: string[]; // Helpful demonstration videos
  estimatedReadingTimeMinutes: number;
  curatorNotes?: string;
}

/**
 * Represents a cross-entity discovery Recommendation.
 */
export interface Recommendation {
  id: string;
  sourceEntityId: string; // The origin context item
  sourceEntityType: 'WORK' | 'COMPOSER' | 'VIDEO' | 'PLAYLIST' | 'ARTIST';
  targetEntityId: string; // Recommended target item
  targetEntityType: 'WORK' | 'COMPOSER' | 'VIDEO' | 'PLAYLIST' | 'LEARNING_GUIDE';
  confidenceScore: number; // 0.0 to 1.0 representation
  relationshipReasoning: string; // Why this recommendation is made (e.g. "Both showcase baroque counterpoint on Pipe Organ")
}

/**
 * Represents an Organisation (e.g., Cathedral trust, recording label, archival guild).
 */
export interface Organisation {
  id: string;
  name: string;
  type: 'ACADEMIC' | 'ECCLESIASTICAL' | 'ARCHIVAL' | 'TRUST' | 'RECORD_LABEL';
  description: string;
  foundedYear?: string;
  country: string;
}
