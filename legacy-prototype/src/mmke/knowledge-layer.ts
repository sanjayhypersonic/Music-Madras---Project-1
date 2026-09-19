/**
 * Music Madras Knowledge Engine (MMKE) - Core Knowledge Layer
 * Acts as the centralized single source of truth (SSOT) managing archival metadata, relationships,
 * and indexing for Music Madras.
 */

import { 
  Composer, 
  MusicalWork, 
  Performance, 
  Recording, 
  Playlist, 
  Venue, 
  Choir, 
  Conductor, 
  Artist, 
  Instrument, 
  LearningGuide, 
  Recommendation, 
  Organisation 
} from './types/entities';

export class MusicMadrasKnowledgeLayer {
  private static instance: MusicMadrasKnowledgeLayer | null = null;

  // Active records database lists representing initial sample/schema entities
  private composers: Map<string, Composer> = new Map();
  private works: Map<string, MusicalWork> = new Map();
  private performances: Map<string, Performance> = new Map();
  private recordings: Map<string, Recording> = new Map();
  private playlists: Map<string, Playlist> = new Map();
  private venues: Map<string, Venue> = new Map();
  private choirs: Map<string, Choir> = new Map();
  private conductors: Map<string, Conductor> = new Map();
  private artists: Map<string, Artist> = new Map();
  private instruments: Map<string, Instrument> = new Map();
  private guides: Map<string, LearningGuide> = new Map();
  private recommendations: Map<string, Recommendation> = new Map();
  private organisations: Map<string, Organisation> = new Map();

  private constructor() {
    this.seedInitialSampleData();
  }

  /**
   * Singleton pattern to guarantee single memory registry.
   */
  public static getInstance(): MusicMadrasKnowledgeLayer {
    if (!this.instance) {
      this.instance = new MusicMadrasKnowledgeLayer();
    }
    return this.instance;
  }

  /**
   * Populates baseline structure schema and sample data links showing relationships in actions.
   */
  private seedInitialSampleData() {
    // 1. Seed Composers
    const bach: Composer = {
      id: 'composer-bach',
      name: 'Johann Sebastian Bach',
      born: '1685-03-31',
      died: '1750-07-28',
      nationality: 'German',
      biography: 'German composer and musician of the late Baroque period, renowned for his robust counterpoint and keyboard mastery.',
      era: 'Baroque',
      notableInstruments: [],
      worksIds: ['work-bwv565', 'work-bwv582']
    };
    this.composers.set(bach.id, bach);

    // 2. Seed Venues
    const stAndrews: Venue = {
      id: 'venue-standrews',
      name: "St. Andrew's Church (The Kirk)",
      type: 'CHURCH',
      address: 'Egmore, Chennai',
      city: 'Chennai',
      country: 'India',
      capacity: 500,
      acousticProfile: 'Highly reverberant brick & stone vault dome (approx. 3.2s decay time)',
      organSpecsId: 'instr-kirk-organ'
    };
    this.venues.set(stAndrews.id, stAndrews);

    // 3. Seed Instruments
    const kirkOrgan: Instrument = {
      id: 'instr-kirk-organ',
      name: "St. Andrew's Pipe Organ",
      manufacturer: 'Peter Conacher & Co',
      buildYear: '1883',
      specifications: {
        stopsCount: 18,
        manualsCount: 2,
        actionType: 'TRACKER'
      },
      installationVenueId: 'venue-standrews',
      description: 'A historic tracker action pipe organ built in Huddersfield, England, and shipped to Madras in 1883.'
    };
    this.instruments.set(kirkOrgan.id, kirkOrgan);

    // 4. Seed MusicalWorks
    const bwv565: MusicalWork = {
      id: 'work-bwv565',
      title: 'Toccata and Fugue in D minor',
      composerId: 'composer-bach',
      catalogueNumber: 'BWV 565',
      durationMinutes: 9,
      description: 'Arguably the most famous work in the entire organ literature, opening with its iconic dramatic flourishes.',
      performanceIds: ['perf-live-001'],
      educationalGuideIds: ['guide-organ-basics'],
      similarWorkIds: ['work-bwv582'],
      tags: ['Toccata', 'Fugue', 'Dramatic', 'Baroque']
    };
    this.works.set(bwv565.id, bwv565);

    // 5. Seed Performances
    const livePerf: Performance = {
      id: 'perf-live-001',
      workId: 'work-bwv565',
      performanceDate: '2026-03-15T18:30:00Z',
      venueId: 'venue-standrews',
      performerIds: ['artist-organist-01'],
      recordingIds: ['rec-001'],
      isPublic: true,
      programNotes: 'Recorded during the annual Easter Festival Concert under warm acoustic lighting.'
    };
    this.performances.set(livePerf.id, livePerf);

    // 6. Seed Recordings
    const liveRec: Recording = {
      id: 'rec-001',
      performanceId: 'perf-live-001',
      format: 'VIDEO_HD',
      recordingDate: '2026-03-15',
      durationSeconds: 540,
      copyrightOwner: 'Music Madras Foundation'
    };
    this.recordings.set(liveRec.id, liveRec);
  }

  // --- QUERY APIS (Safe read methods demonstrating the clean retrieval of relational entities) ---

  public getComposer(id: string): Composer | undefined {
    return this.composers.get(id);
  }

  public getWork(id: string): MusicalWork | undefined {
    return this.works.get(id);
  }

  public getVenue(id: string): Venue | undefined {
    return this.venues.get(id);
  }

  public getInstrument(id: string): Instrument | undefined {
    return this.instruments.get(id);
  }

  public getPerformance(id: string): Performance | undefined {
    return this.performances.get(id);
  }

  public getRecording(id: string): Recording | undefined {
    return this.recordings.get(id);
  }

  /**
   * Traverses the relational schema to locate all performances of a specific work.
   * Relationship Resolver: Works -> Performances
   */
  public getPerformancesForWork(workId: string): Performance[] {
    return Array.from(this.performances.values()).filter(p => p.workId === workId);
  }

  /**
   * Identifies the physical instrument played during a particular performance.
   * Traverses: Performance -> Venue -> Instrument
   */
  public getInstrumentForPerformance(performanceId: string): Instrument | undefined {
    const perf = this.getPerformance(performanceId);
    if (!perf) return undefined;
    
    const venue = this.getVenue(perf.venueId);
    if (!venue || !venue.organSpecsId) return undefined;

    return this.getInstrument(venue.organSpecsId);
  }

  /**
   * Resolves a work's composer node.
   * Traverses: Work -> Composer
   */
  public getComposerOfWork(workId: string): Composer | undefined {
    const work = this.getWork(workId);
    if (!work) return undefined;
    return this.getComposer(work.composerId);
  }
}
