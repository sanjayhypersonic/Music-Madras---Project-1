// Credits extraction, milestone 1: the deterministic checks applied to a model's video-credits-v1 output. PURE (no fs, no network, no database).
//
// Two layers, as for the recording-editorial output: first the SHAPE (anything malformed rejects the whole output), then each proposal on its own:
//   - its quotation must occur verbatim in the field it cites (the shared check in modules/mmke/provenance/verbatimEvidence.ts);
//   - the name (or value) must occur inside that quotation, exactly as written (case-sensitive; only invisible characters and white space are ignored);
//   - a work title, when given, must occur in the video's title or description, and only composer, arranger and lyricist credits may carry one;
//   - a venue type is accepted only when the quotation itself names that kind of place ("church", "chapel", "cathedral", ...);
//   - a performance date must be YYYY-MM-DD, YYYY-MM or YYYY and its year must appear in the quotation.
// A proposal that fails is kept in the result as REJECTED with its reason, never silently dropped, so a reviewer (and the report) can see it.
// Passing these checks proves the text SAYS it, not that the attribution is right: a person still reviews every accepted proposal.

import { fieldText, normaliseEvidenceText, quoteOccursIn, type EvidenceField, type VideoText } from "../../mmke/provenance/verbatimEvidence";
import {
  VIDEO_CREDIT_ROLES,
  VIDEO_RECORDING_KINDS,
  VIDEO_VENUE_TYPES,
  type VideoCreditRole,
  type VideoRecordingKind,
  type VideoVenueType,
} from "../prompts/videoCredits/videoCreditsPromptV1";

export const MAX_QUOTE_LENGTH = 300;
export const MAX_NAME_LENGTH = 200;
export const MAX_CREDITS = 200;
export const MAX_GAPS = 30;

/** Only these roles may name the work a credit belongs to. */
const ROLES_WITH_WORK: readonly VideoCreditRole[] = ["COMPOSER", "ARRANGER", "LYRICIST"];

/** Words that state a venue's type. Matched as whole words, case-insensitively, inside the quotation. */
export const VENUE_TYPE_WORDS: Record<VideoVenueType, readonly string[]> = {
  CHURCH: ["church", "chapel", "parish"],
  CATHEDRAL: ["cathedral"],
  CONCERT_HALL: ["concert hall", "auditorium", "hall"],
  STUDIO: ["studio"],
  OUTDOOR: ["outdoor", "outdoors", "open-air", "open air"],
};

export interface VideoCredit {
  role: VideoCreditRole;
  name: string;
  workTitle: string | null;
  quote: string;
  field: EvidenceField;
}

export type CreditRejectionReason =
  | "QUOTE_NOT_FOUND"
  | "NAME_NOT_IN_QUOTE"
  | "QUOTE_TOO_LONG"
  | "NAME_INVALID"
  | "WORK_TITLE_NOT_ALLOWED"
  | "WORK_TITLE_NOT_IN_TEXT"
  | "DUPLICATE";

export type ValueRejectionReason = "MISSING_QUOTE" | "QUOTE_NOT_FOUND" | "QUOTE_TOO_LONG" | "VALUE_NOT_IN_QUOTE" | "INVALID_DATE" | "VENUE_TYPE_NOT_STATED";

/** One quoted single value (date, venue type, title, recording kind) after the checks. */
export type CheckedValue<T> =
  | { status: "ABSENT" }
  | { status: "ACCEPTED"; value: T; quote: string; field: EvidenceField }
  | { status: "REJECTED"; value: T; quote: string | null; field: EvidenceField | null; reason: ValueRejectionReason };

export interface VideoCreditsGap {
  missing: string;
  reason: string;
}

export interface CheckedVideoCredits {
  ok: true;
  /** The model's classification. ABSENT means UNCLEAR without a quotation (no claim); any other value needs a quotation that passes. */
  recordingKind: CheckedValue<VideoRecordingKind>;
  accepted: VideoCredit[];
  rejected: Array<{ credit: VideoCredit; reason: CreditRejectionReason }>;
  performanceDate: CheckedValue<string>;
  venueType: CheckedValue<VideoVenueType>;
  suggestedTitle: CheckedValue<string>;
  gaps: VideoCreditsGap[];
}

export type VideoCreditsCheckResult = CheckedVideoCredits | { ok: false; problems: string[] };

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Shape

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isField = (v: unknown): v is EvidenceField => v === "title" || v === "description";
const isNullableString = (v: unknown): v is string | null => v === null || typeof v === "string";

interface RawQuoted {
  value: unknown;
  quote: string | null;
  field: EvidenceField | null;
}

