import { Sparkles, Mic, Play, Zap } from 'lucide-react';
import { motion } from 'motion/react';
import SafeImage from './SafeImage';

interface HeroProps {
  onOpenBooking: () => void;
  onBrowseVideos: () => void;
}

export default function Hero({ onOpenBooking, onBrowseVideos }: HeroProps) {
  return (
    <section className="relative overflow-hidden bg-zinc-950 border-b border-zinc-800/80 pt-10 pb-6 px-4 md:px-8 isolate flex items-center">
      
      {/* BACKGROUND GRAPHICS */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden -z-10 bg-zinc-950">
        
        {/* LUXURIOUS CINEMATIC AMBIENT STAGE VISUALIZER */}
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
          Music Madras is dedicated to preserving, promoting, and documenting the rich tradition of Western classical music in Chennai through world-class recordings that preserve natural acoustics, educational resources, historical archives, and digital storytelling.
        </p>

        {/* Key Value Pillars Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 w-full max-w-3xl pt-4">
          <div className="group bg-zinc-900/60 backdrop-blur-md border border-zinc-800/80 hover:border-amber-500/40 rounded-2xl overflow-hidden shadow-lg transition-all duration-300 text-left flex flex-col">
            <div className="relative h-28 w-full overflow-hidden">
              <SafeImage 
                src="https://images.unsplash.com/photo-1590602847861-f357a9332bbc?auto=format&fit=crop&w=600&q=80" 
                alt="Studio Microphone" 
                fallbackType="gear"
                className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-500 opacity-80"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-zinc-900/40 to-transparent" />
              <div className="absolute bottom-3 left-3 w-8 h-8 rounded-full bg-red-600/90 backdrop-blur-sm flex items-center justify-center text-white border border-red-500/30">
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
              <SafeImage 
                src="https://images.unsplash.com/photo-1465847899084-d164df4dedc6?auto=format&fit=crop&w=600&q=80" 
                alt="Western Classical Concert Stage" 
                fallbackType="video"
                className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-500 opacity-80"
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
              <SafeImage 
                src="https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?auto=format&fit=crop&w=600&q=80" 
                alt="Recording Console Studio" 
                fallbackType="gear"
                className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-500 opacity-80"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-zinc-900/40 to-transparent" />
              <div className="absolute bottom-3 left-3 w-8 h-8 rounded-full bg-red-600/90 backdrop-blur-sm flex items-center justify-center text-white border border-red-500/30">
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
            aria-label="Inquire and apply for the free live recording program"
            className="px-7 py-3.5 bg-amber-500 hover:bg-amber-600 text-zinc-950 font-extrabold text-sm rounded-full shadow-lg hover:shadow-xl transition-all flex items-center gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            Get Recorded For Free
          </button>
          <button
            onClick={onBrowseVideos}
            aria-label="Browse the live classical recording archives"
            className="px-7 py-3.5 border border-zinc-700 hover:bg-zinc-800/60 text-zinc-200 font-semibold text-sm rounded-full transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
          >
            Browse Highlights
          </button>
        </div>

        <p className="text-xs text-zinc-500 italic">
          * Upcoming and established classical, sacred, or choral Chennai performers qualify for the free program.
        </p>

      </div>
    </section>
  );
}

