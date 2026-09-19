import React from 'react';
import { 
  Play, 
  Plus, 
  UserPlus, 
  Clock, 
  AlertTriangle, 
  Inbox,
  Sparkles,
  FileText,
  CheckCircle,
  Activity,
  ArrowRight
} from 'lucide-react';
import { RecordingDraft, AuditLog, WorkspaceNotification } from './types';

interface DashboardHomeProps {
  recordings: RecordingDraft[];
  logs: AuditLog[];
  notifications: WorkspaceNotification[];
  onNavigate: (tab: string) => void;
  onSelectRecording: (id: string) => void;
  onTriggerIngest: () => void;
  onOpenInvite: () => void;
  currentUser: { email: string; role: string; name: string };
  markNotificationRead: (id: string) => void;
}

export default function DashboardHome({
  recordings,
  logs,
  notifications,
  onNavigate,
  onSelectRecording,
  onTriggerIngest,
  onOpenInvite,
  currentUser,
  markNotificationRead
}: DashboardHomeProps) {

  // Group recordings by status
  const pendingUploads = recordings.filter(r => r.status === 'Detected');
  const metadataRequired = recordings.filter(r => r.status === 'Metadata Required');
  const draftRecordings = recordings.filter(r => r.status === 'Draft');
  const readyToPublish = recordings.filter(r => r.status === 'In Review' || r.status === 'Ready to Publish');
  const recentlyPublished = recordings.filter(r => r.status === 'Published').slice(0, 5);

  const whatToWorkOn = [
    ...metadataRequired,
    ...draftRecordings,
    ...pendingUploads
  ].slice(0, 5);

  return (
    <div className="space-y-6 text-left animate-fade-in text-xs text-zinc-300">
      
      {/* Editorial Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-850 pb-5">
        <div>
          <h1 className="font-serif text-xl md:text-2xl font-extrabold text-zinc-100 tracking-tight">
            Editorial Cockpit
          </h1>
          <p className="text-[11px] text-zinc-400 mt-1">
            Welcome, <span className="text-zinc-200 font-bold">{currentUser.name}</span> • Role: <span className="text-amber-500 font-bold">{currentUser.role}</span>
          </p>
        </div>

        {/* Quick Actions */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={onTriggerIngest}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-zinc-950 font-bold rounded-lg transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Ingest YouTube Uploads
          </button>
          <button
            onClick={onOpenInvite}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-750 text-zinc-300 border border-zinc-750 font-bold rounded-lg transition-colors cursor-pointer"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Invite Contributor
          </button>
        </div>
      </div>

      {/* Task Categorization Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Panel: Primary Work Queue ("What should I work on today?") */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-xs uppercase tracking-widest font-extrabold text-zinc-400 flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-amber-500" />
            What should I work on today?
          </h2>

          {whatToWorkOn.length === 0 ? (
            <div className="p-8 bg-zinc-900/10 border border-dashed border-zinc-800 rounded-xl text-center space-y-2">
              <CheckCircle className="w-8 h-8 text-emerald-500 mx-auto" />
              <p className="font-bold text-zinc-200">Work Queue Cleared!</p>
              <p className="text-[10px] text-zinc-500">Every captured recording is fully catalogued and mapped.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {whatToWorkOn.map(rec => (
                <div
                  key={rec.id}
                  onClick={() => onSelectRecording(rec.id)}
                  className="bg-zinc-900/20 hover:bg-zinc-900/50 border border-zinc-850 hover:border-amber-500/20 p-4 rounded-xl flex items-center justify-between gap-4 cursor-pointer transition-all"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-[8px] font-extrabold font-mono uppercase px-1.5 py-0.5 rounded ${
                        rec.status === 'Detected' ? 'bg-red-500/10 text-red-400' :
                        rec.status === 'Metadata Required' ? 'bg-amber-500/10 text-amber-400' :
                        'bg-zinc-800 text-zinc-400'
                      }`}>
                        {rec.status}
                      </span>
                      <span className="text-[10px] text-zinc-500 font-mono">{rec.duration}</span>
                    </div>
                    <h3 className="font-bold text-zinc-200 leading-snug">{rec.title}</h3>
                    <p className="text-[10px] text-zinc-500 line-clamp-1">Artist: {rec.artist}</p>
                  </div>

                  <ArrowRight className="w-4 h-4 text-zinc-600 flex-shrink-0" />
                </div>
              ))}
            </div>
          )}

          {/* Quick Stats Summary List (Change 8: Clean visual summary, no graphs/widgets) */}
          <div className="border-t border-zinc-850 pt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div className="p-3 bg-zinc-900/10 border border-zinc-850 rounded-lg">
              <span className="text-[9px] font-mono text-zinc-500 block uppercase font-bold">Unprocessed</span>
              <span className="text-sm font-bold text-zinc-200">{pendingUploads.length}</span>
            </div>
            <div className="p-3 bg-zinc-900/10 border border-zinc-850 rounded-lg">
              <span className="text-[9px] font-mono text-zinc-500 block uppercase font-bold">Needs Metadata</span>
              <span className="text-sm font-bold text-zinc-200">{metadataRequired.length}</span>
            </div>
            <div className="p-3 bg-zinc-900/10 border border-zinc-850 rounded-lg">
              <span className="text-[9px] font-mono text-zinc-500 block uppercase font-bold">Drafts</span>
              <span className="text-sm font-bold text-zinc-200">{draftRecordings.length}</span>
            </div>
            <div className="p-3 bg-zinc-900/10 border border-zinc-850 rounded-lg">
              <span className="text-[9px] font-mono text-zinc-500 block uppercase font-bold">In Review</span>
              <span className="text-sm font-bold text-zinc-200">{readyToPublish.length}</span>
            </div>
          </div>
        </div>

        {/* Right Panel: Recent Notifications & Activity Stream */}
        <div className="space-y-6">
          
          {/* Notifications */}
          <div className="space-y-3">
            <h2 className="text-xs uppercase tracking-widest font-extrabold text-zinc-400 flex items-center gap-1.5">
              <Inbox className="w-4 h-4 text-amber-500" />
              Notifications
            </h2>

            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {notifications.filter(n => !n.read).length === 0 ? (
                <div className="p-4 bg-zinc-900/10 border border-zinc-850 rounded-lg text-center text-zinc-500 italic text-[11px]">
                  No unread notifications.
                </div>
              ) : (
                notifications.filter(n => !n.read).map(notif => (
                  <div
                    key={notif.id}
                    className="p-3 bg-zinc-900/20 border border-zinc-850 rounded-lg text-[11px] leading-snug space-y-1 relative"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`font-bold uppercase text-[8px] ${
                        notif.type === 'warning' ? 'text-amber-500' :
                        notif.type === 'success' ? 'text-emerald-400' :
                        'text-zinc-400'
                      }`}>
                        {notif.title}
                      </span>
                      <button
                        onClick={() => markNotificationRead(notif.id)}
                        className="text-[9px] text-zinc-500 hover:text-zinc-300 font-bold cursor-pointer"
                      >
                        Dismiss
                      </button>
                    </div>
                    <p className="text-zinc-300">{notif.message}</p>
                    <span className="text-[9px] text-zinc-600 font-mono block">{notif.date}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Recently Published */}
          <div className="space-y-3">
            <h2 className="text-xs uppercase tracking-widest font-extrabold text-zinc-400 flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              Recently Published
            </h2>

            <div className="space-y-2">
              {recentlyPublished.length === 0 ? (
                <div className="p-4 bg-zinc-900/10 border border-zinc-850 rounded-lg text-center text-zinc-500 italic text-[11px]">
                  No recently published recordings.
                </div>
              ) : (
                recentlyPublished.map(rec => (
                  <div
                    key={rec.id}
                    onClick={() => onSelectRecording(rec.id)}
                    className="p-3 bg-zinc-900/10 hover:bg-zinc-900/30 border border-zinc-850 rounded-lg flex items-center justify-between gap-3 cursor-pointer transition-colors"
                  >
                    <div className="truncate">
                      <h4 className="font-bold text-zinc-200 truncate">{rec.title}</h4>
                      <span className="text-[9px] text-zinc-500 font-mono">Published recently</span>
                    </div>
                    <ArrowRight className="w-3 h-3 text-zinc-500" />
                  </div>
                ))
              )}
            </div>
          </div>

        </div>

      </div>

    </div>
  );
}
