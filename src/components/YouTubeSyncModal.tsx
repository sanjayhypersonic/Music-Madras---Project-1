import React, { useState, FormEvent } from 'react';
import { X, Youtube, Key, CheckCircle2, AlertTriangle, RefreshCw, Eye, EyeOff, ShieldCheck, Radio, ExternalLink } from 'lucide-react';
import { useYouTube } from '../context/YouTubeContext';
import { CHANNEL_ID } from '../lib/youtube';

export default function YouTubeSyncModal() {
  const {
    isSyncModalOpen,
    setIsSyncModalOpen,
    apiKey,
    saveApiKey,
    isLive,
    isLoading,
    isRefreshing,
    refreshFeed,
    videos,
    playlists,
    error,
    lastSynced
  } = useYouTube();

  const [inputKey, setInputKey] = useState(apiKey);
  const [showKey, setShowKey] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isSyncModalOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFeedback(null);
    try {
      const ok = await saveApiKey(inputKey);
      if (ok) {
        setFeedback({
          type: 'success',
          message: `Successfully connected to YouTube Data API! Loaded ${videos.length} dynamic videos directly from @MusicMadras.`
        });
      } else {
        setFeedback({
          type: 'error',
          message: error === 'QUOTA_EXCEEDED'
            ? 'YouTube API Quota exceeded for today. Showing cached YouTube data.'
            : 'Could not connect with this API key. Verify that the YouTube Data API v3 is enabled on your Google Cloud project.'
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const formattedSyncTime = lastSynced 
    ? new Date(lastSynced).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) 
    : 'Not synced yet';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="relative w-full max-w-lg bg-zinc-900 border border-zinc-700/80 rounded-2xl shadow-2xl overflow-hidden text-left"
        role="dialog"
        aria-modal="true"
        aria-labelledby="youtube-sync-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-zinc-800 bg-zinc-950/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#FF0000] text-white flex items-center justify-center shadow-md">
              <Youtube className="w-4 h-4 fill-current" />
            </div>
            <div>
              <h2 id="youtube-sync-title" className="font-serif text-base font-bold text-zinc-100 flex items-center gap-2">
                YouTube API Integration
                {isLive ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Live Sync Active
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                    Standby
                  </span>
                )}
              </h2>
              <p className="text-[11px] text-zinc-400">
                Channel: <span className="text-amber-400 font-mono">@MusicMadras</span> ({CHANNEL_ID})
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsSyncModalOpen(false)}
            aria-label="Close YouTube API modal"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
          {/* Live Status Indicators */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 bg-zinc-950/60 border border-zinc-800 rounded-xl text-center">
              <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider block">API Videos</span>
              <span className="text-lg font-mono font-bold text-amber-400">{videos.length}</span>
              <span className="text-[9px] text-zinc-500 block">From Uploads</span>
            </div>
            <div className="p-3 bg-zinc-950/60 border border-zinc-800 rounded-xl text-center">
              <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider block">Playlists</span>
              <span className="text-lg font-mono font-bold text-amber-400">{playlists.length}</span>
              <span className="text-[9px] text-zinc-500 block">From Channel</span>
            </div>
            <div className="p-3 bg-zinc-950/60 border border-zinc-800 rounded-xl text-center">
              <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider block">Thumbnails</span>
              <span className="text-xs font-mono font-bold text-emerald-400 flex items-center justify-center gap-1 mt-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                i.ytimg.com
              </span>
              <span className="text-[9px] text-zinc-500 block">YouTube CDN</span>
            </div>
          </div>

          {/* Feedback Banner */}
          {feedback && (
            <div
              className={`p-3 rounded-xl border flex items-start gap-2 text-xs ${
                feedback.type === 'success'
                  ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                  : 'bg-red-950/40 border-red-500/40 text-red-300'
              }`}
            >
              {feedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-400 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 flex-shrink-0 text-red-400 mt-0.5" />
              )}
              <span>{feedback.message}</span>
            </div>
          )}

          {/* Key Configuration Form */}
          <form onSubmit={handleSave} className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="yt-api-key-input" className="text-xs font-bold text-zinc-200 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-amber-400" />
                  YouTube Data API v3 Key
                </span>
                <span className="text-[10px] font-normal text-zinc-400">
                  Last synced: <span className="font-mono text-zinc-300">{formattedSyncTime}</span>
                </span>
              </label>
              
              <div className="relative">
                <input
                  id="yt-api-key-input"
                  type={showKey ? 'text' : 'password'}
                  value={inputKey}
                  onChange={(e) => setInputKey(e.target.value)}
                  placeholder="Paste your AIzaSy... YouTube Data API key here"
                  className="w-full px-3.5 py-2.5 pr-20 bg-zinc-950 border border-zinc-700 rounded-xl text-xs font-mono text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200 text-xs px-1.5 py-1 rounded"
                  title={showKey ? 'Hide key' : 'Show key'}
                >
                  {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <p className="text-[10px] text-zinc-400 leading-relaxed">
                Key is securely stored in your browser session for this applet. All video titles, descriptions, and thumbnail URLs update dynamically via YouTube Data API v3.
              </p>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={isSubmitting || isRefreshing}
                className="flex-1 py-2.5 px-4 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-zinc-950 font-bold text-xs rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Validating & Syncing...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Save Key & Sync Live
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={refreshFeed}
                disabled={isRefreshing || isLoading}
                title="Refresh latest uploads from YouTube"
                className="py-2.5 px-3.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold text-xs rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </form>

          {/* Cloud & Vercel deployment instructions */}
          <div className="p-3.5 bg-zinc-950/70 border border-zinc-800/80 rounded-xl space-y-2 text-[11px] text-zinc-400">
            <h4 className="font-bold text-zinc-200 flex items-center gap-1.5 text-xs">
              <Radio className="w-3.5 h-3.5 text-red-500" />
              Deploying on Vercel
            </h4>
            <p className="leading-relaxed">
              To have your production site update automatically for every visitor without entering a key in the browser:
            </p>
            <ol className="list-decimal list-inside space-y-1 text-zinc-300 font-mono text-[10px] pl-1">
              <li>Open your project in the Vercel Dashboard</li>
              <li>Go to <strong className="text-zinc-100">Settings</strong> → <strong className="text-zinc-100">Environment Variables</strong></li>
              <li>Set <strong className="text-amber-400">VITE_YOUTUBE_API_KEY</strong> = your Google API key</li>
              <li>Redeploy. All thumbnails & videos will fetch automatically!</li>
            </ol>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-950/80 flex items-center justify-between">
          <a
            href="https://console.cloud.google.com/apis/credentials"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-amber-500 hover:underline flex items-center gap-1 font-semibold"
          >
            Google Cloud Console Credentials
            <ExternalLink className="w-3 h-3" />
          </a>
          <button
            onClick={() => setIsSyncModalOpen(false)}
            className="px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
