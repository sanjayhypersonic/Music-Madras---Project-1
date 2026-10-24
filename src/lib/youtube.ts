import { Video } from '../types';
import { VIDEOS_DATA } from '../data';

export const CHANNEL_ID = 'UCROw3fAGxl5QSOar9HqXuZw';
export const UPLOADS_PLAYLIST_ID = 'UUROw3fAGxl5QSOar9HqXuZw'; // Uploads playlist derived from channel ID
const CACHE_KEY = 'musicmadras_youtube_videos_cache';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour client-side cache

// Intelligent category classifier based on title, description, and tags
export function classifyVideoCategory(title: string, description: string): Video['category'] {
  const text = `${title} ${description}`.toLowerCase();

  // Pipe Organ detection
  if (
    text.includes('organ') || 
    text.includes('pipe organ') || 
    text.includes('preludio') || 
    text.includes('toccata') || 
    text.includes('chorale prelude') || 
    text.includes('bach organ') ||
    text.includes('widor')
  ) {
    return 'Organ';
  }

  // Choral / Choir detection
  if (
    text.includes('choir') || 
    text.includes('choral') || 
    text.includes('chorus') || 
    text.includes('anthem') || 
    text.includes('hymn') || 
    text.includes('carol') || 
    text.includes('cantata') || 
    text.includes('madrigal')
  ) {
    return 'Choral';
  }

  // Vocal / Solo detection
  if (
    text.includes('solo') || 
    text.includes('soprano') || 
    text.includes('tenor') || 
    text.includes('alto') || 
    text.includes('baritone') || 
    text.includes('bass') || 
    text.includes('vocal') || 
    text.includes('singer') ||
    text.includes('geetham') ||
    text.includes('kavithai')
  ) {
    return 'Vocal';
  }

  // Instrumental / Orchestral detection
  if (
    text.includes('brass') || 
    text.includes('orchestra') || 
    text.includes('symphony') || 
    text.includes('violin') || 
    text.includes('cello') || 
    text.includes('flute') || 
    text.includes('ensemble') || 
    text.includes('clarinet') || 
    text.includes('string quartet') || 
    text.includes('oboe') ||
    text.includes('trumpet') ||
    text.includes('harp')
  ) {
    return 'Instrumental';
  }

  // Default to Concert
  return 'Concert';
}

// Convert ISO 8601 duration (e.g. PT4M12S, PT1H2M30S) to MM:SS or H:MM:SS
export function formatIsoDuration(isoDuration?: string): string {
  if (!isoDuration) return '3:45';
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return '3:45';

  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);

  const formattedSeconds = seconds.toString().padStart(2, '0');

  if (hours > 0) {
    const formattedMinutes = minutes.toString().padStart(2, '0');
    return `${hours}:${formattedMinutes}:${formattedSeconds}`;
  }
  return `${minutes}:${formattedSeconds}`;
}

// Format numbers (e.g. 15400 -> 15.4K)
export function formatCount(countStr?: string): string {
  if (!countStr) return '1.2K';
  const num = parseInt(countStr, 10);
  if (isNaN(num)) return '1.2K';
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

// Format publication date into relative or formatted string
export function formatPublishedDate(publishedAt?: string): string {
  if (!publishedAt) return 'Recent';
  try {
    const date = new Date(publishedAt);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 7) {
      if (diffDays <= 0) return 'Today';
      if (diffDays === 1) return 'Yesterday';
      return `${diffDays} days ago`;
    }
    if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
    }
    if (diffDays < 365) {
      const months = Math.floor(diffDays / 30);
      return `${months} ${months === 1 ? 'month' : 'months'} ago`;
    }
    const years = Math.floor(diffDays / 365);
    return `${years} ${years === 1 ? 'year' : 'years'} ago`;
  } catch {
    return 'Recent';
  }
}

export interface FetchVideosResult {
  videos: Video[];
  isLive: boolean;
  cachedAt?: number;
  error?: string;
}

