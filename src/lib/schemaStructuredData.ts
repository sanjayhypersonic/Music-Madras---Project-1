import { Video, Playlist } from '../types';

/**
 * Parses duration formats like 'MM:SS' or 'HH:MM:SS' to ISO 8601 durations (e.g. PT3M47S)
 */
export function parseDurationToISO8601(durationStr: string): string {
  if (!durationStr) return 'PT0S';
  const parts = durationStr.split(':');
  if (parts.length === 2) {
    const minutes = parseInt(parts[0], 10) || 0;
    const seconds = parseInt(parts[1], 10) || 0;
    return `PT${minutes}M${seconds}S`;
  } else if (parts.length === 3) {
    const hours = parseInt(parts[0], 10) || 0;
    const minutes = parseInt(parts[1], 10) || 0;
    const seconds = parseInt(parts[2], 10) || 0;
    return `PT${hours}H${minutes}M${seconds}S`;
  }
  return 'PT0S';
}

/**
 * Intelligent performance date parser extracting actual timestamps from descriptions or title strings
 */
export function extractEventDate(title: string, description: string): string {
  const dateRegex = /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}/i;
  const match = title.match(dateRegex) || description.match(dateRegex);
  if (match) {
    const d = new Date(match[0]);
    if (!isNaN(d.getTime())) {
      return d.toISOString().split('T')[0];
    }
  }

  const yearRegex = /\b(202\d)\b/;
  const yearMatch = title.match(yearRegex) || description.match(yearRegex);
  if (yearMatch) {
    return `${yearMatch[1]}-01-01`;
  }

  return '2025-12-01'; // Fallback to a valid historical archive date
}

/**
 * Dynamic venue extractor resolving historic Chennai structures
 */
export function extractVenue(description: string, title: string): { name: string; address: string } {
  const combined = `${title} ${description}`.toLowerCase();
  if (combined.includes("st. andrew's") || combined.includes("the kirk")) {
    return {
      name: "St. Andrew's Church (The Kirk)",
      address: "Poonamallee High Rd, Egmore, Chennai, Tamil Nadu 600008"
    };
  }
  if (combined.includes("arulnathar lutheran")) {
    return {
      name: "TELC Arulnathar Lutheran Church",
      address: "Egmore, Chennai, Tamil Nadu 600008"
    };
  }
  if (combined.includes("emmanuel methodist")) {
    return {
      name: "Emmanuel Methodist Church",
      address: "Vepery, Chennai, Tamil Nadu 600007"
    };
  }
  if (combined.includes("bishop heber chapel")) {
    return {
      name: "Bishop Heber Chapel",
      address: "Vepery, Chennai, Tamil Nadu 600007"
    };
  }
  if (combined.includes("adaikalanathar")) {
    return {
      name: "TELC Adaikalanathar Lutheran Church",
      address: "Tana Street, Purasawalkam, Chennai, Tamil Nadu 600007"
    };
  }
  return {
    name: "Music Madras Live Archival Hall",
    address: "Chennai, Tamil Nadu, India"
  };
}

/**
 * Generates schema.org MusicRecording JSON-LD for a single Video object
 */
export function getRecordingSchema(video: Video) {
  return {
    "@context": "https://schema.org",
    "@type": "MusicRecording",
    "name": video.title,
    "url": `https://www.musicmadras.com/?tab=${video.category}&video=${video.id}`,
    "duration": parseDurationToISO8601(video.duration),
    "byArtist": {
      "@type": "MusicGroup",
      "name": video.artist,
      "url": "https://www.musicmadras.com"
    },
    "recordingOf": {
      "@type": "MusicalWork",
      "name": video.title.split('|')[0].trim()
    },
    "thumbnailUrl": video.thumbnailUrl,
    "description": video.description
  };
}

/**
 * Generates schema.org MusicEvent (Concert) JSON-LD for a given Concert video object
 */
