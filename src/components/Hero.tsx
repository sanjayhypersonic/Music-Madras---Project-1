import { Sparkles, Mic, Play, Zap } from 'lucide-react';

interface HeroProps {
  onOpenBooking: () => void;
  onBrowseVideos: () => void;
}

export default function Hero({ onOpenBooking, onBrowseVideos }: HeroProps) {
  return (
    <section className="relative overflow-hidden bg-zinc-950 border-b border-zinc-800/80 py-20 px-4 md:px-8 isolate">
      {/* Background YouTube Video Loop Overlay */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden -z-10 bg-zinc-950">
        <iframe
          src="https://www.youtube.com/embed/zEQmnmwr5UE?autoplay=1&mute=1&loop=1&playlist=zEQmnmwr5UE&controls=0&showinfo=0&rel=0&modestbranding=1&iv_load_policy=3&playsinline=1&enablejsapi=1&start=90&end=120"
          className="absolute top-1/2 left-1/2 w-[180%] h-[180%] min-w-full min-h-full -translate-x-1/2 -translate-y-1/2 opacity-30 scale-105 pointer-events-none border-0 max-w-none"
          allow="autoplay; encrypted-media"
          title="Hero Live Concert Video Background"
          referrerPolicy="no-referrer"
        />
        {/* Cinematic ambient overlays */}
        <div className="absolute inset-0 bg-gradient-to-b from-zinc-950 via-zinc-950/70 to-zinc-950" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_20%,#09090b_85%)]" />
      </div>

      {/* Decorative Classical Elements */}
      <div className="absolute top-0 right-1/4 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl -z-10" />
      <div className="absolute bottom-0 left-1/4 w-96 h-96 bg-[#0D9488]/5 rounded-full blur-3xl -z-10" />

      <div className="max-w-4xl mx-auto flex flex-col items-center text-center space-y-8">
        
        {/* Sparkles pill */}
        <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-amber-500/10 text-amber-400 rounded-full text-xs font-bold tracking-wide border border-amber-500/20 shadow-md">
          <Sparkles className="w-3.5 h-3.5" />
          SOUND-FIRST CLASSICAL RECORDING
        </div>

        {/* Heading */}
        <h1 className="font-serif text-4xl sm:text-5xl md:text-6xl font-bold text-zinc-50 tracking-tight leading-none drop-shadow-xl">
          Capturing the Pure Soul of <br />
          <span className="text-amber-400 italic">Live Classical Music</span>
        </h1>

        {/* Narrative text */}
        <p className="text-sm sm:text-base text-zinc-200 max-w-2xl leading-relaxed drop-shadow-md">
          Music Madras preserves live classical music recitals, pipe organ showcases, church music, and sacred choral services across Chennai. 
          We record with studio-quality matched condenser microphones to preserve natural acoustics, paired with discrete, silent single/multi-cam 4K capture.
        </p>

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
    </section>
  );
}
