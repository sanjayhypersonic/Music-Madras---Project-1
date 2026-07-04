import React, { useState, useRef } from 'react';
import { 
  FileText, 
  Image as ImageIcon, 
  Music, 
  UploadCloud, 
  CheckCircle2, 
  Search, 
  Download, 
  Trash2,
  FileDown
} from 'lucide-react';

interface MediaItem {
  id: string;
  name: string;
  type: 'image' | 'pdf' | 'audio';
  size: string;
  uploadedAt: string;
  url: string;
}

export default function MediaLibrary() {
  const [searchTerm, setSearchTerm] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mediaItems, setMediaItems] = useState<MediaItem[]>([
    { id: 'm-1', name: 'st-andrews-kirk-acoustic-dome.jpg', type: 'image', size: '2.4 MB', uploadedAt: '2026-07-04', url: '#' },
    { id: 'm-2', name: 'pipe-organ-solos-booklet-2026.pdf', type: 'pdf', size: '4.8 MB', uploadedAt: '2026-07-03', url: '#' },
    { id: 'm-3', name: 'bach-fugue-g-minor-master-stem.wav', type: 'audio', size: '48.2 MB', uploadedAt: '2026-07-04', url: '#' },
    { id: 'm-4', name: 'christmas-carols-medley-arrangement.pdf', type: 'pdf', size: '1.2 MB', uploadedAt: '2026-07-02', url: '#' },
    { id: 'm-5', name: 'saso-chorale-concert-poster.png', type: 'image', size: '5.1 MB', uploadedAt: '2026-06-30', url: '#' }
  ]);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFiles(e.target.files);
    }
  };

  const handleFiles = (files: FileList) => {
    const file = files[0];
    const extension = file.name.split('.').pop()?.toLowerCase();
    let type: 'image' | 'pdf' | 'audio' = 'image';
    if (extension === 'pdf') type = 'pdf';
    if (extension === 'wav' || extension === 'mp3') type = 'audio';

    const newItem: MediaItem = {
      id: `m-${Date.now()}`,
      name: file.name,
      type,
      size: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
      uploadedAt: new Date().toISOString().split('T')[0],
      url: '#'
    };

    setMediaItems(prev => [newItem, ...prev]);
    setSuccessMsg(`Successfully uploaded ${file.name}!`);
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  const handleDeleteItem = (id: string) => {
    setMediaItems(prev => prev.filter(item => item.id !== id));
  };

  const filteredItems = mediaItems.filter(item => 
    item.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6 text-left animate-fade-in text-xs text-zinc-300">
      
      {/* Header */}
      <div className="border-b border-zinc-850 pb-5">
        <h2 className="font-serif text-xl md:text-2xl font-extrabold text-zinc-100">
          Digital Media Library
        </h2>
        <p className="text-[11px] text-zinc-400 mt-1">
          Store and link high-resolution posters, program booklets, and master audio stems.
        </p>
      </div>

      {/* Upload area */}
      <div className="space-y-4">
        {successMsg && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg font-bold flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" />
            {successMsg}
          </div>
        )}

        <div
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
            dragActive 
              ? 'border-amber-500 bg-amber-500/5' 
              : 'border-zinc-800 hover:border-zinc-700 bg-zinc-900/10'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileInput}
            className="hidden"
            accept="image/*,application/pdf,audio/wav,audio/mpeg"
          />
          <UploadCloud className="w-10 h-10 text-zinc-500 mx-auto mb-3" />
          <p className="font-bold text-zinc-300 text-sm">Drag and drop assets here, or click to browse</p>
          <p className="text-[10px] text-zinc-500 mt-1">Supports high-res JPG/PNG, Concert Program PDFs, or Master WAV files</p>
        </div>
      </div>

      {/* Explorer */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h3 className="font-serif text-sm font-bold text-zinc-200">Library Assets ({filteredItems.length})</h3>
          
          {/* Search */}
          <div className="relative text-xs max-w-xs w-full">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Filter assets..."
              className="w-full bg-zinc-900/40 border border-zinc-800 p-2 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500 pl-7"
            />
            <Search className="w-3 h-3 text-zinc-500 absolute left-2.5 top-2.5" />
          </div>
        </div>

        {/* Assets Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {filteredItems.map(item => {
            const Icon = item.type === 'image' ? ImageIcon :
                          item.type === 'pdf' ? FileText :
                          Music;
            
            return (
              <div 
                key={item.id} 
                className="bg-zinc-900/10 border border-zinc-850 p-4 rounded-xl flex items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-center gap-3 truncate">
                  <div className={`p-2.5 rounded-lg flex-shrink-0 ${
                    item.type === 'image' ? 'bg-amber-500/10 text-amber-400' :
                    item.type === 'pdf' ? 'bg-blue-500/10 text-blue-400' :
                    'bg-emerald-500/10 text-emerald-400'
                  }`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="truncate space-y-0.5">
                    <p className="font-bold text-zinc-200 truncate">{item.name}</p>
                    <p className="text-[10px] text-zinc-500 font-mono">{item.size} • Uploaded {item.uploadedAt}</p>
                  </div>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    className="p-1.5 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 rounded-lg transition-colors cursor-pointer"
                    title="Download asset"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDeleteItem(item.id)}
                    className="p-1.5 hover:bg-red-500/10 text-zinc-500 hover:text-red-400 rounded-lg transition-colors cursor-pointer"
                    title="Delete asset"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}