export function getConcertSchema(video: Video) {
  const date = extractEventDate(video.title, video.description);
  const venue = extractVenue(video.description, video.title);

  return {
    "@context": "https://schema.org",
    "@type": "MusicEvent",
    "name": video.title,
    "description": video.description,
    "startDate": `${date}T18:30:00+05:30`,
    "eventStatus": "https://schema.org/EventScheduled",
    "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
    "location": {
      "@type": "MusicVenue",
      "name": venue.name,
      "address": {
        "@type": "PostalAddress",
        "addressLocality": "Chennai",
        "addressRegion": "Tamil Nadu",
        "addressCountry": "IN",
        "streetAddress": venue.address
      }
    },
    "performer": {
      "@type": "MusicGroup",
      "name": video.artist,
      "url": "https://www.musicmadras.com"
    },
    "workPerformed": {
      "@type": "MusicalWork",
      "name": video.title.split('|')[0].trim()
    },
    "image": [
      video.thumbnailUrl,
      `https://img.youtube.com/vi/${video.youtubeId}/maxresdefault.jpg`
    ]
  };
}

/**
 * Generates schema.org MusicAlbum compilation JSON-LD for a given Playlist object
 */
export function getAlbumSchema(playlist: Playlist, associatedVideos: Video[]) {
  // Match tracks that belong to or are similar to this playlist/artist
  const matchingTracks = associatedVideos
    .filter(v => {
      const lowerTitle = playlist.title.toLowerCase();
      const lowerArtist = v.artist.toLowerCase();
      const lowerVideoTitle = v.title.toLowerCase();
      
      // Heuristic matches
      return (
        lowerTitle.includes(lowerArtist) ||
        lowerArtist.includes(lowerTitle) ||
        (lowerTitle.includes("saso") && lowerArtist.includes("saso")) ||
        (lowerTitle.includes("emc") && lowerVideoTitle.includes("emc")) ||
        (lowerTitle.includes("bishop heber") && lowerVideoTitle.includes("bishop heber")) ||
        (lowerTitle.includes("chromatics") && lowerVideoTitle.includes("chromatics"))
      );
    })
    .slice(0, 8); // Limit to top 8 items for a concise compilation

  return {
    "@context": "https://schema.org",
    "@type": "MusicAlbum",
    "name": playlist.title,
    "description": playlist.description,
    "url": `https://www.musicmadras.com/?tab=playlists`,
    "albumReleaseType": "CompilationAlbum",
    "byArtist": {
      "@type": "MusicGroup",
      "name": "Music Madras Artists",
      "url": "https://www.musicmadras.com"
    },
    "numTracks": playlist.videoCount,
    "image": playlist.thumbnailUrl,
    "track": matchingTracks.map((v, index) => ({
      "@type": "MusicRecording",
      "position": index + 1,
      "name": v.title,
      "duration": parseDurationToISO8601(v.duration),
      "url": `https://www.musicmadras.com/?tab=playlists&video=${v.id}`,
      "byArtist": {
        "@type": "MusicGroup",
        "name": v.artist
      }
    }))
  };
}

/**
 * Generates schema.org Organization (MusicGroup/RecordingStudio) entity foundation
 */
export function getOrganizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "RecordingStudio",
    "@id": "https://www.musicmadras.com/#organization",
    "name": "Music Madras",
    "url": "https://www.musicmadras.com",
    "logo": "https://yt3.googleusercontent.com/d0KOXSy8sQFmrwCGqkTjm90JYMpqdtrFpjtQCh7145eUjEf0XDnCxPXvfg6_RvKnaIY091x5_TA=s250-c-k-c0x00ffffff-no-rj",
    "description": "Music Madras is Chennai's premier digital platform dedicated to preserving, promoting, and documenting Western classical music traditions.",
    "address": {
      "@type": "PostalAddress",
      "addressLocality": "Chennai",
      "addressRegion": "Tamil Nadu",
      "addressCountry": "IN"
    },
    "sameAs": [
      "https://www.youtube.com/@MusicMadras"
    ]
  };
}

