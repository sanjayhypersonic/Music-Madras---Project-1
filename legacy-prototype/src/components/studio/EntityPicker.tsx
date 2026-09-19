import React, { useState, useEffect, useRef } from 'react';
import { Search, Plus, Clock, Check } from 'lucide-react';

interface EntityPickerProps {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  canonicalSuggestions: string[];
  entityType: string;
}

export default function EntityPicker({
  label,
  placeholder,
  value,
  onChange,
  canonicalSuggestions,
  entityType
}: EntityPickerProps) {
  const [search, setSearch] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load recents from localStorage
  useEffect(() => {
    const key = `mm_recent_${entityType.toLowerCase()}`;
    const saved = localStorage.getItem(key);
    if (saved) {
      try {
        setRecent(JSON.parse(saved));
      } catch (e) {
        setRecent([]);
      }
    }
  }, [entityType]);

  // Sync state if value changes from parent
  useEffect(() => {
    setSearch(value);
  }, [value]);

  // Click outside close
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (val: string) => {
    onChange(val);
    setSearch(val);
    setIsOpen(false);

    // Save to recents
    const key = `mm_recent_${entityType.toLowerCase()}`;
    const updated = [val, ...recent.filter(r => r !== val)].slice(0, 5);
    setRecent(updated);
    localStorage.setItem(key, JSON.stringify(updated));
  };

  const handleCustomSubmit = () => {
    if (search.trim()) {
      handleSelect(search.trim());
    }
  };

  const filtered = canonicalSuggestions.filter(item =>
    item.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div ref={containerRef} className="space-y-1 relative w-full text-xs">
      <label className="font-bold text-zinc-400 block">{label}</label>
      <div className="relative">
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setIsOpen(true);
            onChange(e.target.value); // support typing directly
          }}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          className="w-full bg-zinc-950/40 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500 pl-8"
        />
        <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-3.5" />
        {search && search !== value && (
          <button
            type="button"
            onClick={handleCustomSubmit}
            className="absolute right-2.5 top-2.5 bg-amber-500 hover:bg-amber-600 text-zinc-950 px-2 py-1 rounded text-[10px] font-bold"
          >
            Create
          </button>
        )}
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full bg-zinc-900 border border-zinc-800 rounded-lg mt-1 shadow-xl max-h-60 overflow-y-auto divide-y divide-zinc-850">
          {/* Recent Selections */}
          {recent.length > 0 && !search && (
            <div className="p-2 space-y-1">
              <span className="text-[9px] text-zinc-500 uppercase tracking-wider font-extrabold flex items-center gap-1 px-2 py-0.5">
                <Clock className="w-3 h-3" /> Recent Selections
              </span>
              {recent.map(item => (
                <button
                  type="button"
                  key={item}
                  onClick={() => handleSelect(item)}
                  className="w-full text-left px-2 py-1.5 hover:bg-zinc-800 rounded text-zinc-300 hover:text-zinc-100 flex items-center justify-between cursor-pointer"
                >
                  <span>{item}</span>
                  {value === item && <Check className="w-3.5 h-3.5 text-amber-500" />}
                </button>
              ))}
            </div>
          )}

          {/* Canonical Suggestions */}
          <div className="p-2 space-y-1">
            <span className="text-[9px] text-zinc-500 uppercase tracking-wider font-extrabold px-2 py-0.5 block">
              Canonical Suggestions ({filtered.length})
            </span>
            {filtered.length === 0 ? (
              <p className="text-[10px] text-zinc-500 italic px-2 py-1">
                No matching canonical entities. Press Enter to use "{search || 'custom'}".
              </p>
            ) : (
              filtered.map(item => (
                <button
                  type="button"
                  key={item}
                  onClick={() => handleSelect(item)}
                  className="w-full text-left px-2 py-1.5 hover:bg-zinc-800 rounded text-zinc-300 hover:text-zinc-100 flex items-center justify-between cursor-pointer"
                >
                  <span>{item}</span>
                  {value === item && <Check className="w-3.5 h-3.5 text-amber-500" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
