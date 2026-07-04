import React, { useState } from 'react';
import { ShieldCheck, Search, Info, ShieldAlert } from 'lucide-react';
import { AuditLog } from './types';

interface AuditLogsProps {
  logs: AuditLog[];
}

export default function AuditLogs({ logs }: AuditLogsProps) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredLogs = logs.filter(log => {
    const term = searchTerm.toLowerCase();
    return (
      log.userEmail.toLowerCase().includes(term) ||
      log.action.toLowerCase().includes(term) ||
      log.targetName.toLowerCase().includes(term) ||
      log.role.toLowerCase().includes(term)
    );
  });

  return (
    <div className="space-y-6 text-left animate-fade-in">
      {/* Header */}
      <div className="border-b border-zinc-800 pb-5">
        <h2 className="font-serif text-xl md:text-2xl font-extrabold text-zinc-100">
          Security & Editorial Audit Trails
        </h2>
        <p className="text-xs text-zinc-400 mt-1">
          Immutable tracking logs auditing all actions, logins, and metadata alterations within the Studio.
        </p>
      </div>

      <div className="space-y-4">
        {/* Search */}
        <div className="relative text-xs max-w-md">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Filter audits by Editor name, email, action, or target entity..."
            className="w-full bg-zinc-900/40 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500 pl-8"
          />
          <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-3.5" />
        </div>

        {/* Audit Directory Table */}
        <div className="bg-zinc-900/10 border border-zinc-850 rounded-xl overflow-hidden divide-y divide-zinc-850">
          {filteredLogs.length === 0 ? (
            <div className="p-8 text-center text-zinc-500 text-xs italic">
              No audit records match your query filter.
            </div>
          ) : (
            filteredLogs.map(log => (
              <div 
                key={log.id}
                className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs font-mono"
              >
                <div className="space-y-1 md:max-w-xl">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-zinc-300">{log.userEmail}</span>
                    <span className="text-[9px] bg-zinc-800 text-amber-400 px-1.5 py-0.5 rounded font-extrabold uppercase">
                      {log.role}
                    </span>
                    <span className="text-[10px] text-zinc-500">{log.timestamp}</span>
                  </div>
                  <p className="text-zinc-200 font-sans text-xs leading-relaxed">
                    {log.action}
                  </p>
                </div>

                <div className="text-left md:text-right space-y-0.5 flex-shrink-0">
                  <span className="text-[9px] text-zinc-500 block">Target Object</span>
                  <p className="text-[10px] text-zinc-400 font-semibold">{log.targetName}</p>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Security Warning */}
        <div className="p-4 bg-zinc-900/30 rounded-xl border border-zinc-850 flex gap-3 text-xs leading-normal">
          <ShieldAlert className="w-5 h-5 text-zinc-400 flex-shrink-0" />
          <div className="space-y-1">
            <h4 className="font-bold text-zinc-300">Immutable Logging Protocol Active</h4>
            <p className="text-[10px] text-zinc-500">
              Audit trails are cryptographically locked and stored directly within a separate write-once-read-many (WORM) data partition. These logs cannot be updated or expunged by any team role, ensuring compliance.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