/**
 * Generates schema.org WebSite configuration
 */
export function getWebsiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": "https://www.musicmadras.com/#website",
    "name": "Music Madras",
    "url": "https://www.musicmadras.com",
    "potentialAction": {
      "@type": "SearchAction",
      "target": "https://www.musicmadras.com/?search={search_term_string}",
      "query-input": "required name=search_term_string"
    }
  };
}

/**
 * Generates schema.org WebPage entity representing the active view context
 */
export function getWebPageSchema(activeTab: string, activeVideoTitle?: string, activeVideoId?: string | null) {
  const sectionNames: Record<string, string> = {
    'home': 'Home',
    'playlists': 'Curated Classical Playlists',
    'tech-specs': 'Studio Rig & Gear Specifications',
    'artist-program': 'Free Recording Artist Program',
    'Concert': 'Live Performance Showcases',
    'Organ': 'Pipe Organ Recitals',
    'Choral': 'Choirs & Sacred Ensembles',
    'Vocal': 'Solo Vocal Performances',
    'Instrumental': 'Classical Orchestras & Instruments',
    'all': 'All Recorded Works'
  };

  const sectionDescriptions: Record<string, string> = {
    'home': "Music Madras is Chennai's premier home for Western classical music. Discover live concert archives, pipe organ recitals, and classical choral recordings.",
    'playlists': "Listen to curated Western classical music, sacred choir compositions, and pipe organ masterpieces curated by Madras Music.",
    'tech-specs': "Technical specifications of the high-fidelity recording rig used by Music Madras to archive classical music in Chennai.",
    'artist-program': "Apply to the Music Madras free recording artist program. We support local talent with free high-fidelity recording sessions.",
    'Concert': "Watch live Western classical music concerts and recitals in Chennai, recorded in high-fidelity acoustics.",
    'Organ': "Listen to majestic pipe organ recitals recorded live at historic Chennai cathedrals and churches.",
    'Choral': "Explore our archival recordings of local choirs, sacred anthems, and multi-part classical choruses.",
    'Vocal': "Solo vocal performances and operatic art songs recorded live with natural room resonance.",
    'Instrumental': "Classical instrumental sonatas, string quartets, and chamber orchestras documented live.",
    'all': "Browse the full collection of classical music recordings documented and preserved by Music Madras."
  };

  const name = activeVideoTitle || (sectionNames[activeTab] || activeTab);
  const description = sectionDescriptions[activeTab] || sectionDescriptions['home'];
  const url = activeVideoId 
    ? `https://www.musicmadras.com/?tab=${activeTab}&video=${activeVideoId}`
    : (activeTab === 'home' ? 'https://www.musicmadras.com/' : `https://www.musicmadras.com/?tab=${activeTab}`);

  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${url}#webpage`,
    "url": url,
    "name": `${name} | Music Madras`,
    "description": description,
    "inLanguage": "en-IN",
    "isPartOf": {
      "@type": "WebSite",
      "@id": "https://www.musicmadras.com/#website"
    },
    "publisher": {
      "@type": "Organization",
      "@id": "https://www.musicmadras.com/#organization"
    }
  };
}

/**
 * Generates schema.org BreadcrumbList enabling rich snippets in Google Search results
 */