function quotedShape(raw: unknown, where: string, problems: string[]): RawQuoted | null {
  if (!isObject(raw)) {
    problems.push(`${where}: must be an object with value, quote and field.`);
    return null;
  }
  if (!isNullableString(raw.quote)) problems.push(`${where}.quote: must be a string or null.`);
  if (raw.field !== null && !isField(raw.field)) problems.push(`${where}.field: must be "title", "description" or null.`);
  if (!isNullableString(raw.quote) || (raw.field !== null && !isField(raw.field))) return null;
  return { value: raw.value, quote: raw.quote, field: raw.field as EvidenceField | null };
}

interface ParsedOutput {
  recordingKind: RawQuoted & { value: VideoRecordingKind };
  credits: VideoCredit[];
  performanceDate: RawQuoted & { value: string | null };
  venueType: RawQuoted & { value: VideoVenueType | null };
  suggestedTitle: RawQuoted & { value: string | null };
  gaps: VideoCreditsGap[];
}

function parseShape(output: unknown): { ok: true; parsed: ParsedOutput } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  if (!isObject(output)) return { ok: false, problems: ["The output must be a JSON object."] };

  const recordingKind = quotedShape(output.recordingKind, "recordingKind", problems);
  if (recordingKind && !VIDEO_RECORDING_KINDS.includes(recordingKind.value as VideoRecordingKind)) problems.push(`recordingKind.value: must be one of ${VIDEO_RECORDING_KINDS.join(", ")}.`);

  const performanceDate = quotedShape(output.performanceDate, "performanceDate", problems);
  if (performanceDate && !isNullableString(performanceDate.value)) problems.push("performanceDate.value: must be a string or null.");

  const venueType = quotedShape(output.venueType, "venueType", problems);
  if (venueType && venueType.value !== null && !VIDEO_VENUE_TYPES.includes(venueType.value as VideoVenueType)) problems.push(`venueType.value: must be null or one of ${VIDEO_VENUE_TYPES.join(", ")}.`);

  const suggestedTitle = quotedShape(output.suggestedTitle, "suggestedTitle", problems);
  if (suggestedTitle && !isNullableString(suggestedTitle.value)) problems.push("suggestedTitle.value: must be a string or null.");

  const credits: VideoCredit[] = [];
  if (!Array.isArray(output.credits)) problems.push("credits: must be a list.");
  else if (output.credits.length > MAX_CREDITS) problems.push(`credits: more than ${MAX_CREDITS} credits.`);
  else
    output.credits.forEach((c, i) => {
      if (
        !isObject(c) ||
        !VIDEO_CREDIT_ROLES.includes(c.role as VideoCreditRole) ||
        typeof c.name !== "string" ||
        !isNullableString(c.workTitle) ||
        typeof c.quote !== "string" ||
        !isField(c.field)
      ) {
        problems.push(`credits[${i}]: needs role (one of ${VIDEO_CREDIT_ROLES.join(", ")}), name, workTitle (string or null), quote and field ("title" or "description").`);
        return;
      }
      credits.push({ role: c.role as VideoCreditRole, name: c.name, workTitle: c.workTitle, quote: c.quote, field: c.field });
    });

  const gaps: VideoCreditsGap[] = [];
  if (!Array.isArray(output.gaps)) problems.push("gaps: must be a list.");
  else
    output.gaps.slice(0, MAX_GAPS).forEach((g, i) => {
      if (!isObject(g) || typeof g.missing !== "string" || typeof g.reason !== "string") problems.push(`gaps[${i}]: needs missing and reason.`);
      else gaps.push({ missing: normaliseEvidenceText(g.missing).slice(0, 200), reason: normaliseEvidenceText(g.reason).slice(0, 300) });
    });

  if (problems.length > 0 || !recordingKind || !performanceDate || !venueType || !suggestedTitle) return { ok: false, problems };
  return {
    ok: true,
    parsed: {
      recordingKind: recordingKind as ParsedOutput["recordingKind"],
      credits,
      performanceDate: performanceDate as ParsedOutput["performanceDate"],
      venueType: venueType as ParsedOutput["venueType"],
      suggestedTitle: suggestedTitle as ParsedOutput["suggestedTitle"],
      gaps,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Checks

const contains = (haystack: string, needle: string) => {
  const n = normaliseEvidenceText(needle);
  return n.length > 0 && normaliseEvidenceText(haystack).includes(n);
};

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function checkCredit(credit: VideoCredit, video: VideoText): CreditRejectionReason | null {
  const name = normaliseEvidenceText(credit.name);
  if (name.length === 0 || name.length > MAX_NAME_LENGTH || CONTROL.test(credit.name) || name.startsWith("#")) return "NAME_INVALID";
  if (normaliseEvidenceText(credit.quote).length > MAX_QUOTE_LENGTH) return "QUOTE_TOO_LONG";
  if (!quoteOccursIn(fieldText(video, credit.field), credit.quote)) return "QUOTE_NOT_FOUND";
  if (!contains(credit.quote, credit.name)) return "NAME_NOT_IN_QUOTE";
  if (credit.workTitle !== null) {
    if (!ROLES_WITH_WORK.includes(credit.role)) return "WORK_TITLE_NOT_ALLOWED";
    if (!contains(fieldText(video, "title"), credit.workTitle) && !contains(fieldText(video, "description"), credit.workTitle)) return "WORK_TITLE_NOT_IN_TEXT";
  }
  return null;
}

/** The quotation checks common to every single value; null when they pass. */
function quoteProblem(raw: RawQuoted, video: VideoText): ValueRejectionReason | null {
  if (raw.quote === null || raw.field === null || normaliseEvidenceText(raw.quote).length === 0) return "MISSING_QUOTE";
  if (normaliseEvidenceText(raw.quote).length > MAX_QUOTE_LENGTH) return "QUOTE_TOO_LONG";
  if (!quoteOccursIn(fieldText(video, raw.field), raw.quote)) return "QUOTE_NOT_FOUND";
  return null;
}

function checkValue<T>(raw: RawQuoted & { value: T | null }, video: VideoText, extra: (value: T, quote: string) => ValueRejectionReason | null): CheckedValue<T> {
  if (raw.value === null) return { status: "ABSENT" };
  const value = raw.value as T;
  const problem = quoteProblem(raw, video) ?? extra(value, raw.quote as string);
  if (problem) return { status: "REJECTED", value, quote: raw.quote, field: raw.field, reason: problem };
  return { status: "ACCEPTED", value, quote: raw.quote as string, field: raw.field as EvidenceField };
}

const DATE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

export function isValidPartialDate(value: string): boolean {
  const m = DATE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  if (year < 1800 || year > 2100) return false;
  if (m[2] === undefined) return true;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return false;
  if (m[3] === undefined) return true;
  const day = Number(m[3]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth;
}

const wordPattern = (word: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${word.replace(/[-\s]/g, "[-\\s]")}([^\\p{L}\\p{N}]|$)`, "iu");

export function quoteStatesVenueType(quote: string, type: VideoVenueType): boolean {
  const text = normaliseEvidenceText(quote);
  return VENUE_TYPE_WORDS[type].some((w) => wordPattern(w).test(text));
}

/**
 * Checks a video-credits-v1 output against the video it was produced from. Never throws; a malformed output returns { ok: false, problems }.
 */
export function validateVideoCreditsOutput(output: unknown, video: VideoText): VideoCreditsCheckResult {
  const shape = parseShape(output);
  if (!shape.ok) return shape;
  const { parsed } = shape;

  const accepted: VideoCredit[] = [];
  const rejected: CheckedVideoCredits["rejected"] = [];
  const seen = new Set<string>();
  for (const credit of parsed.credits) {
    const reason = checkCredit(credit, video);
    if (reason) {
      rejected.push({ credit, reason });
      continue;
    }
    const key = [credit.role, normaliseEvidenceText(credit.name), normaliseEvidenceText(credit.workTitle ?? "")].join("\u0000");
    if (seen.has(key)) {
      rejected.push({ credit, reason: "DUPLICATE" });
      continue;
    }
    seen.add(key);
    accepted.push(credit);
  }

  // UNCLEAR without a quotation is no claim at all, so it reads as ABSENT; any other kind, or UNCLEAR with a quotation, must pass the quotation check.
  const kindRaw = parsed.recordingKind;
  const recordingKind: CheckedValue<VideoRecordingKind> =
    kindRaw.value === "UNCLEAR" && (kindRaw.quote === null || kindRaw.field === null) ? { status: "ABSENT" } : checkValue<VideoRecordingKind>(kindRaw, video, () => null);

  return {
    ok: true,
    recordingKind,
    accepted,
    rejected,
    performanceDate: checkValue<string>(parsed.performanceDate, video, (value, quote) => {
      if (!isValidPartialDate(value)) return "INVALID_DATE";
      return normaliseEvidenceText(quote).includes(value.slice(0, 4)) ? null : "VALUE_NOT_IN_QUOTE";
    }),
    venueType: checkValue<VideoVenueType>(parsed.venueType, video, (value, quote) => (quoteStatesVenueType(quote, value) ? null : "VENUE_TYPE_NOT_STATED")),
    suggestedTitle: checkValue<string>(parsed.suggestedTitle, video, (value, quote) => (contains(quote, value) ? null : "VALUE_NOT_IN_QUOTE")),
    gaps: parsed.gaps,
  };
}
