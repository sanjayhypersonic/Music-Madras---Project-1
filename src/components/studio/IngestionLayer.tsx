import React, { useState, useMemo } from 'react';
import { 
  Youtube, 
  UploadCloud, 
  Server, 
  Plus, 
  RefreshCw, 
  CheckCircle, 
  Flame, 
  Clock, 
  AlertTriangle,
  Play,
  Search,
  SlidersHorizontal,
  ChevronRight,
  Sparkles,
  Bookmark
} from 'lucide-react';
import { RecordingDraft } from './types';
import { useYouTube } from '../../context/YouTubeContext';

interface IngestionLayerProps {
  recordings: RecordingDraft[];
  onIngestNew: (item: {
    youtubeId: string;
    title: string;
    artist: string;
    duration: string;
    description: string;
  }) => void;
  onSelectRecording: (id: string) => void;
}

export default function IngestionLayer({ 
  recordings, 
  onIngestNew, 
  onSelectRecording 
}: IngestionLayerProps) {
  const { videos: channelVideos, refreshFeed, isRefreshing: isGlobalRefreshing } = useYouTube();
  const [isSyncing, setIsSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'title' | 'duration'>('date');
  const [ingestedIds, setIngestedIds] = useState<string[]>([]);

  // Dynamically map live YouTube channel uploads into the ingestion queue
  // Filters out videos that are already part of recordings in the Studio
  const pendingUploads = useMemo(() => {
    const existingIds = new Set([
      ...recordings.map(r => r.youtubeId),
      ...ingestedIds
    ]);

    return channelVideos
      .filter(v => !existingIds.has(v.youtubeId))
      .map((video, index) => ({
        youtubeId: video.youtubeId,
        title: video.title,
        artist: video.artist,
        duration: video.duration,
        publishedAt: video.publishedAtRaw || video.publishedAt,
        publishedLabel: video.publishedAt,
        requiredActions: index % 2 === 0 
          ? ["Link Composer", "Map Venue Nodes", "Generate SEO Metadata"]
          : ["Add Choral Entities", "Segment Movements", "Anchor Audio Master"],
        description: video.description || 'Live acoustic performance captured in Chennai venue with high-fidelity matched stereo microphones.'
      }));
  }, [channelVideos, recordings, ingestedIds]);

  const handleSyncFeed = async () => {
    setIsSyncing(true);
    try {
      await refreshFeed();
    } catch (err) {
      console.warn('Sync failed', err);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleCreateDraft = (item: typeof pendingUploads[0]) => {
    setIngestedIds(prev => [...prev, item.youtubeId]);
    onIngestNew({
      youtubeId: item.youtubeId,
      title: item.title,
      artist: item.artist,
      duration: item.duration,
      description: item.description
    });
  };

  // Filter & Sort Logic
  const filteredUploads = pendingUploads.filter(item => {
    const text = (item.title + ' ' + item.artist + ' ' + item.description).toLowerCase();
    return text.includes(searchQuery.toLowerCase());
  });

  const sortedUploads = [...filteredUploads].sort((a, b) => {
    if (sortBy === 'title') {
      return a.title.localeCompare(b.title);
    }
    if (sortBy === 'duration') {
      return b.duration.localeCompare(a.duration); // longer first
    }
    // Default 'date'
    return b.publishedAt.localeCompare(a.publishedAt); // newer first
  });

  return (
    <div className="space-y-6 text-left animate-fade-in text-xs text-zinc-300">
      
      {/* Ingestion Header */}
      <div className="border-b border-zinc-850 pb-5">
        <h2 className="font-serif text-xl md:text-2xl font-extrabold text-zinc-100">
          Archival Ingestion Queue
        </h2>
        <p className="text-[11px] text-zinc-400 mt-1">
          Decoupled ingest ports scanning official feeds. Map raw concert recordings into the canonical Knowledge Engine.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        {/* Left Column: Source Connectors */}
        <div className="space-y-2 lg:col-span-1">
          <span className="text-[10px] text-zinc-500 font-mono font-bold uppercase tracking-wider block mb-2">
            Archival Sources
          </span>
          {[
            { id: 'youtube', label: 'YouTube API Connector', icon: Youtube, active: true },
            { id: 'vimeo', label: 'Vimeo Integration', icon: Play, active: false, badge: 'Planned' },
            { id: 'local', label: 'Local WAV/MP4 Uploads', icon: UploadCloud, active: false, badge: 'Planned' },
            { id: 'partners', label: 'Partner Digital Archives', icon: Server, active: false, badge: 'Planned' },
          ].map(conn => {
            const Icon = conn.icon;
            const active = conn.id === 'youtube';
            return (
              <button
                key={conn.id}
                disabled={!conn.active}
                className={`w-full flex items-center justify-between p-3.5 rounded-xl text-xs font-bold text-left transition-all ${
                  active 
                    ? 'bg-amber-500 text-zinc-950 shadow-md' 
                    : 'bg-zinc-900/40 hover:bg-zinc-900 text-zinc-400 border border-zinc-850'
                } ${!conn.active ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className="w-4 h-4" />
                  <span>{conn.label}</span>
                </div>
                {conn.badge && (
                  <span className="text-[8px] bg-zinc-800 text-zinc-500 px-2 py-0.5 rounded uppercase font-bold tracking-wider">
                    {conn.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Right Column: Active Connector Workspace */}
        <div className="lg:col-span-3 space-y-6">
          
          {/* Active Connector Control Bar */}
          <div className="bg-zinc-900/10 border border-zinc-850 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-red-500/10 rounded-xl">
                  <Youtube className="w-5 h-5 text-red-500" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-zinc-200">Official Channel Feed: @MusicMadras</h3>
                  <p className="text-[10px] text-zinc-500">Checking for new captures automatically every 12 hours.</p>
                </div>
              </div>
              
              <button
                onClick={handleSyncFeed}
                disabled={isSyncing}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-zinc-850 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 text-[10px] font-bold rounded-lg transition-colors cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                {isSyncing ? 'Synchronizing...' : 'Force Sync API'}
              </button>
            </div>

            {/* Filter and Sorting Controls */}
            <div className="flex flex-col sm:flex-row gap-3 pt-3 border-t border-zinc-850">
              <div className="relative flex-grow">
                <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-3" />
                <input
                  type="text"
                  placeholder="Filter pending captures by Title, artist, or keywords..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-zinc-950/40 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500 pl-9"
                />
              </div>

              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-3.5 h-3.5 text-zinc-500" />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="bg-zinc-950/40 border border-zinc-800 p-2.5 rounded-lg text-zinc-300 focus:outline-none focus:border-amber-500 text-[11px]"
                >
                  <option value="date">Sort by Date (Newest)</option>
                  <option value="title">Sort by Title (A-Z)</option>
                  <option value="duration">Sort by Duration (Longest)</option>
                </select>
              </div>
            </div>

            {/* Ingestion Queue Listings */}
            <div className="space-y-4 pt-2">
              <h4 className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                <Flame className="w-4 h-4 text-amber-500" />
                Newly Detected Unprocessed Captures ({sortedUploads.length})
              </h4>

              {sortedUploads.length === 0 ? (
                <div className="text-center py-10 bg-zinc-950/20 rounded-xl border border-dashed border-zinc-800 text-xs text-zinc-500 space-y-2">
                  <CheckCircle className="w-8 h-8 text-emerald-500 mx-auto" />
                  <p className="font-bold text-zinc-300">All captured videos successfully imported!</p>
                  <p className="text-[10px] text-zinc-500">New uploads will populate here automatically.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {sortedUploads.map(item => (
                    <div 
                      key={item.youtubeId}
                      className="bg-zinc-950/40 border border-zinc-900 hover:border-zinc-800 p-4 rounded-xl flex flex-col md:flex-row gap-4 text-xs transition-colors"
                    >
                      {/* Thumbnail with High-fidelity Youtube layout */}
                      <div className="w-full md:w-44 aspect-video rounded-lg overflow-hidden bg-zinc-900 border border-zinc-850 relative flex-shrink-0 group">
                        <img 
                          src={`https://i.ytimg.com/vi/${item.youtubeId}/hqdefault.jpg`} 
                          alt={item.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        <span className="absolute bottom-1.5 right-1.5 bg-black/80 px-1.5 py-0.5 rounded font-mono text-[9px] text-zinc-100 font-bold">
                          {item.duration}
                        </span>
                      </div>

                      {/* Info & Details */}
                      <div className="flex-grow space-y-2 flex flex-col justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[8px] font-mono font-bold text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded uppercase tracking-wider border border-amber-500/20">
                              PENDING IMPORT
                            </span>
                            <span className="text-[9px] text-zinc-500 font-mono">Published {item.publishedLabel} ({item.publishedAt})</span>
                          </div>
                          
                          <h5 className="font-bold text-zinc-200 text-xs md:text-sm leading-snug hover:text-amber-500 transition-colors">
                            {item.title}
                          </h5>
                          
                          <p className="text-[10px] text-zinc-400 line-clamp-2 leading-relaxed">
                            {item.description}
                          </p>
                        </div>

                        {/* Required Actions Checklist */}
                        <div className="flex flex-wrap items-center gap-3 pt-1">
                          <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider font-mono">
                            Required:
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {item.requiredActions.map((act, i) => (
                              <span key={i} className="text-[8px] font-mono bg-zinc-900 text-zinc-400 px-2 py-0.5 rounded border border-zinc-850">
                                ○ {act}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Begin Wizard Button */}
                      <div className="flex items-center justify-end md:justify-center flex-shrink-0 border-t md:border-t-0 md:border-l border-zinc-900 pt-3 md:pt-0 md:pl-4">
                        <button
                          onClick={() => handleCreateDraft(item)}
                          className="w-full md:w-auto flex items-center justify-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-zinc-950 font-black rounded-lg transition-all cursor-pointer shadow-md hover:scale-[1.02]"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Begin Wizard</span>
                        </button>
                      </div>

                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Active Archival Registry Flow Status */}
          <div className="bg-zinc-900/10 border border-zinc-850 rounded-2xl p-5 space-y-4">
            <h3 className="font-serif text-sm font-bold text-zinc-200">Archival Registry Quick View</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {recordings.slice(0, 4).map(rec => (
                <div
                  key={rec.id}
                  onClick={() => onSelectRecording(rec.id)}
                  className="p-3.5 bg-zinc-950/40 hover:bg-zinc-900/60 border border-zinc-900 hover:border-amber-500/20 rounded-xl cursor-pointer transition-all text-xs text-left flex justify-between items-center"
                >
                  <div className="space-y-1 truncate max-w-[200px]">
                    <h4 className="font-bold text-zinc-200 truncate">{rec.title}</h4>
                    <span className="text-[10px] text-zinc-500 font-mono">{rec.duration} • {rec.artist}</span>
                  </div>
                  <span className={`px-2.5 py-0.5 rounded text-[8px] font-extrabold uppercase tracking-wide border ${
                    rec.status === 'Detected' ? 'bg-zinc-800 text-zinc-400 border-zinc-700' :
                    rec.status === 'Draft' ? 'bg-blue-900/40 text-blue-300 border-blue-800/20' :
                    rec.status === 'Published' ? 'bg-emerald-900/40 text-emerald-300 border-emerald-800/20' :
                    'bg-amber-900/40 text-amber-300 border-amber-800/20'
                  }`}>
                    {rec.status}
                  </span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
