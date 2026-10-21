import { createHash } from "crypto";

// Phase 6K lifecycle hardening (F12) — the MATERIAL-CHANGE fingerprint of a video's YouTube-side metadata.
//
// An approved unlisted page stays public while its metadata changes, but a change that alters what the page SAYS or SHOWS must not be taken as
// already reviewed. This module decides, in one pure place, which fields count and how they are compared, so the decision is documented and testable:
//
//   MATERIAL (a change is recorded as a pending review)
//     title            what the page is called                                   (whitespace-normalised)
//     description      the text the page shows                                   (line endings and trailing space normalised)
//     thumbnail        the image the page and listings show                      (compared without query string or fragment: cache-busters are not a change)
//     duration         a different length is a different cut of the recording    (whole seconds)
//     publishedAt      the date the page states                                  (to the second)
//     embeddable       whether the player works on the page
//     channel          whose video it is (identity / rights representation)
//
//   NOT MATERIAL (never triggers a review)
//     view, like and comment counts and their timestamp (volatile statistics), the etag and content hash (technical), playlist membership and
//     order (a curated-page concern, not this video's identity), and the field-ownership bookkeeping of the sync.
//
// The fingerprint is versioned: changing what counts bumps METADATA_FINGERPRINT_VERSION, and a stored baseline from another version is
// re-recorded rather than reported as a change (see videoMetadataReviewRepository.ts).

export const METADATA_FINGERPRINT_VERSION = "mm-meta-v1";

export type MaterialField = "title" | "description" | "thumbnail" | "duration" | "publishedAt" | "embeddable" | "channel";

export const MATERIAL_FIELDS: readonly MaterialField[] = ["title", "description", "thumbnail", "duration", "publishedAt", "embeddable", "channel"];

/** What the repository reads off the video row. Anything else on the row is deliberately not an input. */
export interface VideoMetadataFacts {
  title: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  publishedAt: Date | string | null;
  embeddable: boolean | null;
  channelId: string | null;
}

export interface MaterialMetadata {
  version: string;
  title: string | null;
  description: string | null;
  thumbnail: string | null;
  duration: number | null;
  publishedAt: string | null;
  embeddable: boolean | null;
  channel: string | null;
}

function text(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalised = value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t ]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return normalised === "" ? null : normalised;
}

function title(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalised = value.normalize("NFC").replace(/\s+/g, " ").trim();
  return normalised === "" ? null : normalised;
}

/** The image's identity is its host and path: a query string or fragment (cache-busting, resizing) is not a different picture. */
function thumbnail(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return raw.split(/[?#]/)[0] || null;
  }
}

function instant(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(Math.floor(date.getTime() / 1000) * 1000).toISOString();
}

export function materialMetadata(facts: VideoMetadataFacts): MaterialMetadata {
  return {
    version: METADATA_FINGERPRINT_VERSION,
    title: title(facts.title),
    description: text(facts.description),
    thumbnail: thumbnail(facts.thumbnailUrl),
    duration: facts.durationSeconds === null || facts.durationSeconds === undefined ? null : Math.trunc(facts.durationSeconds),
    publishedAt: instant(facts.publishedAt),
    embeddable: facts.embeddable ?? null,
    channel: facts.channelId?.trim() || null,
  };
}

export function fingerprintMaterial(material: MaterialMetadata): string {
  // A fixed key order, so the same facts always hash the same.
  const ordered = [material.version, material.title, material.description, material.thumbnail, material.duration, material.publishedAt, material.embeddable, material.channel];
  return createHash("sha256").update(JSON.stringify(ordered)).digest("hex").slice(0, 32);
}

export function fingerprintFacts(facts: VideoMetadataFacts): string {
  return fingerprintMaterial(materialMetadata(facts));
}

const SUMMARY_LIMIT = 300;
const clip = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const s = String(value);
  return s.length > SUMMARY_LIMIT ? `${s.slice(0, SUMMARY_LIMIT)}…` : s;
};

export interface MaterialChange {
  field: MaterialField;
  /** What was reviewed, shortened. */
  before: string | null;
  /** What is there now, shortened. */
  after: string | null;
}

/** The material fields that differ between what was reviewed and what is there now (empty when nothing material changed). */
export function diffMaterial(reviewed: MaterialMetadata, current: MaterialMetadata): MaterialChange[] {
  const changes: MaterialChange[] = [];
  for (const field of MATERIAL_FIELDS) {
    if (reviewed[field] !== current[field]) changes.push({ field, before: clip(reviewed[field]), after: clip(current[field]) });
  }
  return changes;
}

/** A stored snapshot can only be compared with the current one if it came from this version of the rules. */
export function isComparableSnapshot(value: unknown): value is MaterialMetadata {
  return typeof value === "object" && value !== null && (value as { version?: unknown }).version === METADATA_FINGERPRINT_VERSION;
}
