import { useState, useEffect, useRef, MouseEvent, useMemo } from 'react';
import { Search, Heart, Sparkles, Sliders, Youtube, Volume2, Maximize2, X, AlertCircle, Link, Check, ExternalLink, RefreshCw, Radio, Flame, Shuffle } from 'lucide-react';
import { Video } from '../types';
import { CHANNEL_INFO } from '../data';
import SafeImage from './SafeImage';
import { useYouTube } from '../context/YouTubeContext';
import { parseViewsCount } from '../lib/youtube';

const categoryDisplayNames: Record<string, string> = {
  all: 'All Highlights',
  Concert: 'Concerts',
  Organ: 'Pipe Organ',
  Choral: 'Choirs and Ensembles',
  Vocal: 'Solo Vocals',
  Instrumental: 'Orchestra & Classical Instruments',
};

interface VideoGalleryProps {
  selectedCategory: string;
  setSelectedCategory: (cat: string) => void;
  likedVideos: string[];
  toggleLikeVideo: (id: string) => void;
  activeVideoId: string | null;
  setActiveVideoId: (id: string | null) => void;
}

export default function VideoGallery({ 
  selectedCategory, 
  setSelectedCategory, 
  likedVideos, 
  toggleLikeVideo,
  activeVideoId,
  setActiveVideoId
}: VideoGalleryProps) {
  const { videos: contextVideos } = useYouTube();
  const [searchQuery, setSearchQuery] = useState('');
  const [videos, setVideos] = useState<Video[]>(contextVideos);
  const [copiedVideoId, setCopiedVideoId] = useState<string | null>(null);
  const [shuffleSeed, setShuffleSeed] = useState(0);
  const [showAllArchived, setShowAllArchived] = useState(false);
  const playerRef = useRef<HTMLDivElement>(null);

  // Automatically re-shuffle the 9 rotating showcase items periodically (every 45s)
  useEffect(() => {
    const interval = setInterval(() => {
      setShuffleSeed(prev => prev + 1);
    }, 45000);
    return () => clearInterval(interval);
  }, []);

  const activeVideo = videos.find(v => v.id === activeVideoId) || null;

  useEffect(() => {
    if (activeVideo && playerRef.current) {
      playerRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeVideo]);

  // Sync state for actual likes count in session memory
  useEffect(() => {
    const updatedVideos = contextVideos.map(video => {
      const isLiked = likedVideos.includes(video.id);
      return {
        ...video,
        likesCount: isLiked ? video.likesCount + 1 : video.likesCount
      };
    });
    setVideos(updatedVideos);
  }, [likedVideos, contextVideos]);

  const handleCopyLink = (video: Video, e: MouseEvent) => {
    e.stopPropagation();
    const videoUrl = `https://www.youtube.com/watch?v=${video.youtubeId}`;
    navigator.clipboard.writeText(videoUrl);
    setCopiedVideoId(video.id);
    setTimeout(() => {
      setCopiedVideoId(null);
    }, 2000);
  };

  // Handle active video auto-selection if none is active
  const handlePlayVideo = (video: Video) => {
    setActiveVideoId(video.id);
  };

  // 1. Filter videos based on category tab and search query
  const categoryMatchedVideos = useMemo(() => {
    return videos.filter(video => {
      const matchesCategory = selectedCategory === 'all' || selectedCategory === 'liked' 
        ? (selectedCategory === 'liked' ? likedVideos.includes(video.id) : true)
        : video.category === selectedCategory;
      const matchesSearch = searchQuery.trim() === '' || 
        video.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
        video.artist.toLowerCase().includes(searchQuery.toLowerCase()) ||
        video.description.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [videos, selectedCategory, likedVideos, searchQuery]);

  // 2. Curated Showcase logic: First 3 are top most viewed; remaining 9 are randomly selected & shuffled
  const { displayVideos, top3Ids } = useMemo(() => {
    // If active search query or user requested all, show full list
    if (searchQuery.trim().length > 0 || showAllArchived || categoryMatchedVideos.length <= 12) {
      const sorted = [...categoryMatchedVideos].sort((a, b) => parseViewsCount(b) - parseViewsCount(a));
      return {
        displayVideos: categoryMatchedVideos,
        top3Ids: new Set(sorted.slice(0, 3).map(v => v.id))
      };
    }

    // Sort by highest views descending
    const sortedByViews = [...categoryMatchedVideos].sort((a, b) => parseViewsCount(b) - parseViewsCount(a));

    // First 3: videos with the most views
    const top3 = sortedByViews.slice(0, 3);
    const top3Set = new Set(top3.map(v => v.id));

    // The rest of the candidate videos
    const remainingPool = sortedByViews.slice(3);

    // Randomly select and shuffle 9 from remaining pool using shuffleSeed
    const shuffled = [...remainingPool].sort(() => Math.random() - 0.5);
    const selected9 = shuffled.slice(0, 9);

    return {
      displayVideos: [...top3, ...selected9],
      top3Ids: top3Set
    };
  }, [categoryMatchedVideos, searchQuery, showAllArchived, shuffleSeed]);

  return (
    <section className="py-12 px-4 md:px-8 max-w-7xl mx-auto space-y-8" id="showcases">
      
      {/* Title block */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-zinc-800/80 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="font-serif text-2xl md:text-3xl font-bold text-zinc-100 flex items-center gap-2">
              <span className="text-amber-500">@MusicMadras</span> Archive Highlights
            </h2>
          </div>
          <p className="text-xs md:text-sm text-zinc-400 mt-1">
            Genuine live concert captures from the official YouTube channel. Filtered and optimized for pristine sound projection.
          </p>
        </div>

        {/* Search bar */}
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            placeholder="Search artists, organ, choral, or instruments..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search recordings by artist, instrument, or description"
            className="w-full pl-9 pr-4 py-2 bg-zinc-900/60 border border-zinc-800 rounded-full text-xs font-medium text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
          />
        </div>
      </div>

      {/* Category Tabs & Sub-Filters */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-1.5 bg-zinc-900/60 p-1 rounded-2xl border border-zinc-800" role="tablist" aria-label="Recording categories">
          {['all', 'Concert', 'Organ', 'Choral', 'Vocal', 'Instrumental'].map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              role="tab"
              aria-selected={selectedCategory === cat}
              aria-label={`Filter showcases by ${categoryDisplayNames[cat] || cat}`}
              className={`text-xs font-bold px-3.5 py-1.5 rounded-xl transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                selectedCategory === cat
                  ? 'bg-amber-500 text-zinc-950 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-100'
              }`}
            >
              {categoryDisplayNames[cat] || cat}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {!showAllArchived && categoryMatchedVideos.length > 12 && !searchQuery.trim() && (
            <span className="text-[11px] text-amber-400 font-semibold flex items-center gap-1 bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 rounded-full">
              <Flame className="w-3 h-3 fill-current" />
              Top 3 Most Viewed + 9 Rotated
            </span>
          )}
          <span className="text-[11px] text-zinc-500 font-semibold tracking-wide uppercase">
            {displayVideos.length} recordings shown
          </span>
        </div>
      </div>

      {/* Theatre View (Active Player Mode) */}
      {activeVideo && (
        <div ref={playerRef} className="bg-zinc-900 text-zinc-100 rounded-3xl overflow-hidden shadow-2xl border border-zinc-800 p-4 md:p-6 space-y-4 md:space-y-6">
          <div className="flex justify-between items-center border-b border-zinc-800/60 pb-3">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 bg-amber-500 text-zinc-950 text-[10px] font-extrabold uppercase rounded-md tracking-wider">
                Now Playing
              </span>
              <p className="text-xs font-mono text-amber-400 tracking-wide hidden sm:inline">
                Captured with flagship single/multi-cam 4K capture & low-noise preamp settings
              </p>
            </div>
            <button
              onClick={() => setActiveVideoId(null)}
              aria-label="Close active video player"
              className="text-zinc-400 hover:text-zinc-100 p-1 rounded-full bg-zinc-800 hover:bg-zinc-750 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
              title="Close Player"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* The Video Iframe Embed */}
            <div className="lg:col-span-8 bg-black aspect-video rounded-2xl overflow-hidden relative shadow-inner border border-zinc-800/50">
              <iframe
                src={`https://www.youtube.com/embed/${activeVideo.youtubeId}?autoplay=1&rel=0`}
                title={activeVideo.title}
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              ></iframe>
            </div>

            {/* Audio/Video Recording Specifications Details */}
            <div className="lg:col-span-4 flex flex-col justify-between space-y-4">
              <div className="space-y-3">
                <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-bold rounded-full">
                  {activeVideo.category} Recital
                </span>
                
                <h3 className="font-serif text-lg md:text-xl font-bold leading-snug text-zinc-50">
                  {activeVideo.title}
                </h3>
                
                <p className="text-xs text-amber-400 font-semibold italic">
                  by {activeVideo.artist}
                </p>

                <p className="text-[11px] sm:text-xs text-zinc-300 leading-relaxed pt-1">
                  {activeVideo.description}
                </p>

                {/* Direct subscribe prompt */}
                <div className="bg-zinc-950 border border-zinc-800 p-3 rounded-xl space-y-2 mt-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-400">
                    <Sliders className="w-3.5 h-3.5 text-emerald-400" />
                    Studio Session Notes
                  </div>
                  <p className="text-[10px] text-zinc-400 leading-normal">
                    This live session was captured in its authentic acoustic space with <strong>high-fidelity microphones</strong> and pre-amplified via solid-state low-distortion DACs to preserve raw harmony.
                  </p>
                </div>
              </div>

              <div className="pt-4 border-t border-zinc-800/60 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => toggleLikeVideo(activeVideo.id)}
                    aria-label={likedVideos.includes(activeVideo.id) ? "Remove this video from your favorites" : "Save this video to your favorites"}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                      likedVideos.includes(activeVideo.id)
                        ? 'bg-amber-500 text-zinc-950'
                        : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-750 border border-zinc-700'
                    }`}
                  >
                    <Heart className={`w-3.5 h-3.5 ${likedVideos.includes(activeVideo.id) ? 'fill-current' : ''}`} />
                    {likedVideos.includes(activeVideo.id) ? 'Saved to Favorites' : 'Add to Favorites'}
                  </button>

                  <button
                    onClick={(e) => handleCopyLink(activeVideo, e)}
                    aria-label="Copy YouTube video link to clipboard"
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                      copiedVideoId === activeVideo.id
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-750 border border-zinc-700'
                    }`}
                  >
                    {copiedVideoId === activeVideo.id ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Copied Link!</span>
                      </>
                    ) : (
                      <>
                        <Link className="w-3.5 h-3.5" />
                        <span>Copy Link</span>
                      </>
                    )}
                  </button>
                </div>

                <a
                  href={`https://www.youtube.com/watch?v=${activeVideo.youtubeId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Watch this original recital on YouTube in a new browser tab"
                  className="flex items-center gap-1.5 text-xs text-[#FF0000] hover:text-white transition-all bg-[#FF0000]/10 hover:bg-[#FF0000] px-3.5 py-2 rounded-xl font-bold cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Watch on YouTube
                </a>
              </div>

            </div>

          </div>
        </div>
      )}

      {/* Showcase Curation Banner & Shuffle Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs bg-zinc-900/40 p-3.5 rounded-2xl border border-zinc-800/80">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="flex items-center gap-1.5 font-bold text-zinc-100">
            <Flame className="w-4 h-4 text-amber-500 fill-current" />
            Showcase Highlights:
          </span>
          <span className="text-zinc-400">
            Top 3 most viewed + 9 rotating recitals ({displayVideos.length} shown) • Dynamic API sync every 3 hours
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShuffleSeed(prev => prev + 1)}
            title="Randomly shuffle the 9 rotating recitals"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-amber-400 rounded-xl font-medium transition-all text-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            <Shuffle className="w-3.5 h-3.5 text-amber-400" />
            Shuffle 9 Picks
          </button>

          {categoryMatchedVideos.length > 12 && (
            <button
              onClick={() => setShowAllArchived(!showAllArchived)}
              className="inline-flex items-center gap-1 px-3 py-1.5 border border-zinc-700 hover:border-zinc-600 text-zinc-300 rounded-xl font-medium transition-all text-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
            >
              {showAllArchived ? 'Show 12 Curated' : `View All (${categoryMatchedVideos.length})`}
            </button>
          )}
        </div>
      </div>

      {/* Video Grid */}
      {displayVideos.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {displayVideos.map((video) => {
            const isTopViewed = top3Ids.has(video.id) && !searchQuery.trim();

            return (
              <div
                key={video.id}
                className="group bg-zinc-900/40 border border-zinc-800/80 hover:border-zinc-700/80 rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col justify-between"
              >
                {/* Custom Thumbnail Layout with Overlay Play Trigger */}
                <div 
                  role="button"
                  tabIndex={0}
                  aria-label={`Play recital video: ${video.title} by ${video.artist}`}
                  className="relative aspect-video bg-zinc-950 overflow-hidden cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                  onClick={() => handlePlayVideo(video)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handlePlayVideo(video);
                    }
                  }}
                >
                  {/* Real visual background using YouTube thumbnail */}
                  <SafeImage
                    src={video.thumbnailUrl}
                    alt={video.title}
                    fallbackType="video"
                    title={video.title}
                    className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  {/* Dark overlay gradient for legibility */}
                  <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/90 via-transparent to-black/45 flex flex-col justify-between p-3">
                    {/* Top row */}
                    <div className="flex justify-between items-center gap-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {isTopViewed && (
                          <span className="bg-amber-500 text-zinc-950 font-extrabold text-[9px] px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
                            <Flame className="w-3 h-3 fill-current" />
                            Most Viewed
                          </span>
                        )}
                        <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[9px] font-bold px-2 py-0.5 rounded-full tracking-wider uppercase">
                          {categoryDisplayNames[video.category] || video.category}
                        </span>
                      </div>
                      <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[9px] font-bold px-1.5 py-0.5 rounded-md flex-shrink-0">
                        4K HD
                      </span>
                    </div>

                    {/* Sound Waves animation overlay shown on hover */}
                    <div className="flex justify-center items-center opacity-40 group-hover:opacity-100 transition-opacity duration-300">
                      <div className="w-10 h-10 rounded-full bg-zinc-900/80 backdrop-blur-xs flex items-center justify-center text-white border border-zinc-700 transform group-hover:scale-110 transition-transform">
                        <Volume2 className="w-4 h-4 animate-pulse text-amber-400" />
                      </div>
                    </div>

                    {/* Duration badge */}
                    <div className="flex justify-between items-end">
                      <span className="text-[10px] text-zinc-300 font-mono bg-zinc-950/80 px-1.5 py-0.5 rounded border border-zinc-800/50">
                        {video.duration}
                      </span>
                      <span className="text-[10px] text-amber-400 font-bold drop-shadow-xs flex items-center gap-0.5">
                        <Sparkles className="w-3 h-3 text-[#EAAA08]" /> Live Sound
                      </span>
                    </div>
                  </div>
                </div>

                {/* Details */}
                <div className="p-4 space-y-2 flex-grow flex flex-col justify-between">
                  <div className="space-y-1">
                    <h3
                      className="font-serif text-sm font-bold text-zinc-100 group-hover:text-amber-400 transition-colors leading-snug cursor-pointer line-clamp-2"
                      onClick={() => handlePlayVideo(video)}
                    >
                      {video.title}
                    </h3>
                    <p className="text-xs text-zinc-400 font-medium">
                      {video.artist}
                    </p>
                  </div>

                  <p className="text-[11px] text-zinc-500 line-clamp-2 pt-1 leading-normal">
                    {video.description}
                  </p>

                  <div className="pt-3 border-t border-zinc-800/60 flex items-center justify-between text-[11px] text-zinc-400 font-medium">
                    <span className="flex items-center gap-1.5 flex-wrap">
                      <span>{video.views} views</span>
                      {video.likesCount > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-zinc-400">
                          • <Heart className="w-2.5 h-2.5 text-red-500 fill-current inline" />
                          {video.likesCount}
                        </span>
                      )}
                      <span>• {video.publishedAt}</span>
                    </span>
                    <button
                      onClick={(e) => handleCopyLink(video, e)}
                      aria-label={`Copy YouTube link for ${video.title}`}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                        copiedVideoId === video.id
                          ? 'bg-emerald-500/15 text-emerald-400 font-bold'
                          : 'bg-zinc-800/60 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                      }`}
                      title="Copy YouTube Link"
                    >
                      {copiedVideoId === video.id ? (
                        <>
                          <Check className="w-3 h-3" />
                          <span>Copied!</span>
                        </>
                      ) : (
                        <>
                          <Link className="w-3 h-3" />
                          <span>Copy Link</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-12 bg-zinc-900/40 rounded-3xl border border-zinc-800 max-w-lg mx-auto space-y-3">
          <AlertCircle className="w-8 h-8 text-zinc-500 mx-auto" />
          <h3 className="font-serif text-sm font-bold text-zinc-100">No showcases match your filter</h3>
          <p className="text-xs text-zinc-400 px-6">
            Try adjusting your search query or instrument tabs. Rest assured, all displayed content remains exclusively within the @MusicMadras registry.
          </p>
          <button
            onClick={() => { setSelectedCategory('all'); setSearchQuery(''); }}
            className="text-xs font-bold text-amber-400 hover:underline"
          >
            Clear all filters
          </button>
        </div>
      )}

    </section>
  );
}
