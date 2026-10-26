import { Video, Playlist, ChannelStats } from '../types';
import { VIDEOS_DATA, PLAYLISTS_DATA, CHANNEL_INFO } from '../data';

export const CHANNEL_ID = 'UCROw3fAGxl5QSOar9HqXuZw';
export const UPLOADS_PLAYLIST_ID = 'UUROw3fAGxl5QSOar9HqXuZw'; // Uploads playlist derived from channel ID

// Dynamic API Data update interval: Strictly 3 hours (3 * 60 * 60 * 1000 ms = 10,800,000 ms)
export const DYNAMIC_UPDATE_INTERVAL_MS = 3 * 60 * 60 * 1000;
export const CACHE_TTL_MS = DYNAMIC_UPDATE_INTERVAL_MS;

const CACHE_KEY_VIDEOS = 'musicmadras_youtube_videos_cache_v6';
const CACHE_KEY_PLAYLISTS = 'musicmadras_youtube_playlists_cache_v6';
const CACHE_KEY_STATS = 'musicmadras_youtube_stats_cache_v6';
const CACHE_KEY_SYNC_META = 'musicmadras_dynamic_sync_meta_v6';

// Check whether cached dynamic data is older than 3 hours
export function isDynamicDataStale(timestamp?: number | null): boolean {
  if (!timestamp) return true;
  return Date.now() - timestamp >= DYNAMIC_UPDATE_INTERVAL_MS;
}

// Calculate remaining milliseconds until the next 3-hour cycle check
export function getTimeUntilNextCheck(timestamp?: number | null): number {
  if (!timestamp) return 0;
  const elapsed = Date.now() - timestamp;
  const remaining = DYNAMIC_UPDATE_INTERVAL_MS - elapsed;
  return remaining > 0 ? remaining : 0;
}

