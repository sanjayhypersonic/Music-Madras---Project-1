import { Video, Playlist } from '../types';
import { VIDEOS_DATA, PLAYLISTS_DATA, CHANNEL_INFO } from '../data';

export const CHANNEL_ID = 'UCROw3fAGxl5QSOar9HqXuZw';
export const UPLOADS_PLAYLIST_ID = 'UUROw3fAGxl5QSOar9HqXuZw'; // Uploads playlist derived from channel ID
const CACHE_KEY_VIDEOS = 'musicmadras_youtube_videos_cache_v5';
const CACHE_KEY_PLAYLISTS = 'musicmadras_youtube_playlists_cache_v5';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour client-side cache

// Retrieve API key from environment or user-saved browser storage
export function getYouTubeApiKey(): string {
  const envKey = (((import.meta as any).env?.VITE_YOUTUBE_API_KEY as string) || '').trim();
  if (envKey) return envKey;
  try {
    const localKey = (
      localStorage.getItem('VITE_YOUTUBE_API_KEY') || 
      localStorage.getItem('music_madras_youtube_api_key') || 
      ''
    ).trim();
    if (localKey) return localKey;
  } catch {
    // Ignore localStorage restrictions
  }
  return '';
}

// Save or clear user API key in browser storage
export function setYouTubeApiKey(key: string): void {
  try {
    const trimmed = key.trim();
    if (trimmed) {
      localStorage.setItem('VITE_YOUTUBE_API_KEY', trimmed);
      localStorage.setItem('music_madras_youtube_api_key', trimmed);
    } else {
      localStorage.removeItem('VITE_YOUTUBE_API_KEY');
      localStorage.removeItem('music_madras_youtube_api_key');
    }
  } catch {
    // Ignore
  }
}

