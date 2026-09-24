import type { RecordingPageData } from "./recordingPageContract";

// Phase 6G-5B — pure derivation of SEO metadata from a RecordingPageData
// (Prisma-free, unit-testable without Next.js). Prefers the published
// revision's own authored seoMetaTitle/seoMetaDescription/seoCanonicalPath
// (Studio's SEO wizard step) when present; otherwise falls back to
// conservative, factual defaults built only from the Recording's own
// title and canonical performance context — never an invented claim.

export interface RecordingMetadata {
  title: string;
  description: string | undefined;
  canonicalPath: string;
  openGraphImage: string | undefined;
}

function fallbackDescription(data: RecordingPageData): string | undefined {
  const parts: string[] = [];
  if (data.performance?.venue) {
    parts.push(`Recorded at ${data.performance.venue.name}`);
  }
  if (data.programme) {
    parts.push(parts.length > 0 ? `as part of ${data.programme.title}` : `Part of ${data.programme.title}`);
  }
  if (parts.length === 0) {
    return undefined;
  }
  return `${parts.join(" ")} — documented in the Music Madras archive of Chennai's Western Classical Music heritage.`;
}

export function buildRecordingMetadata(data: RecordingPageData): RecordingMetadata {
  const title = data.seoMetaTitle ?? (data.title ? `${data.title} — Music Madras` : "Music Madras");
  const description = data.seoMetaDescription ?? data.description ?? fallbackDescription(data);
  const canonicalPath = data.seoCanonicalPath ?? `/recordings/${data.slug}`;
  const openGraphImage = data.videos[0]?.thumbnailUrl ?? undefined;

  return { title, description, canonicalPath, openGraphImage };
}
