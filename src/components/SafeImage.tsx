import React, { useState, useEffect, useMemo } from 'react';
import { Music, Radio, Sliders, Award, Video, Disc } from 'lucide-react';

interface SafeImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  fallbackType?: 'music' | 'video' | 'playlist' | 'gear' | 'logo' | 'artist';
  title?: string;
  alt?: string;
  className?: string;
}

export default function SafeImage({
  src,
  fallbackType = 'video',
  title,
  alt = '',
  className = '',
  ...props
}: SafeImageProps) {
  // Extract YouTube ID if this is a YouTube thumbnail or video URL
  const youtubeCandidates = useMemo(() => {
    if (!src) return [];
    const match = src.match(/(?:youtube\.com\/(?:vi\/|watch\?v=)|youtu\.be\/|ytimg\.com\/vi\/)([a-zA-Z0-9_-]{6,15})/);
    if (!match) return [src];
    
    const id = match[1];
    // List candidate CDNs and resolutions in priority order
    const list = [
      src,
      `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
      `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
      `https://img.youtube.com/vi/${id}/mqdefault.jpg`,
      `https://i.ytimg.com/vi/${id}/0.jpg`,
    ];
    // Remove duplicates
    return Array.from(new Set(list));
  }, [src]);

  const [candidateIndex, setCandidateIndex] = useState(0);
  const [error, setError] = useState(false);

  // Reset when src changes
  useEffect(() => {
    setCandidateIndex(0);
    setError(false);
  }, [src]);

  const currentSrc = youtubeCandidates[candidateIndex] || src;

  const handleError = () => {
    if (candidateIndex < youtubeCandidates.length - 1) {
      // Advance to next candidate CDN / format
      setCandidateIndex((prev) => prev + 1);
    } else {
      // All candidates exhausted, switch to graceful UI fallback
      setError(true);
    }
  };

  if (error || !src) {
    if (fallbackType === 'logo' && currentSrc !== '/logo.png') {
      return (
        <img
          src="/logo.png"
          alt={alt || 'Music Madras Logo'}
          className={className}
          onError={() => {
            // If local logo fails as well, show pristine MM badge
            setError(true);
          }}
          {...props}
        />
      );
    }

    if (fallbackType === 'logo') {
      return (
        <div 
          className={`flex items-center justify-center bg-gradient-to-br from-amber-400 via-amber-500 to-amber-600 text-zinc-950 font-serif font-extrabold shadow-inner ${className}`}
          style={{ textShadow: '0 1px 1px rgba(255,255,255,0.2)' }}
        >
          <span className="text-sm md:text-base tracking-wider font-bold">MM</span>
        </div>
      );
    }

    const getIcon = () => {
      switch (fallbackType) {
        case 'music':
          return <Music className="w-7 h-7 text-amber-500/80" />;
        case 'playlist':
          return <Radio className="w-7 h-7 text-amber-500/80 animate-pulse" />;
        case 'gear':
          return <Sliders className="w-7 h-7 text-emerald-500/80" />;
        case 'artist':
          return <Award className="w-7 h-7 text-amber-500/80" />;
        default:
          return <Video className="w-7 h-7 text-amber-500/80" />;
      }
    };

    const getGradient = () => {
      switch (fallbackType) {
        case 'gear':
          return 'from-zinc-900 via-zinc-900/95 to-teal-950/40';
        case 'artist':
          return 'from-zinc-900 via-zinc-900/95 to-amber-950/30';
        default:
          return 'from-zinc-900 via-zinc-900/95 to-zinc-950';
      }
    };

    return (
      <div className={`flex flex-col items-center justify-center bg-gradient-to-br ${getGradient()} p-3 text-center border border-zinc-800/40 overflow-hidden ${className}`}>
        <div className="absolute -right-3 -bottom-3 w-20 h-20 rounded-full border border-zinc-800/20 flex items-center justify-center pointer-events-none opacity-40">
          <Disc className="w-10 h-10 text-zinc-700/30" />
        </div>
        
        {getIcon()}
        
        {title && (
          <span className="mt-1.5 text-[10px] font-serif font-semibold text-zinc-400 line-clamp-1 px-2 tracking-tight">
            {title}
          </span>
        )}
      </div>
    );
  }

  const isExternal = currentSrc.startsWith('http://') || currentSrc.startsWith('https://');

  return (
    <img
      src={currentSrc}
      alt={alt}
      className={className}
      onError={handleError}
      loading="lazy"
      referrerPolicy={isExternal ? 'no-referrer' : undefined}
      {...props}
    />
  );
}
