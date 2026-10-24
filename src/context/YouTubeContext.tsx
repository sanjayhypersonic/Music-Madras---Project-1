import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Video, Playlist } from '../types';
import { CHANNEL_INFO, VIDEOS_DATA, PLAYLISTS_DATA } from '../data';
import {
  getMusicMadrasVideos,
  getMusicMadrasPlaylists,
  getMusicMadrasChannelStats,
  getYouTubeApiKey,
  setYouTubeApiKey,
  ChannelStats
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
  apiKey: string;
  saveApiKey: (newKey: string) => Promise<boolean>;
  refreshFeed: () => Promise<void>;
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
    videoCount: CHANNEL_INFO.videoCount,
    totalViews: CHANNEL_INFO.totalViews
  });
  const [isLive, setIsLive] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);

  const loadData = useCallback(async (forceRefresh = false) => {
    try {
      const [videosRes, playlistsRes, statsRes] = await Promise.all([
        getMusicMadrasVideos(forceRefresh),
        getMusicMadrasPlaylists(forceRefresh),
        getMusicMadrasChannelStats()
      ]);

      if (videosRes.videos && videosRes.videos.length > 0) {
        setVideos(videosRes.videos);
      }
      if (playlistsRes.playlists && playlistsRes.playlists.length > 0) {
        setPlaylists(playlistsRes.playlists);
      }
      if (statsRes.stats) {
        setChannelStats(statsRes.stats);
      }

      const live = Boolean(videosRes.isLive || playlistsRes.isLive || statsRes.isLive);
      setIsLive(live);
      setError(videosRes.error || playlistsRes.error || null);
      if (videosRes.cachedAt) {
        setLastSynced(videosRes.cachedAt);
      } else if (live) {
        setLastSynced(Date.now());
      }
    } catch (err: any) {
      console.warn('YouTube feed loader failed:', err);
      setError(err?.message || 'Failed to sync with YouTube API');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData(false);
  }, [loadData]);

  const refreshFeed = async () => {
    setIsRefreshing(true);
    await loadData(true);
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
        // Also refresh playlists & stats
        const [plRes, stRes] = await Promise.all([
          getMusicMadrasPlaylists(true),
          getMusicMadrasChannelStats()
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
        apiKey,
        saveApiKey,
        refreshFeed,
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
