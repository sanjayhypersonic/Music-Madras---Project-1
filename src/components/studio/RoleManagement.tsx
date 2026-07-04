import React, { useState } from 'react';
import { 
  ShieldAlert, 
  UserPlus, 
  UserCheck, 
  Trash2, 
  Plus, 
  HelpCircle,
  Key,
  ShieldCheck,
  CheckCircle2
} from 'lucide-react';
import { StudioUser, StudioRole } from './types';

interface RoleManagementProps {
  users: StudioUser[];
  onInviteUser: (email: string, role: StudioRole, name: string) => void;
  onRevokeUser: (id: string) => void;
  currentUser: { email: string; role: string };
}

export default function RoleManagement({ users, onInviteUser, onRevokeUser, currentUser }: RoleManagementProps) {
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<StudioRole>('Contributor');
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Check if current user is Admin / Founder
  const canManage = currentUser.role === 'Founder' || currentUser.role === 'Super Administrator' || currentUser.role === 'Administrator';

  const handleInviteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail || !inviteName) return;

    onInviteUser(inviteEmail, inviteRole, inviteName);
    setInviteEmail('');
    setInviteName('');
    setInviteRole('Contributor');
    setSuccessMsg(`Successfully invited ${inviteName} as an ${inviteRole}!`);
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  return (
    <div className="space-y-6 text-left animate-fade-in">
      {/* Header */}
      <div className="border-b border-zinc-800 pb-5">
        <h2 className="font-serif text-xl md:text-2xl font-extrabold text-zinc-100">
          Invite & Role Administration
        </h2>
        <p className="text-xs text-zinc-400 mt-1">
          Provision team roles, invite archival specialists, and regulate access privileges.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Invite Form (Left) */}
        <div className="space-y-4">
          <div className="bg-zinc-900/40 border border-zinc-850 p-6 rounded-xl space-y-4">
            <h3 className="font-serif text-sm font-bold text-zinc-200 flex items-center gap-1.5">
              <UserPlus className="w-4 h-4 text-amber-500" />
              Invite New Team Member
            </h3>

            {!canManage ? (
              <div className="p-4 bg-zinc-950/40 border border-red-500/10 text-red-400 rounded-lg text-xs flex gap-2">
                <ShieldAlert className="w-4 h-4 flex-shrink-0" />
                <p>
                  Access Denied. Only <strong>Administrators</strong> or <strong>Founders</strong> possess permissions to invite new editorial contributors.
                </p>
              </div>
            ) : (
              <form onSubmit={handleInviteSubmit} className="space-y-4 text-xs">
                {successMsg && (
                  <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg font-bold flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {successMsg}
                  </div>
                )}

                <div className="space-y-1">
                  <label className="font-bold text-zinc-400">Full Name</label>
                  <input
                    type="text"
                    required
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    placeholder="e.g. Augustine Paul"
                    className="w-full bg-zinc-950/50 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-zinc-400">Email Address</label>
                  <input
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="e.g. augustine@musicmadras.com"
                    className="w-full bg-zinc-950/50 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-zinc-400">Archival Role</label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as StudioRole)}
                    className="w-full bg-zinc-950/50 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500"
                  >
                    <option value="Contributor">Contributor (Ingest permissions)</option>
                    <option value="Editor">Editor (Linking and metadata drafts)</option>
                    <option value="Reviewer">Reviewer (Audit and correction drafts)</option>
                    <option value="Administrator">Administrator (Direct database writes)</option>
                    <option value="Super Administrator">Super Administrator (All permissions)</option>
                  </select>
                </div>

                <button
                  type="submit"
                  className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-zinc-950 font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  Issue Invite Code
                </button>
              </form>
            )}
          </div>

          {/* Roles Legend */}
          <div className="bg-zinc-900/10 border border-zinc-850 p-4 rounded-xl text-[11px] text-zinc-500 space-y-2">
            <h4 className="font-bold text-zinc-400 uppercase text-[9px] tracking-wide flex items-center gap-1">
              <Key className="w-3 h-3 text-amber-500" />
              Role Permissions Matrix
            </h4>
            <div className="space-y-1.5">
              <p><strong>Founder:</strong> Root ownership, database access, full invite capabilities.</p>
              <p><strong>Admin:</strong> Global publishing, schema linking, user revokes.</p>
              <p><strong>Editor:</strong> Relational entity mapping, programme context summaries.</p>
              <p><strong>Contributor:</strong> Access restricted to YouTube sync queues and ingestion.</p>
            </div>
          </div>
        </div>

        {/* Invited Active Users Directory (Right) */}
        <div className="lg:col-span-2 space-y-4">
          <h3 className="font-serif text-sm font-bold text-zinc-200 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            Registry Team Directory ({users.length})
          </h3>

          <div className="bg-zinc-900/10 border border-zinc-850 rounded-xl overflow-hidden divide-y divide-zinc-850">
            {users.map(u => (
              <div 
                key={u.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-zinc-200 text-sm">{u.name}</span>
                    <span className={`px-2 py-0.5 rounded text-[8px] font-extrabold uppercase tracking-wide ${
                      u.role === 'Founder' ? 'bg-amber-500 text-zinc-950' :
                      u.role === 'Super Administrator' ? 'bg-zinc-800 text-red-400 border border-red-500/20' :
                      u.role === 'Editor' ? 'bg-blue-900/40 text-blue-300 border border-blue-800/20' :
                      'bg-zinc-800 text-zinc-400'
                    }`}>
                      {u.role}
                    </span>
                  </div>
                  <p className="text-[10px] text-zinc-500">{u.email} • Joined {u.createdAt}</p>
                </div>

                <div className="flex items-center gap-2.5">
                  <div className="text-right text-[10px]">
                    {u.twoFactorEnabled ? (
                      <span className="text-emerald-400 font-bold">✔ 2FA Enabled</span>
                    ) : (
                      <span className="text-zinc-500">2FA Configured</span>
                    )}
                  </div>
                  {canManage && u.role !== 'Founder' && (
                    <button
                      onClick={() => onRevokeUser(u.id)}
                      className="p-1.5 bg-zinc-800 hover:bg-red-500/20 text-zinc-400 hover:text-red-400 rounded-lg transition-colors cursor-pointer border border-zinc-700 hover:border-red-500/30"
                      title="Revoke Contributor Access"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
