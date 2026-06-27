import { useState, useEffect } from 'react';
import { Bell, Music, Radio, Sliders, Calendar, Award, Home } from 'lucide-react';
import { CHANNEL_INFO } from '../data';

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onOpenBooking: () => void;
}

export default function Header({ activeTab, setActiveTab, onOpenBooking }: HeaderProps) {
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [showButtons, setShowButtons] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      
      if (window.innerWidth < 768) {
        if (currentScrollY > lastScrollY && currentScrollY > 40) {
          // Scrolling down - hide buttons
          setShowButtons(false);
        } else {
          // Scrolling up - show buttons
          setShowButtons(true);
        }
      } else {
        // Desktop always shown
        setShowButtons(true);
      }
      
      setLastScrollY(currentScrollY);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [lastScrollY]);

  const handleSubscribe = () => {
    setIsSubscribed(!isSubscribed);
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
    <header className="sticky top-0 z-50 bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800/80 py-3 px-4 md:px-8 shadow-md">
      <div className="w-full max-w-7xl mx-auto flex flex-col items-start md:flex-row md:items-center justify-between gap-4">
        
        {/* Logo and Channel Title */}
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => setActiveTab('home')}>
          {/* High-Fidelity SVG Replication of the Music Madras circular emblem */}
          <div className="relative w-12 h-12 md:w-14 md:h-14 flex-shrink-0 rounded-full overflow-hidden border border-zinc-700/50 shadow-md bg-[#f4c21b]">
            <img 
              src="https://yt3.googleusercontent.com/d0KOXSy8sQFmrwCGqkTjm90JYMpqdtrFpjtQCh7145eUjEf0XDnCxPXvfg6_RvKnaIY091x5_TA=s250-c-k-c0x00ffffff-no-rj"
              alt="Music Madras Logo"
              className="w-full h-full object-cover transform hover:scale-105 transition-transform duration-300"
              referrerPolicy="no-referrer"
            />
          </div>
          
          <div className="text-left">
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
        <nav className="flex flex-wrap items-center justify-center gap-1 bg-zinc-900/80 p-1 rounded-2xl md:rounded-full border border-zinc-800 w-full md:w-auto">
          <button
            onClick={() => setActiveTab('home')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full transition-all cursor-pointer ${
              activeTab === 'home'
                ? 'bg-amber-500 text-zinc-950 shadow-sm font-bold'
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60'
            }`}
          >
            <Home className="w-3.5 h-3.5" />
            Home
          </button>

          <button
            onClick={() => setActiveTab('Concert')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full transition-all cursor-pointer ${
              isShowcasesActive
                ? 'bg-amber-500 text-zinc-950 shadow-sm font-bold'
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60'
            }`}
          >
            <Music className="w-3.5 h-3.5" />
            Showcases
          </button>

          <button
            onClick={() => setActiveTab('playlists')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full transition-all cursor-pointer ${
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
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full transition-all cursor-pointer ${
              activeTab === 'tech-specs'
                ? 'bg-amber-500 text-zinc-950 shadow-sm font-bold'
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            Studio Rig
          </button>

          <button
            onClick={() => setActiveTab('artist-program')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full transition-all cursor-pointer ${
              activeTab === 'artist-program'
                ? 'bg-amber-500 text-zinc-950 shadow-sm font-bold'
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60'
            }`}
          >
            <Award className="w-3.5 h-3.5" />
            Artist Program
          </button>
        </nav>

        {/* Subscription and Booking CTA */}
        <div className={`flex items-center justify-center w-full md:w-auto gap-2.5 transition-all duration-300 origin-top overflow-hidden md:!opacity-100 md:!max-h-[50px] md:!scale-100 md:!mt-0 ${
          showButtons 
            ? 'opacity-100 max-h-[50px] scale-100 mt-0' 
            : 'opacity-0 max-h-0 scale-95 -mt-4 pointer-events-none'
        }`}>
          <a
            href={CHANNEL_INFO.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleSubscribe}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
              isSubscribed
                ? 'bg-zinc-850 text-zinc-300 border border-zinc-700'
                : 'bg-[#FF0000] text-white hover:bg-[#CC0000] shadow-sm shadow-[#FF0000]/20'
            }`}
          >
            <Bell className={`w-3.5 h-3.5 ${isSubscribed ? 'fill-current text-zinc-400' : 'text-white'}`} />
            {isSubscribed ? 'Subscribed ✓' : 'Subscribe'}
          </a>

          <button
            onClick={onOpenBooking}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-[#0D9488] hover:bg-[#0b7a70] text-white text-xs font-bold rounded-full shadow-md hover:shadow-lg transition-all cursor-pointer"
          >
            <Calendar className="w-3.5 h-3.5" />
            Book Recording
          </button>
        </div>

      </div>
    </header>
  );
}