export function getBreadcrumbSchema(activeTab: string, activeVideoTitle?: string, activeVideoId?: string | null) {
  const sectionNames: Record<string, string> = {
    'home': 'Home',
    'playlists': 'Curated Classical Playlists',
    'tech-specs': 'Studio Rig & Gear Specifications',
    'artist-program': 'Free Recording Artist Program',
    'Concert': 'Live Performance Showcases',
    'Organ': 'Pipe Organ Recitals',
    'Choral': 'Choirs & Sacred Ensembles',
    'Vocal': 'Solo Vocal Performances',
    'Instrumental': 'Classical Orchestras & Instruments',
    'all': 'All Recorded Works'
  };

  const itemListElement: any[] = [
    {
      "@type": "ListItem",
      "position": 1,
      "name": "Home",
      "item": "https://www.musicmadras.com/"
    }
  ];

  let currentPosition = 2;

  if (activeTab !== 'home') {
    const tabName = sectionNames[activeTab] || activeTab;
    const tabUrl = `https://www.musicmadras.com/?tab=${activeTab}`;
    itemListElement.push({
      "@type": "ListItem",
      "position": currentPosition,
      "name": tabName,
      "item": tabUrl
    });
    currentPosition++;
  }

  if (activeVideoId && activeVideoTitle) {
    const videoUrl = `https://www.musicmadras.com/?tab=${activeTab}&video=${activeVideoId}`;
    itemListElement.push({
      "@type": "ListItem",
      "position": currentPosition,
      "name": activeVideoTitle,
      "item": videoUrl
    });
  }

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "@id": "https://www.musicmadras.com/#breadcrumb",
    "itemListElement": itemListElement
  };
}

/**
 * Dynamic MusicComposition generator for cataloging classical scores, pieces, and sacred choral works
 */
export interface MusicCompositionOptions {
  title: string;
  composerName: string;
  composerEra?: string;
  musicalKey?: string;
  movementCount?: number;
  description?: string;
  path?: string;
}

export function getMusicCompositionSchema(options: MusicCompositionOptions) {
  const { title, composerName, composerEra, musicalKey, movementCount, description, path = 'compositions' } = options;
  const canonicalUrl = `https://www.musicmadras.com/${path}`;

  return {
    "@context": "https://schema.org",
    "@type": "MusicComposition",
    "@id": `${canonicalUrl}#composition`,
    "name": title,
    "description": description || `${title}, composed by classical master ${composerName}${composerEra ? ` during the ${composerEra} era` : ''}.`,
    "composer": {
      "@type": "Person",
      "name": composerName
    },
    "musicCompositionForm": "Classical",
    ...(musicalKey && { "musicalKey": musicalKey }),
    ...(movementCount && { "numMovements": movementCount })
  };
}

/**
 * Dynamic MusicGroup generator representing active orchestras, choral groups, and instrumental ensembles
 */
export interface MusicGroupOptions {
  name: string;
  memberCount?: number;
  foundingDate?: string;
  description?: string;
  image?: string;
  sameAs?: string[];
  path?: string;
}

export function getMusicGroupSchema(options: MusicGroupOptions) {
  const { name, memberCount, foundingDate, description, image, sameAs = [], path = 'artists' } = options;
  const canonicalUrl = `https://www.musicmadras.com/${path}`;

  return {
    "@context": "https://schema.org",
    "@type": "MusicGroup",
    "@id": `${canonicalUrl}#musicgroup`,
    "name": name,
    "description": description || `A premier performing ensemble featured on Music Madras classical concert series.`,
    "url": canonicalUrl,
    ...(image && { "image": image }),
    ...(foundingDate && { "foundingDate": foundingDate }),
    ...(memberCount && { "numberOfMembers": memberCount }),
    ...(sameAs.length > 0 && { "sameAs": sameAs })
  };
}

/**
 * Dynamic general Event generator for scheduling workshops, lecture-demonstrations, and masterclasses
 */
export interface GeneralEventOptions {
  name: string;
  startDate: string;
  endDate?: string;
  description: string;
  venueName: string;
  venueAddress: string;
  image?: string;
  path?: string;
}

