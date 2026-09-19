import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  Inbox, 
  Music, 
  Database, 
  Image as ImageIcon, 
  Users, 
  Settings as SettingsIcon, 
  LogOut,
  Search
} from 'lucide-react';

import { 
  RecordingDraft, 
  AuditLog, 
  WorkspaceNotification, 
  StudioUser, 
  StudioRole, 
  RecordingStatus 
} from './types';

import DashboardHome from './DashboardHome';
import IngestionLayer from './IngestionLayer';
import EditorialConsole from './EditorialConsole';
import RecordingsList from './RecordingsList';
import EntitiesManager from './EntitiesManager';
import MediaLibrary from './MediaLibrary';
import RoleManagement from './RoleManagement';
import Settings from './Settings';
import StudioAuth from './StudioAuth';
import RecordingDetails from './RecordingDetails';

import { VIDEOS_DATA } from '../../data';

interface MusicMadrasStudioProps {
  onPublishPack: (recording: RecordingDraft) => void;
  publishedPacks: RecordingDraft[];
}

interface SearchResult {
  id: string;
  type: 'Composer' | 'Work' | 'Recording' | 'Venue' | 'Choir' | 'Conductor' | 'Programme';
  name: string;
  detail: string;
  associatedRecordingId: string;
}

export default function MusicMadrasStudio({ onPublishPack, publishedPacks }: MusicMadrasStudioProps) {
  // Authentication State
  const [activeUser, setActiveUser] = useState<{ email: string; role: string; name: string } | null>(null);

  // CHANGE 7: Sidebar simplified tabs
  const [activeTab, setActiveTab] = useState<'dashboard' | 'uploads' | 'recordings' | 'entities' | 'media' | 'users' | 'settings'>('dashboard');

  // Currently opened Recording for direct editorial linkage
  const [selectedRecordingId, setSelectedRecordingId] = useState<string | null>(null);
  const [isEditingPublished, setIsEditingPublished] = useState<boolean>(false);

  // Global search state
  const [globalSearchTerm, setGlobalSearchTerm] = useState('');
  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);

  // Auto-reset edit mode when recording changes
  useEffect(() => {
    setIsEditingPublished(false);
  }, [selectedRecordingId]);

  const getGlobalSearchResults = (): SearchResult[] => {
    if (!globalSearchTerm.trim()) return [];
    const query = globalSearchTerm.toLowerCase();
    const resultsMap = new Map<string, SearchResult>();

    recordings.forEach(r => {
      // 1. Recordings Search
      if (r.title.toLowerCase().includes(query) || (r.description && r.description.toLowerCase().includes(query))) {
        const key = `recording-${r.id}`;
        if (!resultsMap.has(key)) {
          resultsMap.set(key, {
            id: r.id,
            type: 'Recording',
            name: r.title,
            detail: `Artist: ${r.artist} | Duration: ${r.duration}`,
            associatedRecordingId: r.id
          });
        }
      }

      // 2. Composer Search
      if (r.works) {
        r.works.forEach(w => {
          if (w.composerName && w.composerName.toLowerCase().includes(query)) {
            const key = `composer-${w.composerName}`;
            if (!resultsMap.has(key)) {
              resultsMap.set(key, {
                id: `comp-${w.composerName}`,
                type: 'Composer',
                name: w.composerName,
                detail: `Historical Era: ${w.composerEra || 'Baroque'} Era Master`,
                associatedRecordingId: r.id
              });
            }
          }
        });
      }

      // 3. Work Search
      if (r.works) {
        r.works.forEach(w => {
          if (w.title && w.title.toLowerCase().includes(query)) {
            const key = `work-${w.title}`;
            if (!resultsMap.has(key)) {
              resultsMap.set(key, {
                id: `work-${w.title}`,
                type: 'Work',
                name: w.title,
                detail: `Composer: ${w.composerName}${w.catalogueNumber ? ` (${w.catalogueNumber})` : ''}`,
                associatedRecordingId: r.id
              });
            }
          }
        });
      }

      // 4. Venue Search
      if (r.venue && r.venue.name && r.venue.name.toLowerCase().includes(query)) {
        const key = `venue-${r.venue.name}`;
        if (!resultsMap.has(key)) {
          resultsMap.set(key, {
            id: `venue-${r.venue.name}`,
            type: 'Venue',
            name: r.venue.name,
            detail: r.venue.acousticProfile || 'Historical Venue with Unique Decay',
            associatedRecordingId: r.id
          });
        }
      }

      // 5. Choir Search
      if (r.participants && r.participants.choir && r.participants.choir.toLowerCase().includes(query)) {
        const key = `choir-${r.participants.choir}`;
        if (!resultsMap.has(key)) {
          resultsMap.set(key, {
            id: `choir-${r.participants.choir}`,
            type: 'Choir',
            name: r.participants.choir,
            detail: 'Vocal Ensemble Choir',
            associatedRecordingId: r.id
          });
        }
      }

      // 6. Conductor Search
      if (r.participants && r.participants.conductor && r.participants.conductor.toLowerCase().includes(query)) {
        const key = `conductor-${r.participants.conductor}`;
        if (!resultsMap.has(key)) {
          resultsMap.set(key, {
            id: `conductor-${r.participants.conductor}`,
            type: 'Conductor',
            name: r.participants.conductor,
            detail: 'Concert Conducting Direction',
            associatedRecordingId: r.id
          });
        }
      }

      // 7. Programme Search
      if (r.programme && r.programme.programmeTitle && r.programme.programmeTitle.toLowerCase().includes(query)) {
        const key = `programme-${r.programme.programmeTitle}`;
        if (!resultsMap.has(key)) {
          resultsMap.set(key, {
            id: `prog-${r.programme.programmeTitle}`,
            type: 'Programme',
            name: r.programme.programmeTitle,
            detail: `Concert sequence featuring ${r.works?.length || 0} work(s)`,
            associatedRecordingId: r.id
          });
        }
      }
    });

    return Array.from(resultsMap.values());
  };

  // Core Repositories State
  const [recordings, setRecordings] = useState<RecordingDraft[]>([]);
  const [users, setUsers] = useState<StudioUser[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [notifications, setNotifications] = useState<WorkspaceNotification[]>([]);

  // Seed baseline repositories once upon activation
  useEffect(() => {
    // 1. Seed Recordings by mapping the static public video data
    const initialRecordings: RecordingDraft[] = VIDEOS_DATA.map((vid, idx) => {
      let status: RecordingStatus = 'Published';
      if (idx === 0) status = 'Metadata Required';
      if (idx === 1) status = 'Draft';
      if (idx === 3) status = 'Metadata Required';

      return {
        id: vid.id,
        youtubeId: vid.youtubeId,
        title: vid.title,
        artist: vid.artist,
        duration: vid.duration,
        publishedAt: vid.publishedAt,
        description: vid.description,
        status: status,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isPublic: true,
        programme: {
          programmeTitle: 'Classical Concert Selection',
          concertOrder: idx + 1,
          intermission: false,
          programmeNotes: 'Archived live recording capturing natural ambient room acoustics.'
        },
        works: [
          {
            title: vid.title.split('|')[0].trim(),
            composerName: idx % 2 === 0 ? 'Johann Sebastian Bach' : 'Augustine Paul',
            catalogueNumber: idx % 2 === 0 ? 'BWV 542' : 'Trad.'
          }
        ],
        venue: {
          name: idx % 2 === 0 ? "St. Andrew's Church (The Kirk)" : "Emmanuel Methodist Church",
          acousticProfile: "Highly reverberant historical brick dome (approx 3.2s decay time)",
          address: "Egmore, Chennai"
        },
        participants: {
          organist: idx % 2 === 0 ? 'Jeremiah Christopher' : 'Augustine Paul',
          choir: vid.artist,
          conductor: idx % 2 === 0 ? 'Alvin Arumugam' : 'Augustine Paul'
        },
        educationalContent: {
          difficultyLevel: 'INTERMEDIATE',
          listeningGuide: '0:00 Opening, 2:15 Theme presentation'
        },
        mediaAssets: {
          youtubeId: vid.youtubeId,
          masterAudioUrl: `/media/audio/${vid.id}-master.wav`,
          programmePdfUrl: '/media/booklets/concert-program.pdf'
        },
        seo: {
          metaTitle: `${vid.title} | Music Madras Archive`,
          metaDescription: vid.description,
          canonicalUrl: `https://www.musicmadras.com/recordings/${vid.id}`
        },
        relationships: []
      };
    });
    setRecordings(initialRecordings);

    // 2. Seed Directory team members
    const initialUsers: StudioUser[] = [
      {
        id: 'usr-1',
        name: 'Sanjay Hypersonic',
        email: 'sanjay.hypersonic@gmail.com',
        role: 'Founder',
        twoFactorEnabled: true,
        createdAt: '2026-01-01'
      },
      {
        id: 'usr-2',
        name: 'Alistair David',
        email: 'alistair@musicmadras.com',
        role: 'Super Administrator',
        twoFactorEnabled: true,
        createdAt: '2026-02-15'
      },
      {
        id: 'usr-3',
        name: 'Augustine Paul',
        email: 'augustine@musicmadras.com',
        role: 'Editor',
        twoFactorEnabled: false,
        createdAt: '2026-03-01'
      }
    ];
    setUsers(initialUsers);

    // 3. Seed Audit Log trails
    const initialLogs: AuditLog[] = [
      {
        id: 'log-1',
        timestamp: '2026-07-04T10:15:30Z',
        userEmail: 'sanjay.hypersonic@gmail.com',
        role: 'Founder',
        action: 'Authenticated via secure SSO gateway (MFA Verified)',
        targetId: 'session',
        targetName: 'Studio Core Console'
      },
      {
        id: 'log-2',
        timestamp: '2026-07-04T09:42:10Z',
        userEmail: 'alistair@musicmadras.com',
        role: 'Super Administrator',
        action: 'Ingested raw YouTube stream capture',
        targetId: 'vid-3',
        targetName: 'The best of Mozart and Verdi | SASO'
      },
      {
        id: 'log-3',
        timestamp: '2026-07-04T08:12:05Z',
        userEmail: 'augustine@musicmadras.com',
        role: 'Editor',
        action: 'Linked canonical Composer node J.S. Bach',
        targetId: 'composer-bach',
        targetName: 'Johann Sebastian Bach'
      }
    ];
    setLogs(initialLogs);

    // 4. Seed system notifications
    const initialNotifications: WorkspaceNotification[] = [
      {
        id: 'notif-1',
        type: 'warning',
        title: 'Metadata Connection Required',
        message: 'The newly ingested recording (vid-1) is missing an acoustic venue mapping node.',
        date: '2 hours ago',
        read: false
      },
      {
        id: 'notif-2',
        type: 'success',
        title: 'Security Sync Completed',
        message: 'Daily encrypted backup and audit log lock completed with zero integrity errors.',
        date: '1 day ago',
        read: false
      }
    ];
    setNotifications(initialNotifications);
  }, []);

  const handleLoginSuccess = (user: { email: string; role: string; name: string }) => {
    setActiveUser(user);
    // Write audit log entry
    const newLog: AuditLog = {
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString(),
      userEmail: user.email,
      role: user.role as any,
      action: 'Authenticated successfully via email (MFA Token Accepted)',
      targetId: 'session',
      targetName: 'Studio Core Console'
    };
    setLogs(prev => [newLog, ...prev]);
  };

  const handleLogout = () => {
    if (activeUser) {
      const logoutLog: AuditLog = {
        id: `log-${Date.now()}`,
        timestamp: new Date().toISOString(),
        userEmail: activeUser.email,
        role: activeUser.role as any,
        action: 'Terminated active session cleanly',
        targetId: 'session',
        targetName: 'Studio Core Console'
      };
      setLogs(prev => [logoutLog, ...prev]);
    }
    setActiveUser(null);
  };

  // Ingest video from queue
  const handleIngestNewRecording = (item: {
    youtubeId: string;
    title: string;
    artist: string;
    duration: string;
    description: string;
  }) => {
    const newRec: RecordingDraft = {
      id: `vid-${Date.now()}`,
      youtubeId: item.youtubeId,
      title: item.title,
      artist: item.artist,
      duration: item.duration,
      publishedAt: 'Just now',
      description: item.description,
      status: 'Draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isPublic: true,
      programme: {
        programmeTitle: 'Concert Performance',
        concertOrder: 1,
        intermission: false
      },
      works: [
        {
          title: item.title,
          composerName: item.artist
        }
      ],
      venue: {
        name: "St. Andrew's Church (The Kirk)"
      },
      seo: {
        metaTitle: `${item.title} | Music Madras Archive`,
        metaDescription: item.description,
        canonicalUrl: `https://www.musicmadras.com/recordings/${item.youtubeId}`
      },
      relationships: []
    };

    setRecordings(prev => [newRec, ...prev]);

    // Create Audit Log
    const newLog: AuditLog = {
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString(),
      userEmail: activeUser?.email || 'system',
      role: (activeUser?.role as any) || 'Editor',
      action: 'Generated Draft Recording from YouTube ingestion hook',
      targetId: newRec.id,
      targetName: newRec.title
    };
    setLogs(prev => [newLog, ...prev]);

    // Create Notification
    const newNotif: WorkspaceNotification = {
      id: `notif-${Date.now()}`,
      type: 'info',
      title: 'Draft Recording Spawned',
      message: `A new metadata draft was generated for "${newRec.title}". Open the Editorial Console to link entities.`,
      date: 'Just now',
      read: false
    };
    setNotifications(prev => [newNotif, ...prev]);

    setSelectedRecordingId(newRec.id);
  };

  const handleUpdateRecording = (updated: RecordingDraft) => {
    setRecordings(prev => prev.map(r => r.id === updated.id ? updated : r));
    
    // Add audit trail for modification
    const newLog: AuditLog = {
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString(),
      userEmail: activeUser?.email || 'system',
      role: (activeUser?.role as any) || 'Editor',
      action: `Saved updated metadata draft (Status: ${updated.status})`,
      targetId: updated.id,
      targetName: updated.title
    };
    setLogs(prev => [newLog, ...prev]);
  };

  const handlePublishRecordingAction = (recordingId: string) => {
    const target = recordings.find(r => r.id === recordingId);
    if (!target) return;

    const published: RecordingDraft = {
      ...target,
      status: 'Published',
      updatedAt: new Date().toISOString()
    };

    // Update locally
    setRecordings(prev => prev.map(r => r.id === recordingId ? published : r));

    // Trigger parent callback to publish to global/main site lists
    onPublishPack(published);

    // Create Audit Log for publishing
    const newLog: AuditLog = {
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString(),
      userEmail: activeUser?.email || 'system',
      role: (activeUser?.role as any) || 'Editor',
      action: 'Committed relational metadata layout to production web registry',
      targetId: target.id,
      targetName: target.title
    };
    setLogs(prev => [newLog, ...prev]);

    // Notification
    const newNotif: WorkspaceNotification = {
      id: `notif-${Date.now()}`,
      type: 'success',
      title: 'Knowledge Object Launched',
      message: `"${target.title}" is now successfully published in the public registry.`,
      date: 'Just now',
      read: false
    };
    setNotifications(prev => [newNotif, ...prev]);

    setSelectedRecordingId(null);
    setActiveTab('dashboard');
  };

  const handleInviteUser = (email: string, role: StudioRole, name: string) => {
    const newUser: StudioUser = {
      id: `usr-${Date.now()}`,
      name,
      email,
      role,
      twoFactorEnabled: false,
      createdAt: new Date().toISOString().split('T')[0]
    };
    setUsers(prev => [...prev, newUser]);

    // Log the invite operation
    const inviteLog: AuditLog = {
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString(),
      userEmail: activeUser?.email || 'system',
      role: (activeUser?.role as any) || 'Founder',
      action: `Provisioned and issued secure invite code for ${name} (${role})`,
      targetId: newUser.id,
      targetName: newUser.email
    };
    setLogs(prev => [inviteLog, ...prev]);
  };

  const handleRevokeUser = (id: string) => {
    const targetUser = users.find(u => u.id === id);
    if (!targetUser) return;

    setUsers(prev => prev.filter(u => u.id !== id));

    // Log user revocation
    const revokeLog: AuditLog = {
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString(),
      userEmail: activeUser?.email || 'system',
      role: (activeUser?.role as any) || 'Founder',
      action: `Revoked access tokens and purged session keys for user ${targetUser.name}`,
      targetId: targetUser.id,
      targetName: targetUser.email
    };
    setLogs(prev => [revokeLog, ...prev]);
  };

  const handleMarkNotificationRead = (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  // If not authenticated, render Auth Portal
  if (!activeUser) {
    return <StudioAuth onLoginSuccess={handleLoginSuccess} />;
  }

  // Active editable recording object
  const activeRecording = selectedRecordingId ? recordings.find(r => r.id === selectedRecordingId) : null;

  return (
    <div className="w-full max-w-7xl mx-auto min-h-[700px] flex flex-col md:flex-row gap-6 text-left p-2 md:p-6 animate-fade-in">
      
      {/* Studio Navigation Sidebar */}
      <div className="w-full md:w-60 flex-shrink-0 flex flex-col justify-between bg-zinc-900/10 border border-zinc-850 rounded-2xl p-4 space-y-6 h-fit md:sticky md:top-24">
        <div className="space-y-6">
          <div className="flex items-center gap-2 border-b border-zinc-850 pb-4">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center font-serif text-zinc-950 font-black text-sm">
              M
            </div>
            <div>
              <h2 className="text-xs font-bold text-zinc-200 uppercase tracking-widest">
                Music Madras
              </h2>
              <p className="text-[10px] text-zinc-500 font-mono">
                Studio Platform v2.0
              </p>
            </div>
          </div>

          {/* Global Entity Search */}
          <div className="relative text-xs">
            <div className="relative">
              <input
                type="text"
                value={globalSearchTerm}
                onChange={(e) => {
                  setGlobalSearchTerm(e.target.value);
                  setIsGlobalSearchOpen(true);
                }}
                onFocus={() => setIsGlobalSearchOpen(true)}
                placeholder="Search MMKE Knowledge..."
                className="w-full bg-zinc-950/60 border border-zinc-850 p-2.5 rounded-xl text-zinc-200 focus:outline-none focus:border-amber-500 pl-8 text-[11px]"
              />
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-3.5" />
              {globalSearchTerm && (
                <button
                  onClick={() => {
                    setGlobalSearchTerm('');
                    setIsGlobalSearchOpen(false);
                  }}
                  className="absolute right-2.5 top-2.5 text-zinc-500 hover:text-zinc-300 font-bold text-[13px]"
                >
                  ×
                </button>
              )}
            </div>

            {/* Floating results dropdown */}
            {isGlobalSearchOpen && globalSearchTerm.trim() && (
              <div className="absolute left-0 right-0 z-50 mt-1 max-h-72 overflow-y-auto bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl divide-y divide-zinc-850">
                {getGlobalSearchResults().length === 0 ? (
                  <div className="p-3 text-center text-zinc-500 italic text-[11px]">
                    No entities or recordings match "{globalSearchTerm}"
                  </div>
                ) : (
                  getGlobalSearchResults().map((res) => (
                    <button
                      key={`${res.type}-${res.id}`}
                      onClick={() => {
                        setSelectedRecordingId(res.associatedRecordingId);
                        setGlobalSearchTerm('');
                        setIsGlobalSearchOpen(false);
                        
                        // Add to log
                        const searchLog: AuditLog = {
                          id: `log-${Date.now()}`,
                          timestamp: new Date().toISOString(),
                          userEmail: activeUser.email,
                          role: activeUser.role as any,
                          action: `Discovered entity link via Global Search (${res.type}: ${res.name})`,
                          targetId: res.associatedRecordingId,
                          targetName: res.name
                        };
                        setLogs(prev => [searchLog, ...prev]);
                      }}
                      className="w-full text-left p-2.5 hover:bg-zinc-850 flex flex-col gap-0.5 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-zinc-200 truncate max-w-[130px]">{res.name}</span>
                        <span className="text-[8px] font-extrabold uppercase bg-amber-500/10 text-amber-400 px-1 py-0.2 rounded border border-amber-500/20 font-mono scale-90">
                          {res.type}
                        </span>
                      </div>
                      <p className="text-[9px] text-zinc-500 truncate">{res.detail}</p>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Navigation Links */}
          <div className="flex flex-col gap-1 text-xs">
            {[
              { id: 'dashboard', label: 'Dashboard Cockpit', icon: LayoutDashboard },
              { id: 'uploads', label: 'Upload Queue', icon: Inbox },
              { id: 'recordings', label: 'Recordings', icon: Music },
              { id: 'entities', label: 'Entities', icon: Database },
              { id: 'media', label: 'Media Library', icon: ImageIcon },
              { id: 'users', label: 'Users', icon: Users },
              { id: 'settings', label: 'Settings', icon: SettingsIcon }
            ].map(item => {
              const Icon = item.icon;
              const active = activeTab === item.id && !selectedRecordingId;
              
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setSelectedRecordingId(null);
                    setActiveTab(item.id as any);
                  }}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl font-bold text-left transition-all cursor-pointer ${
                    active 
                      ? 'bg-amber-500 text-zinc-950 shadow-md shadow-amber-500/10' 
                      : 'text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200'
                  }`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* User Info & Logout button */}
        <div className="border-t border-zinc-850 pt-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-xs">
            <div className="w-7 h-7 rounded-full bg-zinc-800 flex items-center justify-center font-bold text-xs text-amber-500 uppercase">
              {activeUser.name.charAt(0)}
            </div>
            <div className="truncate max-w-[120px]">
              <span className="text-[11px] font-bold text-zinc-200 block truncate leading-none">
                {activeUser.name}
              </span>
              <span className="text-[9px] text-zinc-500 font-mono truncate uppercase font-bold">
                {activeUser.role}
              </span>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center justify-center gap-1.5 w-full py-1.5 bg-zinc-900 hover:bg-red-500/10 text-zinc-400 hover:text-red-400 border border-zinc-850 hover:border-red-500/25 text-[10px] font-bold rounded-lg transition-all cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Terminate Session
          </button>
        </div>
      </div>

      {/* Main Panel Content Area */}
      <div className="flex-grow min-w-0">
        {activeRecording ? (
          activeRecording.status === 'Published' && !isEditingPublished ? (
            <RecordingDetails
              recording={activeRecording}
              logs={logs}
              onClose={() => setSelectedRecordingId(null)}
              onEdit={() => setIsEditingPublished(true)}
            />
          ) : (
            <EditorialConsole
              recording={activeRecording}
              onUpdateRecording={handleUpdateRecording}
              onClose={() => {
                setSelectedRecordingId(null);
                setIsEditingPublished(false);
              }}
              onPublish={(recId) => {
                handlePublishRecordingAction(recId);
                setIsEditingPublished(false);
              }}
            />
          )
        ) : (
          <>
            {activeTab === 'dashboard' && (
              <DashboardHome
                recordings={recordings}
                logs={logs}
                notifications={notifications}
                onNavigate={(tab) => setActiveTab(tab as any)}
                onSelectRecording={setSelectedRecordingId}
                onTriggerIngest={() => setActiveTab('uploads')}
                onOpenInvite={() => setActiveTab('users')}
                currentUser={activeUser}
                markNotificationRead={handleMarkNotificationRead}
              />
            )}

            {activeTab === 'uploads' && (
              <IngestionLayer
                recordings={recordings}
                onIngestNew={handleIngestNewRecording}
                onSelectRecording={setSelectedRecordingId}
              />
            )}

            {activeTab === 'recordings' && (
              <RecordingsList
                recordings={recordings}
                onSelectRecording={setSelectedRecordingId}
              />
            )}

            {activeTab === 'entities' && (
              <EntitiesManager />
            )}

            {activeTab === 'media' && (
              <MediaLibrary />
            )}

            {activeTab === 'users' && (
              <RoleManagement
                users={users}
                onInviteUser={handleInviteUser}
                onRevokeUser={handleRevokeUser}
                currentUser={activeUser}
              />
            )}

            {activeTab === 'settings' && (
              <Settings logs={logs} />
            )}
          </>
        )}
      </div>

    </div>
  );
}
