# Music Madras Knowledge Engine (MMKE)
## Phase 0.6A — Canonical Knowledge Objects Specification

This specification establishes the permanent, reusable information architecture ("DNA") of the **Music Madras Knowledge Engine (MMKE)**. It defines five core canonical knowledge objects, their progressive enrichment lifecycle, relationship rules, and integration paradigms (AI, SEO, and Media).

---

## 1. Canonical Composer Knowledge Object

### 1.1 Purpose
The Composer object models the origin of musical heritage. It translates historical figures and contemporary masters into nodes of structured analytical data, enabling multi-era classification and context-aware recommendations.

### 1.2 Knowledge Model Schema
```typescript
interface CanonicalComposer {
  // --- LEVEL 1: CORE FACTS ---
  id: string;                      // Uniform resource ID: e.g., "composer:johann-sebastian-bach"
  name: string;                    // Primary professional name: e.g., "Johann Sebastian Bach"
  canonicalSlug: string;           // URL-safe slug: e.g., "johann-sebastian-bach"
  born: string;                    // Birth date (ISO-8601 or historical year string: "1685-03-31")
  died: string | null;             // Death date (ISO-8601, or null if living)
  nationality: string;             // Country of origin/heritage
  era: 'Renaissance' | 'Baroque' | 'Classical' | 'Romantic' | 'Modern' | 'Contemporary';
  
  // --- LEVEL 2: EDUCATIONAL VALUE ---
  biographySummary: string;        // Concise 2-3 sentence overview
  extendedBiographyMarkdown: string; // Comprehensive editorial narrative
  stylisticAttributes: string[];   // Stylistic tags: e.g., ["Counterpoint", "Chorale Prelude", "Polyphony"]
  notableInstruments: string[];    // Instruments primarily associated with: e.g., ["Pipe Organ", "Harpsichord"]
  
  // --- LEVEL 3: MUSIC MADRAS RESOURCES ---
  worksIds: string[];              // Linked MusicalWork entity IDs
  associatedPlaylists: string[];   // Curated MM Playlists featuring this composer
  
  // --- LEVEL 4: ADVANCED RESEARCH ---
  externalReferences: {
    imslpUrl?: string;             // Link to sheet music archives
    wikipediaUrl?: string;         // Biography grounding URL
    groveMusicOnlineId?: string;   // Scholarly research identifier
  };
  customSearchKeywords: string[];  // Synonyms/aliases for semantic search indexing
}
```

### 1.3 Computed Fields
* `lifespanYears`: Automatically calculated string or number representing the composer's age or historical era duration.
* `activeWorksCount`: The size of the `worksIds` array loaded in the active Knowledge Layer.

### 1.4 AI Grounding Prompts
* *"Explain the structural contribution of {name} to the evolution of fugal counterpoint."*
* *"What instruments at Madras are best suited for performing works by {name}?"*

---

## 2. Canonical Musical Work Knowledge Object

### 2.1 Purpose
The Musical Work represents a distinct abstract composition. It is independent of any single live event or recording, serving as the pivot connecting composers to actual performances, educational collection guides, and music analytical data.

### 2.2 Knowledge Model Schema
```typescript
interface CanonicalMusicalWork {
  // --- LEVEL 1: CORE FACTS ---
  id: string;                      // Uniform resource ID: e.g., "work:bwv-565"
  composerId: string;              // Related Composer ID
  title: string;                   // Composition title: e.g., "Toccata and Fugue in D minor"
  catalogueNumber?: string;        // Catalogue designation: e.g., "BWV 565"
  compositionYear?: string;        // Estimation or exact year of composition
  keySignature?: string;           // Key, e.g., "D minor"
  
  // --- LEVEL 2: EDUCATIONAL VALUE ---
  difficultyLevel: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED' | 'SCHOLARLY';
  structuralForm: string;          // e.g., "Toccata & Fugue", "Choral Prelude", "Sonata"
  analyticalDescription: string;   // Analysis of the counterpoint, registration, and style
  pedagogicalFocusPoints: string[]; // e.g., ["Double-pedaling", "Terraced dynamics", "Trio playing"]
  
  // --- LEVEL 3: MUSIC MADRAS RESOURCES ---
  performanceIds: string[];        // Relational Performance nodes
  learningGuideIds: string[];      // Associated Educational Collection guides
  similarWorkIds: string[];        // Recommended similar compositions
  
  // --- LEVEL 4: ADVANCED RESEARCH ---
  recommendedRegistration: {
    manualsPreferred?: string;     // Organ manuals requirements
    stopFamiliesSuggested?: string[]; // e.g., ["Principal 8'", "Mixture IV", "Flute 4'"]
  };
}
```

### 2.3 Computed Fields
* `displayName`: Concatenates `title` and `catalogueNumber` (e.g., *"Toccata and Fugue in D minor (BWV 565)"*).
* `isRecordedByMusicMadras`: Evaluated boolean returning true if `performanceIds` contains active recordings.

