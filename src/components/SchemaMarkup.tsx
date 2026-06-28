import React from 'react';
import { VIDEOS_DATA, PLAYLISTS_DATA } from '../data';
import {
  getConcertSchema,
  getRecordingSchema,
  getAlbumSchema,
  getOrganizationSchema,
  getWebsiteSchema,
  getWebPageSchema,
  getBreadcrumbSchema
} from '../lib/schemaStructuredData';

interface SchemaMarkupProps {
  activeTab: string;
  activeVideoId: string | null;
}

export const SchemaMarkup: React.FC<SchemaMarkupProps> = ({ activeTab, activeVideoId }) => {
  const activeVideo = activeVideoId ? VIDEOS_DATA.find(v => v.id === activeVideoId) : null;
  const activeVideoTitle = activeVideo ? activeVideo.title : undefined;

  // Always include the central entity definition (Organization/Studio & WebSite)
  const schemas: any[] = [
    getWebsiteSchema(),
    getOrganizationSchema(),
    getWebPageSchema(activeTab, activeVideoTitle, activeVideoId),
    getBreadcrumbSchema(activeTab, activeVideoTitle, activeVideoId)
  ];

  // If a specific video is currently selected/active, prioritize its detailed schema
  if (activeVideo) {
    schemas.push(getRecordingSchema(activeVideo));
    if (activeVideo.category === 'Concert') {
      schemas.push(getConcertSchema(activeVideo));
    }
  }

  // Dynamic context schemas based on the active tab/archives being viewed
  if (activeTab === 'playlists') {
    // Generate MusicAlbum schemas for our curated compiled lists
    PLAYLISTS_DATA.forEach(playlist => {
      schemas.push(getAlbumSchema(playlist, VIDEOS_DATA));
    });
  } else if (activeTab === 'Concert') {
    // Generate Concert/MusicEvent schemas for the main showcases
    const concertVideos = VIDEOS_DATA.filter(v => v.category === 'Concert').slice(0, 5);
    concertVideos.forEach(v => {
      schemas.push(getConcertSchema(v));
    });
  } else if (activeTab === 'all' || activeTab === 'home') {
    // Showcase general high-profile events and recordings
    const featuredConcerts = VIDEOS_DATA.filter(v => v.category === 'Concert').slice(0, 3);
    featuredConcerts.forEach(v => {
      schemas.push(getConcertSchema(v));
    });

    const featuredRecordings = VIDEOS_DATA.slice(0, 5);
    featuredRecordings.forEach(v => {
      schemas.push(getRecordingSchema(v));
    });
  } else {
    // For other tabs, include the relevant recording schemas
    const categoryVideos = VIDEOS_DATA.filter(v => v.category === activeTab).slice(0, 5);
    categoryVideos.forEach(v => {
      schemas.push(getRecordingSchema(v));
    });
  }

  return (
    <>
      {schemas.map((schema, index) => (
        <script
          key={`ldjson-${activeTab}-${activeVideoId || 'none'}-${index}`}
          type="application/ld+json"
          id={`ldjson-script-${index}`}
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
      ))}
    </>
  );
};

export default SchemaMarkup;
