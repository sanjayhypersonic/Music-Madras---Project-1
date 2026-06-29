// Next.js 15 Metadata API - Global Metadata Configuration and Extensible Architecture
// This file acts as the official metadata configuration for Next.js 15 environments,
// declaring the full structural hierarchy, brand values, keywords, and entity links,
// and providing reusable generators to handle thousands of future dynamic routes.

export interface Metadata {
  metadataBase: URL;
  title: {
    default: string;
    template: string;
  };
  description: string;
  applicationName: string;
  generator: string;
  keywords: string[];
  authors: Array<{ name: string; url?: string }>;
  creator: string;
  publisher: string;
  themeColor?: string | Array<{ media: string; color: string }>;
  category: string;
  classification: string;
  robots: {
    index: boolean;
    follow: boolean;
    nocache?: boolean;
    googleBot?: {
      index: boolean;
      follow: boolean;
      noimageindex?: boolean;
      'max-video-preview'?: number | string;
      'max-image-preview'?: 'none' | 'standard' | 'large';
      'max-snippet'?: number;
    };
  };
  alternates: {
    canonical: string;
    languages: Record<string, string>;
  };
  icons: {
    icon: string;
    shortcut?: string;
    apple?: string;
    other?: Array<{ rel: string; url: string }>;
  };
  openGraph: {
    type: string;
    locale: string;
    url: string;
    title: string;
    description: string;
    siteName: string;
    images: Array<{
      url: string;
      width?: number;
      height?: number;
      alt?: string;
    }>;
  };
  twitter: {
    card: 'summary' | 'summary_large_image' | 'app' | 'player';
    title: string;
    description: string;
    creator?: string;
    images: string[];
  };
  verification?: {
    google?: string;
    yandex?: string;
    yahoo?: string;
    other?: Record<string, string[]>;
  };
  appleWebApp?: {
    capable: boolean;
    title: string;
    statusBarStyle: 'default' | 'black' | 'black-translucent';
  };
}

// 153 characters, perfectly optimized between 150-160 characters for Google's SERP snippet recommendations.
export const HOME_DESCRIPTION = "Music Madras is Chennai's premier home for Western classical music. Discover live concert archives, pipe organ recitals, and classical choral recordings.";

export const globalMetadata: Metadata = {
  metadataBase: new URL('https://www.musicmadras.com'),
  title: {
    default: "Music Madras | Chennai's Home for Western Classical Music",
    template: "%s | Music Madras — Chennai's Home for Western Classical Music",
  },
  description: HOME_DESCRIPTION,
  applicationName: 'Music Madras',
  generator: 'Vite + React + Next.js Hybrid Architecture',
  keywords: [
    'Western Classical Music',
    'Choir Music',
    'Symphony Orchestra',
    'Brass Band',
    'Pipe Organ',
    'Sacred Music',
    'Church Music',
    'Chamber Music',
    'Music Recording',
    'Concert Documentation',
    'Music Education',
    'Chennai',
    'Tamil Nadu',
    'India',
    'High-Fidelity Audio Preservation'
  ],
  authors: [{ name: 'Music Madras', url: 'https://www.musicmadras.com' }],
  creator: 'Music Madras',
  publisher: 'Music Madras',
  category: 'Classical Music',
  classification: 'Performing Arts & Recording Studio Archive',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#09090b' },
    { media: '(prefers-color-scheme: light)', color: '#fafafa' }
  ],
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  alternates: {
    canonical: 'https://www.musicmadras.com/',
    languages: {
      'en-US': 'https://www.musicmadras.com/',
      'en-IN': 'https://www.musicmadras.com/',
      'x-default': 'https://www.musicmadras.com/'
    },
  },
  icons: {
    icon: '/logo.png',
    apple: '/logo.png',
    other: [
      {
        rel: 'mask-icon',
        url: '/logo.png'
      }
    ]
  },
  openGraph: {
    type: 'website',
    locale: 'en_IN',
    url: 'https://www.musicmadras.com/',
    title: "Music Madras | Chennai's Home for Western Classical Music",
    description: HOME_DESCRIPTION,
    siteName: 'Music Madras',
    images: [
      {
        url: '/logo.png',
        width: 1200,
        height: 630,
        alt: "Music Madras — Chennai's Home for Western Classical Music"
      }
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: "Music Madras | Chennai's Home for Western Classical Music",
    description: HOME_DESCRIPTION,
    creator: '@musicmadras',
    images: ['/logo.png'],
  },
  verification: {
    google: 'google-site-verification-placeholder-code',
    yandex: 'yandex-verification-placeholder-code',
    other: {
      'msvalidate.01': ['bing-webmaster-verification-placeholder-code'],
    }
  },
  appleWebApp: {
    capable: true,
    title: 'Music Madras',
    statusBarStyle: 'black-translucent'
  }
};