### 2.4 AI Grounding Prompts
* *"Analyze the counterpoint structure of {displayName} and explain how to listen to it."*
* *"Recommend similar pieces to {displayName} from the same era."*

---

## 3. Canonical Performance Knowledge Object

### 3.1 Purpose
The Performance model contextualizes a real-world physical event occurring at a specific time and place. It details the acoustic environments, instruments played, conductors, choirs, and ensembles involved.

### 3.2 Knowledge Model Schema
```typescript
interface CanonicalPerformance {
  // --- LEVEL 1: CORE FACTS ---
  id: string;                      // e.g., "performance:kirk-easter-2026"
  workId: string;                  // Associated MusicalWork ID
  performanceDate: string;         // ISO-8601 Timestamp
  venueId: string;                 // Venue ID where the performance took place
  
  // --- LEVEL 2: EDUCATIONAL VALUE ---
  performerIds: string[];          // Artist IDs participating
  conductorId?: string;            // Conductor ID (if orchestral/choral)
  choirId?: string;                // Choir ID (if vocal)
  instrumentPlayedId?: string;     // Specific Instrument ID played (e.g., "instr-kirk-organ")
  
  // --- LEVEL 3: MUSIC MADRAS RESOURCES ---
  recordingIds: string[];          // Associated audio/video Recording nodes
  programNotesMarkdown?: string;   // Historical notes distributed during the performance
  
  // --- LEVEL 4: ADVANCED RESEARCH ---
  registrationLog?: {              // Registrations logged by the organist for archive reference
    section: string;
    stopsPulled: string[];
  }[];
}
```

### 3.3 Computed Fields
* `acousticEnvironment`: Evaluates and inherits the acoustics of the parent `venueId` (e.g., *"Highly reverberant St. Andrew's Kirk"*).
* `hasVideoTrack`: Boolean returning true if any associated recording contains a HD/4K video resource.

### 3.4 AI Grounding Prompts
* *"Describe the performance context of {workId} played on the historic Conacher Organ at St. Andrew's Kirk."*

---

## 4. Canonical Recording Knowledge Object

### 4.1 Purpose
The Recording model describes the technological capture of a Performance. It manages multi-format streams, platform locations (e.g., YouTube), capture hardware metrics, and streaming URLs.

### 4.2 Knowledge Model Schema
```typescript
interface CanonicalRecording {
  // --- LEVEL 1: CORE FACTS ---
  id: string;                      // e.g., "recording:rec-001"
  performanceId: string;           // Link back to physical Performance
  durationSeconds: number;         // Master file duration
  format: 'AUDIO_ONLY' | 'VIDEO_HD' | 'VIDEO_4K' | 'MASTER_MULTITRACK';
  
  // --- LEVEL 2: EDUCATIONAL VALUE ---
  recordingEngineer?: string;      // Sound engineer credits
  masteringBitDepth?: number;      // e.g., 24
  masteringSampleRateHz?: number;  // e.g., 96000
  
  // --- LEVEL 3: MUSIC MADRAS RESOURCES ---
  platformLinks: {
    youtubeVideoId?: string;       // Public YouTube Video ID reference
    youtubeUnlistedId?: string;    // Unlisted/Archive raw reference
    youtubeMusicId?: string;       // Streaming Music references
    spotifyTrackId?: string;       // Future platform mapping
    appleMusicId?: string;         // Future platform mapping
  };
  
  // --- LEVEL 4: ADVANCED RESEARCH ---
  microphoneLayoutNotes?: string;  // Tech details: e.g., "ORTF stereo pair near organ gallery"
}
```

### 4.3 Computed Fields
* `durationDisplay`: Converts raw seconds to readable string format (e.g., *"9:15"*).
* `activeStreamingPlatform`: Returns the primary online platform from which the stream can be requested.

### 4.4 AI Grounding Prompts
* *"Retrieve the high-fidelity recording details for {id} and display the streaming video link."*

---

## 5. Canonical Educational Collection Knowledge Object

### 5.1 Purpose
The Educational Collection structure models pathways, listening guides, and guided curriculum courses. It structures raw archive entries into paths suitable for systematic study.

### 5.2 Knowledge Model Schema
```typescript
interface CanonicalEducationalCollection {
  // --- LEVEL 1: CORE FACTS ---
  id: string;                      // e.g., "collection:art-of-pipe-organ"
  slug: string;                    // URL-safe route slug
  title: string;                   // Path name: e.g., "The Art of the Pipe Organ"
  topic: 'BEGINNER_GUIDE' | 'SACRED_MUSIC' | 'PIPE_ORGAN' | 'CHOIRS' | 'COMPOSERS' | 'LEARNING_PATH';
  shortDescription: string;        // Brief description
  
  // --- LEVEL 2: EDUCATIONAL VALUE ---
  difficulty: 'NOVICE' | 'APPRENTICE' | 'SCHOLAR' | 'VIRTUOSO';
  extendedSyllabusMarkdown: string; // Extensive course description and learning objectives
  listeningFocusQuestions: string[]; // Standard focus questions to guide active listening
  
  // --- LEVEL 3: MUSIC MADRAS RESOURCES ---
  curatedSteps: {
    stepNumber: number;
    title: string;
    objective: string;
    associatedWorkId?: string;     // Highlighted work
    associatedRecordingId?: string; // Performance video
    readingMaterialMarkdown: string; // In-situ guide reading block
  }[];
  
  // --- LEVEL 4: ADVANCED RESEARCH ---
  scholarlyBibliography?: string[]; // Scholarly references and recommended reading
}
```

