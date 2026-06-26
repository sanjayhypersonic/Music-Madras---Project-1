import { useState } from 'react';
import { Youtube, Music, Radio, Sliders, Calendar, Award, Sparkles } from 'lucide-react';
import { CHANNEL_INFO } from '../data';

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onOpenBooking: () => void;
}

export default function Header({ activeTab, setActiveTab, onOpenBooking }: HeaderProps) {
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [subscriberCount, setSubscriberCount] = useState(CHANNEL_INFO.subscribers);

  const handleSubscribe = () => {
    if (!isSubscribed) {
      setIsSubscribed(true);
      // Simulate real-time subscriber increment
      setSubscriberCount('12.5K');
    } else {
      setIsSubscribed(false);
      setSubscriberCount(CHANNEL_INFO.subscribers);
    }
  };

  return (
    <header className="sticky top-0 z-50 bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800/80 py-3 px-4 md:px-8 shadow-md">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        
        {/* Logo and Channel Title */}
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => setActiveTab('all')}>
          {/* High-Fidelity SVG Replication of the Music Madras circular emblem */}
          <div className="relative w-12 h-12 md:w-14 md:h-14 flex-shrink-0 rounded-full overflow-hidden border border-zinc-700/50 shadow-md bg-[#f4c21b]">
            <img 
              src="https://yt3.googleusercontent.com/d0KOXSy8sQFmrwCGqkTjm90JYMpqdtrFpjtQCh7145eUjEf0XDnCxPXvfg6_RvKnaIY091x5_TA=s250-c-k-c0x00ffffff-no-rj"
              alt="Music Madras Logo"
              className="w-full h-full object-cover transform hover:scale-105 transition-transform duration-300"
              referrerPolicy="no-referrer"
            />
          </div>
          
          <div>
            <h1 className="font-serif text-lg md:text-xl font-bold text-zinc-100 tracking-tight leading-none flex items-center gap-1.5">
              Music Madras
              <span className="inline-block w-2 h-2 rounded-full bg-[#0D9488] animate-pulse" title="Recording Sound Live"></span>
            </h1>
            <p className="text-xs text-zinc-400 font-medium tracking-wide mt-0.5">
              {CHANNEL_INFO.handle} • Chennai Classical
            </p>
          </div>
        </div>

        {/* Desktop Navigation */}
        <nav className="flex items-center gap-1 bg-zinc-900/80 p-1 rounded-full border border-zinc-800">
          <button
            onClick={() => setActiveTab('all')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-full transition-all ${
              activeTab === 'all' || activeTab === 'Organ' || activeTab === 'Choral' || activeTab === 'Vocal' || activeTab === 'Instrumental' || activeTab === 'Concert' || activeTab === 'liked'
                ? 'bg-amber-500 text-zinc-950 shadow-sm font-bold'
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60'
            }`}
          >
            <Music className="w-3.5 h-3.5" />
            Showcases
          </button>

          <button
            onClick={() => setActiveTab('playlists')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-full transition-all ${
              activeTab === 'playlists'
                ? 'bg-amber-500 text-zinc-950 shadow-sm font-bold'
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            Playlists
          </button>

          <button
            onClick={() => setActiveTab('tech-specs')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-full transition-all ${
              activeTab === 'tech-specs'
                ? 'bg-amber-500 text-zinc-950 shadow-sm font-bold'
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            Studio Rig
          </button>
        </nav>

        {/* YouTube Subscription and Booking CTA */}
        <div className="flex items-center gap-2.5">

          <a
            href={CHANNEL_INFO.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleSubscribe}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
              isSubscribed
                ? 'bg-zinc-800 text-zinc-300 border border-zinc-700'
                : 'bg-[#FF0000] text-white hover:bg-[#CC0000] shadow-sm shadow-[#FF0000]/20'
            }`}
          >
            <Youtube className="w-3.5 h-3.5" fill="currentColor" />
            {isSubscribed ? 'Subscribed ✓' : 'Subscribe'}
          </a>

          <button
            onClick={onOpenBooking}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-[#0D9488] hover:bg-[#0b7a70] text-white text-xs font-bold rounded-full shadow-md hover:shadow-lg transition-all"
          >
            <Calendar className="w-3.5 h-3.5" />
            Book Live Recording
          </button>
        </div>

      </div>
    </header>
  );
}
