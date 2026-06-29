import React, { useState, useEffect } from 'react';
import { Music, Radio, Sliders, Award, Video, Mic, Disc } from 'lucide-react';

interface SafeImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  fallbackType?: 'music' | 'video' | 'playlist' | 'gear' | 'logo' | 'artist';
  title?: string;
  alt?: string;
  className?: string;
}

export default function SafeImage({ src, fallbackType = 'video', title, alt, className = '', ...props }: SafeImageProps) {
  const [error, setError] = useState(false);
  const [imgSrc, setImgSrc] = useState(src);

  // Sync state if src changes
  useEffect(() => {
    setImgSrc(src);
    setError(false);
  }, [src]);

  if (error || !imgSrc) {
    // Return a pristine, luxury themed CSS fallback
    if (fallbackType === 'logo') {
      return (
        <div 
          className={`w-full h-full flex items-center justify-center bg-gradient-to-br from-amber-400 via-amber-500 to-amber-600 text-zinc-950 font-serif font-extrabold shadow-inner ${className}`}
          style={{ textShadow: '0 1px 1px rgba(255,255,255,0.2)' }}
        >
          <span className="text-sm md:text-base tracking-wider">MM</span>
        </div>
      );
    }

    // Standard card fallbacks
    const getIcon = () => {
      switch (fallbackType) {
        case 'music':
          return <Music className="w-8 h-8 text-amber-500/80" />;
        case 'playlist':
          return <Radio className="w-8 h-8 text-amber-500/80 animate-pulse" />;
        case 'gear':
          return <Sliders className="w-8 h-8 text-emerald-500/80" />;
        case 'artist':
          return <Award className="w-8 h-8 text-amber-500/80" />;
        case 'gear':
          return <Mic className="w-8 h-8 text-red-500/80" />;
        default:
          return <Video className="w-8 h-8 text-amber-500/80" />;
      }
    };

    const getGradient = () => {
      switch (fallbackType) {
        case 'gear':
          return 'from-zinc-900 via-zinc-900/90 to-teal-950/40';
        case 'artist':
          return 'from-zinc-900 via-zinc-900/90 to-amber-950/30';
        default:
          return 'from-zinc-900 via-zinc-900/90 to-zinc-950';
      }
    };

    return (
      <div className={`relative w-full h-full flex flex-col items-center justify-center bg-gradient-to-br ${getGradient()} p-4 text-center border border-zinc-800/40 rounded-xl overflow-hidden ${className}`}>
        {/* Abstract floating background record pattern for depth */}
        <div className="absolute -right-4 -bottom-4 w-24 h-24 rounded-full border border-zinc-800/20 flex items-center justify-center pointer-events-none">
          <Disc className="w-12 h-12 text-zinc-800/10 animate-spin-slow" />
        </div>
        
        {getIcon()}
        
        {title && (
          <span className="mt-2 text-[10px] font-serif font-bold text-zinc-400 line-clamp-1 px-2 tracking-tight">
            {title}
          </span>
        )}
      </div>
    );
  }

  return (
    <img
      src={imgSrc}
      alt={alt}
      className={className}
      onError={() => {
        setError(true);
      }}
      referrerPolicy="no-referrer"
      {...props}
    />
  );
}