---

## 6. Progressive Knowledge Enrichment (PKE) Model

To accommodate varying archival states without delaying publication, MMKE uses a **4-Tier Progressive Enrichment Model**:

```
+-------------------------------------------------------------+
| LEVEL 1: Core Archival Facts (ID, Title, Date, Venue, Link) | -> Minimum for ingest
+-------------------------------------------------------------+
                            |
                            v
+-------------------------------------------------------------+
| LEVEL 2: Educational Context (Bio, Difficulty, Analysis)    | -> Adds curation
+-------------------------------------------------------------+
                            |
                            v
+-------------------------------------------------------------+
| LEVEL 3: Media & Relationships (Linked recordings & guides) | -> Enhances discovery
+-------------------------------------------------------------+
                            |
                            v
+-------------------------------------------------------------+
| LEVEL 4: Advanced Research (Organ specs, full registrations)| -> Scholarly level
+-------------------------------------------------------------+
```

---

## 7. Knowledge Relationship Rules

To guarantee strict referential integrity across the system graph:
1. **No Orphan Performances**: A Performance MUST always resolve back to a valid `MusicalWork` ID and a valid `Venue` ID.
2. **One-Way ID Preservation**: To avoid recursive JSON loop issues, keep arrays of IDs flat and resolve them programmatically via the `MusicMadrasKnowledgeLayer` singleton.
3. **Automatic Instrument Matching**: An organ performance must inherit the specifications of the organ installed in the venue where it was performed.

---

## 8. Editorial & Quality Standards

### 8.1 Writing Style & Tone
* **Tone**: Academic, highly respectful, objective, and deeply editorial. Avoid sensationalist language or marketing terminology (e.g., replace *"mind-blowing performance"* with *"masterful execution demonstrating precise control over registration changes"*).
* **Naming Conventions**: Use full composer names (e.g., *Dieterich Buxtehude*, not *D. Buxtehude*). Use scientific catalog markers (BWV, Op.) in italics.

### 8.2 Citation Standards
* References to historical manuscripts must cite source libraries when available (e.g., *Staatsbibliothek zu Berlin* for Bach manuscripts).

---

## 9. SEO & Metadata Standards

### 9.1 Canonical URL Philosophy
Each entity type has a strict URL schema:
* **Composers**: `/composers/[slug]`
* **Musical Works**: `/works/[slug]`
* **Educational Paths**: `/education/[slug]`

### 9.2 Schema.org Structured Data
* **Composer**: Maps to `Schema.org/MusicGroup` or `Schema.org/Person`.
* **Musical Work**: Maps to `Schema.org/MusicComposition`.
* **Performance/Recording**: Maps to `Schema.org/MusicRecording` or `Schema.org/MusicVideoObject`.

---

## 10. AI Coordination Standards

To enable natural, context-aware interaction with the AI Assistant:
1. **RAG Grounding Preference**: The AI must never hallucinate dates, locations, or catalog numbers. When a user asks about a work, the system must search the MMKE Knowledge Layer, extract the structured node, and feed it as static system context.
2. **Context-Aware Persona Shifts**:
   * *Music Librarian*: Focuses strictly on catalogue numbers, manuscripts, and specifications.
   * *Music Educator*: Explains the fundamentals of modes, counterpoint, and provides learning paths.

---

## 11. Publishing & Quality Checklist

Before publishing any knowledge card or entity:
- [ ] **Type Validation**: The object conforms to its designated TypeScript interface.
- [ ] **Referential Integrity**: All referenced IDs (`workId`, `composerId`, `venueId`) exist in the registry.
- [ ] **Metadata Completeness**: Level 1 core facts are complete.
- [ ] **Copy Editing**: Narrative bios contain no subjective hype; spelling of historical figures matches IMSLP standards.
- [ ] **SEO Schema**: Corresponding JSON-LD structured schema block compiles.
- [ ] **RAG Flag**: Search keywords are populated for indexing.

---

## 12. Future Expansion Notes

Over the next decade, this schema can be extended to include:
* **Dynamic MIDI Roll Maps**: Attaching keyboard key-press metadata for direct piano-roll overlays.
* **Acoustic Waveforms**: Storing convolution impulse responses (SIR) of venues like the Kirk or St. Mary's so digital players can hear recordings simulated in different architectural spaces.
* **Music Madras API Integrations**: Serving as a headless graph CMS for third-party classical learning apps.