export interface PageMetadataOptions {
  title?: string;
  description?: string;
  path?: string;
  ogType?: 'website' | 'music.song' | 'music.playlist' | 'profile' | 'video.other' | 'music.musical_work';
  ogImage?: string;
  keywords?: string[];
  noIndex?: boolean;
}

/**
 * Core Dynamic Metadata Engine
 * Generates SEO configurations with robust fallback mechanisms and customized tags.
 */
export function generatePageMetadata(options: PageMetadataOptions = {}): Metadata {
  const {
    title,
    description,
    path = '',
    ogType = 'website',
    ogImage,
    keywords = [],
    noIndex = false,
  } = options;

  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  const canonicalUrl = `https://www.musicmadras.com/${cleanPath}`;
  const mergedKeywords = Array.from(new Set([...globalMetadata.keywords, ...keywords]));
  const imageUrl = ogImage || globalMetadata.icons.icon;
  const finalDescription = description || globalMetadata.description;

  const displayTitle = title 
    ? `${title} | Music Madras` 
    : globalMetadata.title.default;

  return {
    ...globalMetadata,
    title: title ? {
      default: title,
      template: globalMetadata.title.template
    } : globalMetadata.title,
    description: finalDescription,
    keywords: mergedKeywords,
    robots: {
      index: !noIndex,
      follow: true,
      googleBot: {
        index: !noIndex,
        follow: true,
        'max-video-preview': -1,
        'max-image-preview': 'large',
        'max-snippet': -1,
      },
    },
    alternates: {
      canonical: canonicalUrl,
      languages: {
        'en-US': canonicalUrl,
        'en-IN': canonicalUrl,
        'x-default': canonicalUrl,
      },
    },
    openGraph: {
      ...globalMetadata.openGraph,
      type: ogType,
      url: canonicalUrl,
      title: displayTitle,
      description: finalDescription,
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: title || "Music Madras — Chennai's Home for Western Classical Music",
        },
      ],
    },
    twitter: {
      ...globalMetadata.twitter,
      title: displayTitle,
      description: finalDescription,
      images: [imageUrl],
    },
  };
}

/**
 * Reusable utility helper for generating dynamic Concert Page metadata
 */
export function generateConcertMetadata(concert: {
  title: string;
  performer: string;
  date: string;
  description?: string;
  image?: string;
  path: string;
}): Metadata {
  const concertTitle = `${concert.title} by ${concert.performer}`;
  const concertDesc = concert.description || `Experience the performance of ${concert.title} by ${concert.performer}, recorded live in Chennai on ${concert.date} with exceptional acoustic preservation.`;
  return generatePageMetadata({
    title: concertTitle,
    description: concertDesc.slice(0, 160),
    path: concert.path,
    ogType: 'music.musical_work',
    ogImage: concert.image,
    keywords: [concert.performer, concert.title, 'Concert Recording', 'Live Chennai Performance', 'Classical Concert Archive']
  });
}

/**
 * Reusable utility helper for generating dynamic Composer Page metadata
 */
