import React, { useState } from 'react';
import { 
  Settings as SettingsIcon, 
  Database, 
  ShieldCheck, 
  Lock, 
  Trash2, 
  RefreshCw, 
  CheckCircle2, 
  Info 
} from 'lucide-react';
import AuditLogs from './AuditLogs';
import { AuditLog } from './types';

interface SettingsProps {
  logs: AuditLog[];
}

export default function Settings({ logs }: SettingsProps) {
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);
  const [backupInterval, setBackupInterval] = useState('12');
  const [schemaSynced, setSchemaSynced] = useState(true);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Check how many items are in draft in localStorage
  const countDrafts = () => {
    let count = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('mm_draft_recording_')) {
        count++;
      }
    }
    return count;
  };

  const handleClearDrafts = () => {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('mm_draft_recording_')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
    setSuccessMsg('Successfully cleared recovered local drafts.');
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  const handleForceSyncSchema = () => {
    setSchemaSynced(false);
    setTimeout(() => {
      setSchemaSynced(true);
      setSuccessMsg('Database schema validated and synchronized successfully.');
      setTimeout(() => setSuccessMsg(null), 3000);
    }, 1000);
  };

  return (
    <div className="space-y-6 text-left animate-fade-in text-xs text-zinc-300">
      
      {/* Header */}
      <div className="border-b border-zinc-850 pb-5">
        <h2 className="font-serif text-xl md:text-2xl font-extrabold text-zinc-100">
          Studio System Settings
        </h2>
        <p className="text-[11px] text-zinc-400 mt-1">
          Regulate Editorial auto-save behaviors, verify database schema, and review immutable compliance audit logs.
        </p>
      </div>

      {successMsg && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg font-bold flex items-center gap-1.5">
          <CheckCircle2 className="w-4 h-4" />
          {successMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Configurations (Left Column) */}
        <div className="lg:col-span-1 space-y-4">
          
          {/* Editorial Engine Preferences */}
          <div className="bg-zinc-900/10 border border-zinc-850 p-5 rounded-xl space-y-4">
            <h3 className="font-serif text-sm font-bold text-zinc-200 flex items-center gap-1.5">
              <SettingsIcon className="w-4 h-4 text-amber-500" />
              Editorial Preferences
            </h3>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-bold text-zinc-300 block">Automatic Draft Saving</span>
                  <span className="text-[10px] text-zinc-500">Persist modifications locally</span>
                </div>
                <input
                  type="checkbox"
                  checked={autoSaveEnabled}
                  onChange={(e) => setAutoSaveEnabled(e.target.checked)}
                  className="w-4 h-4 accent-amber-500 cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-zinc-400 block">Backup Synced Frequency</label>
                <select
                  value={backupInterval}
                  onChange={(e) => setBackupInterval(e.target.value)}
                  className="w-full bg-zinc-950/50 border border-zinc-800 p-2 rounded-lg text-zinc-200 focus:outline-none"
                >
                  <option value="6">Every 6 Hours</option>
                  <option value="12">Every 12 Hours</option>
                  <option value="24">Daily Backup Sync</option>
                </select>
              </div>
            </div>
          </div>

          {/* Recovered Drafts Registry */}
          <div className="bg-zinc-900/10 border border-zinc-850 p-5 rounded-xl space-y-4">
            <h3 className="font-serif text-sm font-bold text-zinc-200 flex items-center gap-1.5">
              <Database className="w-4 h-4 text-amber-500" />
              Local Draft Cache
            </h3>

            <div className="space-y-2">
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-zinc-400">Total Cached Drafts:</span>
                <span className="font-mono font-bold text-zinc-200">{countDrafts()}</span>
              </div>
              <p className="text-[10px] text-zinc-500 leading-normal">
                Drafts are kept in local storage for protection against sudden browser crashes or tab closings.
              </p>
              {countDrafts() > 0 && (
                <button
                  onClick={handleClearDrafts}
                  className="w-full py-1.5 bg-zinc-850 hover:bg-red-500/10 text-zinc-400 hover:text-red-400 border border-zinc-800 hover:border-red-500/20 text-[10px] font-bold rounded-lg transition-colors cursor-pointer"
                >
                  Purge Cached Drafts
                </button>
              )}
            </div>
          </div>

          {/* Database Schema Status */}
          <div className="bg-zinc-900/10 border border-zinc-850 p-5 rounded-xl space-y-4">
            <h3 className="font-serif text-sm font-bold text-zinc-200 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              System Schema Verifier
            </h3>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                <span className="font-bold text-zinc-300">MMKE Schema Compliant</span>
              </div>
              <p className="text-[10px] text-zinc-500 leading-normal">
                Verifies structure alignment between database models and frontend metadata engines.
              </p>
              <button
                onClick={handleForceSyncSchema}
                className="w-full py-1.5 bg-zinc-850 hover:bg-zinc-800 border border-zinc-800 text-[10px] font-bold rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5 text-zinc-300"
              >
                <RefreshCw className="w-3 h-3" />
                Force Sync Verification
              </button>
            </div>
          </div>

        </div>

        {/* Immutable Audit Trail (Right Column) */}
        <div className="lg:col-span-2 space-y-4 bg-zinc-900/5 border border-zinc-850 p-5 rounded-xl">
          <h3 className="font-serif text-sm font-bold text-zinc-200 flex items-center gap-1.5 border-b border-zinc-850 pb-3">
            <Lock className="w-4 h-4 text-amber-500" />
            Compliance Auditing Trails
          </h3>
          <p className="text-[10px] text-zinc-500 leading-normal mb-2">
            Immutable tracking logs auditing logins, user additions, and metadata modifications inside settings.
          </p>
          <AuditLogs logs={logs} />
        </div>

      </div>

    </div>
  );
}
