import { Radio, Youtube, Layers, ArrowUpRight } from 'lucide-react';
import { PLAYLISTS_DATA, CHANNEL_INFO } from '../data';
import SafeImage from './SafeImage';

export default function PlaylistsSection() {
  return (
    <section className="py-12 px-4 md:px-8 max-w-7xl mx-auto space-y-8" id="playlists">
      
      {/* Title block */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 border-b border-zinc-800/80 pb-5">
        <div>
          <h2 className="font-serif text-2xl md:text-3xl font-bold text-zinc-50 flex items-center gap-2">
            <Radio className="w-6 h-6 text-amber-500 animate-pulse" />
            Curated Channel Playlists
          </h2>
          <p className="text-xs md:text-sm text-zinc-400 mt-1">
            Carefully grouped concert logs, vocal compilations, and debut recitals on @MusicMadras.
          </p>
        </div>

        <a
          href={`${CHANNEL_INFO.url}/playlists`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="View all curated classical playlists on YouTube (opens in a new tab)"
          className="inline-flex items-center gap-1 text-xs font-bold text-[#FF0000] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded px-1"
        >
          View all on YouTube
          <ArrowUpRight className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* Playlist Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {PLAYLISTS_DATA.map((playlist) => (
          <a
            key={playlist.id}
            href={playlist.youtubeUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open YouTube playlist: ${playlist.title} (opens in a new tab)`}
            className="group bg-zinc-900/40 border border-zinc-800/85 hover:border-zinc-700/80 rounded-2xl overflow-hidden shadow-md hover:shadow-xl transition-all duration-300 flex flex-col justify-between focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            {/* Folder Art Representation */}
            <div className="relative aspect-video bg-zinc-950 overflow-hidden">
              <SafeImage
                src={playlist.thumbnailUrl}
                alt={playlist.title}
                fallbackType="playlist"
                title={playlist.title}
                className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/40 flex flex-col justify-between p-4">
                {/* Folder corner notch */}
                <div className="absolute top-0 right-0 w-12 h-12 bg-zinc-900 transform rotate-45 translate-x-6 -translate-y-6" />

                <div className="flex justify-between items-start z-10">
                  <span className="bg-black/60 text-white backdrop-blur-xs text-[9px] font-bold px-2.5 py-0.5 rounded-full tracking-wider uppercase flex items-center gap-1">
                    <Layers className="w-3 h-3" />
                    Playlist Series
                  </span>
                </div>

                {/* Playlist Video Count Overlay */}
                <div className="bg-black/70 backdrop-blur-xs p-3 rounded-xl border border-white/10 max-w-[120px] text-center self-center z-10 shadow-lg">
                  <p className="text-lg font-mono font-extrabold text-amber-400">{playlist.videoCount}</p>
                  <p className="text-[9px] text-white/80 uppercase font-bold tracking-widest">Videos</p>
                </div>
              </div>
            </div>

            {/* Description Details */}
            <div className="p-5 space-y-3 flex-grow flex flex-col justify-between text-left">
              <div className="space-y-1.5">
                <h3 className="font-serif text-base font-bold text-zinc-100 group-hover:text-amber-400 transition-colors">
                  {playlist.title}
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  {playlist.description}
                </p>
              </div>

              <div className="pt-3 border-t border-zinc-800/60 flex items-center justify-between">
                <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">
                  @MusicMadras Curated
                </span>
                
                <span
                  className="inline-flex items-center gap-1 text-xs font-bold text-[#FF0000] group-hover:text-[#FF3333] transition-colors rounded px-1.5 py-0.5"
                >
                  <Youtube className="w-3.5 h-3.5" fill="currentColor" />
                  Open Playlist
                </span>
              </div>
            </div>

          </a>
        ))}
      </div>

    </section>
  );
}
