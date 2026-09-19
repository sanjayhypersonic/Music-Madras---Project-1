import { useEffect } from 'react';
import { VIDEOS_DATA } from '../data';

export interface UseSEOOptions {
  activeTab: string;
  activeVideoId?: string | null;
}

/**
 * Custom hook to manage page-level SEO metadata updates (title, meta description, canonical URLs)
 * and history state synchronization.
 * Decouples side-effect logic from the main App component rendering cycle.
 */
export function useSEO({ activeTab, activeVideoId }: UseSEOOptions) {
  useEffect(() => {
    // 1. Synchronize URL query parameters dynamically to enable search crawler deep-links
    const url = new URL(window.location.href);
    if (activeTab === 'home') {
      url.searchParams.delete('tab');
    } else {
      url.searchParams.set('tab', activeTab);
    }

    if (activeVideoId) {
      url.searchParams.set('video', activeVideoId);
    } else {
      url.searchParams.delete('video');
    }

    window.history.replaceState(null, '', url.pathname + url.search + url.hash);

    // 2. Dynamic Canonical Link tag updates
    let canonicalLink = document.querySelector('link[rel="canonical"]');
    if (!canonicalLink) {
      canonicalLink = document.createElement('link');
      canonicalLink.setAttribute('rel', 'canonical');
      document.head.appendChild(canonicalLink);
    }
    
    const canonicalUrl = activeVideoId
      ? `https://www.musicmadras.com/?tab=${activeTab}&video=${activeVideoId}`
      : (activeTab === 'home' ? 'https://www.musicmadras.com/' : `https://www.musicmadras.com/?tab=${activeTab}`);
      
    canonicalLink.setAttribute('href', canonicalUrl);

    // 3. Define section display names and search-optimized descriptive snippets
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

    const suffix = "Music Madras — Chennai's Home for Western Classical Music";
    
    let displayTitle = '';
    let displayDescription = '';
    
    const activeVideo = activeVideoId ? VIDEOS_DATA.find(v => v.id === activeVideoId) : null;
    
    if (activeVideo) {
      displayTitle = `${activeVideo.title} | ${suffix}`;
      displayDescription = activeVideo.description || sectionDescriptions[activeTab] || sectionDescriptions['home'];
    } else {
      const name = sectionNames[activeTab] || activeTab;
      displayTitle = activeTab === 'home' ? "Music Madras | Chennai's Home for Western Classical Music" : `${name} | ${suffix}`;
      displayDescription = sectionDescriptions[activeTab] || sectionDescriptions['home'];
    }

    // Set browser document title
    document.title = displayTitle;

    // Set meta description tag
    let descriptionMeta = document.querySelector('meta[name="description"]');
    if (!descriptionMeta) {
      descriptionMeta = document.createElement('meta');
      descriptionMeta.setAttribute('name', 'description');
      document.head.appendChild(descriptionMeta);
    }
    descriptionMeta.setAttribute('content', displayDescription);

  }, [activeTab, activeVideoId]);
}

export default useSEO;
