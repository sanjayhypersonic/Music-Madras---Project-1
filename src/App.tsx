import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Youtube, Shield, MapPin, Radio, Heart, Mic2, Star, Sparkles, Sliders } from 'lucide-react';
import Header from './components/Header';
import Hero from './components/Hero';
import VideoGallery from './components/VideoGallery';
import BookingForm from './components/BookingForm';
import TechSpecs from './components/TechSpecs';
import PlaylistsSection from './components/PlaylistsSection';
import { CHANNEL_INFO } from './data';

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('all'); // 'all', 'playlists', 'tech-specs'
  const [isBookingOpen, setIsBookingOpen] = useState(false);
  const [bookingFormMode, setBookingFormMode] = useState<'booking' | 'inquire'>('booking');
  const [likedVideos, setLikedVideos] = useState<string[]>([]);

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

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col justify-between selection:bg-amber-500/20 selection:text-amber-400">
      
      {/* Header element */}
      <Header
        activeTab={activeTab}
        setActiveTab={(tab) => {
          setActiveTab(tab);
          // If navigating from other tabs to showcase tabs
          if (tab === 'all') {
            const element = document.getElementById('showcases');
            if (element) element.scrollIntoView({ behavior: 'smooth' });
          }
        }}
        onOpenBooking={() => {
          setBookingFormMode('booking');
          setIsBookingOpen(true);
        }}
      />

      {/* Main Body */}
      <main className="flex-grow">
        
        {/* Absolute Brand Hero Banner */}
        <Hero
          onOpenBooking={() => {
            setBookingFormMode('booking');
            setIsBookingOpen(true);
          }}
          onBrowseVideos={() => {
            setActiveTab('all');
            const element = document.getElementById('showcases');
            if (element) element.scrollIntoView({ behavior: 'smooth' });
          }}
        />

        {/* Dynamic section tabs loader using motion.div */}
        <div className="relative">
          <AnimatePresence mode="wait">
            
            {/* View 1: Showcases & Video registries */}
            {(activeTab === 'all' || activeTab === 'Organ' || activeTab === 'Choral' || activeTab === 'Vocal' || activeTab === 'Instrumental' || activeTab === 'Concert') && (
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

          </AnimatePresence>
        </div>

        {/* Feature section showcasing the Free Collaboration Incentive */}
        <section className="bg-zinc-900 border-t border-b border-zinc-800 py-12 px-4 md:px-8 mt-12 text-left">
          <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            <div className="space-y-4">
              <span className="px-2.5 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full text-[10px] font-extrabold uppercase tracking-wide flex items-center gap-1 w-fit">
                <Star className="w-3.5 h-3.5 text-amber-400" fill="currentColor" />
                Artist Collaboration Program
              </span>
              <h2 className="font-serif text-2xl md:text-3xl font-bold text-zinc-50 leading-tight">
                Get Recorded in Studio Quality, At No Monetary Cost
              </h2>
              <p className="text-xs md:text-sm text-zinc-300 leading-relaxed">
                Music Madras provides upcoming and established classical, church, and sacred music performers with high-fidelity live audio and video capture services absolutely free of cost. 
                In exchange, the finished video is published to our growing classical music channel <strong>@MusicMadras</strong> with a collaboration link.
              </p>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Performers receive the finished 4K files and pristine mastered stereo outputs, which can be shared freely on Instagram, TikTok, and other personal social handles.
              </p>
            </div>

            <div className="bg-zinc-950 p-6 rounded-3xl border border-zinc-800 space-y-4 shadow-md">
              <h3 className="font-serif text-base font-bold text-zinc-100">
                How It Works — 3 Simple Steps
              </h3>
              
              <div className="space-y-4 text-xs">
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
                className="w-full mt-2 py-2.5 bg-amber-500 hover:bg-amber-600 text-zinc-950 font-bold text-xs rounded-xl transition-colors"
              >
                Inquire About Your Date
              </button>
            </div>
          </div>
        </section>

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
              <button onClick={() => { setActiveTab('Organ'); const e = document.getElementById('showcases'); e?.scrollIntoView(); }} className="hover:text-amber-400 transition-colors text-left">Pipe Organ Recitals</button>
              <button onClick={() => { setActiveTab('Choral'); const e = document.getElementById('showcases'); e?.scrollIntoView(); }} className="hover:text-amber-400 transition-colors text-left">Sacred Choirs</button>
              <button onClick={() => { setActiveTab('Vocal'); const e = document.getElementById('showcases'); e?.scrollIntoView(); }} className="hover:text-amber-400 transition-colors text-left">Solo Vocals</button>
              <button onClick={() => { setActiveTab('Instrumental'); const e = document.getElementById('showcases'); e?.scrollIntoView(); }} className="hover:text-amber-400 transition-colors text-left">Classical Instruments</button>
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
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#FF0000] hover:bg-[#CC0000] text-white text-xs font-bold rounded-xl transition-all shadow-md"
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
