import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Video, Playlist, ChannelStats } from '../types';
import { CHANNEL_INFO, VIDEOS_DATA, PLAYLISTS_DATA } from '../data';
import {
  getMusicMadrasVideos,
  getMusicMadrasPlaylists,
  getMusicMadrasChannelStats,
  checkAndUpdateDynamicData,
  getYouTubeApiKey,
  setYouTubeApiKey,
  isDynamicDataStale,
  getTimeUntilNextCheck,
  formatTimeUntilNextCheck,
  DYNAMIC_UPDATE_INTERVAL_MS
} from '../lib/youtube';

interface YouTubeContextType {
  videos: Video[];
  playlists: Playlist[];
  channelStats: ChannelStats;
  isLive: boolean;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  lastSynced: number | null;
  nextCheckInMs: number;
  nextCheckTimeFormatted: string;
  isStale: boolean;
  apiKey: string;
  saveApiKey: (newKey: string) => Promise<boolean>;
  refreshFeed: () => Promise<void>;
  checkDynamicUpdate: (force?: boolean) => Promise<void>;
  isSyncModalOpen: boolean;
  setIsSyncModalOpen: (open: boolean) => void;
}

const YouTubeContext = createContext<YouTubeContextType | undefined>(undefined);

export function YouTubeProvider({ children }: { children: React.ReactNode }) {
  const [apiKey, setApiKey] = useState<string>(() => getYouTubeApiKey());
  const [videos, setVideos] = useState<Video[]>(VIDEOS_DATA);
  const [playlists, setPlaylists] = useState<Playlist[]>(PLAYLISTS_DATA);
  const [channelStats, setChannelStats] = useState<ChannelStats>({
    subscribers: CHANNEL_INFO.subscribers,
    subscriberCountRaw: parseInt(CHANNEL_INFO.subscribers, 10),
    videoCount: CHANNEL_INFO.videoCount,
    totalViews: CHANNEL_INFO.totalViews,
    totalViewsRaw: 227000,
    channelTitle: CHANNEL_INFO.name,
    channelDescription: CHANNEL_INFO.description,
    handle: CHANNEL_INFO.handle,
    avatarUrl: 'https://yt3.googleusercontent.com/d0KOXSy8sQFmrwCGqkTjm90JYMpqdtrFpjtQCh7145eUjEf0XDnCxPXvfg6_RvKnaIY091x5_TA=s800-c-k-c0x00ffffff-no-rj'
  });
  const [isLive, setIsLive] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<number | null>(() => {
    try {
      const meta = localStorage.getItem('musicmadras_dynamic_sync_meta_v6');
      if (meta) {
        const parsed = JSON.parse(meta);
        if (parsed.lastCheckedAt) return parsed.lastCheckedAt;
      }
    } catch {
      // ignore
    }
    return null;
  });
  const [nextCheckInMs, setNextCheckInMs] = useState<number>(() => getTimeUntilNextCheck(lastSynced));
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);

  const isUpdatingRef = useRef(false);

  // Master Dynamic Data checker and updater (every 3 hours)
  const checkDynamicUpdate = useCallback(async (forceRefresh = false) => {
    if (isUpdatingRef.current) return;
    isUpdatingRef.current = true;
    setIsRefreshing(forceRefresh);

    try {
      const result = await checkAndUpdateDynamicData(forceRefresh);

      if (result.videos && result.videos.length > 0) {
        setVideos(result.videos);
      }
      if (result.playlists && result.playlists.length > 0) {
        setPlaylists(result.playlists);
      }
      if (result.channelStats) {
        setChannelStats(result.channelStats);
      }

      setIsLive(result.isLive);
      setError(result.error || null);
      setLastSynced(result.cachedAt);
      setNextCheckInMs(getTimeUntilNextCheck(result.cachedAt));
    } catch (err: any) {
      console.warn('3-hour dynamic update failed:', err);
      setError(err?.message || 'Failed to sync with YouTube API');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
      isUpdatingRef.current = false;
    }
  }, []);

  // Initial check on mount: If dynamic data is stale (> 3 hours), update immediately
  useEffect(() => {
    const shouldForce = isDynamicDataStale(lastSynced);
    checkDynamicUpdate(shouldForce);
  }, [checkDynamicUpdate]);

  // Periodic heartbeat every 30 seconds:
  // Updates countdown timer and triggers full API refresh when 3-hour cycle expires
  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = getTimeUntilNextCheck(lastSynced);
      setNextCheckInMs(remaining);

      // If 3 hours have passed since lastSynced, automatically re-check and update!
      if (isDynamicDataStale(lastSynced) && !isUpdatingRef.current) {
        console.log('3 hours elapsed: checking and updating YouTube dynamic data...');
        checkDynamicUpdate(true);
      }
    }, 30000); // Check every 30 seconds

    return () => clearInterval(interval);
  }, [lastSynced, checkDynamicUpdate]);

  // Page Visibility & Window Focus Handler:
  // When user returns to tab, if 3 hours elapsed, auto-check and update immediately
  useEffect(() => {
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible' && !isUpdatingRef.current) {
        if (isDynamicDataStale(lastSynced)) {
          console.log('Tab focused and data is older than 3 hours: triggering dynamic update...');
          checkDynamicUpdate(true);
        } else {
          setNextCheckInMs(getTimeUntilNextCheck(lastSynced));
        }
      }
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    return () => {
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [lastSynced, checkDynamicUpdate]);

  // Manual trigger for refresh
  const refreshFeed = async () => {
    await checkDynamicUpdate(true);
  };

  const saveApiKey = async (newKey: string): Promise<boolean> => {
    setYouTubeApiKey(newKey);
    setApiKey(newKey);
    setIsRefreshing(true);
    try {
      const res = await getMusicMadrasVideos(true);
      if (res.isLive) {
        setVideos(res.videos);
        setIsLive(true);
        setError(null);
        setLastSynced(Date.now());
        // Also refresh playlists & channel stats
        const [plRes, stRes] = await Promise.all([
          getMusicMadrasPlaylists(true),
          getMusicMadrasChannelStats(true)
        ]);
        if (plRes.playlists.length > 0) setPlaylists(plRes.playlists);
        if (stRes.stats) setChannelStats(stRes.stats);
        return true;
      } else {
        setError(res.error || 'Failed to authenticate YouTube API key');
        return false;
      }
    } catch (err: any) {
      setError(err?.message || 'Invalid API key or network error');
      return false;
    } finally {
      setIsRefreshing(false);
    }
  };

  const isStale = isDynamicDataStale(lastSynced);
  const nextCheckTimeFormatted = formatTimeUntilNextCheck(lastSynced);

  return (
    <YouTubeContext.Provider
      value={{
        videos,
        playlists,
        channelStats,
        isLive,
        isLoading,
        isRefreshing,
        error,
        lastSynced,
        nextCheckInMs,
        nextCheckTimeFormatted,
        isStale,
        apiKey,
        saveApiKey,
        refreshFeed,
        checkDynamicUpdate,
        isSyncModalOpen,
        setIsSyncModalOpen
      }}
    >
      {children}
    </YouTubeContext.Provider>
  );
}

export function useYouTube(): YouTubeContextType {
  const context = useContext(YouTubeContext);
  if (!context) {
    throw new Error('useYouTube must be used within a YouTubeProvider');
  }
  return context;
}