export function getGeneralEventSchema(options: GeneralEventOptions) {
  const { name, startDate, endDate, description, venueName, venueAddress, image, path = 'events' } = options;
  const canonicalUrl = `https://www.musicmadras.com/${path}`;

  return {
    "@context": "https://schema.org",
    "@type": "Event",
    "@id": `${canonicalUrl}#event`,
    "name": name,
    "description": description,
    "startDate": startDate,
    ...(endDate && { "endDate": endDate }),
    "eventStatus": "https://schema.org/EventScheduled",
    "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
    "location": {
      "@type": "Place",
      "name": venueName,
      "address": {
        "@type": "PostalAddress",
        "addressLocality": "Chennai",
        "addressRegion": "Tamil Nadu",
        "addressCountry": "IN",
        "streetAddress": venueAddress
      }
    },
    ...(image && { "image": image })
  };
}

/**
 * Dynamic VideoObject generator for indexing high-fidelity multi-cam performance footage on search consoles
 */
export interface VideoObjectOptions {
  title: string;
  description: string;
  uploadDate: string;
  thumbnailUrl: string;
  embedUrl: string;
  duration: string; // ISO 8601 duration format (e.g. "PT3M15S")
  path?: string;
}

export function getVideoObjectSchema(options: VideoObjectOptions) {
  const { title, description, uploadDate, thumbnailUrl, embedUrl, duration, path = 'videos' } = options;
  const canonicalUrl = `https://www.musicmadras.com/${path}`;

  return {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    "@id": `${canonicalUrl}#videoobject`,
    "name": title,
    "description": description,
    "thumbnailUrl": thumbnailUrl,
    "uploadDate": uploadDate,
    "embedUrl": embedUrl,
    "duration": duration,
    "publisher": {
      "@type": "Organization",
      "name": "Music Madras",
      "logo": {
        "@type": "ImageObject",
        "url": "https://yt3.googleusercontent.com/d0KOXSy8sQFmrwCGqkTjm90JYMpqdtrFpjtQCh7145eUjEf0XDnCxPXvfg6_RvKnaIY091x5_TA=s250-c-k-c0x00ffffff-no-rj"
      }
    }
  };
}

/**
 * Dynamic Person generator for organizing classical instrumentalists, vocal soloists, and guest conductors
 */
export interface PersonOptions {
  name: string;
  role?: string;
  biography?: string;
  image?: string;
  sameAs?: string[];
  path?: string;
}

export function getPersonSchema(options: PersonOptions) {
  const { name, role, biography, image, sameAs = [], path = 'artists' } = options;
  const canonicalUrl = `https://www.musicmadras.com/${path}`;

  return {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": `${canonicalUrl}#person`,
    "name": name,
    "jobTitle": role || "Classical Musician",
    "description": biography || `${name} is an active classical performance artist collaborated with Music Madras Chennai.`,
    ...(image && { "image": image }),
    ...(sameAs.length > 0 && { "sameAs": sameAs })
  };
}

/**
 * Dynamic Place generator detailing historical Chennai cathedrals and organs
 */
export interface PlaceOptions {
  name: string;
  address: string;
  description?: string;
  geoLatitude?: number;
  geoLongitude?: number;
  image?: string;
  path?: string;
}

export function getPlaceSchema(options: PlaceOptions) {
  const { name, address, description, geoLatitude, geoLongitude, image, path = 'places' } = options;
  const canonicalUrl = `https://www.musicmadras.com/${path}`;

  return {
    "@context": "https://schema.org",
    "@type": "Place",
    "@id": `${canonicalUrl}#place`,
    "name": name,
    "address": {
      "@type": "PostalAddress",
      "addressLocality": "Chennai",
      "addressRegion": "Tamil Nadu",
      "addressCountry": "IN",
      "streetAddress": address
    },
    "description": description || `A historic musical and architectural landmark in Chennai, Tamil Nadu.`,
    ...(image && { "image": image }),
    ...(geoLatitude && geoLongitude && {
      "geo": {
        "@type": "GeoCoordinates",
        "latitude": geoLatitude,
        "longitude": geoLongitude
      }
    })
  };
}
