import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Youtube, Shield, MapPin, Radio, Heart, Star, Sparkles, Sliders, Music, Award, Play } from 'lucide-react';
import Header from './components/Header';
import Hero from './components/Hero';
import VideoGallery from './components/VideoGallery';
import BookingForm from './components/BookingForm';
import TechSpecs from './components/TechSpecs';
import PlaylistsSection from './components/PlaylistsSection';
import SchemaMarkup from './components/SchemaMarkup';
import useSEO from './hooks/useSEO';
import { CHANNEL_INFO, VIDEOS_DATA } from './data';

export default function App() {
  const [activeTab, setActiveTab] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    if (tabParam) {
      return tabParam;
    }
    const hash = window.location.hash.replace('#', '');
    if (hash) {
      return hash;
    }
    return 'home';
  });
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [isBookingOpen, setIsBookingOpen] = useState(false);
  const [bookingFormMode, setBookingFormMode] = useState<'booking' | 'inquire'>('booking');
  const [likedVideos, setLikedVideos] = useState<string[]>([]);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('music_madras_theme');
    return (saved as 'dark' | 'light') || 'dark';
  });

  // Dynamic Canonical URLs, SEO Document Title, and Description Synchronization
  useSEO({ activeTab, activeVideoId });

  // Local storage synchronization for theme
  useEffect(() => {
    const body = window.document.body;
    if (theme === 'light') {
      body.classList.add('light');
    } else {
      body.classList.remove('light');
    }
    localStorage.setItem('music_madras_theme', theme);
  }, [theme]);

  // Global keyboard shortcut (Shift+T) to toggle theme
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (activeEl) {
        const tagName = activeEl.tagName.toLowerCase();
        if (tagName === 'input' || tagName === 'textarea' || activeEl.hasAttribute('contenteditable')) {
          return;
        }
      }

      if (e.shiftKey && (e.key === 'T' || e.key === 't')) {
        e.preventDefault();
        setTheme(prev => prev === 'dark' ? 'light' : 'dark');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Local storage synchronization for liked videos
  useEffect(() => {
    const saved = localStorage.getItem('music_madras_likes');
    if (saved) {
      try {
        setLikedVideos(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse saved video likes', e);
      }
    }
  }, []);

  const toggleLikeVideo = (id: string) => {
    let updated: string[];
    if (likedVideos.includes(id)) {
      updated = likedVideos.filter(item => item !== id);
    } else {
      updated = [...likedVideos, id];
    }
    setLikedVideos(updated);
    localStorage.setItem('music_madras_likes', JSON.stringify(updated));
  };

  const isShowcasesActive = 
    activeTab === 'all' || 
    activeTab === 'Organ' || 
    activeTab === 'Choral' || 
    activeTab === 'Vocal' || 
    activeTab === 'Instrumental' || 
    activeTab === 'Concert' || 
    activeTab === 'liked';

  return (
    <div className={`min-h-screen flex flex-col justify-between transition-colors duration-300 ${
      theme === 'light' 
        ? 'bg-[#fafafa] text-zinc-900 selection:bg-amber-500/10 selection:text-amber-600' 
        : 'bg-zinc-950 text-zinc-100 selection:bg-amber-500/20 selection:text-amber-400'
    }`}>
      
      {/* Structured Dynamic SEO Schema Data */}
      <SchemaMarkup activeTab={activeTab} activeVideoId={activeVideoId} />
      
      {/* Header element */}
      <Header
        activeTab={activeTab}
        setActiveTab={(tab) => {
          setActiveTab(tab);
        }}
        onOpenBooking={() => {
          setBookingFormMode('booking');
          setIsBookingOpen(true);
        }}
        theme={theme}
        setTheme={setTheme}
      />

      {/* Main Body */}
      <main className="flex-grow">
        
        {/* Brand Hero Banner - Rendered on Home tab */}
        {activeTab === 'home' && (
          <Hero
            onOpenBooking={() => {
              setBookingFormMode('booking');
              setIsBookingOpen(true);
            }}
            onBrowseVideos={() => {
              setActiveTab('Concert');
            }}
          />
        )}

        {/* Dynamic section tabs loader using motion.div */}
        <div className="relative">
          <AnimatePresence mode="wait">
            
            {/* View 0: Clean Homepage dashboard portals */}
            {activeTab === 'home' && (
              <motion.div
                key="home-view"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.35 }}
                className="py-12 px-4 md:px-8 max-w-7xl mx-auto space-y-12 text-left"
              >
                <div className="text-center space-y-3">
                  <h2 className="font-serif text-2xl md:text-3xl font-bold text-zinc-100">
                    Explore the Archive
                  </h2>
                  <p className="text-xs md:text-sm text-zinc-400 max-w-lg mx-auto leading-relaxed">
                    Quickly navigate to different segments of the @MusicMadras digital collection and recording eligibility.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                  {/* Card 1: MusicMadras Archive */}
                  <div 
                    onClick={() => setActiveTab('Concert')}
                    className="group bg-zinc-900/40 hover:bg-zinc-900/80 border border-zinc-800 hover:border-amber-500/50 rounded-2xl overflow-hidden shadow-md hover:shadow-2xl transition-all duration-300 cursor-pointer flex flex-col justify-between"
                  >
                    <div>
                      <div className="relative h-32 w-full overflow-hidden">
                        <img 
                          src="https://img.youtube.com/vi/zEQmnmwr5UE/maxresdefault.jpg"
                          alt="MusicMadras Archive"
                          className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-500 opacity-85"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/20 to-transparent" />
                        <div className="absolute top-3 left-3 w-8 h-8 rounded-lg bg-zinc-950/80 backdrop-blur-sm flex items-center justify-center text-amber-400 border border-zinc-800">
                          <Music className="w-4 h-4" />
                        </div>
                      </div>
                      <div className="p-5 space-y-2">
                        <h3 className="font-serif text-sm font-bold text-zinc-100 group-hover:text-amber-400 transition-colors">
                          MusicMadras Archive
                        </h3>
                        <p className="text-[11px] text-zinc-400 leading-relaxed">
                          Discover classical concert highlights, pipe organ recitals, vocals, and instruments captured across historical Chennai venues.
                        </p>
                      </div>
                    </div>
                    <div className="px-5 pb-5 pt-0">
                      <span className="text-[11px] font-bold text-amber-500 group-hover:underline flex items-center gap-1">
                        Browse Showcases →
                      </span>
                    </div>
                  </div>

                  {/* Card 2: Playlists */}
                  <div 
                    onClick={() => setActiveTab('playlists')}
                    className="group bg-zinc-900/40 hover:bg-zinc-900/80 border border-zinc-800 hover:border-amber-500/50 rounded-2xl overflow-hidden shadow-md hover:shadow-2xl transition-all duration-300 cursor-pointer flex flex-col justify-between"
                  >
                    <div>
                      <div className="relative h-32 w-full overflow-hidden">
                        <img 
                          src="https://images.unsplash.com/photo-1507838153414-b4b713384a76?auto=format&fit=crop&w=600&q=80"
                          alt="Curated Playlists"
                          className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-500 opacity-80"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/20 to-transparent" />
                        <div className="absolute top-3 left-3 w-8 h-8 rounded-lg bg-zinc-950/80 backdrop-blur-sm flex items-center justify-center text-amber-400 border border-zinc-800">
                          <Radio className="w-4 h-4" />
                        </div>
                      </div>
                      <div className="p-5 space-y-2">
                        <h3 className="font-serif text-sm font-bold text-zinc-100 group-hover:text-amber-400 transition-colors">
                          Curated Playlists
                        </h3>
                        <p className="text-[11px] text-zinc-400 leading-relaxed">
                          Access multi-track performance registries, sacred hymns, and full choral carols organized by musical theme.
                        </p>
                      </div>
                    </div>
                    <div className="px-5 pb-5 pt-0">
                      <span className="text-[11px] font-bold text-amber-500 group-hover:underline flex items-center gap-1">
                        View Playlists →
                      </span>
                    </div>
                  </div>

                  {/* Card 3: Studio Rig */}
                  <div 
                    onClick={() => setActiveTab('tech-specs')}
                    className="group bg-zinc-900/40 hover:bg-zinc-900/80 border border-zinc-800 hover:border-amber-500/50 rounded-2xl overflow-hidden shadow-md hover:shadow-2xl transition-all duration-300 cursor-pointer flex flex-col justify-between"
                  >
                    <div>
                      <div className="relative h-32 w-full overflow-hidden">
                        <img 
                          src="https://images.unsplash.com/photo-1603048588665-791ca8aea617?auto=format&fit=crop&w=600&q=80"
                          alt="Focusrite Studio Rig"
                          className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-500 opacity-80"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/20 to-transparent" />
                        <div className="absolute top-3 left-3 w-8 h-8 rounded-lg bg-zinc-950/80 backdrop-blur-sm flex items-center justify-center text-amber-400 border border-zinc-800">
                          <Sliders className="w-4 h-4" />
                        </div>
                      </div>
                      <div className="p-5 space-y-2">
                        <h3 className="font-serif text-sm font-bold text-zinc-100 group-hover:text-amber-400 transition-colors">
                          Studio Recording Rig
                        </h3>
                        <p className="text-[11px] text-zinc-400 leading-relaxed">
                          Explore the high-end matched condenser microphone pairs, Focusrite preamps, and silent 4K cameras we bring to your location.
                        </p>
                      </div>
                    </div>
                    <div className="px-5 pb-5 pt-0">
                      <span className="text-[11px] font-bold text-amber-500 group-hover:underline flex items-center gap-1">
                        Explore Gear Specs →
                      </span>
                    </div>
                  </div>

                  {/* Card 4: Artist Program */}
                  <div 
                    onClick={() => setActiveTab('artist-program')}
                    className="group bg-zinc-900/40 hover:bg-zinc-900/80 border border-zinc-800 hover:border-amber-500/50 rounded-2xl overflow-hidden shadow-md hover:shadow-2xl transition-all duration-300 cursor-pointer flex flex-col justify-between"
                  >
                    <div>
                      <div className="relative h-32 w-full overflow-hidden">
                        <img 
                          src="https://images.unsplash.com/photo-1511192336575-5a79af67a629?auto=format&fit=crop&w=600&q=80"
                          alt="Artist Program"
                          className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-500 opacity-80"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/20 to-transparent" />
                        <div className="absolute top-3 left-3 w-8 h-8 rounded-lg bg-zinc-950/80 backdrop-blur-sm flex items-center justify-center text-amber-400 border border-zinc-800">
                          <Award className="w-4 h-4" />
                        </div>
                      </div>
                      <div className="p-5 space-y-2">
                        <h3 className="font-serif text-sm font-bold text-zinc-100 group-hover:text-amber-400 transition-colors">
                          Artist Program
                        </h3>
                        <p className="text-[11px] text-zinc-400 leading-relaxed">
                          We record local Chennai musicians, chapel choirs, and organists entirely free. Learn about eligibility and requirements.
                        </p>
                      </div>
                    </div>
                    <div className="px-5 pb-5 pt-0">
                      <span className="text-[11px] font-bold text-amber-500 group-hover:underline flex items-center gap-1">
                        Learn Program Details →
                      </span>
                    </div>
                  </div>
                </div>

                {/* Featured Video Archives Grid */}
                <div className="space-y-6 pt-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <h3 className="font-serif text-lg font-bold text-zinc-100 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-red-600 animate-pulse" />
                        Featured Concert highlights
                      </h3>
                      <p className="text-[11px] text-zinc-400">
                        Top live classical recordings captured on location with absolute sound precision.
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setActiveTab('Concert');
                        if (VIDEOS_DATA.length > 0) {
                          setActiveVideoId(VIDEOS_DATA[0].id);
                        }
                      }}
                      aria-label="View all live concert highlights"
                      className="text-xs font-bold text-amber-500 hover:underline flex items-center gap-1 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded px-1"
                    >
                      View All Highlights →
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {VIDEOS_DATA.slice(0, 3).map((video) => (
                      <div
                        key={video.id}
                        onClick={() => {
                          setActiveVideoId(video.id);
                          setActiveTab('Concert');
                        }}
                        className="group bg-zinc-900/30 border border-zinc-800 hover:border-amber-500/40 rounded-2xl overflow-hidden shadow-md hover:shadow-xl transition-all duration-300 cursor-pointer flex flex-col"
                      >
                        {/* Video Thumbnail Wrapper */}
                        <div className="relative aspect-video w-full overflow-hidden bg-black">
                          <img
                            src={video.thumbnailUrl}
                            alt={video.title}
                            className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-500"
                            referrerPolicy="no-referrer"
                          />
                          {/* Hover Play Button Overlay */}
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                            <div className="w-11 h-11 rounded-full bg-amber-500 text-zinc-950 flex items-center justify-center shadow-lg transform scale-90 group-hover:scale-100 transition-transform duration-300">
                              <Play className="w-5 h-5 fill-current pl-0.5" />
                            </div>
                          </div>
                          {/* Duration Tag */}
                          <span className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-black/85 backdrop-blur-sm rounded text-[9px] font-bold font-mono text-zinc-200">
                            {video.duration}
                          </span>
                          {/* Category Tag */}
                          <span className="absolute top-2 left-2 px-2 py-0.5 bg-amber-500/90 text-zinc-950 text-[9px] font-extrabold uppercase rounded tracking-wider">
                            {video.category}
                          </span>
                        </div>

                        {/* Video Metadata */}
                        <div className="p-4 flex-grow flex flex-col justify-between space-y-3 text-left">
                          <div className="space-y-1">
                            <h4 className="font-serif text-xs sm:text-sm font-bold text-zinc-100 line-clamp-2 group-hover:text-amber-400 transition-colors">
                              {video.title}
                            </h4>
                            <p className="text-[10px] text-zinc-400 font-medium">{video.artist}</p>
                          </div>
                          <div className="flex items-center justify-between pt-2 border-t border-zinc-900 text-[10px] text-zinc-500 font-semibold">
                            <span>{video.views} views</span>
                            <span>{video.publishedAt}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Sub-hero badge */}
                <div className="bg-zinc-900/15 border border-zinc-850 p-6 md:p-8 rounded-3xl flex flex-col md:flex-row items-center justify-between gap-6">
                  <div className="space-y-1.5 text-center md:text-left">
                    <h3 className="font-serif text-lg font-bold text-zinc-100">Planning a concert or recital in Chennai?</h3>
                    <p className="text-xs text-zinc-400 max-w-xl">We record sacred classical recitals and choral assemblies live with high-fidelity matched audio and 4K video entirely free of cost.</p>
                  </div>
                  <div className="flex gap-3">
                    <button 
                      onClick={() => { setBookingFormMode('inquire'); setIsBookingOpen(true); }}
                      aria-label="Inquire about a live recording date"
                      className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-zinc-950 text-xs font-bold rounded-xl transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                    >
                      Inquire About Your Date
                    </button>
                    <button 
                      onClick={() => setActiveTab('artist-program')}
                      aria-label="Learn how our free live recording program works"
                      className="px-5 py-2.5 border border-zinc-700 hover:bg-zinc-800 text-zinc-300 text-xs font-semibold rounded-xl transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-450"
                    >
                      How It Works
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {/* View 1: Showcases & Video registries */}
            {isShowcasesActive && (
              <motion.div
                key="showcases-view"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.35 }}
              >
                <VideoGallery
                  selectedCategory={activeTab}
                  setSelectedCategory={setActiveTab}
                  likedVideos={likedVideos}
                  toggleLikeVideo={toggleLikeVideo}
                  activeVideoId={activeVideoId}
                  setActiveVideoId={setActiveVideoId}
                />
              </motion.div>
            )}

            {/* View 2: Curated Channel Playlists */}
            {activeTab === 'playlists' && (
              <motion.div
                key="playlists-view"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.35 }}
              >
                <PlaylistsSection />
              </motion.div>
            )}

            {/* View 3: Technical Rig specs */}
            {activeTab === 'tech-specs' && (
              <motion.div
                key="tech-specs-view"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.35 }}
              >
                <TechSpecs />
              </motion.div>
            )}

            {/* View 4: Dedicated Artist Collaboration Program page */}
            {activeTab === 'artist-program' && (
              <motion.div
                key="artist-program-view"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.35 }}
              >
                <section className="py-12 px-4 md:px-8 text-left max-w-7xl mx-auto space-y-12">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
                    <div className="space-y-4">
                      <span className="px-2.5 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full text-[10px] font-extrabold uppercase tracking-wide flex items-center gap-1 w-fit">
                        <Star className="w-3.5 h-3.5 text-amber-400" fill="currentColor" />
                        Artist Collaboration Program
                      </span>
                      <h2 className="font-serif text-3xl md:text-4xl font-bold text-zinc-50 leading-tight">
                        Get Recorded in Studio Quality, At No Monetary Cost
                      </h2>
                      <p className="text-sm text-zinc-300 leading-relaxed">
                        Music Madras provides upcoming and established classical, church, and sacred music performers with high-fidelity live audio and video capture services absolutely free of cost. 
                        In exchange, the finished video is published to our growing classical music channel <strong>@MusicMadras</strong> with a collaboration link.
                      </p>
                      <p className="text-xs text-zinc-400 leading-relaxed">
                        Performers receive the finished 4K files and pristine mastered stereo outputs, which can be shared freely on Instagram, TikTok, and other personal social handles.
                      </p>
                    </div>

                    <div className="bg-zinc-900/40 p-8 rounded-3xl border border-zinc-850 space-y-5 shadow-lg">
                      <h3 className="font-serif text-lg font-bold text-zinc-100">
                        How It Works — 3 Simple Steps
                      </h3>
                      
                      <div className="space-y-4 text-xs leading-normal">
                        <div className="flex gap-3">
                          <div className="w-6 h-6 rounded-full bg-[#0D9488] text-zinc-950 flex items-center justify-center font-extrabold flex-shrink-0">
                            1
                          </div>
                          <div>
                            <h4 className="font-bold text-zinc-100">Submit Booking Request</h4>
                            <p className="text-zinc-400 mt-0.5">Let us know the date, location, and musical context of your Chennai concert/recital.</p>
                          </div>
                        </div>

                        <div className="flex gap-3">
                          <div className="w-6 h-6 rounded-full bg-[#0D9488] text-zinc-950 flex items-center justify-center font-extrabold flex-shrink-0">
                            2
                          </div>
                          <div>
                            <h4 className="font-bold text-zinc-100">Live Recording Day</h4>
                            <p className="text-zinc-400 mt-0.5">We set up low-profile matched mics and flagship single/multi-cam 4K capture systems to record silently.</p>
                          </div>
                        </div>

                        <div className="flex gap-3">
                          <div className="w-6 h-6 rounded-full bg-[#0D9488] text-zinc-950 flex items-center justify-center font-extrabold flex-shrink-0">
                            3
                          </div>
                          <div>
                            <h4 className="font-bold text-zinc-100">Publish in 2-3 Days</h4>
                            <p className="text-zinc-400 mt-0.5">We mix and normalize your audio, master the video files, and release it with joint collaboration credits.</p>
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          setBookingFormMode('inquire');
                          setIsBookingOpen(true);
                        }}
                        aria-label="Inquire about a live recording date for your classical performance"
                        className="w-full mt-2 py-3 bg-amber-500 hover:bg-amber-600 text-zinc-950 font-bold text-xs rounded-xl transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                      >
                        Inquire About Your Date
                      </button>
                    </div>
                  </div>
                </section>
              </motion.div>
            )}

          </AnimatePresence>
        </div>

      </main>

      {/* Booking Modal Form Overlay */}
      <BookingForm
        isOpen={isBookingOpen}
        onClose={() => setIsBookingOpen(false)}
        defaultMode={bookingFormMode}
      />

      {/* Footer Element */}
      <footer className="bg-zinc-950 text-zinc-300 border-t border-zinc-800 py-12 px-4 md:px-8 shadow-inner">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-8 text-left">
          
          <div className="md:col-span-5 space-y-4">
            <h3 className="font-serif text-lg font-bold text-zinc-100 flex items-center gap-1.5">
              Music Madras
              <span className="w-2 h-2 rounded-full bg-[#0D9488]"></span>
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed max-w-sm">
              Enterprise-class archival portal dedicated entirely to the live performances captured by @MusicMadras. Supporting Chennai's classical and sacred musical heritage through unmatched sound fidelity and rapid turnarounds.
            </p>
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <MapPin className="w-4 h-4 text-emerald-400" />
              <span>Chennai, Tamil Nadu, India</span>
            </div>
          </div>

          <div className="md:col-span-3 space-y-3">
            <h4 className="text-xs font-bold text-zinc-100 uppercase tracking-widest">
              Live Categories
            </h4>
            <div className="flex flex-col gap-2 text-xs text-zinc-400 font-semibold">
              <button 
                onClick={() => setActiveTab('Organ')} 
                aria-label="Filter showcases by Pipe Organ Recitals"
                className="hover:text-amber-400 transition-colors text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded px-1"
              >
                Pipe Organ Recitals
              </button>
              <button 
                onClick={() => setActiveTab('Choral')} 
                aria-label="Filter showcases by Choirs and Ensembles"
                className="hover:text-amber-400 transition-colors text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded px-1"
              >
                Choirs and Ensembles
              </button>
              <button 
                onClick={() => setActiveTab('Vocal')} 
                aria-label="Filter showcases by Solo Vocals"
                className="hover:text-amber-400 transition-colors text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded px-1"
              >
                Solo Vocals
              </button>
              <button 
                onClick={() => setActiveTab('Instrumental')} 
                aria-label="Filter showcases by Orchestra and Classical Instruments"
                className="hover:text-amber-400 transition-colors text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded px-1"
              >
                Orchestra & Classical Instruments
              </button>
            </div>
          </div>

          <div className="md:col-span-4 space-y-4">
            <h4 className="text-xs font-bold text-zinc-100 uppercase tracking-widest">
              Official Channel Link
            </h4>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Never miss a recital. Subscribing on YouTube directly assists the @MusicMadras archiving initiative, helping Chennai artists gain exposure worldwide.
            </p>
            <a
              href={CHANNEL_INFO.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Visit the official @MusicMadras YouTube channel (opens in a new tab)"
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#FF0000] hover:bg-[#CC0000] text-white text-xs font-bold rounded-xl transition-all shadow-md cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              <Youtube className="w-4 h-4" fill="currentColor" />
              Visit @MusicMadras YouTube
            </a>
          </div>

        </div>

        <div className="max-w-7xl mx-auto mt-10 pt-6 border-t border-zinc-800 flex flex-col gap-4 text-[11px] text-zinc-500">
          <p>© {new Date().getFullYear()} Music Madras. All performance audio & video material is captured exclusively from @MusicMadras.</p>
          <p className="leading-relaxed max-w-4xl text-zinc-400/80">
            MusicMadras exists only for the passion of live music in Chennai and as an archive of live music. MusicMadras does not hold any copyrights; all rights belong to the respective composers and performers.
          </p>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mt-2">
            <span className="flex items-center gap-1">
              <Shield className="w-3.5 h-3.5 text-emerald-400" />
              Enterprise Archival Portal
            </span>
          </div>
        </div>
      </footer>

    </div>
  );
}
