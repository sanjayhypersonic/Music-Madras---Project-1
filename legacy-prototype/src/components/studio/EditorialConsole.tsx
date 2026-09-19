import React, { useState, useEffect } from 'react';
import { 
  FileText, 
  Youtube, 
  Music, 
  MapPin, 
  Users, 
  BookOpen, 
  Image as ImageIcon, 
  Globe, 
  Link as LinkIcon, 
  CheckCircle, 
  ArrowLeft, 
  ArrowRight, 
  Sparkles, 
  Plus, 
  Trash2, 
  Save,
  Clock,
  AlertTriangle,
  Info,
  ChevronRight,
  Eye,
  ShieldCheck,
  Award
} from 'lucide-react';
import { RecordingDraft, RecordingStatus, MusicalWorkDraft, Programme, SEOData, RelationshipItem } from './types';
import EntityPicker from './EntityPicker';

interface EditorialConsoleProps {
  recording: RecordingDraft;
  onUpdateRecording: (updated: RecordingDraft) => void;
  onClose: () => void;
  onPublish: (recordingId: string) => void;
}

export default function EditorialConsole({ 
  recording, 
  onUpdateRecording, 
  onClose, 
  onPublish 
}: EditorialConsoleProps) {
  
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [formData, setFormData] = useState<RecordingDraft>(() => {
    // Draft Recovery / Auto Save load
    const saved = localStorage.getItem(`mm_draft_recording_${recording.id}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          ...recording,
          ...parsed,
          id: recording.id 
        };
      } catch (e) {
        console.warn('Error recovering draft, fallback to props.', e);
      }
    }
    return {
      ...recording,
      programme: recording.programme || {
        programmeTitle: '',
        concertOrder: 1,
        intermission: false,
        programmeNotes: ''
      },
      works: recording.works || [],
      venue: recording.venue || { name: '' },
      participants: recording.participants || {},
      educationalContent: recording.educationalContent || { difficultyLevel: 'BEGINNER' },
      mediaAssets: recording.mediaAssets || { youtubeId: recording.youtubeId },
      seo: recording.seo || { metaTitle: '', metaDescription: '', canonicalUrl: '' },
      relationships: recording.relationships || []
    };
  });

  const [lastAutoSaved, setLastAutoSaved] = useState<string>('');

  // Canonical suggestion lists for Autocomplete Picker
  const composersSuggestions = [
    'Johann Sebastian Bach', 
    'George Frideric Handel', 
    'Wolfgang Amadeus Mozart', 
    'Giuseppe Verdi', 
    'Ludwig van Beethoven', 
    'Johannes Brahms', 
    'Henry Mancini',
    'Augustine Paul'
  ];

  const venuesSuggestions = [
    "St. Andrew's Church (The Kirk)", 
    "St. George's Cathedral", 
    "TELC Arulnathar Lutheran Church", 
    "Emmanuel Methodist Church",
    "Museum Theatre, Chennai"
  ];

  const choirsSuggestions = [
    "The Chennai Chorale", 
    "Bishop Heber Chapel Choir", 
    "EMC Alumni Choir", 
    "3 Part Harmony Choir", 
    "The Canticles",
    "Madras Youth Choir"
  ];

  const conductorsSuggestions = [
    "Alvin Arumugam", 
    "Augustine Paul", 
    "Ebenezer ArunKumar", 
    "Jeremiah Christopher"
  ];

  const worksSuggestions = [
    "Toccata and Fugue in D minor, BWV 565", 
    "Fantasia and Fugue in G minor, BWV 542",
    "Passacaglia and Fugue in C minor, BWV 582", 
    "Dingiri Dingalae", 
    "Ambara Umbara",
    "Crown Him with Many Crowns", 
    "Thine be the Glory",
    "The Pink Panther Theme"
  ];

  // Helper to generate slug
  const generateSlug = (title: string): string => {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  };

  // Auto Save triggers on change
  useEffect(() => {
    localStorage.setItem(`mm_draft_recording_${formData.id}`, JSON.stringify(formData));
    const now = new Date().toLocaleTimeString();
    setLastAutoSaved(now);
    onUpdateRecording(formData);
  }, [formData]);

  // Automated metadata compiler
  const handleTriggerAutomations = () => {
    const slug = generateSlug(formData.title || 'untitled-recording');
    const worksText = formData.works && formData.works.length > 0 
      ? formData.works.map(w => w.title).join(', ') 
      : 'Classical pieces';
    const artistText = formData.artist || 'Music Madras Performers';
    const venueText = formData.venue?.name || 'Chennai Archive Venue';

    const generatedMetaTitle = `${formData.title} | Music Madras Archive`;
    const generatedMetaDescription = `Listen to high-fidelity live recording of ${worksText} performed by ${artistText} live at ${venueText}. Captured under acoustic precision in Chennai.`;
    const generatedCanonicalUrl = `https://www.musicmadras.com/recordings/${slug}`;
    const generatedBreadcrumbs = ['Home', 'Archive', 'Recordings', formData.title];
    const generatedInternalLinks = [
      `/venues/${generateSlug(venueText)}`,
      ...(formData.works ? formData.works.map(w => `/composers/${generateSlug(w.composerName)}`) : [])
    ];

    const generatedSchema = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "MusicRecording",
      "name": formData.title,
      "duration": formData.duration ? `PT${formData.duration.split(':')[0]}M${formData.duration.split(':')[1]}S` : "PT5M",
      "url": generatedCanonicalUrl,
      "byArtist": {
        "@type": "MusicGroup",
        "name": artistText
      },
      "recordingOf": {
        "@type": "MusicComposition",
        "name": worksText
      }
    }, null, 2);

    // Smart relationship updates
    const smartRelationships: RelationshipItem[] = [];
    if (formData.venue?.name) {
      smartRelationships.push({
        targetId: generateSlug(formData.venue.name),
        targetName: formData.venue.name,
        targetType: 'Venue',
        confidenceScore: 0.95,
        reasoning: `Direct match with venue spatial data for ${formData.venue.name}.`
      });
    }
    if (formData.works) {
      formData.works.forEach(w => {
        if (w.composerName) {
          smartRelationships.push({
            targetId: generateSlug(w.composerName),
            targetName: w.composerName,
            targetType: 'Composer',
            confidenceScore: 1.0,
            reasoning: `Composer of work "${w.title}" linked explicitly.`
          });
        }
      });
    }

    setFormData(prev => ({
      ...prev,
      seo: {
        metaTitle: prev.seo?.metaTitle || generatedMetaTitle,
        metaDescription: prev.seo?.metaDescription || generatedMetaDescription,
        canonicalUrl: prev.seo?.canonicalUrl || generatedCanonicalUrl,
        openGraphUrl: `https://www.musicmadras.com/og/${slug}.jpg`,
        twitterCard: 'summary_large_image',
        jsonLdSchema: generatedSchema,
        breadcrumbs: generatedBreadcrumbs,
        internalLinks: generatedInternalLinks
      },
      relationships: smartRelationships
    }));
  };

  const handleWorkChange = (index: number, field: keyof MusicalWorkDraft, value: any) => {
    setFormData(prev => {
      const updatedWorks = [...(prev.works || [])];
      updatedWorks[index] = { ...updatedWorks[index], [field]: value };
      return { ...prev, works: updatedWorks };
    });
  };

  const handleAddWork = () => {
    setFormData(prev => ({
      ...prev,
      works: [...(prev.works || []), { title: '', composerName: '', catalogueNumber: '' }]
    }));
  };

  const handleRemoveWork = (index: number) => {
    setFormData(prev => {
      const updatedWorks = [...(prev.works || [])];
      updatedWorks.splice(index, 1);
      return { ...prev, works: updatedWorks };
    });
  };

  // Custom steps aligned with the specific 11-step visual progression
  const stepsList = [
    { num: 1, label: 'Recording', icon: Youtube },
    { num: 2, label: 'Programme', icon: FileText },
    { num: 3, label: 'Works', icon: Music },
    { num: 4, label: 'Venue', icon: MapPin },
    { num: 5, label: 'Participants', icon: Users },
    { num: 6, label: 'Educational', icon: BookOpen },
    { num: 7, label: 'Media', icon: ImageIcon },
    { num: 8, label: 'SEO', icon: Globe },
    { num: 9, label: 'Relationships', icon: LinkIcon },
    { num: 10, label: 'Review', icon: CheckCircle },
    { num: 11, label: 'Public Preview', icon: Eye }
  ];

  return (
    <div className="bg-zinc-900/15 border border-zinc-850 rounded-2xl p-4 md:p-6 text-left animate-fade-in space-y-6">
      
      {/* Editorial Wizard Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-850 pb-4">
        <div>
          <button
            onClick={onClose}
            className="text-xs text-zinc-500 hover:text-amber-500 hover:underline mb-2 flex items-center gap-1 cursor-pointer"
          >
            ← Exit to Workspace (Auto-saved)
          </button>
          <div className="flex items-center gap-2">
            <h2 className="font-serif text-lg md:text-xl font-extrabold text-zinc-100">
              {formData.title || 'Untitled Recording'}
            </h2>
            <span className="text-[10px] uppercase font-bold tracking-wider font-mono bg-amber-500/10 text-amber-400 px-2.5 py-0.5 rounded">
              {formData.status}
            </span>
          </div>
        </div>

        {/* Saved Status Indicator */}
        <div className="text-right text-[10px] font-mono text-zinc-500 flex items-center gap-1.5 justify-end">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
          <span>Auto-saved {lastAutoSaved || 'just now'}</span>
        </div>
      </div>

      {/* Guided Wizard Steps list with visual indicators */}
      <div className="flex items-center gap-1 overflow-x-auto pb-2 scrollbar-none border-b border-zinc-850">
        {stepsList.map(step => {
          const StepIcon = step.icon;
          const active = currentStep === step.num;
          const completed = currentStep > step.num;

          return (
            <button
              key={step.num}
              onClick={() => setCurrentStep(step.num)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-bold whitespace-nowrap transition-all cursor-pointer ${
                active 
                  ? 'bg-amber-500 text-zinc-950 shadow-md' 
                  : completed 
                    ? 'text-emerald-400 bg-zinc-950/20 hover:bg-zinc-900/40' 
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/20'
              }`}
            >
              <StepIcon className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{step.num}. {step.label}</span>
            </button>
          );
        })}
      </div>

      {/* Wizard Form Panels */}
      <div className="min-h-[380px] bg-zinc-950/20 border border-zinc-900 rounded-xl p-5 md:p-6 space-y-6">
        
        {/* Step 1: Recording Source & Performance Context */}
        {currentStep === 1 && (
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
              <Youtube className="w-4 h-4 text-amber-500" />
              Step 1: Recording Source & Performance Context
            </h3>
            <p className="text-[11px] text-zinc-400 leading-normal">
              Verify the newly detected recording's root details. These were generated automatically from the YouTube channel crawler.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-zinc-400">Recording Title</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full bg-zinc-900/60 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-zinc-400">Performing Artist/Ensemble</label>
                <input
                  type="text"
                  value={formData.artist}
                  onChange={(e) => setFormData(prev => ({ ...prev, artist: e.target.value }))}
                  className="w-full bg-zinc-900/60 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-zinc-400">YouTube Video ID</label>
                <input
                  type="text"
                  value={formData.youtubeId}
                  disabled
                  className="w-full bg-zinc-950/40 border border-zinc-900 p-2.5 rounded-lg text-zinc-500 cursor-not-allowed font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-zinc-400">Duration (MM:SS)</label>
                <input
                  type="text"
                  value={formData.duration}
                  onChange={(e) => setFormData(prev => ({ ...prev, duration: e.target.value }))}
                  className="w-full bg-zinc-900/60 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500 font-mono"
                />
              </div>

              {/* Performance context fields mapped to Step 1 */}
              <div className="space-y-1">
                <label className="font-bold text-zinc-400">Performance Date (ISO or Text)</label>
                <input
                  type="text"
                  placeholder="e.g. 2026-03-15 or Palm Sunday"
                  value={formData.performanceDate || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, performanceDate: e.target.value }))}
                  className="w-full bg-zinc-900/60 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="space-y-1 flex items-center gap-2 pt-6">
                <input
                  type="checkbox"
                  id="public-check"
                  checked={formData.isPublic}
                  onChange={(e) => setFormData(prev => ({ ...prev, isPublic: e.target.checked }))}
                  className="w-4 h-4 accent-amber-500 cursor-pointer"
                />
                <label htmlFor="public-check" className="font-bold text-zinc-300 cursor-pointer">Set Performance Publicly Searchable</label>
              </div>

              <div className="md:col-span-2 space-y-1">
                <label className="font-bold text-zinc-400">Description</label>
                <textarea
                  rows={3}
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full bg-zinc-900/60 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Concert Programme */}
        {currentStep === 2 && (
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
              <FileText className="w-4 h-4 text-amber-500" />
              Step 2: Concert Programme
            </h3>
            <p className="text-[11px] text-zinc-400 leading-normal">
              Concerts frequently contain multiple composers. Define the core programme information for this recording below.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-zinc-400">Programme Title</label>
                <input
                  type="text"
                  placeholder="e.g. Easter Festival Choral Evensong"
                  value={formData.programme?.programmeTitle || ''}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    programme: { ...(prev.programme as Programme), programmeTitle: e.target.value }
                  }))}
                  className="w-full bg-zinc-900/60 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-zinc-400">Concert Order Number</label>
                <input
                  type="number"
                  value={formData.programme?.concertOrder || 1}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    programme: { ...(prev.programme as Programme), concertOrder: parseInt(e.target.value) || 1 }
                  }))}
                  className="w-full bg-zinc-900/60 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500 font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-zinc-400">Running Order</label>
                <input
                  type="text"
                  placeholder="e.g. Opening, Prelude, Hymn, Offertory, Postlude"
                  value={formData.programme?.runningOrder || ''}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    programme: { ...(prev.programme as Programme), runningOrder: e.target.value }
                  }))}
                  className="w-full bg-zinc-900/60 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-zinc-400">Movements/Sections</label>
                <input
                  type="text"
                  placeholder="e.g. I. Allegro, II. Adagio, III. Presto"
                  value={formData.programme?.movements || ''}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    programme: { ...(prev.programme as Programme), movements: e.target.value }
                  }))}
                  className="w-full bg-zinc-900/60 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="space-y-1 flex items-center gap-2 pt-6">
                <input
                  type="checkbox"
                  id="intermission-check"
                  checked={formData.programme?.intermission || false}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    programme: { ...(prev.programme as Programme), intermission: e.target.checked }
                  }))}
                  className="w-4 h-4 accent-amber-500 cursor-pointer"
                />
                <label htmlFor="intermission-check" className="font-bold text-zinc-300 cursor-pointer">Contains Intermission</label>
              </div>

              {formData.programme?.intermission && (
                <div className="space-y-1">
                  <label className="font-bold text-zinc-400">Intermission Details</label>
                  <input
                    type="text"
                    placeholder="e.g. 15 minute tea break with organ gallery visits"
                    value={formData.programme?.intermissionDetails || ''}
                    onChange={(e) => setFormData(prev => ({
                      ...prev,
                      programme: { ...(prev.programme as Programme), intermissionDetails: e.target.value }
                    }))}
                    className="w-full bg-zinc-900/60 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500"
                  />
                </div>
              )}

              <div className="space-y-1">
                <label className="font-bold text-zinc-400">Encore Selection</label>
                <input
                  type="text"
                  placeholder="e.g. Toccata in G by Theodore Dubois"
                  value={formData.programme?.encore || ''}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    programme: { ...(prev.programme as Programme), encore: e.target.value }
                  }))}
                  className="w-full bg-zinc-900/60 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="md:col-span-2 space-y-1">
                <label className="font-bold text-zinc-400">Programme Notes</label>
                <textarea
                  rows={4}
                  placeholder="Write the formal programme description, history, and musical highlights..."
                  value={formData.programme?.programmeNotes || ''}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    programme: { ...(prev.programme as Programme), programmeNotes: e.target.value }
                  }))}
                  className="w-full bg-zinc-900/60 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Composer & Musical Works */}
        {currentStep === 3 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
                <Music className="w-4 h-4 text-amber-500" />
                Step 3: Composer & Musical Works
              </h3>
              <button
                type="button"
                onClick={handleAddWork}
                className="flex items-center gap-1.5 px-3 py-1 bg-amber-500 hover:bg-amber-600 text-zinc-950 font-bold rounded text-[10px] cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Musical Work
              </button>
            </div>
            <p className="text-[11px] text-zinc-400 leading-normal">
              Map this recording to one or more classical Musical Works inside MMKE. Link a Composer to each Work.
            </p>

            {(formData.works || []).length === 0 ? (
              <div className="bg-zinc-950/40 border border-dashed border-zinc-800 p-8 rounded-lg text-center text-zinc-500">
                No Musical Works added yet. Click "Add Musical Work" to map compositions.
              </div>
            ) : (
              <div className="space-y-4 max-h-[300px] overflow-y-auto pr-1">
                {(formData.works || []).map((work, index) => (
                  <div key={index} className="bg-zinc-900/40 border border-zinc-850 p-4 rounded-xl space-y-4 relative animate-fade-in">
                    <button
                      type="button"
                      onClick={() => handleRemoveWork(index)}
                      className="absolute right-3 top-3 text-zinc-500 hover:text-red-400 cursor-pointer"
                      title="Remove work"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>

                    <h4 className="text-[10px] font-bold text-zinc-300">Composition #{index + 1}</h4>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                      {/* Work Search */}
                      <EntityPicker
                        label="Musical Work Title"
                        placeholder="e.g. Toccata and Fugue in D minor"
                        value={work.title}
                        onChange={(val) => handleWorkChange(index, 'title', val)}
                        canonicalSuggestions={worksSuggestions}
                        entityType="Work"
                      />

                      {/* Composer Search */}
                      <EntityPicker
                        label="Composer"
                        placeholder="e.g. Johann Sebastian Bach"
                        value={work.composerName}
                        onChange={(val) => handleWorkChange(index, 'composerName', val)}
                        canonicalSuggestions={composersSuggestions}
                        entityType="Composer"
                      />

                      <div className="space-y-1">
                        <label className="font-bold text-zinc-400">Catalogue Number</label>
                        <input
                          type="text"
                          placeholder="e.g. BWV 565"
                          value={work.catalogueNumber || ''}
                          onChange={(e) => handleWorkChange(index, 'catalogueNumber', e.target.value)}
                          className="w-full bg-zinc-900/60 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="font-bold text-zinc-400">Composer Era</label>
                        <select
                          value={work.composerEra || ''}
                          onChange={(e) => handleWorkChange(index, 'composerEra', e.target.value)}
                          className="w-full bg-zinc-900/60 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none"
                        >
                          <option value="">Select Era</option>
                          <option value="Renaissance">Renaissance</option>
                          <option value="Baroque">Baroque</option>
                          <option value="Classical">Classical</option>
                          <option value="Romantic">Romantic</option>
                          <option value="Modern">Modern</option>
                          <option value="Contemporary">Contemporary</option>
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 4: Venue Details */}
        {currentStep === 4 && (
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
              <MapPin className="w-4 h-4 text-amber-500" />
              Step 4: Venue Details & Acoustic Mapping
            </h3>
            <p className="text-[11px] text-zinc-400 leading-normal">
              Every recording belongs to a physical spatial location in India. Smart link with an existing Venue.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <EntityPicker
                label="Physical Venue Name"
                placeholder="e.g. St. Andrew's Church (The Kirk)"
                value={formData.venue?.name || ''}
                onChange={(val) => setFormData(prev => ({
                  ...prev,
                  venue: { ...prev.venue, name: val }
                }))}
                canonicalSuggestions={venuesSuggestions}
                entityType="Venue"
              />

              <div className="space-y-1">
                <label className="font-bold text-zinc-400">Acoustic Room Profile / Decay Time</label>
                <input
                  type="text"
                  placeholder="e.g. Reverberant brick & stone dome (approx. 3.2s decay time)"
                  value={formData.venue?.acousticProfile || ''}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    venue: { ...prev.venue, acousticProfile: e.target.value }
                  }))}
                  className="w-full bg-zinc-900/60 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-zinc-400">Capacity</label>
                <input
                  type="number"
                  placeholder="500"
                  value={formData.venue?.capacity || ''}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    venue: { ...prev.venue, capacity: parseInt(e.target.value) || undefined }
                  }))}
                  className="w-full bg-zinc-900/60 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500 font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-zinc-400">Address Location</label>
                <input
                  type="text"
                  placeholder="Egmore, Chennai"
                  value={formData.venue?.address || ''}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    venue: { ...prev.venue, address: e.target.value }
                  }))}
                  className="w-full bg-zinc-900/60 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 5: Concert Participants */}
        {currentStep === 5 && (
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
              <Users className="w-4 h-4 text-amber-500" />
              Step 5: Concert Participants
            </h3>
            <p className="text-[11px] text-zinc-400 leading-normal">
              Map physical performers, choirs, conductors, or instrumental soloists directly with security suggestions.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <EntityPicker
                label="Organist / Lead Instrumentalist"
                placeholder="e.g. Jeremiah Christopher"
                value={formData.participants?.organist || ''}
                onChange={(val) => setFormData(prev => ({
                  ...prev,
                  participants: { ...prev.participants, organist: val }
                }))}
                canonicalSuggestions={['Jeremiah Christopher', 'Alvin Arumugam', 'Augustine Paul']}
                entityType="Artist"
              />

              <EntityPicker
                label="Ensemble Choir"
                placeholder="e.g. The Chennai Chorale"
                value={formData.participants?.choir || ''}
                onChange={(val) => setFormData(prev => ({
                  ...prev,
                  participants: { ...prev.participants, choir: val }
                }))}
                canonicalSuggestions={choirsSuggestions}
                entityType="Choir"
              />

              <EntityPicker
                label="Lead Conductor"
                placeholder="e.g. Alvin Arumugam"
                value={formData.participants?.conductor || ''}
                onChange={(val) => setFormData(prev => ({
                  ...prev,
                  participants: { ...prev.participants, conductor: val }
                }))}
                canonicalSuggestions={conductorsSuggestions}
                entityType="Conductor"
              />

              <div className="space-y-1">
                <label className="font-bold text-zinc-400">Orchestral Support</label>
                <input
                  type="text"
                  placeholder="e.g. The South Asian Symphony Orchestra"
                  value={formData.participants?.orchestra || ''}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    participants: { ...prev.participants, orchestra: e.target.value }
                  }))}
                  className="w-full bg-zinc-900/60 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="md:col-span-2 space-y-1">
                <label className="font-bold text-zinc-400">Featured Soloists</label>
                <input
                  type="text"
                  placeholder="e.g. Ebenezer Arunkumar (Tenor), Priya Rajasekar (Soprano)"
                  value={formData.participants?.soloists || ''}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    participants: { ...prev.participants, soloists: e.target.value }
                  }))}
                  className="w-full bg-zinc-900/60 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 6: Educational Content */}
        {currentStep === 6 && (
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-amber-500" />
              Step 6: Educational Content & Archive Guides
            </h3>
            <p className="text-[11px] text-zinc-400 leading-normal">
              Provide context guides and reading notes for scholars, organ students, and classical music fans.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-zinc-400">Difficulty Study Rating</label>
                <select
                  value={formData.educationalContent?.difficultyLevel || 'BEGINNER'}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    educationalContent: { ...prev.educationalContent, difficultyLevel: e.target.value as any }
                  }))}
                  className="w-full bg-zinc-900/60 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500 font-bold"
                >
                  <option value="BEGINNER">Beginner Listener Guide</option>
                  <option value="INTERMEDIATE">Intermediate Student level</option>
                  <option value="ADVANCED">Advanced / Specialist performance notes</option>
                  <option value="SCHOLARLY">Academic Scholarly dissertation</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-zinc-400">Listening Timeline Guide (0:00 notation)</label>
                <input
                  type="text"
                  placeholder="e.g. 0:00 Opening fanfare, 2:15 Fugue theme presentation"
                  value={formData.educationalContent?.listeningGuide || ''}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    educationalContent: { ...prev.educationalContent, listeningGuide: e.target.value }
                  }))}
                  className="w-full bg-zinc-900/60 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="md:col-span-2 space-y-1">
                <label className="font-bold text-zinc-400">Archive Analysis (Markdown study notes)</label>
                <textarea
                  rows={4}
                  placeholder="Enter detailed historical analysis, stop registration details, harmonic structures, counterpoint review..."
                  value={formData.educationalContent?.analysisMarkdown || ''}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    educationalContent: { ...prev.educationalContent, analysisMarkdown: e.target.value }
                  }))}
                  className="w-full bg-zinc-900/60 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 7: Media Assets */}
        {currentStep === 7 && (
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-amber-500" />
              Step 7: Media Assets Library Mapping
            </h3>
            <p className="text-[11px] text-zinc-400 leading-normal">
              Map and manage ancillary digital assets (including booklet PDFs, high-res audio master stems, program booklets, and posters).
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-zinc-400">Master Stem Audio Resource URL</label>
                <input
                  type="text"
                  placeholder="e.g. /media/audio/bach-542-master.wav"
                  value={formData.mediaAssets?.masterAudioUrl || ''}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    mediaAssets: { ...(prev.mediaAssets as any), masterAudioUrl: e.target.value }
                  }))}
                  className="w-full bg-zinc-900/60 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500 font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-zinc-400">Programme PDF URL</label>
                <input
                  type="text"
                  placeholder="e.g. /media/booklets/concert-program.pdf"
                  value={formData.mediaAssets?.programmePdfUrl || ''}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    mediaAssets: { ...(prev.mediaAssets as any), programmePdfUrl: e.target.value }
                  }))}
                  className="w-full bg-zinc-900/60 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500 font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-zinc-400">Poster Graphics Image URL</label>
                <input
                  type="text"
                  placeholder="e.g. /media/posters/poster-hd.jpg"
                  value={formData.mediaAssets?.posterUrl || ''}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    mediaAssets: { ...(prev.mediaAssets as any), posterUrl: e.target.value }
                  }))}
                  className="w-full bg-zinc-900/60 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500 font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-zinc-400">Sheet Music / Score Link</label>
                <input
                  type="text"
                  placeholder="e.g. /media/sheetmusic/bwv542.pdf"
                  value={formData.mediaAssets?.sheetMusicUrl || ''}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    mediaAssets: { ...(prev.mediaAssets as any), sheetMusicUrl: e.target.value }
                  }))}
                  className="w-full bg-zinc-900/60 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500 font-mono"
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 8: SEO & AI Discovery */}
        {currentStep === 8 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
                <Globe className="w-4 h-4 text-amber-500" />
                Step 8: Automated SEO & AI Discovery
              </h3>
              <button
                type="button"
                onClick={handleTriggerAutomations}
                className="flex items-center gap-1.5 px-3 py-1 bg-amber-500 hover:bg-amber-600 text-zinc-950 font-bold rounded text-[10px] cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Automate & Compile Values
              </button>
            </div>
            <p className="text-[11px] text-zinc-400 leading-normal">
              Ensure Google, Bing, and AI search crawlers can index the published performance perfectly. Click "Automate" to compile standard parameters.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-zinc-400">Meta Title</label>
                <input
                  type="text"
                  value={formData.seo?.metaTitle || ''}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    seo: { ...(prev.seo as SEOData), metaTitle: e.target.value }
                  }))}
                  className="w-full bg-zinc-900/60 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-zinc-400">Canonical URL</label>
                <input
                  type="text"
                  value={formData.seo?.canonicalUrl || ''}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    seo: { ...(prev.seo as SEOData), canonicalUrl: e.target.value }
                  }))}
                  className="w-full bg-zinc-900/60 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none focus:border-amber-500 font-mono"
                />
              </div>

              <div className="md:col-span-2 space-y-1">
                <label className="font-bold text-zinc-400">Meta Description</label>
                <textarea
                  rows={3}
                  value={formData.seo?.metaDescription || ''}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    seo: { ...(prev.seo as SEOData), metaDescription: e.target.value }
                  }))}
                  className="w-full bg-zinc-900/60 border border-zinc-800 p-2.5 rounded-lg text-zinc-200 focus:outline-none"
                />
              </div>

              {formData.seo?.jsonLdSchema && (
                <div className="md:col-span-2 space-y-1 font-mono">
                  <label className="font-bold text-zinc-400 block">Schema.org JSON-LD Markup</label>
                  <pre className="w-full bg-zinc-950 p-3 rounded-lg text-[9px] text-zinc-400 max-h-40 overflow-y-auto whitespace-pre-wrap border border-zinc-900">
                    {formData.seo.jsonLdSchema}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 9: Smart Relationships */}
        {currentStep === 9 && (
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
              <LinkIcon className="w-4 h-4 text-amber-500" />
              Step 9: Smart Entity Relationships
            </h3>
            <p className="text-[11px] text-zinc-400 leading-normal">
              Validate internal linkage parameters in the Music Madras Knowledge Engine (MMKE). This establishes clean semantic connections.
            </p>

            {(formData.relationships || []).length === 0 ? (
              <div className="p-6 text-center text-zinc-500 italic bg-zinc-950/20 rounded-lg border border-dashed border-zinc-800 text-xs">
                No automatic links mapped yet. Proceed to Step 8 and select "Automate" to resolve smart linkages.
              </div>
            ) : (
              <div className="space-y-2">
                {(formData.relationships || []).map((rel, idx) => (
                  <div key={idx} className="p-3 bg-zinc-900/40 border border-zinc-850 rounded-lg flex items-center justify-between text-xs animate-fade-in">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 font-bold">
                        <span className="text-zinc-200">{rel.targetName}</span>
                        <span className="text-[9px] bg-zinc-850 text-amber-400 px-1.5 py-0.5 rounded uppercase font-extrabold font-mono border border-zinc-800">
                          {rel.targetType}
                        </span>
                      </div>
                      <p className="text-[10px] text-zinc-500">{rel.reasoning}</p>
                    </div>

                    <div className="text-right">
                      <span className="text-[9px] text-zinc-500 block uppercase font-mono font-bold">Confidence</span>
                      <span className="text-xs font-bold text-emerald-400 font-mono">{(rel.confidenceScore * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 10: Review checklist (SCREEN 5 Checklist before publishing) */}
        {currentStep === 10 && (
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-amber-500" />
              Step 10: Curation Review & Archival Checklist
            </h3>
            
            <div className="p-4 bg-zinc-900/30 border border-zinc-850 rounded-xl space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4 border-b border-zinc-850 pb-3">
                <div>
                  <span className="text-[10px] text-zinc-500 block uppercase font-mono">Primary Title</span>
                  <p className="font-bold text-zinc-100">{formData.title || 'No Title'}</p>
                </div>
                <div>
                  <span className="text-[10px] text-zinc-500 block uppercase font-mono">Featured Ensemble</span>
                  <p className="font-bold text-zinc-100">{formData.artist || 'No Artist'}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 border-b border-zinc-850 pb-3">
                <div>
                  <span className="text-[10px] text-zinc-500 block uppercase font-mono">Concert Programme</span>
                  <p className="font-bold text-zinc-100">{formData.programme?.programmeTitle || 'None specified'}</p>
                </div>
                <div>
                  <span className="text-[10px] text-zinc-500 block uppercase font-mono">Physical Venue</span>
                  <p className="font-bold text-zinc-100">{formData.venue?.name || 'None specified'}</p>
                </div>
              </div>

              <div>
                <span className="text-[10px] text-zinc-500 block uppercase font-mono">Compositions Linked</span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {(formData.works || []).map((w, idx) => (
                    <span key={idx} className="px-2.5 py-1 bg-zinc-950 border border-zinc-850 text-zinc-300 rounded-lg text-[10px] font-bold">
                      {w.title} (by {w.composerName})
                    </span>
                  ))}
                  {(formData.works || []).length === 0 && (
                    <span className="text-red-400 font-bold">❌ No works mapped! Please link compositions.</span>
                  )}
                </div>
              </div>

              {/* Status Checklist items requested by user */}
              <div className="pt-2">
                <span className="text-[10px] text-zinc-500 block uppercase font-mono mb-2">Archival Verification Checklist</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="flex items-center gap-2">
                    {formData.title ? (
                      <span className="text-emerald-400 font-bold font-mono">✔ Recording Logged</span>
                    ) : (
                      <span className="text-red-400 font-mono">❌ Missing Recording Title</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {formData.programme?.programmeTitle ? (
                      <span className="text-emerald-400 font-bold font-mono">✔ Programme Configured</span>
                    ) : (
                      <span className="text-zinc-500 font-mono">⚠ Missing Programme Context</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {(formData.works || []).length > 0 ? (
                      <span className="text-emerald-400 font-bold font-mono">✔ Musical Works Linked</span>
                    ) : (
                      <span className="text-red-400 font-bold font-mono">❌ Missing Compositions</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {formData.venue?.name ? (
                      <span className="text-emerald-400 font-bold font-mono">✔ Venue Localised</span>
                    ) : (
                      <span className="text-zinc-500 font-mono">⚠ Missing Venue Mappings</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {formData.participants?.organist || formData.participants?.choir ? (
                      <span className="text-emerald-400 font-bold font-mono">✔ Participants Authenticated</span>
                    ) : (
                      <span className="text-zinc-500 font-mono">⚠ Missing Participant Entities</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {formData.educationalContent?.listeningGuide || formData.educationalContent?.analysisMarkdown ? (
                      <span className="text-emerald-400 font-bold font-mono">✔ Educational Notes Created</span>
                    ) : (
                      <span className="text-zinc-500 font-mono">⚠ Missing Educational Notes</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {formData.seo?.metaTitle ? (
                      <span className="text-emerald-400 font-bold font-mono">✔ SEO & JSON-LD schema generated</span>
                    ) : (
                      <span className="text-zinc-500 font-mono">⚠ Missing SEO Metadata</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {(formData.relationships || []).length > 0 ? (
                      <span className="text-emerald-400 font-bold font-mono">✔ Smart Linkages Synced</span>
                    ) : (
                      <span className="text-zinc-500 font-mono">⚠ Missing Entity Linkages</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="p-4 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-xl flex gap-2.5 text-xs">
              <AlertTriangle className="w-5 h-5 flex-shrink-0" />
              <div>
                <h4 className="font-bold">Ready for Production Preview</h4>
                <p className="text-[10px] text-amber-500/90 mt-0.5 leading-normal">
                  Proceed to Step 11 to view a pixel-perfect render of how this performance appears to public visitors and scholars before officially publishing.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Step 11: Public Page Preview (SCREEN 6) */}
        {currentStep === 11 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <span className="text-[9px] font-mono text-emerald-400 font-bold uppercase tracking-widest block">Simulation Sandbox</span>
                <h3 className="font-serif text-sm font-bold text-zinc-100 flex items-center gap-2">
                  <Eye className="w-4.5 h-4.5 text-emerald-400" />
                  Visitor Public Page Preview
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCurrentStep(10)}
                className="px-3 py-1 bg-zinc-800 hover:bg-zinc-750 text-zinc-300 font-bold text-[10px] rounded"
              >
                ← Return to Editing
              </button>
            </div>

            {/* Simulated Live Visitor View */}
            <div className="bg-zinc-950 border border-zinc-850 rounded-2xl overflow-hidden font-sans text-zinc-300 shadow-2xl">
              
              {/* Simulated Public Site Header */}
              <header className="bg-zinc-900 px-6 py-4 border-b border-zinc-850 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 bg-amber-500 rounded-lg flex items-center justify-center font-bold text-zinc-950 text-sm">
                    M
                  </div>
                  <div>
                    <span className="font-serif text-xs font-bold tracking-widest text-zinc-100 uppercase">MUSIC MADRAS</span>
                    <span className="text-[8px] text-zinc-500 block uppercase font-mono tracking-wider">Hark! The organ gallery</span>
                  </div>
                </div>

                <nav className="hidden sm:flex items-center gap-4 text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
                  <span className="hover:text-zinc-100 cursor-pointer">Archive</span>
                  <span className="hover:text-zinc-100 cursor-pointer">Composers</span>
                  <span className="hover:text-zinc-100 cursor-pointer">Venues</span>
                  <span className="hover:text-zinc-100 cursor-pointer">About</span>
                </nav>
              </header>

              {/* Simulated Hero Section with Playback */}
              <section className="bg-zinc-950 px-6 py-8 md:py-12 border-b border-zinc-850 relative">
                <div className="max-w-3xl mx-auto space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-mono font-bold uppercase bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded border border-amber-500/20">
                      Live Performance Capture
                    </span>
                    {formData.performanceDate && (
                      <span className="text-[9px] text-zinc-500 font-mono">Recorded on {formData.performanceDate}</span>
                    )}
                  </div>

                  <h1 className="font-serif text-2xl md:text-3xl font-black text-zinc-100 leading-tight">
                    {formData.title || 'Bach - Fantasia in G minor'}
                  </h1>

                  <p className="text-xs md:text-sm text-zinc-400">
                    Performed live by <span className="text-zinc-100 font-bold">{formData.artist || 'Jeremiah Christopher'}</span>
                  </p>

                  {/* YouTube Player Embed inside Preview */}
                  {formData.youtubeId ? (
                    <div className="relative aspect-video rounded-xl overflow-hidden bg-black border border-zinc-800 mt-6 shadow-lg">
                      <iframe
                        className="w-full h-full"
                        src={`https://www.youtube.com/embed/${formData.youtubeId}`}
                        title={formData.title}
                        frameBorder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    </div>
                  ) : (
                    <div className="aspect-video rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center p-6 text-zinc-500 mt-6">
                      YouTube Link Missing
                    </div>
                  )}
                </div>
              </section>

              {/* Simulated Public Layout Body */}
              <div className="px-6 py-8 max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
                
                {/* Main Content Area */}
                <div className="md:col-span-2 space-y-6">
                  
                  {/* Performance Description */}
                  <div className="space-y-2">
                    <h3 className="font-serif text-xs font-bold text-zinc-100 uppercase tracking-widest">About this Capture</h3>
                    <p className="text-[11px] text-zinc-400 leading-relaxed whitespace-pre-wrap">
                      {formData.description || 'This canonical live concert recording represents a critical chapter of high-fidelity music archiving in India.'}
                    </p>
                  </div>

                  {/* Concert Programme notes */}
                  {formData.programme?.programmeTitle && (
                    <div className="p-4 bg-zinc-900/60 border border-zinc-850 rounded-xl space-y-3">
                      <h4 className="font-serif text-xs font-bold text-zinc-200">
                        Programme: {formData.programme.programmeTitle}
                      </h4>
                      <p className="text-[10px] text-zinc-400 italic">
                        {formData.programme.programmeNotes}
                      </p>
                      {formData.programme.movements && (
                        <div className="text-[10px] text-zinc-500 border-t border-zinc-850 pt-2 font-mono">
                          <span className="font-bold text-zinc-400">Movements:</span> {formData.programme.movements}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Educational Notes */}
                  {(formData.educationalContent?.listeningGuide || formData.educationalContent?.analysisMarkdown) && (
                    <div className="space-y-3 pt-4 border-t border-zinc-900">
                      <h3 className="font-serif text-xs font-bold text-zinc-100 uppercase tracking-widest flex items-center gap-1.5 text-emerald-400">
                        <BookOpen className="w-4 h-4" />
                        Scholar & Study Notes
                      </h3>
                      
                      {formData.educationalContent.listeningGuide && (
                        <div className="p-2.5 bg-zinc-900/40 border border-zinc-850 rounded-lg text-[10px] font-mono">
                          <span className="font-bold text-zinc-400 block mb-1">Timeline guide</span>
                          {formData.educationalContent.listeningGuide}
                        </div>
                      )}

                      {formData.educationalContent.analysisMarkdown && (
                        <p className="text-[11px] text-zinc-400 leading-relaxed whitespace-pre-wrap italic">
                          {formData.educationalContent.analysisMarkdown}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Simulated Public Sidebar */}
                <div className="space-y-6">
                  
                  {/* Venue Mapping */}
                  {formData.venue?.name && (
                    <div className="p-4 bg-zinc-900/30 border border-zinc-850 rounded-xl space-y-2">
                      <h4 className="font-serif text-[10px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-emerald-500" /> Venue Node
                      </h4>
                      <p className="text-xs font-bold text-zinc-200">{formData.venue.name}</p>
                      {formData.venue.acousticProfile && (
                        <p className="text-[9px] text-zinc-500 font-mono leading-tight">{formData.venue.acousticProfile}</p>
                      )}
                    </div>
                  )}

                  {/* Performers */}
                  {(formData.participants?.organist || formData.participants?.choir) && (
                    <div className="p-4 bg-zinc-900/30 border border-zinc-850 rounded-xl space-y-2">
                      <h4 className="font-serif text-[10px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1">
                        <Users className="w-3.5 h-3.5 text-amber-500" /> Performers
                      </h4>
                      {formData.participants.organist && (
                        <div className="text-[11px]">
                          <span className="text-[9px] text-zinc-500 block">Lead Instrumentalist</span>
                          <span className="font-bold text-zinc-200">{formData.participants.organist}</span>
                        </div>
                      )}
                      {formData.participants.choir && (
                        <div className="text-[11px] pt-1">
                          <span className="text-[9px] text-zinc-500 block">Ensemble Choir</span>
                          <span className="font-bold text-zinc-200">{formData.participants.choir}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Related Works Linkage */}
                  {(formData.works || []).length > 0 && (
                    <div className="p-4 bg-zinc-900/30 border border-zinc-850 rounded-xl space-y-2">
                      <h4 className="font-serif text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                        Related Musical Works
                      </h4>
                      <div className="space-y-2">
                        {formData.works.map((w, idx) => (
                          <div key={idx} className="text-[10px] bg-zinc-950/60 p-2 rounded border border-zinc-900">
                            <span className="font-bold text-zinc-200 block">{w.title}</span>
                            <span className="text-[9px] text-amber-500 font-bold">{w.composerName}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Internal Linkage tags mapped in Step 8/9 */}
                  {formData.seo?.internalLinks && formData.seo.internalLinks.length > 0 && (
                    <div className="space-y-1.5">
                      <span className="text-[9px] font-mono font-bold text-zinc-500 uppercase tracking-widest block">Engine Linkages</span>
                      <div className="flex flex-wrap gap-1">
                        {formData.seo.internalLinks.map((lnk, i) => (
                          <span key={i} className="text-[9px] font-mono bg-zinc-900 text-zinc-400 px-2 py-0.5 rounded hover:text-amber-400 cursor-pointer">
                            {lnk}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                </div>

              </div>

              {/* Simulated SEO Google snippet inside public preview page */}
              <div className="bg-zinc-900 border-t border-zinc-850 p-4 font-mono">
                <span className="text-[8px] text-zinc-500 block uppercase font-bold tracking-widest mb-1">Google SERP Preview</span>
                <div className="bg-zinc-950 p-3 rounded-lg text-left text-[10px] space-y-0.5">
                  <span className="text-blue-400 font-bold hover:underline">{formData.seo?.metaTitle || `${formData.title} | Music Madras`}</span>
                  <span className="text-emerald-600 block text-[9px] truncate">{formData.seo?.canonicalUrl || `https://www.musicmadras.com/...`}</span>
                  <span className="text-zinc-500 block leading-snug line-clamp-1">{formData.seo?.metaDescription || 'No meta description preview.'}</span>
                </div>
              </div>

            </div>
          </div>
        )}

      </div>

      {/* Wizard Form Navigation Control Buttons */}
      <div className="flex justify-between items-center gap-4 text-xs">
        <button
          type="button"
          onClick={() => setCurrentStep(prev => Math.max(1, prev - 1))}
          disabled={currentStep === 1}
          className="flex items-center gap-1.5 px-4 py-2 bg-zinc-850 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 font-bold rounded-lg transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ArrowLeft className="w-4 h-4" />
          Previous Step
        </button>

        {currentStep < 11 ? (
          <button
            type="button"
            onClick={() => setCurrentStep(prev => Math.min(11, prev + 1))}
            className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-zinc-950 font-bold rounded-lg transition-colors cursor-pointer"
          >
            Next Step
            <ArrowRight className="w-4 h-4" />
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCurrentStep(10)}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-750 text-zinc-300 font-bold rounded-lg border border-zinc-750 cursor-pointer"
            >
              Return to Editing
            </button>
            <button
              type="button"
              onClick={() => onPublish(formData.id)}
              disabled={!formData.title || (formData.works || []).length === 0}
              className="flex items-center gap-1.5 px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-zinc-950 font-black rounded-lg transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <CheckCircle className="w-4 h-4" />
              Commit & Publish Registry
            </button>
          </div>
        )}
      </div>

    </div>
  );
}
