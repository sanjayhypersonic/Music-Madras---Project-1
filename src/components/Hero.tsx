import { useState, useRef, useEffect } from 'react';
import { Sparkles, Mic, Play, Zap, Video, VideoOff, ExternalLink, AlertCircle, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface HeroProps {
  onOpenBooking: () => void;
  onBrowseVideos: () => void;
}

type BackgroundSource = 'mp4_local' | 'youtube' | 'ambient';

export default function Hero({ onOpenBooking, onBrowseVideos }: HeroProps) {
  const [bgSource, setBgSource] = useState<BackgroundSource>('mp4_local');
  const [videoOpacity, setVideoOpacity] = useState(0.35);
  const [mp4LoadFailed, setMp4LoadFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Attempt to check if local MP4 is available or if it fails
  useEffect(() => {
    if (bgSource === 'mp4_local' && videoRef.current) {
      videoRef.current.load();
    }
  }, [bgSource]);

  const handleMp4Error = () => {
    console.warn("Local hero-loop.mp4 not found. Falling back to ambient stage mode.");
    setMp4LoadFailed(true);
    setBgSource('ambient');
  };

  return (
    <section className="relative overflow-hidden bg-zinc-950 border-b border-zinc-800/80 py-20 px-4 md:px-8 isolate min-h-[580px] flex items-center">
      
      {/* BACKGROUND GRAPHICS & PLAYS */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden -z-10 bg-zinc-950">
        
        {/* 1. LOCAL MP4 PLAYER (PREFERABLE) */}
        {bgSource === 'mp4_local' && !mp4LoadFailed && (
          <video
            ref={videoRef}
            autoPlay
            loop
            muted
            playsInline
            onError={handleMp4Error}
            style={{ opacity: videoOpacity }}
            className="absolute top-1/2 left-1/2 w-full h-full min-w-full min-h-full -translate-x-1/2 -translate-y-1/2 object-cover transition-opacity duration-700"
          >
            <source src="/assets/hero-loop.mp4" type="video/mp4" />
            <source src="/assets/hero_loop.mp4" type="video/mp4" />
            <source src="/hero-loop.mp4" type="video/mp4" />
            <source src="/hero_loop.mp4" type="video/mp4" />
          </video>
        )}

        {/* 2. YOUTUBE EMBED PLAYER (WITH ERROR EXPLANATION BANNER IF REQUIRED) */}
        {bgSource === 'youtube' && (
          <iframe
            src="https://www.youtube.com/embed/zEQmnmwr5UE?autoplay=1&mute=1&loop=1&playlist=zEQmnmwr5UE&controls=0&showinfo=0&rel=0&modestbranding=1&iv_load_policy=3&playsinline=1&enablejsapi=1&start=40"
            style={{ opacity: videoOpacity }}
            className="absolute top-1/2 left-1/2 w-[180%] h-[180%] min-w-full min-h-full -translate-x-1/2 -translate-y-1/2 pointer-events-none border-0 max-w-none transition-opacity duration-700"
            allow="autoplay; encrypted-media"
            title="Hero Live Concert Video Background"
            referrerPolicy="no-referrer"
          />
        )}

        {/* 3. LUXURIOUS CINEMATIC AMBIENT STAGE VISUALIZER (PERFECT FAILSAFE & BACKDROP) */}
        {bgSource === 'ambient' && (
          <div className="absolute inset-0 bg-zinc-950 overflow-hidden">
            {/* Glowing spotlight cones */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[500px] bg-[radial-gradient(ellipse_at_top,rgba(245,158,11,0.08)_0%,transparent_70%)] animate-pulse" style={{ animationDuration: '6s' }} />
            <div className="absolute top-0 left-1/4 w-[400px] h-[600px] bg-[radial-gradient(ellipse_at_top,rgba(13,148,136,0.06)_0%,transparent_70%)] animate-pulse" style={{ animationDuration: '8s' }} />
            <div className="absolute top-0 right-1/4 w-[400px] h-[600px] bg-[radial-gradient(ellipse_at_top,rgba(245,158,11,0.05)_0%,transparent_70%)] animate-pulse" style={{ animationDuration: '10s' }} />

            {/* Glowing horizontal pipe organ shadows / visualizers */}
            <div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-zinc-950 via-zinc-950/20 to-transparent" />
            
            {/* Elegant slow-floating warm stage particles */}
            <div className="absolute inset-0">
              {[...Array(12)].map((_, i) => (
                <motion.div
                  key={i}
                  className="absolute rounded-full bg-amber-400/20 blur-[1px]"
                  style={{
                    width: Math.random() * 5 + 2,
                    height: Math.random() * 5 + 2,
                    left: `${Math.random() * 100}%`,
                    top: `${Math.random() * 100}%`,
                  }}
                  animate={{
                    y: [-20, -120],
                    x: [0, (Math.random() - 0.5) * 40],
                    opacity: [0, 0.7, 0],
                  }}
                  transition={{
                    duration: Math.random() * 12 + 10,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: Math.random() * 5,
                  }}
                />
              ))}
              {[...Array(8)].map((_, i) => (
                <motion.div
                  key={i + 12}
                  className="absolute rounded-full bg-emerald-400/15 blur-[2px]"
                  style={{
                    width: Math.random() * 6 + 3,
                    height: Math.random() * 6 + 3,
                    left: `${Math.random() * 100}%`,
                    top: `${Math.random() * 100}%`,
                  }}
                  animate={{
                    y: [-10, -90],
                    x: [0, (Math.random() - 0.5) * 30],
                    opacity: [0, 0.5, 0],
                  }}
                  transition={{
                    duration: Math.random() * 14 + 12,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: Math.random() * 6,
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Ambient Gradient Masks to isolate page contents */}
        <div className="absolute inset-0 bg-gradient-to-b from-zinc-950 via-zinc-950/60 to-zinc-950" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_30%,#09090b_85%)]" />
      </div>

      {/* Decorative Blur Spheres */}
      <div className="absolute top-0 right-1/4 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl -z-10" />
      <div className="absolute bottom-0 left-1/4 w-96 h-96 bg-[#0D9488]/5 rounded-full blur-3xl -z-10" />

      {/* HERO MAIN BODY */}
      <div className="max-w-4xl mx-auto flex flex-col items-center text-center space-y-8 w-full">
        
        {/* Sparkles Pill */}
        <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-amber-500/10 text-amber-400 rounded-full text-xs font-bold tracking-wide border border-amber-500/20 shadow-md">
          <Sparkles className="w-3.5 h-3.5" />
          SOUND-FIRST CLASSICAL RECORDING
        </div>

        {/* Heading */}
        <h1 className="font-serif text-4xl sm:text-5xl md:text-6xl font-bold text-zinc-50 tracking-tight leading-none drop-shadow-xl">
          Capturing the Pure Soul of <br />
          <span className="text-amber-400 italic">Live Classical Music</span>
        </h1>

        {/* Narrative */}
        <p className="text-sm sm:text-base text-zinc-200 max-w-2xl leading-relaxed drop-shadow-md">
          Music Madras preserves live classical music recitals, pipe organ showcases, church music, and sacred choral services across Chennai. 
          We record with studio-quality matched condenser microphones to preserve natural acoustics, paired with discrete, silent single/multi-cam 4K capture.
        </p>

        {/* YouTube Iframe Warning Info Box (Error 153 Guard) */}
        {bgSource === 'youtube' && (
          <div className="w-full max-w-2xl bg-amber-500/10 border border-amber-500/20 backdrop-blur-md rounded-2xl p-4 text-left space-y-2 text-xs text-amber-200">
            <div className="flex items-center gap-2 font-bold text-amber-400">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>YouTube Video Embed Restriction (Error 150/153)</span>
            </div>
            <p className="leading-relaxed">
              Classical concerts and high-fidelity video releases on YouTube are often strictly restricted by publishers from being played in sandboxed previews. If the background loop above shows <span className="underline decoration-amber-400/40">"Video Unavailable" (Error 153)</span>, click the button below to view the official master recording directly on YouTube, or toggle back to our built-in <strong className="text-zinc-50">Cinematic Ambient Stage</strong>.
            </p>
            <div className="pt-1 flex gap-3">
              <a 
                href="https://youtu.be/zEQmnmwr5UE?si=JmTWDXrZSY_47TV_&t=40" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-zinc-950 font-bold rounded-lg transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                Open Original on YouTube
              </a>
              <button 
                onClick={() => setBgSource('ambient')} 
                className="px-3 py-1.5 border border-zinc-700 hover:bg-zinc-800 text-zinc-200 font-medium rounded-lg transition-colors"
              >
                Switch to Ambient Glow
              </button>
            </div>
          </div>
        )}

        {/* Key Value Pillars Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 w-full max-w-3xl pt-4">
          <div className="group bg-zinc-900/60 backdrop-blur-md border border-zinc-800/80 hover:border-amber-500/40 rounded-2xl overflow-hidden shadow-lg transition-all duration-300 text-left flex flex-col">
            <div className="relative h-28 w-full overflow-hidden">
              <img 
                src="https://images.unsplash.com/photo-1590602847861-f357a9332bbc?auto=format&fit=crop&w=600&q=80" 
                alt="Studio Microphone" 
                className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-500 opacity-80"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-zinc-900/40 to-transparent" />
              <div className="absolute bottom-3 left-3 w-8 h-8 rounded-full bg-[#0D9488]/90 backdrop-blur-sm flex items-center justify-center text-white border border-[#0D9488]/30">
                <Mic className="w-3.5 h-3.5" />
              </div>
            </div>
            <div className="p-4 flex-grow flex flex-col justify-between">
              <div>
                <h3 className="font-serif text-sm font-bold text-zinc-100 group-hover:text-amber-400 transition-colors">Studio-Grade Mics</h3>
                <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">Matched-pair condensers & solid-state pre-amps for ultimate transient detail.</p>
              </div>
            </div>
          </div>

          <div className="group bg-zinc-900/60 backdrop-blur-md border border-zinc-800/80 hover:border-amber-500/40 rounded-2xl overflow-hidden shadow-lg transition-all duration-300 text-left flex flex-col">
            <div className="relative h-28 w-full overflow-hidden">
              <img 
                src="https://images.unsplash.com/photo-1465847899084-d164df4dedc6?auto=format&fit=crop&w=600&q=80" 
                alt="Western Classical Concert Stage" 
                className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-500 opacity-80"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-zinc-900/40 to-transparent" />
              <div className="absolute bottom-3 left-3 w-8 h-8 rounded-full bg-amber-500/90 backdrop-blur-sm flex items-center justify-center text-zinc-950 border border-amber-500/30">
                <Play className="w-3.5 h-3.5 fill-current" />
              </div>
            </div>
            <div className="p-4 flex-grow flex flex-col justify-between">
              <div>
                <h3 className="font-serif text-sm font-bold text-zinc-100 group-hover:text-amber-400 transition-colors">Flagship 4K Video</h3>
                <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">Stunning single/multi-cam 4K capture without bulky, obtrusive camera rigs.</p>
              </div>
            </div>
          </div>

          <div className="group bg-zinc-900/60 backdrop-blur-md border border-zinc-800/80 hover:border-amber-500/40 rounded-2xl overflow-hidden shadow-lg transition-all duration-300 text-left flex flex-col">
            <div className="relative h-28 w-full overflow-hidden">
              <img 
                src="https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?auto=format&fit=crop&w=600&q=80" 
                alt="Recording Console Studio" 
                className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-500 opacity-80"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-zinc-900/40 to-transparent" />
              <div className="absolute bottom-3 left-3 w-8 h-8 rounded-full bg-[#0D9488]/90 backdrop-blur-sm flex items-center justify-center text-white border border-[#0D9488]/30">
                <Zap className="w-3.5 h-3.5" />
              </div>
            </div>
            <div className="p-4 flex-grow flex flex-col justify-between">
              <div>
                <h3 className="font-serif text-sm font-bold text-zinc-100 group-hover:text-amber-400 transition-colors">2-3 Day Delivery</h3>
                <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">Fast turnaround to publish and share pristine video files across your handles.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Call to Actions */}
        <div className="flex flex-wrap justify-center items-center gap-4 pt-4">
          <button
            onClick={onOpenBooking}
            className="px-7 py-3.5 bg-amber-500 hover:bg-amber-600 text-zinc-950 font-extrabold text-sm rounded-full shadow-lg hover:shadow-xl transition-all flex items-center gap-2 cursor-pointer"
          >
            Get Recorded For Free
          </button>
          <button
            onClick={onBrowseVideos}
            className="px-7 py-3.5 border border-zinc-700 hover:bg-zinc-800/60 text-zinc-200 font-semibold text-sm rounded-full transition-all cursor-pointer"
          >
            Browse Highlights
          </button>
        </div>

        <p className="text-xs text-zinc-500 italic">
          * Upcoming and established classical, sacred, or choral Chennai performers qualify for the free program.
        </p>

      </div>

      {/* INTERACTIVE COMPREHENSIVE BACKROUND CONTROL DECK */}
      <div className="absolute bottom-4 right-4 z-20 flex flex-col sm:flex-row items-center gap-2 bg-zinc-900/90 backdrop-blur-md border border-zinc-800/80 rounded-2xl sm:rounded-full px-4 py-2 text-[10px] text-zinc-300 shadow-xl max-w-xs sm:max-w-lg">
        <span className="font-bold text-zinc-400 uppercase tracking-widest text-[9px] shrink-0">Backdrop:</span>
        <div className="flex flex-wrap gap-1.5 justify-center">
          
          {/* Failsafe Ambient Mode */}
          <button
            onClick={() => setBgSource('ambient')}
            className={`px-2 py-1 rounded-full font-bold transition-all ${
              bgSource === 'ambient'
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : 'hover:text-zinc-100 border border-transparent'
            }`}
          >
            Ambient Glow
          </button>

          {/* YouTube Live Embed Mode */}
          <button
            onClick={() => setBgSource('youtube')}
            className={`px-2 py-1 rounded-full font-bold transition-all ${
              bgSource === 'youtube'
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : 'hover:text-zinc-100 border border-transparent'
            }`}
            title="Attempts to stream the performance loop from YouTube"
          >
            YouTube Embed
          </button>

          {/* Local MP4 Mode (Designed for custom upload) */}
          <button
            onClick={() => {
              setMp4LoadFailed(false);
              setBgSource('mp4_local');
            }}
            className={`px-2 py-1 rounded-full font-bold transition-all ${
              bgSource === 'mp4_local'
                ? 'bg-[#0D9488]/20 text-[#2DD4BF] border border-[#0D9488]/30'
                : 'hover:text-zinc-100 border border-transparent'
            }`}
            title="Ideal mode if you upload a cut MP4 loop to the assets directory!"
          >
            Local MP4
          </button>
        </div>

        {bgSource !== 'ambient' && (
          <>
            <span className="hidden sm:inline text-zinc-800">|</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setVideoOpacity(prev => prev <= 0.2 ? 0.35 : prev <= 0.4 ? 0.6 : 0.15)}
                className="hover:text-amber-400 transition-colors font-semibold"
                title="Adjust transparency"
              >
                Dim: {Math.round(videoOpacity * 100)}%
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