export function generateComposerMetadata(composer: {
  name: string;
  era: string;
  biographySummary?: string;
  image?: string;
  path: string;
}): Metadata {
  const composerTitle = `${composer.name} (${composer.era}) — Classical Composer Profile`;
  const composerDesc = composer.biographySummary || `Explore classical masterworks, concert archives, and history of composer ${composer.name} (${composer.era}) compiled by Music Madras.`;
  return generatePageMetadata({
    title: composerTitle,
    description: composerDesc.slice(0, 160),
    path: composer.path,
    ogType: 'profile',
    ogImage: composer.image,
    keywords: [composer.name, composer.era, 'Classical Composer', 'Composer History', 'Chennai Chamber Music']
  });
}

/**
 * Reusable utility helper for generating dynamic Venue Page metadata
 */
export function generateVenueMetadata(venue: {
  name: string;
  location: string;
  description?: string;
  image?: string;
  path: string;
}): Metadata {
  const venueTitle = `${venue.name}, ${venue.location} — Historic Classical Music Venue`;
  const venueDesc = venue.description || `Discover performances, acoustics, and documentation from the historical organ or classical music venue ${venue.name} in ${venue.location}.`;
  return generatePageMetadata({
    title: venueTitle,
    description: venueDesc.slice(0, 160),
    path: venue.path,
    ogType: 'website',
    ogImage: venue.image,
    keywords: [venue.name, venue.location, 'Performance Venue', 'Pipe Organ Cathedral Chennai', 'Acoustic Space']
  });
}

/**
 * Reusable utility helper for generating dynamic Playlist Page metadata
 */
export function generatePlaylistMetadata(playlist: {
  title: string;
  trackCount: number;
  description?: string;
  image?: string;
  path: string;
}): Metadata {
  const playlistTitle = `${playlist.title} — Curated Classical Playlist (${playlist.trackCount} Works)`;
  const playlistDesc = playlist.description || `Listen to ${playlist.title}, a curated high-fidelity playlist of classical recordings containing ${playlist.trackCount} live performance tracks.`;
  return generatePageMetadata({
    title: playlistTitle,
    description: playlistDesc.slice(0, 160),
    path: playlist.path,
    ogType: 'music.playlist',
    ogImage: playlist.image,
    keywords: [playlist.title, 'Classical Playlist', 'Sacred Choir Selection', 'Curated Orchestral Works']
  });
}

/**
 * Reusable utility helper for generating dynamic Video Page metadata
 */
export function generateVideoMetadata(video: {
  title: string;
  category: string;
  description?: string;
  image?: string;
  path: string;
}): Metadata {
  const videoTitle = `${video.title} (${video.category})`;
  const videoDesc = video.description || `Watch high-definition recording of ${video.title} categorized under ${video.category}, featuring natural acoustic spatial audio capturing.`;
  return generatePageMetadata({
    title: videoTitle,
    description: videoDesc.slice(0, 160),
    path: video.path,
    ogType: 'video.other',
    ogImage: video.image,
    keywords: [video.title, video.category, 'Classical Performance Video', 'High-Fidelity Audio capture', 'Chennai Recital Video']
  });
}

/**
 * Reusable utility helper for generating dynamic Conductor/Director Page metadata
 */
export function generateConductorMetadata(conductor: {
  name: string;
  role: string; // e.g. "Choirmaster", "Symphony Director"
  biographySummary?: string;
  image?: string;
  path: string;
}): Metadata {
  const conductorTitle = `${conductor.name} (${conductor.role}) — Music Director Profile`;
  const conductorDesc = conductor.biographySummary || `Learn about conductor and music director ${conductor.name}, leading premier choral assemblies and symphony orchestras in Chennai.`;
  return generatePageMetadata({
    title: conductorTitle,
    description: conductorDesc.slice(0, 160),
    path: conductor.path,
    ogType: 'profile',
    ogImage: conductor.image,
    keywords: [conductor.name, conductor.role, 'Classical Conductor', 'Choirmaster Chennai', 'Music Madras Conductor']
  });
}
