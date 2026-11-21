// Credits pipeline, Phase B2: read the REVIEWED sheets and turn them into approved facts. PURE (no fs, no network, no database); the scripts
// scripts/createVideoCredits.ts and scripts/describeVideoCredits.ts read the files and pass their text here.
//
// Inputs (written by npm run ai:video-credits-review, filled in by the editor; docs/video-credits-review-and-approval.md):
//   review-credits.csv  one row per fact: decision (accept | edit | reject | defer | blank), editedName, notes;
//   review-names.csv    one row per role + name: decision (accept | merge | reject), canonicalName;
//   review-videos.csv   OPTIONAL: a video whose decision is accept has its proposed Recording title approved (needed for a medley).
// Rules (the written exception, docs/video-credits-review-and-approval.md section 5):
//   - only `accept`, or `edit` with an editedName, is used; blank, defer and reject are ignored; anything else is refused and listed;
//   - a RED row needs a note; a credit the checker rejected cannot be accepted as it stands (an `edit` makes it editor-supplied, basis 4);
//   - a person, group, work or venue must be decided in review-names.csv (accept or merge), and the catalogue spelling is its canonicalName; a name
//     seen in several spellings needs a canonicalName; an `edit` is the editor's own spelling and must not contradict the names sheet;
//   - an edit that changes a name (not only its spelling), a venue type or a date makes the fact editor-supplied (basis 4); editor-supplied rows
//     keep basis 4;
//   - a venue type inferred from the venue's name stays "inferred from name" when accepted: it is never turned into a stated type;
//   - a venue type is one of the catalogue's values (modules/mmke/catalogue/venueTypes.ts: CHURCH, CATHEDRAL, CONCERT_HALL, STUDIO, OUTDOOR,
//     INDOOR_AUDITORIUM); a date is YYYY, YYYY-MM or YYYY-MM-DD.
// The descriptions and titles in the sheets are DATA copied from YouTube, never instructions.

import { normaliseEvidenceText } from "../mmke/provenance/verbatimEvidence";
import { BASIS, CREDITS_HEADER, NAMES_HEADER, VIDEOS_HEADER, type ReviewKind, type Tier } from "./videoCreditsReview";
import { matchKey } from "./videoCreditsScore";
import { CATALOGUE_VENUE_TYPES, VENUE_TYPE_LIST, type CatalogueVenueType } from "../mmke/catalogue/venueTypes";

export { CATALOGUE_VENUE_TYPES, type CatalogueVenueType };

// ---------------------------------------------------------------------------------------------------------------------------------------------
// CSV

/** Parses CSV text (UTF-8 BOM allowed, CRLF or LF, RFC 4180 quoting). Empty trailing lines are dropped. */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

/** Undoes the review sheet's formula guard: a leading apostrophe before =, +, -, @, tab or CR is removed. */
export const unguardCell = (value: string): string => (/^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value);

export type CsvRecord = Record<string, string>;