// Format duration until next check into human-readable string (e.g. "2h 45m" or "Due now")
export function formatTimeUntilNextCheck(timestamp?: number | null): string {
  const remainingMs = getTimeUntilNextCheck(timestamp);
  if (remainingMs <= 0) return 'Due now (Every 3 hours)';
  const totalMinutes = Math.floor(remainingMs / (60 * 1000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

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
  if (countStr === undefined || countStr === null) return '0';
  const num = typeof countStr === 'number' ? countStr : parseInt(countStr.toString().replace(/,/g, ''), 10);
  if (isNaN(num)) return '0';
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

// Sanitize artist names to remove any deprecated specific choir labels
export function sanitizeArtistName(artist: string): string {
  if (!artist) return 'Vocal Ensemble';
  if (/st\.?\s*andrew'?s\s*kirk\s*choir/i.test(artist)) {
    return 'Wedding Choir';
  }
  if (/music\s*madras\s*vocal\s*ensemble/i.test(artist)) {
    return 'Wedding Choir';
  }
  if (/music\s*madras\s*choir/i.test(artist)) {
    return 'Vocal Ensemble';
  }
  return artist;
}

// Extract timestamp for strict sorting by latest upload date
export function getVideoPublishTimestamp(video: Video): number {
  if (video.publishedAtRaw) {
    const t = new Date(video.publishedAtRaw).getTime();
    if (!isNaN(t) && t > 0) return t;
  }
  
  // Parse relative strings like "2 days ago", "9 days ago", "2 weeks ago", "1 month ago"
  const text = (video.publishedAt || '').toLowerCase().trim();
  const now = Date.now();
  
  if (text.includes('just now') || text.includes('today')) {
    return now;
  }
  if (text.includes('yesterday')) {
    return now - 86400 * 1000;
  }
  
  const hourMatch = text.match(/(\d+)\s*hour/);
  if (hourMatch) {
    return now - parseInt(hourMatch[1], 10) * 3600 * 1000;
  }
  
  const dayMatch = text.match(/(\d+)\s*day/);
  if (dayMatch) {
    return now - parseInt(dayMatch[1], 10) * 86400 * 1000;
  }
  
  const weekMatch = text.match(/(\d+)\s*week/);
  if (weekMatch) {
    return now - parseInt(weekMatch[1], 10) * 7 * 86400 * 1000;
  }
  
  const monthMatch = text.match(/(\d+)\s*month/);
  if (monthMatch) {
    return now - parseInt(monthMatch[1], 10) * 30 * 86400 * 1000;
  }
  
  const yearMatch = text.match(/(\d+)\s*year/);
  if (yearMatch) {
    return now - parseInt(yearMatch[1], 10) * 365 * 86400 * 1000;
  }
  
  return 0;
}

// Retrieves the latest video strictly by upload/publish date
export function getLatestUpload(videos: Video[]): Video | undefined {
  if (!videos || videos.length === 0) return undefined;
  return [...videos].sort((a, b) => getVideoPublishTimestamp(b) - getVideoPublishTimestamp(a))[0];
}

export interface FetchVideosResult {
  videos: Video[];
  isLive: boolean;
  cachedAt?: number;
  error?: string;
}

// Helper: Split array into chunks of chunkSize
function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const results: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    results.push(array.slice(i, i + chunkSize));
  }
  return results;
}

// Primary fetcher for Music Madras YouTube Channel Videos
// Checks cache freshness (3-hour rule) and updates all dynamic fields: titles, views, likes, durations, descriptions, etc.
export async function getMusicMadrasVideos(forceRefresh = false): Promise<FetchVideosResult> {
  const apiKey = getYouTubeApiKey();

  // 1. Check local cache first if not forcing refresh
  if (!forceRefresh) {
    try {
      const cached = localStorage.getItem(CACHE_KEY_VIDEOS);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (
          parsed.timestamp && 
          !isDynamicDataStale(parsed.timestamp) && 
          Array.isArray(parsed.videos) && 
          parsed.videos.length > 0
        ) {
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

  // 2. If no API key is provided, return default channel archive with real YouTube data
  if (!apiKey) {
    return {
      videos: VIDEOS_DATA,
      isLive: false,
      error: 'NO_API_KEY'
    };
  }

  try {
    // 3. Deep YouTube API integration:
    // Query search with order=viewCount to guarantee top-viewed videos
    // Query uploads playlist items to get recent uploads
    const [popularSearchRes, uploadsRes] = await Promise.all([
      fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${CHANNEL_ID}&order=viewCount&type=video&maxResults=50&key=${apiKey}`).catch(() => null),
      fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${UPLOADS_PLAYLIST_ID}&maxResults=50&key=${apiKey}`).catch(() => null)
    ]);

    const snippetItemsMap = new Map<string, any>();

    // Prioritize uploads playlist items so newest uploads are preserved in order
    if (uploadsRes && uploadsRes.ok) {
      const uploadsData = await uploadsRes.json();
      (uploadsData.items || []).forEach((item: any) => {
        const vidId = item.snippet?.resourceId?.videoId || item.contentDetails?.videoId;
        if (vidId && !snippetItemsMap.has(vidId)) {
          snippetItemsMap.set(vidId, item);
        }
      });

      // If uploads has a nextPageToken, fetch page 2 to get more recent uploads
      if (uploadsData.nextPageToken) {
        try {
          const uploadsRes2 = await fetch(
            `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${UPLOADS_PLAYLIST_ID}&maxResults=50&pageToken=${uploadsData.nextPageToken}&key=${apiKey}`
          );
          if (uploadsRes2.ok) {
            const data2 = await uploadsRes2.json();
            (data2.items || []).forEach((item: any) => {
              const vidId = item.snippet?.resourceId?.videoId || item.contentDetails?.videoId;
              if (vidId && !snippetItemsMap.has(vidId)) {
                snippetItemsMap.set(vidId, item);
              }
            });
          }
        } catch {
          // ignore page 2 failure
        }
      }
    }

    // Next add popular search results so any other catalog performances are included
    if (popularSearchRes && popularSearchRes.ok) {
      const searchData = await popularSearchRes.json();
      (searchData.items || []).forEach((item: any) => {
        const vidId = item.id?.videoId;
        if (vidId && !snippetItemsMap.has(vidId)) {
          snippetItemsMap.set(vidId, item);
        }
      });
    }

    const uniqueVideoIds = Array.from(snippetItemsMap.keys());

    if (uniqueVideoIds.length === 0) {
      return { videos: VIDEOS_DATA, isLive: false };
    }

    // 4. Batch fetch statistics & details for ALL video IDs in chunks of 50
    const chunks = chunkArray(uniqueVideoIds, 50);
    const detailsMap = new Map<string, any>();

    await Promise.all(
      chunks.map(async (chunk) => {
        const detailsUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${chunk.join(',')}&key=${apiKey}`;
        try {
          const detailsRes = await fetch(detailsUrl);
          if (detailsRes.ok) {
            const detailsData = await detailsRes.json();
            (detailsData.items || []).forEach((item: any) => {
              detailsMap.set(item.id, item);
            });
          }
        } catch (err) {
          console.warn('Batch video details fetch error:', err);
        }
      })
    );

    // 5. Map into clean Video objects matching application interface
    // Every single thumbnail comes strictly from YouTube's official CDN
    // Every title, viewsCount, likesCount, duration comes directly from the official API
    const mappedVideos: Video[] = uniqueVideoIds.map((videoId: string) => {
      const item = snippetItemsMap.get(videoId);
      const detail = detailsMap.get(videoId);
      const title = detail?.snippet?.title || item?.snippet?.title || 'Music Madras Performance';
      const description = detail?.snippet?.description || item?.snippet?.description || '';
      const publishedAtIso = detail?.snippet?.publishedAt || item?.snippet?.publishedAt || '';
      
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
      const commentCount = parseInt(detail?.statistics?.commentCount || '0', 10);
      const publishedAt = formatPublishedDate(publishedAtIso);

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
      artist = sanitizeArtistName(artist);

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
        publishedAtRaw: publishedAtIso,
        description: description.slice(0, 200) + (description.length > 200 ? '...' : ''),
        likesCount: likesCount > 0 ? likesCount : 0,
        commentCount: commentCount > 0 ? commentCount : 0,
        thumbnailUrl: thumb,
        tags: detail?.snippet?.tags || []
      };
    });

    // Sort mappedVideos strictly by latest upload date descending
    mappedVideos.sort((a, b) => getVideoPublishTimestamp(b) - getVideoPublishTimestamp(a));

    const now = Date.now();

    // Save to localStorage cache with current timestamp
    try {
      localStorage.setItem(CACHE_KEY_VIDEOS, JSON.stringify({
        timestamp: now,
        videos: mappedVideos
      }));
    } catch {
      // Ignore cache storage errors
    }

    return {
      videos: mappedVideos,
      isLive: true,
      cachedAt: now
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
// Supports pagination so all playlists are captured, checking and updating every 3 hours
export async function getMusicMadrasPlaylists(forceRefresh = false): Promise<FetchPlaylistsResult> {
  const apiKey = getYouTubeApiKey();

  if (!forceRefresh) {
    try {
      const cached = localStorage.getItem(CACHE_KEY_PLAYLISTS);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (
          parsed.timestamp && 
          !isDynamicDataStale(parsed.timestamp) && 
          Array.isArray(parsed.playlists) && 
          parsed.playlists.length > 0
        ) {
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
    let allItems: any[] = [];
    let nextPageToken: string | undefined = undefined;
    let pageCount = 0;

    // Multi-page fetch to ensure no playlists are missed
    do {
      pageCount++;
      const url: string = `https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&channelId=${CHANNEL_ID}&maxResults=50${nextPageToken ? `&pageToken=${nextPageToken}` : ''}&key=${apiKey}`;
      const res: Response = await fetch(url);
      if (!res.ok) {
        break;
      }
      const data: any = await res.json();
      if (data.items && Array.isArray(data.items)) {
        allItems = allItems.concat(data.items);
      }
      nextPageToken = data.nextPageToken;
    } while (nextPageToken && pageCount < 5);

    if (allItems.length === 0) {
      return { playlists: PLAYLISTS_DATA, isLive: false };
    }

    const mappedPlaylists: Playlist[] = allItems.map((item: any) => {
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
        imageQuery: 'concert',
        publishedAt: item.snippet?.publishedAt,
        channelTitle: item.snippet?.channelTitle || 'Music Madras'
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
          title: pl.title || curated.title,
          videoCount: pl.videoCount || curated.videoCount,
          thumbnailUrl: pl.thumbnailUrl || curated.thumbnailUrl,
          description: pl.description || curated.description
        };
      }
      return pl;
    });

    // Add any remaining curated playlists that might not have been returned in the live set
    PLAYLISTS_DATA.forEach(p => {
      if (!combinedPlaylists.some(cp => cp.id === p.id)) {
        combinedPlaylists.push(p);
      }
    });

    const now = Date.now();

    try {
      localStorage.setItem(CACHE_KEY_PLAYLISTS, JSON.stringify({
        timestamp: now,
        playlists: combinedPlaylists
      }));
    } catch {
      // ignore
    }

    return {
      playlists: combinedPlaylists,
      isLive: true,
      cachedAt: now
    };
  } catch (err: any) {
    return {
      playlists: PLAYLISTS_DATA,
      isLive: false,
      error: err.message
    };
  }
}

export interface FetchChannelStatsResult {
  stats: ChannelStats;
  isLive: boolean;
  cachedAt?: number;
  error?: string;
}

// Fetcher for Channel Stats (subscribers, views, video counts, etc.)
// Dynamic checking and updating every 3 hours
export async function getMusicMadrasChannelStats(forceRefresh = false): Promise<FetchChannelStatsResult> {
  const apiKey = getYouTubeApiKey();
  const defaultStats: ChannelStats = {
    subscribers: CHANNEL_INFO.subscribers,
    subscriberCountRaw: parseInt(CHANNEL_INFO.subscribers, 10),
    videoCount: CHANNEL_INFO.videoCount,
    totalViews: CHANNEL_INFO.totalViews,
    totalViewsRaw: 227000,
    channelTitle: CHANNEL_INFO.name,
    channelDescription: CHANNEL_INFO.description,
    handle: CHANNEL_INFO.handle,
    avatarUrl: 'https://yt3.googleusercontent.com/d0KOXSy8sQFmrwCGqkTjm90JYMpqdtrFpjtQCh7145eUjEf0XDnCxPXvfg6_RvKnaIY091x5_TA=s800-c-k-c0x00ffffff-no-rj'
  };

  // 1. Check local cache first if not forcing refresh
  if (!forceRefresh) {
    try {
      const cached = localStorage.getItem(CACHE_KEY_STATS);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.timestamp && !isDynamicDataStale(parsed.timestamp) && parsed.stats) {
          return {
            stats: parsed.stats,
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
    return { stats: defaultStats, isLive: false, error: 'NO_API_KEY' };
  }

  try {
    const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,brandingSettings&id=${CHANNEL_ID}&key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) {
      return { stats: defaultStats, isLive: false, error: `API_ERROR_${res.status}` };
    }

    const data = await res.json();
    const item = data.items?.[0];
    if (!item) {
      return { stats: defaultStats, isLive: false };
    }

    const subCountRaw = parseInt(item.statistics?.subscriberCount || '0', 10);
    const viewCountRaw = parseInt(item.statistics?.viewCount || '0', 10);
    const videoCountStr = item.statistics?.videoCount ? item.statistics.videoCount.toString() : defaultStats.videoCount;

    const liveStats: ChannelStats = {
      subscribers: subCountRaw > 0 ? (subCountRaw < 10000 ? subCountRaw.toString() : formatCount(subCountRaw)) : defaultStats.subscribers,
      subscriberCountRaw: subCountRaw > 0 ? subCountRaw : defaultStats.subscriberCountRaw,
      videoCount: videoCountStr,
      totalViews: viewCountRaw > 0 ? formatCount(viewCountRaw) : defaultStats.totalViews,
      totalViewsRaw: viewCountRaw > 0 ? viewCountRaw : defaultStats.totalViewsRaw,
      channelTitle: item.snippet?.title || defaultStats.channelTitle,
      channelDescription: item.snippet?.description || defaultStats.channelDescription,
      handle: item.snippet?.customUrl || defaultStats.handle,
      avatarUrl: item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.default?.url || defaultStats.avatarUrl
    };

    const now = Date.now();

    try {
      localStorage.setItem(CACHE_KEY_STATS, JSON.stringify({
        timestamp: now,
        stats: liveStats
      }));
    } catch {
      // ignore
    }

    return { stats: liveStats, isLive: true, cachedAt: now };
  } catch (err: any) {
    return { stats: defaultStats, isLive: false, error: err.message };
  }
}

// Unified master check and refresh function for all dynamic YouTube Data API fields
// Checks if current state is older than 3 hours; executes full dynamic refresh if so
export async function checkAndUpdateDynamicData(forceRefresh = false): Promise<{
  videos: Video[];
  playlists: Playlist[];
  channelStats: ChannelStats;
  isLive: boolean;
  cachedAt: number;
  nextCheckAt: number;
  refreshed: boolean;
  error?: string;
}> {
  // Check if any dataset is stale (>= 3 hours)
  let shouldRefresh = forceRefresh;
  
  if (!shouldRefresh) {
    try {
      const syncMeta = localStorage.getItem(CACHE_KEY_SYNC_META);
      if (syncMeta) {
        const parsed = JSON.parse(syncMeta);
        if (parsed.lastCheckedAt && isDynamicDataStale(parsed.lastCheckedAt)) {
          shouldRefresh = true;
        }
      } else {
        shouldRefresh = true;
      }
    } catch {
      shouldRefresh = true;
    }
  }

  const [videosRes, playlistsRes, statsRes] = await Promise.all([
    getMusicMadrasVideos(shouldRefresh),
    getMusicMadrasPlaylists(shouldRefresh),
    getMusicMadrasChannelStats(shouldRefresh)
  ]);

  const now = Date.now();
  const cachedAt = videosRes.cachedAt || playlistsRes.cachedAt || statsRes.cachedAt || now;
  const nextCheckAt = cachedAt + DYNAMIC_UPDATE_INTERVAL_MS;

  try {
    localStorage.setItem(CACHE_KEY_SYNC_META, JSON.stringify({
      lastCheckedAt: cachedAt,
      nextCheckAt,
      channelId: CHANNEL_ID,
      subscriberCount: statsRes.stats.subscribers,
      videosCount: videosRes.videos.length,
      playlistsCount: playlistsRes.playlists.length
    }));
  } catch {
    // ignore
  }

  return {
    videos: videosRes.videos,
    playlists: playlistsRes.playlists,
    channelStats: statsRes.stats,
    isLive: Boolean(videosRes.isLive || playlistsRes.isLive || statsRes.isLive),
    cachedAt,
    nextCheckAt,
    refreshed: shouldRefresh,
    error: videosRes.error || playlistsRes.error || statsRes.error
  };
}
