/**
 * Music Madras Knowledge Engine (MMKE) - Media Connectors Framework
 * Declares extensible adapters to ingest metadata and stream identifiers from various third-party services.
 */

import { VideoResource } from './entities';

/**
 * Universal platform descriptor.
 */
export type MediaPlatform = 
  | 'YOUTUBE_PUBLIC' 
  | 'YOUTUBE_UNLISTED' 
  | 'YOUTUBE_MUSIC' 
  | 'SPOTIFY' 
  | 'APPLE_MUSIC' 
  | 'LOCAL_HTTP_LIVE_STREAM';

/**
 * Common payload representing a remote audio or video track across any platform.
 */
export interface UnifiedMediaTrack {
  id: string; // MMKE uniform URI: e.g. "mmke:track:youtube:12345"
  title: string;
  artistOrPerformer: string;
  durationSeconds: number;
  thumbnailUrl: string;
  platform: MediaPlatform;
  externalResourceId: string; // The platform ID (e.g. YouTube Video ID or Spotify Track ID)
  streamUrl?: string; // Standard play stream, if resolved
  audioOnly: boolean;
  metadata?: Record<string, any>;
}

/**
 * Extensible interface contract that each external media provider connector must implement.
 */
export interface IMediaConnector {
  readonly platform: MediaPlatform;

  /**
   * Initializes the credential-handshake, API tokens, or public SDK loaders safely.
   */
  initialize(): Promise<boolean>;

  /**
   * Resolves a target identifier into an enriched, normalized track metadata.
   */
  fetchTrackDetails(externalResourceId: string): Promise<UnifiedMediaTrack>;

  /**
   * Fetches metadata for an entire playlist or album of resources in sequence.
   */
  fetchPlaylistTracks(externalPlaylistId: string, limit?: number): Promise<UnifiedMediaTrack[]>;
}

/**
 * Registry holding all active connectors to multiplex streams dynamically.
 */
export interface IMediaConnectorRegistry {
  registerConnector(connector: IMediaConnector): void;
  getConnector(platform: MediaPlatform): IMediaConnector | null;
  resolveUniversalTrack(trackUri: string): Promise<UnifiedMediaTrack>;
}