// Primary fetcher for Music Madras YouTube Channel
export async function getMusicMadrasVideos(forceRefresh = false): Promise<FetchVideosResult> {
  const apiKey = (import.meta.env.VITE_YOUTUBE_API_KEY || '').trim();

  // 1. Check local cache first if not forcing refresh
  if (!forceRefresh) {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.timestamp && Date.now() - parsed.timestamp < CACHE_TTL_MS && Array.isArray(parsed.videos) && parsed.videos.length > 0) {
          return {
            videos: parsed.videos,
            isLive: true,
            cachedAt: parsed.timestamp
          };
        }
      }
    } catch {
      // Ignore cache read errors
    }
  }

  // 2. If no API key is provided, return curated fallback smoothly
  if (!apiKey) {
    return {
      videos: VIDEOS_DATA,
      isLive: false,
      error: 'NO_API_KEY'
    };
  }

  try {
    // 3. Low-quota fetch: Get up to 50 uploads from playlist (Costs ONLY 1 quota unit)
    const playlistUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${UPLOADS_PLAYLIST_ID}&maxResults=50&key=${apiKey}`;
    const playlistRes = await fetch(playlistUrl);

    if (!playlistRes.ok) {
      const errData = await playlistRes.json().catch(() => ({}));
      console.warn('YouTube Playlist API warning:', errData);
      return {
        videos: VIDEOS_DATA,
        isLive: false,
        error: playlistRes.status === 403 ? 'QUOTA_EXCEEDED' : 'API_ERROR'
      };
    }

    const playlistData = await playlistRes.json();
    const items = playlistData.items || [];
    if (items.length === 0) {
      return { videos: VIDEOS_DATA, isLive: false };
    }

    // Extract video IDs
    const videoIds: string[] = items
      .map((item: any) => item.snippet?.resourceId?.videoId)
      .filter((id: string | undefined): id is string => Boolean(id));

    // 4. Batch fetch details for all video IDs (Costs ONLY 1 quota unit for up to 50 items)
    const detailsUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${videoIds.join(',')}&key=${apiKey}`;
    const detailsRes = await fetch(detailsUrl);
    
    let detailsMap = new Map<string, any>();
    if (detailsRes.ok) {
      const detailsData = await detailsRes.json();
      (detailsData.items || []).forEach((item: any) => {
        detailsMap.set(item.id, item);
      });
    }

    // 5. Map into clean Video objects matching application interface
    const mappedVideos: Video[] = items.map((item: any, index: number) => {
      const videoId = item.snippet?.resourceId?.videoId || `mm-${index}`;
      const detail = detailsMap.get(videoId);
      const title = item.snippet?.title || 'Music Madras Performance';
      const description = item.snippet?.description || '';
      
      const thumb = 
        item.snippet?.thumbnails?.maxres?.url ||
        item.snippet?.thumbnails?.high?.url ||
        item.snippet?.thumbnails?.medium?.url ||
        `https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?q=80&w=1200`;

      const category = classifyVideoCategory(title, description);
      const duration = formatIsoDuration(detail?.contentDetails?.duration);
      const views = formatCount(detail?.statistics?.viewCount);
      const likesCount = parseInt(detail?.statistics?.likeCount || '0', 10);
      const publishedAt = formatPublishedDate(item.snippet?.publishedAt);

      // Extract artist if formatted like "Artist - Title" or "Title | Artist"
      let artist = 'Music Madras Ensemble';
      if (title.includes('|')) {
        const parts = title.split('|');
        if (parts.length > 1 && parts[1].trim().length > 0) {
          artist = parts[1].trim();
        }
      } else if (title.includes(' - ')) {
        const parts = title.split(' - ');
        if (parts.length > 1 && parts[1].trim().length > 0) {
          artist = parts[0].trim();
        }
      }

      return {
        id: videoId,
        youtubeId: videoId,
        title,
        artist,
        category,
        duration,
        views,
        publishedAt,
        description: description.slice(0, 180) + (description.length > 180 ? '...' : ''),
        likesCount: likesCount > 0 ? likesCount : (85 + index * 12),
        thumbnailUrl: thumb
      };
    });

    // Save to localStorage cache
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        timestamp: Date.now(),
        videos: mappedVideos
      }));
    } catch {
      // Ignore cache storage errors
    }

    return {
      videos: mappedVideos,
      isLive: true,
      cachedAt: Date.now()
    };
  } catch (err: any) {
    console.warn('Error fetching YouTube API live videos:', err);
    return {
      videos: VIDEOS_DATA,
      isLive: false,
      error: err.message
    };
  }
}
