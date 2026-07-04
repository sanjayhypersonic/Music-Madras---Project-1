export type StudioRole = 'Founder' | 'Super Administrator' | 'Administrator' | 'Editor' | 'Reviewer' | 'Contributor';

export type KnowledgePack = RecordingDraft;
export type KnowledgePackStatus = RecordingStatus;

export interface StudioUser {
  id: string;
  email: string;
  name: string;
  role: StudioRole;
  twoFactorEnabled: boolean;
  invitedBy?: string;
  createdAt: string;
}

export type RecordingStatus =
  | 'Detected'
  | 'Draft'
  | 'Metadata Required'
  | 'In Review'
  | 'Ready to Publish'
  | 'Published'
  | 'Archived';

// CHANGE 2: Programme is a first-class entity
export interface Programme {
  programmeTitle: string;
  concertOrder: number;
  movements?: string;
  intermission: boolean;
  intermissionDetails?: string;
  encore?: string;
  runningOrder?: string;
  programmeNotes?: string;
}

export interface MusicalWorkDraft {
  title: string;
  composerName: string;
  composerEra?: string;
  catalogueNumber?: string;
  durationMinutes?: number;
  keySignature?: string;
}

export interface MediaAssets {
  youtubeId: string;
  masterAudioUrl?: string;
  highResImageUrl?: string;
  programmePdfUrl?: string;
  posterUrl?: string;
  concertBookletUrl?: string;
  slidesUrl?: string;
  sheetMusicUrl?: string;
  archiveFilesUrl?: string;
}

export interface SEOData {
  metaTitle: string;
  metaDescription: string;
  canonicalUrl: string;
  openGraphUrl?: string;
  twitterCard?: string;
  jsonLdSchema?: string;
  breadcrumbs?: string[];
  internalLinks?: string[];
}

export interface RelationshipItem {
  targetId: string;
  targetName: string;
  targetType: 'Composer' | 'Work' | 'Venue' | 'Artist' | 'Choir' | 'Conductor';
  confidenceScore: number; // 0.0 to 1.0
  reasoning: string;
}

// CHANGE 1: Recording is the primary root object
export interface RecordingDraft {
  id: string;
  youtubeId: string;
  title: string;
  artist: string; // Performing artist/ensemble
  duration: string;
  publishedAt: string;
  description: string;
  status: RecordingStatus;
  createdAt: string;
  updatedAt: string;

  // Step 2: Programme
  programme?: Programme;

  // Step 3: Composer & Musical Works
  works?: MusicalWorkDraft[];

  // Step 4: Performance Details
  performanceDate?: string;
  isPublic: boolean;

  // Step 5: Venue Details
  venue?: {
    id?: string;
    name: string;
    address?: string;
    city?: string;
    capacity?: number;
    acousticProfile?: string;
  };

  // Step 6: Participants
  participants?: {
    organist?: string;
    choir?: string;
    conductor?: string;
    orchestra?: string;
    soloists?: string;
  };

  // Step 7: Educational Content
  educationalContent?: {
    listeningGuide?: string;
    analysisMarkdown?: string;
    difficultyLevel?: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED' | 'SCHOLARLY';
  };

  // Step 8: Media Assets
  mediaAssets?: MediaAssets;

  // Step 9: SEO
  seo?: SEOData;

  // Step 10: Smart Relationships
  relationships?: RelationshipItem[];
}

export interface AuditLog {
  id: string;
  timestamp: string;
  userEmail: string;
  role: StudioRole;
  action: string;
  targetId: string;
  targetName: string;
}

export interface WorkspaceNotification {
  id: string;
  type: 'alert' | 'success' | 'info' | 'warning';
  title: string;
  message: string;
  date: string;
  read: boolean;
}
