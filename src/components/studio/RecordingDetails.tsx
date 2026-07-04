import React from 'react';
import { 
  ArrowLeft, 
  Edit3, 
  Youtube, 
  Music, 
  MapPin, 
  Users, 
  BookOpen, 
  ImageIcon, 
  Globe, 
  Link as LinkIcon, 
  Clock, 
  FileText, 
  ShieldCheck,
  Download,
  Calendar,
  Layers,
  ChevronRight,
  Sparkles,
  Award
} from 'lucide-react';
import { RecordingDraft, AuditLog } from './types';

interface RecordingDetailsProps {
  recording: RecordingDraft;
  logs: AuditLog[];
  onClose: () => void;
  onEdit: (id: string) => void;
}

export default function RecordingDetails({ recording, logs, onClose, onEdit }: RecordingDetailsProps) {
  // Filter logs related to this recording
  const publishingHistory = logs.filter(
    log => log.targetId === recording.id || log.targetName === recording.title
  );

  return (
    <div className="space-y-8 text-left animate-fade-in text-xs text-zinc-300">
      
      {/* Editorial Navigation Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-850 pb-5">
        <div>
          <button
            onClick={onClose}
            className="text-xs text-zinc-500 hover:text-amber-500 hover:underline mb-2 flex items-center gap-1 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Registry List
          </button>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="font-serif text-xl md:text-2xl font-extrabold text-zinc-100 tracking-tight leading-tight">
              {recording.title}
            </h1>
            <span className="text-[9px] uppercase font-bold tracking-widest font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-0.5 rounded-full flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" />
              Published Archive Record
            </span>
          </div>
          <p className="text-[11px] text-zinc-500 mt-1">
            Archived to the Music Madras Knowledge Engine (MMKE) • ID: <span className="font-mono">{recording.id}</span>
          </p>
        </div>

        <button
          onClick={() => onEdit(recording.id)}
          className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-zinc-950 font-bold rounded-xl transition-all cursor-pointer shadow-md hover:scale-[1.02]"
        >
          <Edit3 className="w-4 h-4" />
          Edit Metadata Draft
        </button>
      </div>

      {/* Grid containing Metadata Modules */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column (Main Archival Details - 2 Cols span) */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* Module 1: The Core Recording & YouTube Embed */}
          <div className="bg-zinc-900/10 border border-zinc-850 rounded-2xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-zinc-850 pb-3">
              <h3 className="font-serif text-sm font-bold text-zinc-100 flex items-center gap-2">
                <Youtube className="w-4.5 h-4.5 text-red-500" />
                Recording Source Details
              </h3>
              <span className="text-[10px] text-zinc-500 font-mono font-bold">Duration: {recording.duration}</span>
            </div>

            {/* YouTube Embed mock placeholder or iframe if ID exists */}
            {recording.youtubeId ? (
              <div className="relative aspect-video rounded-xl overflow-hidden bg-black border border-zinc-850 group">
                <iframe
                  className="w-full h-full"
                  src={`https://www.youtube.com/embed/${recording.youtubeId}`}
                  title={recording.title}
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : (
              <div className="aspect-video rounded-xl bg-zinc-950 flex flex-col items-center justify-center border border-zinc-850 text-zinc-500 text-center p-6 space-y-2">
                <Youtube className="w-10 h-10 text-zinc-700" />
                <p className="font-bold">No Linked Video Embed</p>
              </div>
            )}

            <div className="space-y-2 leading-relaxed">
              <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider block">Description Context</span>
              <p className="text-[11px] text-zinc-300 whitespace-pre-wrap">{recording.description || 'No direct recording description available.'}</p>
            </div>
          </div>

          {/* Module 2: Linked Musical Works (Compositions) */}
          <div className="bg-zinc-900/10 border border-zinc-850 rounded-2xl p-6 space-y-5">
            <h3 className="font-serif text-sm font-bold text-zinc-100 flex items-center gap-2 border-b border-zinc-850 pb-3">
              <Music className="w-4.5 h-4.5 text-amber-500" />
              Linked Musical Works ({recording.works?.length || 0})
            </h3>

            {(!recording.works || recording.works.length === 0) ? (
              <p className="text-zinc-500 italic">No specific compositions associated with this archive record.</p>
            ) : (
              <div className="divide-y divide-zinc-850">
                {recording.works.map((work, index) => (
                  <div key={index} className="py-4 first:pt-0 last:pb-0 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <h4 className="font-bold text-zinc-100 text-sm">{work.title}</h4>
                        <p className="text-[10px] text-zinc-400 mt-0.5">
                          Composer: <span className="text-amber-500 font-bold">{work.composerName}</span>
                          {work.catalogueNumber && <span className="text-zinc-500 font-mono ml-1.5">({work.catalogueNumber})</span>}
                        </p>
                      </div>
                      {work.composerEra && (
                        <span className="px-2.5 py-0.5 rounded-md bg-zinc-850 text-[9px] font-bold text-zinc-300 font-mono self-start sm:self-center uppercase">
                          {work.composerEra} Era
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Module 3: Concert Programme Details */}
          {recording.programme && (
            <div className="bg-zinc-900/10 border border-zinc-850 rounded-2xl p-6 space-y-5">
              <h3 className="font-serif text-sm font-bold text-zinc-100 flex items-center gap-2 border-b border-zinc-850 pb-3">
                <FileText className="w-4.5 h-4.5 text-blue-400" />
                Concert Programme Architecture
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-1">
                  <span className="text-[9px] font-mono text-zinc-500 uppercase block font-bold">Programme Title</span>
                  <p className="font-bold text-zinc-200">{recording.programme.programmeTitle || 'Not recorded'}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-[9px] font-mono text-zinc-500 uppercase block font-bold">Concert Sequence Order</span>
                  <p className="font-bold text-zinc-200 font-mono">Position #{recording.programme.concertOrder || 1}</p>
                </div>

                {recording.programme.runningOrder && (
                  <div className="sm:col-span-2 space-y-1">
                    <span className="text-[9px] font-mono text-zinc-500 uppercase block font-bold">Running Order</span>
                    <p className="text-zinc-300 bg-zinc-950/40 p-2.5 border border-zinc-850 rounded-lg">{recording.programme.runningOrder}</p>
                  </div>
                )}

                {recording.programme.movements && (
                  <div className="sm:col-span-2 space-y-1">
                    <span className="text-[9px] font-mono text-zinc-500 uppercase block font-bold">Movements / Movements catalogued</span>
                    <p className="text-zinc-300 font-mono text-[10px] bg-zinc-950/40 p-2.5 border border-zinc-850 rounded-lg">{recording.programme.movements}</p>
                  </div>
                )}

                <div className="space-y-1">
                  <span className="text-[9px] font-mono text-zinc-500 uppercase block font-bold">Contains Intermission</span>
                  <p className="font-bold text-zinc-200">{recording.programme.intermission ? 'Yes, configured' : 'No Intermission'}</p>
                </div>

                {recording.programme.intermission && recording.programme.intermissionDetails && (
                  <div className="space-y-1">
                    <span className="text-[9px] font-mono text-zinc-500 uppercase block font-bold">Intermission Details</span>
                    <p className="text-zinc-300">{recording.programme.intermissionDetails}</p>
                  </div>
                )}

                {recording.programme.encore && (
                  <div className="sm:col-span-2 space-y-1">
                    <span className="text-[9px] font-mono text-zinc-500 uppercase block font-bold">Encore Performance</span>
                    <p className="text-emerald-400 font-bold font-serif">{recording.programme.encore}</p>
                  </div>
                )}

                {recording.programme.programmeNotes && (
                  <div className="sm:col-span-2 space-y-1 pt-2 border-t border-zinc-850">
                    <span className="text-[9px] font-mono text-zinc-500 uppercase block font-bold mb-1">Curation & Programme Notes</span>
                    <p className="text-zinc-300 leading-relaxed italic">{recording.programme.programmeNotes}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Module 4: Educational Content & Counterpoint Analysis */}
          {recording.educationalContent && (
            <div className="bg-zinc-900/10 border border-zinc-850 rounded-2xl p-6 space-y-5">
              <h3 className="font-serif text-sm font-bold text-zinc-100 flex items-center gap-2 border-b border-zinc-850 pb-3">
                <BookOpen className="w-4.5 h-4.5 text-emerald-400" />
                Educational Notes & Curation Study
              </h3>

              <div className="space-y-5">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="p-2.5 bg-zinc-950 rounded-lg border border-zinc-850 text-center">
                    <span className="text-[8px] font-mono text-zinc-500 block uppercase font-bold">Difficulty Rating</span>
                    <span className="text-[10px] font-bold text-amber-500 font-mono tracking-wider">{recording.educationalContent.difficultyLevel || 'BEGINNER'}</span>
                  </div>

                  {recording.educationalContent.listeningGuide && (
                    <div className="flex-grow p-2.5 bg-zinc-950 rounded-lg border border-zinc-850">
                      <span className="text-[8px] font-mono text-zinc-500 block uppercase font-bold">Timeline Navigation Guide</span>
                      <p className="text-[10px] font-mono text-zinc-300 mt-0.5">{recording.educationalContent.listeningGuide}</p>
                    </div>
                  )}
                </div>

                {recording.educationalContent.analysisMarkdown ? (
                  <div className="space-y-2 border-t border-zinc-850 pt-4 leading-relaxed">
                    <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider block font-bold">Scholarly Counterpoint Analysis</span>
                    <p className="text-[11px] text-zinc-300 whitespace-pre-wrap">{recording.educationalContent.analysisMarkdown}</p>
                  </div>
                ) : (
                  <p className="text-zinc-500 italic">No advanced counterpoint or historical structural analysis has been written yet.</p>
                )}
              </div>
            </div>
          )}

        </div>

        {/* Right Column (Sidebar Archive Details - 1 Col span) */}
        <div className="space-y-8">
          
          {/* Module 5: Physical Venue & Acoustics */}
          <div className="bg-zinc-900/10 border border-zinc-850 rounded-2xl p-5 space-y-4">
            <h3 className="font-serif text-xs font-bold text-zinc-200 flex items-center gap-1.5 border-b border-zinc-850 pb-2">
              <MapPin className="w-4 h-4 text-emerald-400" />
              Venue & Spatial Acoustics
            </h3>

            {recording.venue?.name ? (
              <div className="space-y-3">
                <div className="space-y-0.5">
                  <span className="text-[9px] font-mono text-zinc-500 uppercase block">Venue Node</span>
                  <p className="font-bold text-zinc-200 text-xs">{recording.venue.name}</p>
                </div>

                {recording.venue.acousticProfile && (
                  <div className="space-y-0.5">
                    <span className="text-[9px] font-mono text-zinc-500 uppercase block">Acoustic Room Profile</span>
                    <p className="text-zinc-300 text-[11px] leading-normal font-mono">{recording.venue.acousticProfile}</p>
                  </div>
                )}

                {recording.venue.address && (
                  <div className="space-y-0.5">
                    <span className="text-[9px] font-mono text-zinc-500 uppercase block">Spatial Address</span>
                    <p className="text-zinc-400 font-mono text-[10px]">{recording.venue.address}</p>
                  </div>
                )}

                {recording.venue.capacity && (
                  <div className="space-y-0.5">
                    <span className="text-[9px] font-mono text-zinc-500 uppercase block">Estimated Capacity</span>
                    <p className="text-zinc-300 font-mono text-[10px]">{recording.venue.capacity} seats</p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-zinc-500 italic">No physical venue mapped to this recording.</p>
            )}
          </div>

          {/* Module 6: Musicians & Participants */}
          <div className="bg-zinc-900/10 border border-zinc-850 rounded-2xl p-5 space-y-4">
            <h3 className="font-serif text-xs font-bold text-zinc-200 flex items-center gap-1.5 border-b border-zinc-850 pb-2">
              <Users className="w-4 h-4 text-amber-500" />
              Musicians & Participants
            </h3>

            {recording.participants ? (
              <div className="space-y-3">
                {recording.participants.organist && (
                  <div className="space-y-0.5">
                    <span className="text-[9px] font-mono text-zinc-500 uppercase block">Lead Organist / Instrumentalist</span>
                    <p className="font-bold text-zinc-200 flex items-center gap-1">
                      <Award className="w-3.5 h-3.5 text-amber-500" />
                      {recording.participants.organist}
                    </p>
                  </div>
                )}

                {recording.participants.choir && (
                  <div className="space-y-0.5">
                    <span className="text-[9px] font-mono text-zinc-500 uppercase block">Ensemble Choir</span>
                    <p className="font-bold text-zinc-200">{recording.participants.choir}</p>
                  </div>
                )}

                {recording.participants.conductor && (
                  <div className="space-y-0.5">
                    <span className="text-[9px] font-mono text-zinc-500 uppercase block">Conducting Direction</span>
                    <p className="font-bold text-zinc-200">{recording.participants.conductor}</p>
                  </div>
                )}

                {recording.participants.orchestra && (
                  <div className="space-y-0.5">
                    <span className="text-[9px] font-mono text-zinc-500 uppercase block">Supporting Orchestra</span>
                    <p className="font-bold text-zinc-200">{recording.participants.orchestra}</p>
                  </div>
                )}

                {recording.participants.soloists && (
                  <div className="space-y-0.5">
                    <span className="text-[9px] font-mono text-zinc-500 uppercase block">Featured Soloists</span>
                    <p className="text-zinc-300">{recording.participants.soloists}</p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-zinc-500 italic">No specific participants list mapped.</p>
            )}
          </div>

          {/* Module 7: Associated Media Assets */}
          {recording.mediaAssets && (
            <div className="bg-zinc-900/10 border border-zinc-850 rounded-2xl p-5 space-y-3">
              <h3 className="font-serif text-xs font-bold text-zinc-200 flex items-center gap-1.5 border-b border-zinc-850 pb-2">
                <ImageIcon className="w-4 h-4 text-blue-400" />
                Linked Digital Assets
              </h3>

              <div className="space-y-2">
                {recording.mediaAssets.masterAudioUrl && (
                  <div className="p-2 bg-zinc-950/60 border border-zinc-850 rounded-lg flex items-center justify-between">
                    <div className="truncate">
                      <span className="text-[8px] font-mono text-zinc-500 uppercase block leading-none">Master Stem Audio</span>
                      <span className="text-[10px] font-mono text-zinc-300 truncate block mt-0.5">{recording.mediaAssets.masterAudioUrl.split('/').pop()}</span>
                    </div>
                    <button className="p-1 hover:bg-zinc-850 text-zinc-400 hover:text-zinc-200 rounded">
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {recording.mediaAssets.programmePdfUrl && (
                  <div className="p-2 bg-zinc-950/60 border border-zinc-850 rounded-lg flex items-center justify-between">
                    <div className="truncate">
                      <span className="text-[8px] font-mono text-zinc-500 uppercase block leading-none">Concert Program Booklet</span>
                      <span className="text-[10px] font-mono text-zinc-300 truncate block mt-0.5">{recording.mediaAssets.programmePdfUrl.split('/').pop()}</span>
                    </div>
                    <button className="p-1 hover:bg-zinc-850 text-zinc-400 hover:text-zinc-200 rounded">
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {recording.mediaAssets.posterUrl && (
                  <div className="p-2 bg-zinc-950/60 border border-zinc-850 rounded-lg flex items-center justify-between">
                    <div className="truncate">
                      <span className="text-[8px] font-mono text-zinc-500 uppercase block leading-none">High-res Poster Graphics</span>
                      <span className="text-[10px] font-mono text-zinc-300 truncate block mt-0.5">{recording.mediaAssets.posterUrl.split('/').pop()}</span>
                    </div>
                    <button className="p-1 hover:bg-zinc-850 text-zinc-400 hover:text-zinc-200 rounded">
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {recording.mediaAssets.sheetMusicUrl && (
                  <div className="p-2 bg-zinc-950/60 border border-zinc-850 rounded-lg flex items-center justify-between">
                    <div className="truncate">
                      <span className="text-[8px] font-mono text-zinc-500 uppercase block leading-none">Sheet Music / score</span>
                      <span className="text-[10px] font-mono text-zinc-300 truncate block mt-0.5">{recording.mediaAssets.sheetMusicUrl.split('/').pop()}</span>
                    </div>
                    <button className="p-1 hover:bg-zinc-850 text-zinc-400 hover:text-zinc-200 rounded">
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Module 8: SEO & Schema Verification */}
          {recording.seo && (
            <div className="bg-zinc-900/10 border border-zinc-850 rounded-2xl p-5 space-y-3">
              <h3 className="font-serif text-xs font-bold text-zinc-200 flex items-center gap-1.5 border-b border-zinc-850 pb-2">
                <Globe className="w-4 h-4 text-emerald-400" />
                SEO & Crawler Snippet
              </h3>

              <div className="space-y-3 text-left">
                <div className="bg-zinc-950/60 border border-zinc-850 p-3 rounded-lg space-y-1">
                  <span className="text-[8px] text-emerald-400 font-mono block">Google Snippet Preview</span>
                  <p className="text-blue-400 font-bold hover:underline text-[11px] truncate leading-snug">
                    {recording.seo.metaTitle || `${recording.title} | Music Madras`}
                  </p>
                  <p className="text-emerald-600 font-mono text-[9px] truncate">{recording.seo.canonicalUrl || `https://www.musicmadras.com/...`}</p>
                  <p className="text-zinc-400 text-[10px] line-clamp-2 leading-snug mt-1">
                    {recording.seo.metaDescription || 'No description preview available.'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Module 9: Immutable Publishing History Logs */}
          <div className="bg-zinc-900/10 border border-zinc-850 rounded-2xl p-5 space-y-4">
            <h3 className="font-serif text-xs font-bold text-zinc-200 flex items-center gap-1.5 border-b border-zinc-850 pb-2">
              <Clock className="w-4 h-4 text-amber-500" />
              Archival Publishing History
            </h3>

            {publishingHistory.length === 0 ? (
              <p className="text-[10px] text-zinc-500 italic">No historical log entries saved for this recording in the current session.</p>
            ) : (
              <div className="space-y-3">
                {publishingHistory.map((log) => (
                  <div key={log.id} className="text-[10px] space-y-1 border-l-2 border-zinc-800 pl-3 py-0.5">
                    <div className="flex items-center justify-between text-zinc-500 text-[9px] font-mono">
                      <span>{log.userEmail.split('@')[0]} ({log.role})</span>
                      <span>{new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <p className="text-zinc-300 font-bold">{log.action}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

      </div>

    </div>
  );
}
