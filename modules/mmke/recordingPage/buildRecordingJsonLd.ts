import type { RecordingPageData } from "./recordingPageContract";

// Phase 6G-5B — pure derivation of the Recording page's structured data
// (Prisma-free, unit-testable). schema.org/MusicRecording is the primary
// type: a Recording is exactly "an audio/video recording of a music
// performance," which is what this page represents. Every property is
// included only when the canonical MMKE data actually supports it —
// never forced in to make the object larger, never a fabricated
// statistic (view counts, popularity, rankings are never schema.org
// MusicRecording properties in the first place, and are never stored on
// Recording/RecordingRevision regardless).
//
// `recordingOf` is only included when there is exactly one directly
// attached MusicalWork — with more than one, which work this recording
// is authoritatively "a recording of" is ambiguous, and schema.org's
// recordingOf expects a single MusicComposition.

export interface RecordingJsonLd {
  "@context": "https://schema.org";
  "@type": "MusicRecording";
  name?: string;
  description?: string;
  url: string;
  image?: string;
  byArtist?: { "@type": "Person"; name: string }[];
  composer?: { "@type": "Person"; name: string }[];
  recordingOf?: { "@type": "MusicComposition"; name: string; composer: { "@type": "Person"; name: string } };
}

export function buildRecordingJsonLd(data: RecordingPageData, siteOrigin: string): RecordingJsonLd {
  const jsonLd: RecordingJsonLd = {
    "@context": "https://schema.org",
    "@type": "MusicRecording",
    url: `${siteOrigin}/recordings/${data.slug}`,
  };

  if (data.title) {
    jsonLd.name = data.title;
  }
  if (data.description) {
    jsonLd.description = data.description;
  }
  if (data.videos[0]?.thumbnailUrl) {
    jsonLd.image = data.videos[0].thumbnailUrl;
  }
  if (data.performance && data.performance.artists.length > 0) {
    jsonLd.byArtist = data.performance.artists.map((artist) => ({ "@type": "Person", name: artist.name }));
  }
  if (data.composers.length > 0) {
    jsonLd.composer = data.composers.map((composer) => ({ "@type": "Person", name: composer.name }));
  }
  if (data.works.length === 1) {
    jsonLd.recordingOf = {
      "@type": "MusicComposition",
      name: data.works[0].title,
      composer: { "@type": "Person", name: data.works[0].composer.name },
    };
  }

  return jsonLd;
}
