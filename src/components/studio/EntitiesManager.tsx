import React, { useState } from 'react';
import { 
  Music, 
  Users, 
  MapPin, 
  Search, 
  Plus, 
  Calendar, 
  Info,
  CheckCircle2,
  Trash2
} from 'lucide-react';

interface EntityItem {
  id: string;
  type: 'Composer' | 'Work' | 'Venue';
  name: string;
  detail1: string; // e.g., Era, Composer Name, Location
  detail2?: string; // e.g., Catalogue no, Acoustic decay, Key signature
}

export default function EntitiesManager() {
  const [activeSubTab, setActiveSubTab] = useState<'all' | 'Composer' | 'Work' | 'Venue'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Seed baseline entities representing MMKE canonical models
  const [entities, setEntities] = useState<EntityItem[]>([
    { id: 'ent-1', type: 'Composer', name: 'Johann Sebastian Bach', detail1: 'Baroque Era', detail2: 'German Organ Master' },
    { id: 'ent-2', type: 'Composer', name: 'Wolfgang Amadeus Mozart', detail1: 'Classical Era', detail2: 'Austrian Genius' },
    { id: 'ent-3', type: 'Composer', name: 'Augustine Paul', detail1: 'Contemporary Era', detail2: 'Chennai Choral Arranger' },
    { id: 'ent-4', type: 'Composer', name: 'Henry Mancini', detail1: 'Modern Era', detail2: 'American Jazz & Film Composer' },
    { id: 'ent-5', type: 'Work', name: 'Toccata and Fugue in D minor BWV 565', detail1: 'J.S. Bach', detail2: 'Organ Work' },
    { id: 'ent-6', type: 'Work', name: 'Dingiri Dingalae', detail1: 'Augustine Paul (Arr.)', detail2: 'Symphonic Choral Traditional' },
    { id: 'ent-7', type: 'Work', name: 'The Pink Panther Theme', detail1: 'Henry Mancini', detail2: 'Brass Ensemble Arr.' },
    { id: 'ent-8', type: 'Venue', name: "St. Andrew's Church (The Kirk)", detail1: 'Egmore, Chennai', detail2: 'Reverberant Brick Dome, 3.2s Decay' },
    { id: 'ent-9', type: 'Venue', name: 'Emmanuel Methodist Church', detail1: 'Vepery, Chennai', detail2: 'Modern Acoustic Sanctuary, 1.8s Decay' },
    { id: 'ent-10', type: 'Venue', name: 'Bishop Heber Chapel', detail1: 'Trichy / Chennai Synod', detail2: 'Warm Wooden Arch Sanctuary, 2.1s Decay' }
  ]);

  // Form states for creating a new entity
  const [newType, setNewType] = useState<'Composer' | 'Work' | 'Venue'>('Composer');
  const [newName, setNewName] = useState('');
  const [newDetail1, setNewDetail1] = useState('');
  const [newDetail2, setNewDetail2] = useState('');

  const handleAddEntity = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newDetail1) return;

    const newItem: EntityItem = {
      id: `ent-${Date.now()}`,
      type: newType,
      name: newName,
      detail1: newDetail1,
      detail2: newDetail2
    };

    setEntities(prev => [newItem, ...prev]);
    setNewName('');
    setNewDetail1('');
    setNewDetail2('');
    setSuccessMsg(`Successfully created canonical ${newType} "${newName}"!`);
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  const handleRemoveEntity = (id: string) => {
    setEntities(prev => prev.filter(e => e.id !== id));
  };

  const filteredEntities = entities.filter(ent => {
    const matchesTab = activeSubTab === 'all' || ent.type === activeSubTab;
    const matchesSearch = ent.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          ent.detail1.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesTab && matchesSearch;
  });

  return (
    <div className="space-y-6 text-left animate-fade-in text-xs text-zinc-300">
      
      {/* Header */}
      <div className="border-b border-zinc-850 pb-5">
        <h2 className="font-serif text-xl md:text-2xl font-extrabold text-zinc-100">
          Canonical Knowledge Entities
        </h2>
        <p className="text-[11px] text-zinc-400 mt-1">
          Review, map, and author canonical entity registries across composers, works, and physical venues.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Entity Creator (Left) */}
        <div className="bg-zinc-900/10 border border-zinc-850 p-5 rounded-xl space-y-4 h-fit">
          <h3 className="font-serif text-sm font-bold text-zinc-200 flex items-center gap-1.5">
            <Plus className="w-4 h-4 text-amber-500" />
            Provision Canonical Entity
          </h3>

          {successMsg && (
            <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg font-bold flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {successMsg}
            </div>
          )}

          <form onSubmit={handleAddEntity} className="space-y-4">
            <div className="space-y-1">
              <label className="font-bold text-zinc-400">Entity Type</label>
              <select
                value={newType}
                onChange={(e) => {
                  setNewType(e.target.value as any);
                  setNewDetail1('');
                  setNewDetail2('');
                }}
                className="w-full bg-zinc-950/50 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500 font-bold"
              >
                <option value="Composer">Composer (Historical Bio Node)</option>
                <option value="Work">Musical Work (Composition Schema)</option>
                <option value="Venue">Concert Venue (Acoustic Site)</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="font-bold text-zinc-400">Canonical Name</label>
              <input
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={
                  newType === 'Composer' ? 'e.g. Johann Sebastian Bach' :
                  newType === 'Work' ? 'e.g. Passacaglia in C minor' :
                  'e.g. St. Andrew\'s Church'
                }
                className="w-full bg-zinc-950/50 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="space-y-1">
              <label className="font-bold text-zinc-400">
                {newType === 'Composer' ? 'Historical Era' :
                 newType === 'Work' ? 'Composer / Arranger' :
                 'Location Address'}
              </label>
              <input
                type="text"
                required
                value={newDetail1}
                onChange={(e) => setNewDetail1(e.target.value)}
                placeholder={
                  newType === 'Composer' ? 'e.g. Baroque Era' :
                  newType === 'Work' ? 'e.g. J.S. Bach' :
                  'e.g. Egmore, Chennai'
                }
                className="w-full bg-zinc-950/50 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="space-y-1">
              <label className="font-bold text-zinc-400">
                {newType === 'Composer' ? 'National Origin / Description' :
                 newType === 'Work' ? 'Catalogue Classification' :
                 'Acoustic Profile (Decay Time)'}
              </label>
              <input
                type="text"
                value={newDetail2}
                onChange={(e) => setNewDetail2(e.target.value)}
                placeholder={
                  newType === 'Composer' ? 'e.g. German master organist' :
                  newType === 'Work' ? 'e.g. BWV 582' :
                  'e.g. Reverberant stone dome'
                }
                className="w-full bg-zinc-950/50 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500"
              />
            </div>

            <button
              type="submit"
              className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-zinc-950 font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Commit Canonical Node
            </button>
          </form>
        </div>

        {/* Database Explorer (Right) */}
        <div className="lg:col-span-2 space-y-4">
          
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-850 pb-3">
            {/* Filters */}
            <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
              {[
                { id: 'all', label: 'All Entities', icon: Info },
                { id: 'Composer', label: 'Composers', icon: Users },
                { id: 'Work', label: 'Works', icon: Music },
                { id: 'Venue', label: 'Venues', icon: MapPin }
              ].map(tab => {
                const Icon = tab.icon;
                const active = activeSubTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveSubTab(tab.id as any)}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-bold whitespace-nowrap transition-colors cursor-pointer ${
                      active 
                        ? 'bg-zinc-800 text-zinc-100 border border-zinc-700' 
                        : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {tab.label}
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
                placeholder="Search canonical registry..."
                className="w-full bg-zinc-900/40 border border-zinc-800 p-2 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500 pl-7"
              />
              <Search className="w-3 h-3 text-zinc-500 absolute left-2.5 top-2.5" />
            </div>
          </div>

          {/* Directory list */}
          <div className="bg-zinc-900/10 border border-zinc-850 rounded-xl overflow-hidden divide-y divide-zinc-850">
            {filteredEntities.length === 0 ? (
              <div className="p-8 text-center text-zinc-500 italic">
                No matching canonical entities in our Knowledge Base.
              </div>
            ) : (
              filteredEntities.map(ent => (
                <div key={ent.id} className="p-4 flex items-center justify-between gap-4 text-xs">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-zinc-200 text-sm">{ent.name}</span>
                      <span className={`px-2 py-0.5 rounded text-[8px] font-extrabold uppercase tracking-wide ${
                        ent.type === 'Composer' ? 'bg-amber-500 text-zinc-950' :
                        ent.type === 'Work' ? 'bg-blue-900/40 text-blue-300 border border-blue-800/20' :
                        'bg-emerald-900/40 text-emerald-300 border border-emerald-800/20'
                      }`}>
                        {ent.type}
                      </span>
                    </div>
                    <p className="text-[10px] text-zinc-500 leading-none">
                      {ent.detail1} {ent.detail2 ? `• ${ent.detail2}` : ''}
                    </p>
                  </div>

                  <button
                    onClick={() => handleRemoveEntity(ent.id)}
                    className="p-1.5 bg-zinc-900 hover:bg-red-500/20 text-zinc-500 hover:text-red-400 rounded-lg border border-zinc-850 hover:border-red-500/20 transition-all cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>

        </div>

      </div>

    </div>
  );
}