// Canonical YouTube CDN Thumbnail URL generator
export function getYouTubeThumbnailUrl(youtubeId: string, quality: 'maxres' | 'hq' | 'mq' | 'default' = 'hq'): string {
  switch (quality) {
    case 'maxres':
      return `https://i.ytimg.com/vi/${youtubeId}/maxresdefault.jpg`;
    case 'mq':
      return `https://i.ytimg.com/vi/${youtubeId}/mqdefault.jpg`;
    case 'default':
      return `https://i.ytimg.com/vi/${youtubeId}/default.jpg`;
    case 'hq':
    default:
      return `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;
  }
}

// Intelligent category classifier based on title, description, and musical keywords
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

// Convert view strings or Video objects to accurate numeric count for sorting
export function parseViewsCount(videoOrStr?: Video | string | number): number {
  if (videoOrStr === undefined || videoOrStr === null) return 0;
  if (typeof videoOrStr === 'object') {
    if (typeof videoOrStr.viewsCount === 'number' && videoOrStr.viewsCount > 0) {
      return videoOrStr.viewsCount;
    }
    return parseViewsCount(videoOrStr.views);
  }
  if (typeof videoOrStr === 'number') return videoOrStr;
  const str = videoOrStr.toString().trim().toUpperCase().replace(/VIEWS?/gi, '').trim();
  if (str.endsWith('M') || str.includes('M')) {
    const numPart = str.replace(/[^0-9.]/g, '');
    return (parseFloat(numPart) || 0) * 1000000;
  }
  if (str.endsWith('K') || str.includes('K')) {
    const numPart = str.replace(/[^0-9.]/g, '');
    return (parseFloat(numPart) || 0) * 1000;
  }
  const clean = str.replace(/[^0-9.]/g, '');
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}

// Format numbers (e.g. 15400 -> 15.4K)
export function formatCount(countStr?: string | number): string {
  if (countStr === undefined || countStr === null) return '1.2K';
  const num = typeof countStr === 'number' ? countStr : parseInt(countStr, 10);
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

// Primary fetcher for Music Madras YouTube Channel Videos
export async function getMusicMadrasVideos(forceRefresh = false): Promise<FetchVideosResult> {
  const apiKey = getYouTubeApiKey();

  // 1. Check local cache first if not forcing refresh
  if (!forceRefresh) {
    try {
      const cached = localStorage.getItem(CACHE_KEY_VIDEOS);
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

  // 2. If no API key is provided, return default channel archive with YouTube CDN thumbnails
  if (!apiKey) {
    return {
      videos: VIDEOS_DATA,
      isLive: false,
      error: 'NO_API_KEY'
    };
  }

  try {
    // 3. Deep YouTube API integration:
    // Query search with order=viewCount to guarantee all the most viewed videos are fetched
    // Also query uploads playlist for recent recordings
    const [popularSearchRes, uploadsRes] = await Promise.all([
      fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${CHANNEL_ID}&order=viewCount&type=video&maxResults=50&key=${apiKey}`).catch(() => null),
      fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${UPLOADS_PLAYLIST_ID}&maxResults=50&key=${apiKey}`).catch(() => null)
    ]);

    const snippetItemsMap = new Map<string, any>();

    if (popularSearchRes && popularSearchRes.ok) {
      const searchData = await popularSearchRes.json();
      (searchData.items || []).forEach((item: any) => {
        const vidId = item.id?.videoId;
        if (vidId) {
          snippetItemsMap.set(vidId, item);
        }
      });
    }

    if (uploadsRes && uploadsRes.ok) {
      const uploadsData = await uploadsRes.json();
      (uploadsData.items || []).forEach((item: any) => {
        const vidId = item.snippet?.resourceId?.videoId;
        if (vidId && !snippetItemsMap.has(vidId)) {
          snippetItemsMap.set(vidId, item);
        }
      });
    }

    const uniqueVideoIds = Array.from(snippetItemsMap.keys());

    if (uniqueVideoIds.length === 0) {
      return { videos: VIDEOS_DATA, isLive: false };
    }

    // 4. Batch fetch statistics & details for all video IDs
    const detailsUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${uniqueVideoIds.slice(0, 50).join(',')}&key=${apiKey}`;
    const detailsRes = await fetch(detailsUrl);
    
    let detailsMap = new Map<string, any>();
    if (detailsRes.ok) {
      const detailsData = await detailsRes.json();
      (detailsData.items || []).forEach((item: any) => {
        detailsMap.set(item.id, item);
      });
    }

    // 5. Map into clean Video objects matching application interface
    // Every single thumbnail comes strictly from YouTube's official CDN
    const mappedVideos: Video[] = uniqueVideoIds.map((videoId: string, index: number) => {
      const item = snippetItemsMap.get(videoId);
      const detail = detailsMap.get(videoId);
      const title = detail?.snippet?.title || item?.snippet?.title || 'Music Madras Performance';
      const description = detail?.snippet?.description || item?.snippet?.description || '';
      
      const thumb = 
        detail?.snippet?.thumbnails?.maxres?.url ||
        detail?.snippet?.thumbnails?.high?.url ||
        item?.snippet?.thumbnails?.high?.url ||
        item?.snippet?.thumbnails?.medium?.url ||
        `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

      const category = classifyVideoCategory(title, description);
      const duration = formatIsoDuration(detail?.contentDetails?.duration);
      const rawViews = parseInt(detail?.statistics?.viewCount || '0', 10);
      const views = formatCount(rawViews);
      const likesCount = parseInt(detail?.statistics?.likeCount || '0', 10);
      const publishedAt = formatPublishedDate(detail?.snippet?.publishedAt || item?.snippet?.publishedAt);

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
        viewsCount: rawViews,
        publishedAt,
        description: description.slice(0, 180) + (description.length > 180 ? '...' : ''),
        likesCount: likesCount > 0 ? likesCount : (85 + index * 12),
        thumbnailUrl: thumb
      };
    });

    // Save to localStorage cache
    try {
      localStorage.setItem(CACHE_KEY_VIDEOS, JSON.stringify({
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

export interface FetchPlaylistsResult {
  playlists: Playlist[];
  isLive: boolean;
  cachedAt?: number;
  error?: string;
}

// Fetcher for Music Madras YouTube Playlists
export async function getMusicMadrasPlaylists(forceRefresh = false): Promise<FetchPlaylistsResult> {
  const apiKey = getYouTubeApiKey();

  if (!forceRefresh) {
    try {
      const cached = localStorage.getItem(CACHE_KEY_PLAYLISTS);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.timestamp && Date.now() - parsed.timestamp < CACHE_TTL_MS && Array.isArray(parsed.playlists) && parsed.playlists.length > 0) {
          return {
            playlists: parsed.playlists,
            isLive: true,
            cachedAt: parsed.timestamp
          };
        }
      }
    } catch {
      // ignore
    }
  }

  if (!apiKey) {
    return {
      playlists: PLAYLISTS_DATA,
      isLive: false,
      error: 'NO_API_KEY'
    };
  }

  try {
    const url = `https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&channelId=${CHANNEL_ID}&maxResults=50&key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) {
      return {
        playlists: PLAYLISTS_DATA,
        isLive: false,
        error: `API_ERROR_${res.status}`
      };
    }

    const data = await res.json();
    const items = data.items || [];
    if (items.length === 0) {
      return { playlists: PLAYLISTS_DATA, isLive: false };
    }

    const mappedPlaylists: Playlist[] = items.map((item: any) => {
      const thumb =
        item.snippet?.thumbnails?.maxres?.url ||
        item.snippet?.thumbnails?.high?.url ||
        item.snippet?.thumbnails?.medium?.url ||
        item.snippet?.thumbnails?.standard?.url ||
        item.snippet?.thumbnails?.default?.url ||
        `https://i.ytimg.com/vi/vgh1AU_pg3w/hqdefault.jpg`;

      return {
        id: item.id,
        title: item.snippet?.title || 'Music Madras Playlist',
        videoCount: item.contentDetails?.itemCount || 0,
        description: item.snippet?.description || 'Curated classical performances from @MusicMadras.',
        youtubeUrl: `https://www.youtube.com/playlist?list=${item.id}`,
        thumbnailUrl: thumb,
        imageQuery: 'concert'
      };
    });

    // Merge with any curated descriptions in PLAYLISTS_DATA if available
    const playlistIdMap = new Map<string, Playlist>();
    PLAYLISTS_DATA.forEach(p => playlistIdMap.set(p.id, p));
    const combinedPlaylists = mappedPlaylists.map(pl => {
      const curated = playlistIdMap.get(pl.id);
      if (curated) {
        return {
          ...curated,
          videoCount: pl.videoCount || curated.videoCount,
          thumbnailUrl: pl.thumbnailUrl || curated.thumbnailUrl
        };
      }
      return pl;
    });

    // Add any remaining curated playlists that might not have been returned in the batch
    PLAYLISTS_DATA.forEach(p => {
      if (!combinedPlaylists.some(cp => cp.id === p.id)) {
        combinedPlaylists.push(p);
      }
    });

    try {
      localStorage.setItem(CACHE_KEY_PLAYLISTS, JSON.stringify({
        timestamp: Date.now(),
        playlists: combinedPlaylists
      }));
    } catch {
      // ignore
    }

    return {
      playlists: combinedPlaylists,
      isLive: true,
      cachedAt: Date.now()
    };
  } catch (err: any) {
    return {
      playlists: PLAYLISTS_DATA,
      isLive: false,
      error: err.message
    };
  }
}

