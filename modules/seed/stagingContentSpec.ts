// The CURATED content spec for the staging loader, and the check that every fact in it is traceable. PURE.
//
// The spec (content/staging/first-recording.json) is written by a person from what a YouTube description or title STATES. Nothing is parsed out of a description at
// load time, and nothing is inferred. Each fact carries an `evidence` quotation, and `verifyEvidence` requires that quotation to occur VERBATIM in the cited video's
// title or description in the fixture (ignoring zero-width characters and runs of white space), so a fact whose source text changed or never said it is refused.
// Facts the sources do not state are listed under `omissions` with the reason, and are NOT loaded.
//
// The quotation check itself lives in modules/mmke/provenance/verbatimEvidence.ts, shared with the video-credits extraction.

import { verifyEvidence as verifyQuotedEvidence, type Evidence, type VideoText } from "../mmke/provenance/verbatimEvidence";

export type { Evidence };

export interface ComposerSpec { slug: string; name: string; evidence: Evidence }
export interface WorkSpec { slug: string; title: string; evidence: Evidence }
export interface ProgrammeSpec { slug: string; title: string; evidence: Evidence }
export interface VenueSpec {
  slug: string;
  name: string;
  city: string;
  country: string;
  /** null = the sources do not state the venue's type, so neither the Venue nor the Performance (which needs a Venue) is created. Fill it in only from a source. */
  type: "CHURCH" | "CATHEDRAL" | "CONCERT_HALL" | "STUDIO" | "OUTDOOR" | null;
  evidence: Evidence[];
}
export interface RecordingSpec {
  youtubeVideoId: string;
  /** The canonical Music Madras title (never copied from YouTube automatically). */
  title: string;
  titleEvidence: Evidence;
}
export interface Omission { fact: string; reason: string }

export interface StagingContentSpec {
  version: 1;
  recording: RecordingSpec;
  composer: ComposerSpec;
  work: WorkSpec;
  programme: ProgrammeSpec;
  venue: VenueSpec;
  omissions: Omission[];
}

export interface FixtureVideoText extends VideoText {
  privacyStatus: string | null;
}

const VENUE_TYPES = ["CHURCH", "CATHEDRAL", "CONCERT_HALL", "STUDIO", "OUTDOOR"] as const;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

function evidenceOf(v: unknown, where: string, problems: string[]): Evidence | null {
  if (!isObject(v) || !text(v.youtubeVideoId) || (v.field !== "title" && v.field !== "description") || !text(v.quote)) {
    problems.push(`${where}: evidence needs youtubeVideoId, field ("title" or "description") and a non-empty quote.`);
    return null;
  }
  return { youtubeVideoId: v.youtubeVideoId, field: v.field, quote: v.quote };
}

export type ParseResult = { ok: true; spec: StagingContentSpec } | { ok: false; problems: string[] };

export function parseStagingContentSpec(raw: unknown): ParseResult {
  const problems: string[] = [];
  if (!isObject(raw) || raw.version !== 1) return { ok: false, problems: ["The content file must be an object with version 1."] };

  const named = (key: string, fields: string[]) => {
    const o = raw[key];
    if (!isObject(o)) {
      problems.push(`${key}: missing.`);
      return null;
    }
    for (const f of fields) if (!text(o[f])) problems.push(`${key}.${f}: missing or empty.`);
    if (!text(o.slug) || !SLUG.test(o.slug as string)) problems.push(`${key}.slug: must be lower-case letters, digits and single hyphens.`);
    return o;
  };

  const composer = named("composer", ["slug", "name"]);
  const work = named("work", ["slug", "title"]);
  const programme = named("programme", ["slug", "title"]);
  const venue = named("venue", ["slug", "name", "city", "country"]);
  const recording = raw.recording;
  if (!isObject(recording) || !text(recording.youtubeVideoId) || !text(recording.title)) problems.push("recording: youtubeVideoId and title are required.");

  if (isObject(venue) && venue.type !== null && !VENUE_TYPES.includes(venue.type as (typeof VENUE_TYPES)[number])) problems.push(`venue.type: must be null or one of ${VENUE_TYPES.join(", ")}.`);
  if (!Array.isArray(raw.omissions) || !raw.omissions.every((o) => isObject(o) && text(o.fact) && text(o.reason))) problems.push("omissions: must be a list of { fact, reason }.");

  const composerEvidence = composer ? evidenceOf(composer.evidence, "composer", problems) : null;
  const workEvidence = work ? evidenceOf(work.evidence, "work", problems) : null;
  const programmeEvidence = programme ? evidenceOf(programme.evidence, "programme", problems) : null;
  const venueEvidence = venue && Array.isArray(venue.evidence) && venue.evidence.length > 0 ? venue.evidence.map((e, i) => evidenceOf(e, `venue.evidence[${i}]`, problems)) : (problems.push("venue.evidence: at least one quotation is required."), []);
  const titleEvidence = isObject(recording) ? evidenceOf(recording.titleEvidence, "recording.titleEvidence", problems) : null;

  if (problems.length > 0 || !composer || !work || !programme || !venue || !isObject(recording) || !composerEvidence || !workEvidence || !programmeEvidence || !titleEvidence) return { ok: false, problems };
  return {
    ok: true,
    spec: {
      version: 1,
      recording: { youtubeVideoId: recording.youtubeVideoId as string, title: (recording.title as string).trim(), titleEvidence },
      composer: { slug: composer.slug as string, name: (composer.name as string).trim(), evidence: composerEvidence },
      work: { slug: work.slug as string, title: (work.title as string).trim(), evidence: workEvidence },
      programme: { slug: programme.slug as string, title: (programme.title as string).trim(), evidence: programmeEvidence },
      venue: {
        slug: venue.slug as string,
        name: (venue.name as string).trim(),
        city: (venue.city as string).trim(),
        country: (venue.country as string).trim(),
        type: venue.type as VenueSpec["type"],
        evidence: venueEvidence.filter((e): e is Evidence => e !== null),
      },
      omissions: (raw.omissions as Omission[]).map((o) => ({ fact: o.fact, reason: o.reason })),
    },
  };
}

export function allEvidence(spec: StagingContentSpec): Array<{ where: string; evidence: Evidence }> {
  return [
    { where: "composer", evidence: spec.composer.evidence },
    { where: "work", evidence: spec.work.evidence },
    { where: "programme", evidence: spec.programme.evidence },
    ...spec.venue.evidence.map((evidence, i) => ({ where: `venue[${i}]`, evidence })),
    { where: "recording.title", evidence: spec.recording.titleEvidence },
  ];
}

/** Every quotation must occur verbatim in the cited video's title or description (the shared check), and the Recording's video must be present. Returns the problems (empty = every fact is traceable). */
export function verifyEvidence(spec: StagingContentSpec, videos: readonly FixtureVideoText[]): string[] {
  const problems = verifyQuotedEvidence(allEvidence(spec), videos);
  if (!videos.some((v) => v.youtubeVideoId === spec.recording.youtubeVideoId)) problems.push(`recording: video ${spec.recording.youtubeVideoId} is not in the fixtures.`);
  return problems;
}