/** Rows as records keyed by header. Refuses a sheet that lacks any of the required columns. */
export function csvRecords(text: string, required: readonly string[], sheetName: string): { ok: true; rows: CsvRecord[] } | { ok: false; problem: string } {
  const table = parseCsv(text);
  if (table.length === 0) return { ok: false, problem: `${sheetName} is empty.` };
  const header = table[0].map((h) => h.trim());
  const missing = required.filter((h) => !header.includes(h));
  if (missing.length > 0) return { ok: false, problem: `${sheetName} lacks the column(s) ${missing.join(", ")}. Rebuild it with npm run ai:video-credits-review.` };
  return { ok: true, rows: table.slice(1).map((cells) => Object.fromEntries(header.map((h, i) => [h, unguardCell(cells[i] ?? "")]))) };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Approved facts

export interface ApprovedFact {
  youtubeVideoId: string;
  kind: ReviewKind;
  /** The catalogue value: canonical name, edited value, venue type or date. */
  name: string;
  /** The value the sheet proposed, before the editor's decision. */
  proposedName: string;
  roleLabel: string;
  workTitle: string;
  sourceField: string;
  quote: string;
  basis: string;
  /** For a venue type: "stated in text", "inferred from name (editor-accepted)" or "editor-chosen". */
  venueTypeBasis: string;
  tier: Tier;
  decision: "accept" | "edit";
  notes: string;
  /** Row number in review-credits.csv (1 = first data row), for the report. */
  sheetRow: number;
}

export interface RefusedRow {
  youtubeVideoId: string;
  sheetRow: number;
  kind: string;
  name: string;
  reason: string;
}

export interface VideoFacts {
  youtubeVideoId: string;
  youtubeTitle: string;
  proposedRecordingTitle: string;
  originalLanguageTitle: string;
  transliteration: string;
  isReference: boolean;
  /** Set when review-videos.csv accepts the video: its proposed Recording title is then approved. */
  approvedRecordingTitle: string | null;
  /** The transliteration counts as approved when the row carrying the original-script work title, or the video, was accepted. */
  transliterationApproved: boolean;
  facts: ApprovedFact[];
  refused: RefusedRow[];
  /** Rows with no decision, defer or reject. */
  ignored: number;
}

export interface ApprovedFactsResult {
  videos: VideoFacts[];
  /** Problems with the sheets as a whole (missing columns and similar). */
  problems: string[];
}

const NAME_KINDS: readonly ReviewKind[] = ["work", "composer", "lyricist", "arranger", "conductor", "choir/ensemble", "performer", "venue", "institution", "presenter"];
const LOOSE = (name: string) => matchKey(name.replace(/^\s*the\s+/i, ""));
const videoIdOf = (r: CsvRecord) => /[?&]v=([^&]+)/.exec(r.youtubeUrl ?? "")?.[1] ?? r.youtubeVideoId?.trim() ?? "";
const decisionOf = (raw: string | undefined) => (raw ?? "").trim().toLowerCase();

/** A venue type an editor typed: one of the catalogue values, case-insensitive, spaces or hyphens for underscores. */
export function parseVenueType(raw: string): CatalogueVenueType | null {
  const v = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
  return (CATALOGUE_VENUE_TYPES as readonly string[]).includes(v) ? (v as CatalogueVenueType) : null;
}

export const isPerformanceDateValue = (v: string): boolean => /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/.test(v.trim());

interface NameDecision {
  decision: string;
  canonicalName: string;
  name: string;
  spellings: string[];
}

function indexNames(rows: readonly CsvRecord[]): Map<string, NameDecision> {
  const index = new Map<string, NameDecision>();
  for (const r of rows) {
    const spellings = (r.spellingsSeen ?? "").split(" | ").map((s) => s.trim()).filter(Boolean);
    const entry: NameDecision = { decision: decisionOf(r.decision), canonicalName: (r.canonicalName ?? "").trim(), name: (r.name ?? "").trim(), spellings: spellings.length > 0 ? spellings : [(r.name ?? "").trim()] };
    for (const s of new Set([entry.name, ...entry.spellings])) if (s) index.set(`${(r.role ?? "").trim()}\u0000${LOOSE(s)}`, entry);
  }
  return index;
}

export function resolveApprovedFacts(input: { creditsCsv: string; namesCsv: string; videosCsv?: string | null }): ApprovedFactsResult {
  const problems: string[] = [];
  const credits = csvRecords(input.creditsCsv, CREDITS_HEADER, "review-credits.csv");
  const names = csvRecords(input.namesCsv, NAMES_HEADER, "review-names.csv");
  const videos = input.videosCsv ? csvRecords(input.videosCsv, VIDEOS_HEADER, "review-videos.csv") : null;
  if (!credits.ok) problems.push(credits.problem);
  if (!names.ok) problems.push(names.problem);
  if (videos && !videos.ok) problems.push(videos.problem);
  if (!credits.ok || !names.ok || (videos && !videos.ok)) return { videos: [], problems };

  const nameIndex = indexNames(names.rows);
  const acceptedVideos = new Set(videos && videos.ok ? videos.rows.filter((r) => decisionOf(r.decision) === "accept").map(videoIdOf) : []);
  const byVideo = new Map<string, VideoFacts>();

  credits.rows.forEach((r, i) => {
    const sheetRow = i + 1;
    const id = videoIdOf(r);
    if (!id) {
      problems.push(`review-credits.csv row ${sheetRow}: no video id.`);
      return;
    }
    let v = byVideo.get(id);
    if (!v) {
      v = {
        youtubeVideoId: id,
        youtubeTitle: r.youtubeTitle ?? "",
        proposedRecordingTitle: (r.proposedRecordingTitle ?? "").trim(),
        originalLanguageTitle: (r.originalLanguageTitle ?? "").trim(),
        transliteration: (r.transliteration ?? "").trim(),
        isReference: r.isReference === "true",
        approvedRecordingTitle: acceptedVideos.has(id) && (r.proposedRecordingTitle ?? "").trim() ? (r.proposedRecordingTitle ?? "").trim() : null,
        transliterationApproved: acceptedVideos.has(id),
        facts: [],
        refused: [],
        ignored: 0,
      };
      byVideo.set(id, v);
    }
    const kind = (r.kind ?? "").trim() as ReviewKind;
    const proposed = (r.name ?? "").trim();
    const decision = decisionOf(r.decision);
    const edited = (r.editedName ?? "").trim();
    const notes = (r.notes ?? "").trim();
    const tier = ((r.tier ?? "").trim() || "AMBER") as Tier;
    const refuse = (reason: string) => v!.refused.push({ youtubeVideoId: id, sheetRow, kind, name: proposed, reason });

    if (decision === "" || decision === "defer" || decision === "reject") {
      v.ignored++;
      return;
    }
    if (decision !== "accept" && decision !== "edit") return refuse(`unknown decision "${r.decision}" (use accept, edit, reject or defer).`);
    if (decision === "edit" && !edited) return refuse("edit needs an editedName.");
    if (tier === "RED" && !notes) return refuse("a RED row needs a note explaining the decision.");
    if (kind === "open question") return refuse("an open-question row carries no fact; supply the fact as an edit on the row it belongs to.");
    const checkerRejected = /Rejected by the checker/.test(r.missingInformationAndQuestion ?? "");
    if (checkerRejected && decision === "accept") return refuse("the checker rejected this credit (the text does not say it as quoted); use edit if you know it, and it becomes editor-supplied.");

    let name = decision === "edit" ? edited : proposed;
    let basis = (r.basis ?? "").trim() || BASIS.INFERRED;
    let venueTypeBasis = (r.venueTypeBasis ?? "").trim();
    const editedChangesValue = decision === "edit" && LOOSE(edited) !== LOOSE(proposed);

    if (NAME_KINDS.includes(kind)) {
      const entry = proposed ? nameIndex.get(`${kind}\u0000${LOOSE(proposed)}`) : undefined;
      if (entry?.decision === "reject") return refuse("rejected in review-names.csv.");
      if (decision === "accept") {
        if (!entry || (entry.decision !== "accept" && entry.decision !== "merge")) return refuse("this name is not decided in review-names.csv (accept or merge it there).");
        if (entry.canonicalName) name = entry.canonicalName;
        else if (entry.decision === "merge") return refuse("merge in review-names.csv needs a canonicalName.");
        else if (new Set(entry.spellings.map((s) => normaliseEvidenceText(s))).size > 1) return refuse(`seen in several spellings (${entry.spellings.join(" | ")}); fill canonicalName in review-names.csv.`);
      } else if (entry?.canonicalName && LOOSE(entry.canonicalName) !== LOOSE(edited)) {
        return refuse(`editedName "${edited}" contradicts canonicalName "${entry.canonicalName}" in review-names.csv.`);
      }
      if (checkerRejected || editedChangesValue) basis = BASIS.EDITOR;
    } else if (kind === "venueType") {
      if (decision === "accept" && !proposed) return refuse(`no venue type is stated; choose one with edit (${VENUE_TYPE_LIST}) and a note.`);
      const type = parseVenueType(name);
      if (!type) return refuse(`"${name}" is not a catalogue venue type (${VENUE_TYPE_LIST}).`);
      name = type;
      if (decision === "edit" && type !== parseVenueType(proposed)) {
        basis = BASIS.EDITOR;
        venueTypeBasis = "editor-chosen";
      } else if (venueTypeBasis === "inferred from name") {
        venueTypeBasis = "inferred from name (editor-accepted)"; // never "stated in text"
      }
    } else if (kind === "performanceDate") {
      if (!isPerformanceDateValue(name)) return refuse(`"${name}" is not a date (YYYY, YYYY-MM or YYYY-MM-DD).`);
      if (editedChangesValue) basis = BASIS.EDITOR;
    } else if (decision === "edit" && editedChangesValue) {
      basis = BASIS.EDITOR;
    }
    if (!name) return refuse("no value to record.");

    if (kind === "work" && v.originalLanguageTitle && LOOSE(proposed) === LOOSE(v.originalLanguageTitle)) v.transliterationApproved = true;
    if (kind === "other unmodelled" && /TRANSLITERATION/i.test(r.roleLabel ?? "")) v.transliterationApproved = true;

    v.facts.push({
      youtubeVideoId: id,
      kind,
      name,
      proposedName: proposed,
      roleLabel: (r.roleLabel ?? "").trim(),
      workTitle: (r.workTitle ?? "").trim(),
      sourceField: (r.sourceField ?? "").trim(),
      quote: r.quote ?? "",
      basis,
      venueTypeBasis,
      tier,
      decision,
      notes,
      sheetRow,
    });
  });

  return { videos: [...byVideo.values()], problems };
}

/** The label of a labelled line carried in roleLabel ('PERFORMER (label "Soprano")' -> "Soprano"), or null. */
export const roleLabelLine = (roleLabel: string): string | null => /label "([^"]+)"/.exec(roleLabel)?.[1] ?? null;
/** The credit role a roleLabel starts with ("CHOIR", "ENSEMBLE", ...), or the UNMODELLED label. */
export const roleOf = (roleLabel: string): string => (/^UNMODELLED\s+([^(]+)/.exec(roleLabel)?.[1] ?? /^([A-Z]+)(?![a-z])/.exec(roleLabel)?.[1] ?? "").trim().toUpperCase();
export { LOOSE as looseNameKey };