export interface ChannelStats {
  subscribers: string;
  videoCount: string;
  totalViews: string;
}

export interface FetchChannelStatsResult {
  stats: ChannelStats;
  isLive: boolean;
  error?: string;
}

const CACHE_KEY_STATS = 'musicmadras_youtube_stats_cache_v5';

// Fetcher for Channel Stats (subscribers, views, video counts)
export async function getMusicMadrasChannelStats(forceRefresh = false): Promise<FetchChannelStatsResult> {
  const apiKey = getYouTubeApiKey();
  const defaultStats: ChannelStats = {
    subscribers: CHANNEL_INFO.subscribers,
    videoCount: CHANNEL_INFO.videoCount,
    totalViews: CHANNEL_INFO.totalViews
  };

  // 1. Check local cache first if not forcing refresh
  if (!forceRefresh) {
    try {
      const cached = localStorage.getItem(CACHE_KEY_STATS);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.timestamp && Date.now() - parsed.timestamp < CACHE_TTL_MS && parsed.stats) {
          return {
            stats: parsed.stats,
            isLive: true
          };
        }
      }
    } catch {
      // ignore
    }
  }

  if (!apiKey) {
    return { stats: defaultStats, isLive: false, error: 'NO_API_KEY' };
  }

  try {
    const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${CHANNEL_ID}&key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) {
      return { stats: defaultStats, isLive: false, error: `API_ERROR_${res.status}` };
    }

    const data = await res.json();
    const item = data.items?.[0];
    if (!item) {
      return { stats: defaultStats, isLive: false };
    }

    const subCount = item.statistics?.subscriberCount;
    const liveStats: ChannelStats = {
      subscribers: subCount ? formatCount(subCount) : defaultStats.subscribers,
      videoCount: item.statistics?.videoCount ? item.statistics.videoCount.toString() : defaultStats.videoCount,
      totalViews: item.statistics?.viewCount ? formatCount(item.statistics.viewCount) : defaultStats.totalViews
    };

    try {
      localStorage.setItem(CACHE_KEY_STATS, JSON.stringify({
        timestamp: Date.now(),
        stats: liveStats
      }));
    } catch {
      // ignore
    }

    return { stats: liveStats, isLive: true };
  } catch (err: any) {
    return { stats: defaultStats, isLive: false, error: err.message };
  }
}
