import React, { useState } from 'react';
import { 
  Music, 
  Search, 
  Filter, 
  ArrowRight, 
  CheckCircle, 
  AlertCircle,
  FileText,
  Clock,
  Play
} from 'lucide-react';
import { RecordingDraft } from './types';

interface RecordingsListProps {
  recordings: RecordingDraft[];
  onSelectRecording: (id: string) => void;
}

export default function RecordingsList({ recordings, onSelectRecording }: RecordingsListProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filtered = recordings.filter(rec => {
    const matchesSearch = rec.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          rec.artist.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || rec.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6 text-left animate-fade-in text-xs text-zinc-300">
      
      {/* Header */}
      <div className="border-b border-zinc-850 pb-5">
        <h2 className="font-serif text-xl md:text-2xl font-extrabold text-zinc-100">
          Recordings Database
        </h2>
        <p className="text-[11px] text-zinc-400 mt-1">
          Review, map metadata, or publish active concert captures in the Music Madras Platform.
        </p>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Status Pills */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
          {[
            { id: 'all', label: 'All Recordings' },
            { id: 'Published', label: 'Published' },
            { id: 'Draft', label: 'Draft' },
            { id: 'Metadata Required', label: 'Needs Metadata' },
            { id: 'Detected', label: 'Newly Ingested' }
          ].map(pill => {
            const active = statusFilter === pill.id;
            return (
              <button
                key={pill.id}
                onClick={() => setStatusFilter(pill.id)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold whitespace-nowrap transition-colors cursor-pointer ${
                  active 
                    ? 'bg-zinc-800 text-zinc-100 border border-zinc-750' 
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {pill.label}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="relative text-xs max-w-xs w-full">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search recordings..."
            className="w-full bg-zinc-900/40 border border-zinc-800 p-2 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500 pl-7"
          />
          <Search className="w-3 h-3 text-zinc-500 absolute left-2.5 top-2.5" />
        </div>
      </div>

      {/* Grid of Recordings */}
      {filtered.length === 0 ? (
        <div className="p-12 text-center text-zinc-500 italic bg-zinc-900/5 rounded-xl border border-zinc-850">
          No recordings found matching your search.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map(rec => (
            <div 
              key={rec.id}
              onClick={() => onSelectRecording(rec.id)}
              className="bg-zinc-900/10 hover:bg-zinc-900/30 border border-zinc-850 hover:border-amber-500/15 p-4 rounded-xl flex items-center justify-between gap-4 cursor-pointer transition-all text-xs"
            >
              <div className="space-y-1 truncate max-w-sm">
                <div className="flex items-center gap-2">
                  <span className={`text-[8px] font-extrabold uppercase px-2 py-0.5 rounded font-mono ${
                    rec.status === 'Published' ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-800/20' :
                    rec.status === 'Draft' ? 'bg-blue-900/40 text-blue-300 border border-blue-800/20' :
                    rec.status === 'Metadata Required' ? 'bg-amber-900/40 text-amber-300 border border-amber-800/20' :
                    'bg-zinc-800 text-zinc-400'
                  }`}>
                    {rec.status}
                  </span>
                  <span className="text-[10px] text-zinc-500 font-mono">{rec.duration}</span>
                </div>
                <h3 className="font-bold text-zinc-200 truncate leading-snug">{rec.title}</h3>
                <p className="text-[10px] text-zinc-400 truncate">Ensemble: {rec.artist}</p>
                {rec.venue?.name && (
                  <p className="text-[9px] text-zinc-500 truncate">Location: {rec.venue.name}</p>
                )}
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-[10px] text-zinc-500 hover:text-amber-500 font-bold">Edit metadata</span>
                <ArrowRight className="w-4 h-4 text-zinc-600" />
              </div>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}
