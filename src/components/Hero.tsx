import { useState } from 'react';
import { Sparkles, Mic, Play, Radio, Volume2, Shield, Heart, Zap } from 'lucide-react';
import { CHANNEL_INFO } from '../data';

interface HeroProps {
  onOpenBooking: () => void;
  onBrowseVideos: () => void;
}

export default function Hero({ onOpenBooking, onBrowseVideos }: HeroProps) {
  const [ampWarmth, setAmpWarmth] = useState<'solid-state' | 'tube-warmth' | 'ribbon-analog'>('tube-warmth');

  // Frequency simulator details based on instrument and preamp
  const preampDescriptions = {
    'solid-state': {
      title: 'Solid State (Ultra-Transparent)',
      desc: 'Absolutely flat frequency response from 10Hz to 80kHz. Ideal for lightning-fast transients of live string bowing strokes, brass, woodwinds, and pipe organ releases.',
      gain: '+48dB',
      noise: '-128dBu'
    },
    'tube-warmth': {
      title: 'Class-A Tube (Harmonic Richness)',
      desc: 'Adds subtle second-order even harmonics to warm up vocal midranges and acoustic solos, replicating authentic Chennai concert hall acoustics.',
      gain: '+52dB',
      noise: '-124dBu'
    },
    'ribbon-analog': {
      title: 'Passive Ribbon + Impedance Match',
      desc: 'Rolls off harsh high-end friction noise from acoustic string bows and opens up the natural resonances of classical instruments.',
      gain: '+65dB',
      noise: '-120dBu'
    }
  };

  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-zinc-950 via-zinc-950 to-zinc-900 border-b border-zinc-800/80 py-12 px-4 md:px-8">
      {/* Background Decorative Classical Elements */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl -z-10" />
      <div className="absolute bottom-0 left-0 w-96 h-96 bg-[#0D9488]/5 rounded-full blur-3xl -z-10" />

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        
        {/* Left Side: Brand Narrative & Mission */}
        <div className="lg:col-span-7 flex flex-col items-start text-left space-y-6">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-500/10 text-amber-400 rounded-full text-xs font-bold tracking-wide border border-amber-500/20">
            <Sparkles className="w-3.5 h-3.5" />
            SOUND-FIRST CLASSICAL RECORDING
          </div>

          <h1 className="font-serif text-4xl sm:text-5xl md:text-6xl font-bold text-zinc-50 tracking-tight leading-none">
            Capturing the Pure Soul of <span className="text-amber-400 italic">Live Classical Music</span>
          </h1>

          <p className="text-sm sm:text-base text-zinc-300 max-w-2xl leading-relaxed">
            Music Madras preserves live classical music recitals, concerts, church music, and sacred choral services across Chennai. 
            We use <span className="font-semibold text-zinc-100">studio-quality microphones and high-fidelity pre-amps</span> to record pristine acoustics, paired with stunning <span className="font-semibold text-amber-400">single/multi-cam 4K capture</span> shot silently on flagship mobile systems. 
            No excessive production—just raw, honest classical resonance and instrument blending delivered in <span className="font-semibold text-amber-400">2-3 business days</span>.
          </p>

          {/* Key Value Pillars Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full pt-2">
            <div className="bg-zinc-900/60 border border-zinc-800 p-4 rounded-2xl shadow-md">
              <div className="w-8 h-8 rounded-full bg-[#0D9488]/10 flex items-center justify-center text-[#0D9488] mb-3 border border-[#0D9488]/20">
                <Mic className="w-4 h-4" />
              </div>
              <h3 className="font-serif text-sm font-bold text-zinc-100">Studio-Grade Mics</h3>
              <p className="text-xs text-zinc-400 mt-1">Matched-pair condensers & solid-state pre-amps for ultimate live acoustic transient detail.</p>
            </div>

            <div className="bg-zinc-900/60 border border-zinc-800 p-4 rounded-2xl shadow-md">
              <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-400 mb-3 border border-amber-500/20">
                <Play className="w-4 h-4" />
              </div>
              <h3 className="font-serif text-sm font-bold text-zinc-100">Flagship 4K Video</h3>
              <p className="text-xs text-zinc-400 mt-1">Stunning single/multi-cam 4K capture without bulky, obtrusive camera rigs.</p>
            </div>

            <div className="bg-zinc-900/60 border border-zinc-800 p-4 rounded-2xl shadow-md">
              <div className="w-8 h-8 rounded-full bg-[#0D9488]/10 flex items-center justify-center text-[#0D9488] mb-3 border border-[#0D9488]/20">
                <Zap className="w-4 h-4" />
              </div>
              <h3 className="font-serif text-sm font-bold text-zinc-100">2-3 Day Delivery</h3>
              <p className="text-xs text-zinc-400 mt-1">Fast turnaround to publish and share video files across your social profiles.</p>
            </div>
          </div>

          {/* Call to Actions */}
          <div className="flex flex-wrap items-center gap-4 pt-2">
            <button
              onClick={onOpenBooking}
              className="px-6 py-3 bg-amber-500 hover:bg-amber-600 text-zinc-950 font-extrabold text-sm rounded-full shadow-lg hover:shadow-xl transition-all flex items-center gap-2"
            >
              Get Recorded For Free
            </button>
            <button
              onClick={onBrowseVideos}
              className="px-6 py-3 border border-zinc-700 hover:bg-zinc-800/60 text-zinc-200 font-semibold text-sm rounded-full transition-all"
            >
              Browse Highlights
            </button>
            <p className="text-xs text-zinc-500 italic w-full sm:w-auto">
              * Opt for free recording in exchange for a YouTube collaboration link!
            </p>
          </div>
        </div>

        {/* Right Side: Interactive Acoustic Soundboard Simulator */}
        <div className="lg:col-span-5 bg-zinc-900/60 border border-zinc-800 rounded-3xl p-6 relative">
          
          {/* Circular Gold Madras Hall Label */}
          <div className="absolute -top-3 -right-3 bg-amber-500 text-zinc-950 text-[10px] font-extrabold px-3 py-1 rounded-full uppercase tracking-wider shadow-sm flex items-center gap-1">
            <Radio className="w-3 h-3 animate-pulse" />
            Live Sound
          </div>

          <h3 className="font-serif text-lg font-bold text-zinc-100 mb-1 flex items-center gap-1.5">
            Acoustic Pre-Amp Console
          </h3>
          <p className="text-xs text-zinc-400 mb-4">
            Simulate how our high-end hardware shapes the delicate audio of Chennai’s classical instruments.
          </p>

          {/* Preamp Selector */}
          <div className="grid grid-cols-3 gap-2 mb-4 bg-zinc-950 p-1 rounded-xl border border-zinc-800">
            {(['solid-state', 'tube-warmth', 'ribbon-analog'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setAmpWarmth(type)}
                className={`text-[10px] sm:text-xs font-bold py-2 px-1 rounded-lg transition-all ${
                  ampWarmth === type
                    ? 'bg-amber-500 text-zinc-950 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-100'
                }`}
              >
                {type === 'solid-state' ? 'Solid State' : type === 'tube-warmth' ? 'Tube Preamp' : 'Ribbon Warmth'}
              </button>
            ))}
          </div>

          {/* Console Screen */}
          <div className="bg-zinc-950 text-amber-400 font-mono p-4 rounded-2xl space-y-3 mb-4 shadow-inner border border-zinc-800">
            <div className="flex justify-between text-[11px] border-b border-zinc-800/60 pb-1.5 text-zinc-500">
              <span>INPUT MONITORS</span>
              <span className="text-emerald-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-ping"></span>
                ACTIVE
              </span>
            </div>
            
            <div>
              <p className="text-xs font-bold text-zinc-100">{preampDescriptions[ampWarmth].title}</p>
              <p className="text-[10px] text-zinc-300 mt-1 leading-relaxed">
                {preampDescriptions[ampWarmth].desc}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[10px] pt-1 border-t border-zinc-800/60 text-zinc-400">
              <div>PREAMP GAIN: <span className="text-emerald-400 font-bold">{preampDescriptions[ampWarmth].gain}</span></div>
              <div>EQ NOISE FLOOR: <span className="text-emerald-400 font-bold">{preampDescriptions[ampWarmth].noise}</span></div>
            </div>

            {/* Simulated Live Audio Waveform Bars */}
            <div className="h-10 flex items-end justify-between gap-[3px] pt-2">
              {[0.4, 0.8, 0.5, 0.9, 0.3, 0.7, 0.4, 0.95, 0.6, 0.3, 0.8, 0.5, 0.7, 0.4, 0.9, 0.3, 0.8, 0.5, 0.6, 0.35].map((factor, idx) => (
                <div
                  key={idx}
                  className="wave-bar bg-amber-400 w-full rounded-t-sm"
                  style={{
                    height: `${factor * 100}%`,
                    animationDelay: `${idx * 0.08}s`,
                    animationDuration: ampWarmth === 'solid-state' ? '0.7s' : ampWarmth === 'tube-warmth' ? '1.2s' : '1.8s',
                    backgroundColor: ampWarmth === 'solid-state' ? '#0D9488' : ampWarmth === 'tube-warmth' ? '#F59E0B' : '#EF4444'
                  }}
                />
              ))}
            </div>
          </div>

          {/* Interactive controls */}
          <div className="bg-zinc-900 p-3 rounded-2xl border border-zinc-800 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-zinc-200 flex items-center gap-1">
                <Volume2 className="w-3.5 h-3.5 text-amber-400" />
                Live Teaser Sound Level
              </span>
              <span className="text-zinc-400 font-mono">100% (No Clipping)</span>
            </div>
            
            <div className="w-full bg-zinc-950 h-1.5 rounded-full overflow-hidden">
              <div className="bg-[#0D9488] h-full rounded-full transition-all duration-500" style={{ width: ampWarmth === 'solid-state' ? '92%' : ampWarmth === 'tube-warmth' ? '78%' : '60%' }} />
            </div>

            <div className="flex items-center justify-between text-[11px] text-zinc-500">
              <span className="flex items-center gap-1">
                <Shield className="w-3 h-3 text-emerald-400" />
                Anti-Feedback Filter ON
              </span>
              <span>48 kHz / 24-bit PCM</span>
            </div>
          </div>

        </div>

      </div>
    </section>
  );
}
