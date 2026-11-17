// Credits extraction, Phase B1: the editorial REVIEW SHEET. PURE (no fs, no network, no database); scripts/buildVideoCreditsReview.ts reads the
// files and writes the three CSV files.
//
// Input: for every video, the newest v2 proposal and the export text it was written from, plus the editor's reference records. Each proposal is
// checked with the same validators as the checker, and only what they ACCEPT becomes a fact row; a rejected credit becomes a RED row.
// Output rows carry a basis (how we know it), a schema home (where the catalogue could store it), questions for the editor and a tier.
// The sheet is for REVIEW only: it approves nothing, publishes nothing and writes nothing to a database (docs/video-credits-review-and-approval.md).
//
// Basis: 1 stated in title; 2 stated in description; 3 supported by another source; 4 editor-supplied; 5 AI-inferred or unresolved.
// A venue type taken from the venue's own name is basis 5 ("inferred from name"); only a type the text states outside the name is stated.
// Tiers: GREEN = a labelled line or an explicit role sentence ("conducted by", "music by") names the role, the name is exact in the quote, no flag.
//        AMBER = a credit read from other prose or from the title, a venue type inferred from a name, a performance date, an UNMODELLED item,
//                an editor-supplied fact, a research flag.
//        RED   = a CONFLICT or placeholder gap, a name spelled differently elsewhere, a date taken only from a title, a possible duplicate
//                performance, a venue with no venue type, a credit the checker rejected, a proposal the reference rules out.
// No row ever creates or implies a composer that the text does not state: missing or placeholder credits are "open question" rows with no name.

import { normaliseEvidenceText, quoteOccursIn, type VideoText } from "../mmke/provenance/verbatimEvidence";
import { hasNonLatinLetters, validateVideoCreditsOutput, type CheckedVideoCredits, type VideoCredit } from "../ai/structuredOutput/validateVideoCreditsOutput";
import type { VideoCreditRole } from "../ai/prompts/videoCredits/videoCreditsPromptV1";
import { matchKey, type ReferenceVideo } from "./videoCreditsScore";

export type Tier = "GREEN" | "AMBER" | "RED";
export type ReviewKind =
  | "work"
  | "composer"
  | "lyricist"
  | "arranger"
  | "conductor"
  | "choir/ensemble"
  | "performer"
  | "venue"
  | "venueType"
  | "performanceDate"
  | "institution"
  | "presenter"
  | "other unmodelled"
  | "open question";

export const BASIS = {
  TITLE: "1 stated in title",
  DESCRIPTION: "2 stated in description",
  OTHER_SOURCE: "3 supported by another source",
  EDITOR: "4 editor-supplied",
  INFERRED: "5 AI-inferred or unresolved",
} as const;

export interface ReviewInputVideo {
  /** The proposals file the proposal came from (for the video sheet). */
  proposalsFile: string;
  video: VideoText;
  /** The raw proposal object, including youtubeVideoId. */
  proposal: unknown;
}

export interface CreditRow {
  youtubeVideoId: string;
  youtubeUrl: string;
  youtubeTitle: string;
  proposedRecordingTitle: string;
  originalLanguageTitle: string;
  transliteration: string;
  kind: ReviewKind;
  name: string;
  roleLabel: string;
  workTitle: string;
  sourceField: string;
  quote: string;
  basis: string;
  venueTypeBasis: string;
  isReference: boolean;
  schemaHome: string;
  questions: string[];
  tier: Tier;
}

export interface VideoRow {
  youtubeVideoId: string;
  youtubeUrl: string;
  youtubeTitle: string;
  proposedRecordingTitle: string;
  isReference: boolean;
  proposalsFile: string;
  worstTier: Tier;
  rows: number;
  green: number;
  amber: number;
  red: number;
  credits: number;
  unmodelled: number;
  openQuestions: string[];
}

export interface NameRow {
  role: ReviewKind;
  name: string;
  videoCount: number;
  spellingsSeen: string[];
  youtubeVideoIds: string[];
}

export interface ReviewSheet {
  credits: CreditRow[];
  videos: VideoRow[];
  names: NameRow[];
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Vocabulary

const ROLE_KIND: Record<VideoCreditRole, ReviewKind> = {
  WORK: "work",
  COMPOSER: "composer",
  LYRICIST: "lyricist",
  ARRANGER: "arranger",
  CONDUCTOR: "conductor",
  CHOIR: "choir/ensemble",
  ENSEMBLE: "choir/ensemble",
  PERFORMER: "performer",
  VENUE: "venue",
};

const ROLE_HOME: Record<VideoCreditRole, string> = {
  WORK: "MusicalWork.title (Recording via RecordingRevisionWork)",
  COMPOSER: "MusicalWork.composerId -> Composer (one per work)",
  LYRICIST: "none",
  ARRANGER: "none",
  CONDUCTOR: "PerformanceConductor -> Conductor",
  CHOIR: "PerformanceChoir -> Choir",
  ENSEMBLE: "none (no orchestra/ensemble model)",
  PERFORMER: "PerformancePerformer -> Artist (role is free text)",
  VENUE: "Performance.venueId -> Venue",
};

/** Where an UNMODELLED label could live today. */
export function unmodelledHome(label: string): string {
  const l = label.trim().toLowerCase();
  if (l === "institution") return "Venue.organisationId -> Organisation (a venue's institution only; a choir's: none)";
  if (l === "transliteration" || l.startsWith("alternative") || l.startsWith("alternate")) return "MusicalWork.alternateTitles (cannot be marked as a transliteration)";
  if (l === "language") return "MusicalWork.language";
  if (l === "event" || l === "occasion") return "Occasion (via RecordingRevisionOccasion)";
  if (l === "text source" || l === "biblical reference" || l === "source") return "Source / Citation (only as a cited source, not as a credit)";
  return "none";
}

/** The ReviewKind an UNMODELLED label maps to. */
const unmodelledKind = (label: string): ReviewKind => {
  const l = label.trim().toLowerCase();
  if (l === "institution") return "institution";
  if (l === "presenter") return "presenter";
  return "other unmodelled";
};

const LABEL = /^[^\p{L}\p{N}]*([\p{L}][\p{L}\p{M} /&'’.-]{0,40}?)\s*:\s*\S/u;
const EXPLICIT_ROLE = /\b(conducted(?: and arranged)? by|under the direction of|music by|words by|lyrics by|text by|arranged by|arrangement by|composed by|written by|words and music (?:are )?by|translated .* by)\b/iu;

/** The label of a labelled line ("Conductor", "Words & Music"), or null when the quote is prose. */
export function lineLabel(quote: string): string | null {
  const m = LABEL.exec(normaliseEvidenceText(quote));
  return m ? m[1].trim() : null;
}

/** The explicit role phrase in a prose quote ("conducted by"), or null. */
export const explicitRolePhrase = (quote: string): string | null => EXPLICIT_ROLE.exec(normaliseEvidenceText(quote))?.[1].toLowerCase() ?? null;

const fieldBasis = (field: string | null) => (field === "title" ? BASIS.TITLE : field === "description" ? BASIS.DESCRIPTION : BASIS.INFERRED);

const quoteField = (video: VideoText, quote: string): "description" | "title" | "" =>
  quoteOccursIn(video.description ?? "", quote) ? "description" : quoteOccursIn(video.title ?? "", quote) ? "title" : "";

const TIER_RANK: Record<Tier, number> = { GREEN: 0, AMBER: 1, RED: 2 };
const worse = (a: Tier, b: Tier): Tier => (TIER_RANK[a] >= TIER_RANK[b] ? a : b);

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Gap classification

export type GapClass = "CONFLICT" | "PLACEHOLDER" | "DUPLICATE" | "OTHER";

const NO_ROLE = /without (?:stating |a |stating a )?(?:a )?roles?\b|without roles\b/i;
const CONFLICT_HINT = /\btitle (?:says|spells|writes|calls|transliterates)\b|\bdescription (?:says|writes|spells)\b|\blabels .* but\b|\bdiffers?\b|\btypo\b|\bconflict\b/i;
const PLACEHOLDER_HINT = /to be confirmed|please confirm|\bTBC\b|\bTBA\b|asks viewers/i;

/** Classifies a non-UNMODELLED gap. Explicit prefixes win; otherwise the reason's wording decides. A name the title lists without a role is OTHER. */
export function classifyGap(missing: string, reason: string): GapClass {
  if (/^CONFLICT:/i.test(missing)) return "CONFLICT";
  if (/^PLACEHOLDER:/i.test(missing)) return "PLACEHOLDER";
  if (/duplicate/i.test(missing)) return "DUPLICATE";
  if (PLACEHOLDER_HINT.test(reason)) return "PLACEHOLDER";
  const text = `${missing} ${reason}`;
  if (!NO_ROLE.test(text) && CONFLICT_HINT.test(text)) return "CONFLICT";
  return "OTHER";
}

/** The kinds of row a gap's subject is about ("CONFLICT: composer name spelling" -> composer). */
export function gapKinds(missing: string): ReviewKind[] {
  const s = missing.replace(/^(CONFLICT|PLACEHOLDER):\s*/i, "").toLowerCase();
  const kinds = new Set<ReviewKind>();
  if (/\bwork\b|\btitle\b|translit|\bsong\b|\bcarol\b/.test(s)) kinds.add("work");
  if (/compos|\bmusic\b/.test(s)) kinds.add("composer");
  if (/lyric|\bwords\b/.test(s)) kinds.add("lyricist");
  if (/arrang/.test(s)) kinds.add("arranger");
  if (/conduct/.test(s)) kinds.add("conductor");
  if (/choir|ensemble/.test(s)) kinds.add("choir/ensemble");
  if (/venue/.test(s)) kinds.add("venue");
  if (/\bdate\b/.test(s)) kinds.add("performanceDate");
  if (/perform(?:er|ers)\b|soloist/.test(s)) kinds.add("performer");
  if (/institution/.test(s)) kinds.add("institution");
  return [...kinds];
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Building the sheet

const LOOSE = (name: string) => matchKey(name.replace(/^\s*the\s+/i, ""));

/** A name with only its parenthetical alias and a leading "The" removed: two spellings with different keys really are spelled differently. */
export const spellingVariantKey = (name: string): string =>
  normaliseEvidenceText(name)
    .replace(/\([^)]*\)/g, " ")
    .replace(/^\s*the\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
const SPELLING_KINDS: readonly ReviewKind[] = ["composer", "lyricist", "arranger", "conductor", "choir/ensemble", "performer", "venue", "institution"];

export function buildReviewSheet(input: { videos: readonly ReviewInputVideo[]; reference: readonly ReferenceVideo[] }): ReviewSheet {
  const rows: CreditRow[] = [];
  /** Credits the checker rejected: RED already, and kept out of the spelling comparison so they cannot turn accepted names RED. */
  const rejectedRows = new Set<CreditRow>();
  const openByVideo = new Map<string, string[]>();
  const refById = new Map(input.reference.map((r) => [r.youtubeVideoId, r]));
  const meta = new Map<string, { proposalsFile: string; youtubeTitle: string; recordingTitle: string; credits: number; unmodelled: number }>();

  for (const item of input.videos) {
    const v = item.video;
    const id = v.youtubeVideoId;
    const isReference = refById.has(id);
    const open: string[] = [];
    openByVideo.set(id, open);
    const raw = (typeof item.proposal === "object" && item.proposal !== null ? item.proposal : {}) as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { youtubeVideoId: _id, ...output } = raw;
    const checked = validateVideoCreditsOutput(output, v);

    const titleRow = (checked.ok ? recordingTitles(checked) : { proposed: "", original: "", translit: "" });
    const base = (): Omit<CreditRow, "kind" | "name" | "roleLabel" | "workTitle" | "sourceField" | "quote" | "basis" | "venueTypeBasis" | "schemaHome" | "questions" | "tier"> => ({
      youtubeVideoId: id,
      youtubeUrl: `https://www.youtube.com/watch?v=${id}`,
      youtubeTitle: v.title ?? "",
      proposedRecordingTitle: titleRow.proposed,
      originalLanguageTitle: titleRow.original,
      transliteration: titleRow.translit,
      isReference,
    });
    const push = (row: Omit<CreditRow, keyof ReturnType<typeof base>>) => {
      const full = { ...base(), ...row };
      rows.push(full);
      return full;
    };
    const question = (kindLabel: string, text: string, tier: Tier) =>
      push({ kind: "open question", name: "", roleLabel: kindLabel, workTitle: "", sourceField: "", quote: "", basis: BASIS.INFERRED, venueTypeBasis: "", schemaHome: "", questions: [text], tier });

    meta.set(id, { proposalsFile: item.proposalsFile, youtubeTitle: v.title ?? "", recordingTitle: titleRow.proposed, credits: 0, unmodelled: 0 });

    if (!checked.ok) {
      question("proposal", `The proposal is malformed (${checked.problems.length} problem(s)); nothing from it is reviewable. Re-propose this video.`, "RED");
      open.push("malformed proposal");
      continue;
    }
    const thisVideo: CreditRow[] = [];
    const add = (row: Omit<CreditRow, keyof ReturnType<typeof base>>) => {
      const r = push(row);
      thisVideo.push(r);
      return r;
    };

    // Credits the checker accepted.
    const creditRow = (c: VideoCredit, tier: Tier, questions: string[]) => {
      const label = lineLabel(c.quote);
      const phrase = label ? null : explicitRolePhrase(c.quote);
      const how = label ? `label "${label}"` : phrase ? `"${phrase}"` : c.field === "title" ? "from the title" : "from prose";
      return add({
        kind: ROLE_KIND[c.role],
        name: c.name,
        roleLabel: `${c.role} (${how})`,
        workTitle: c.workTitle ?? "",
        sourceField: c.field,
        quote: c.quote,
        basis: fieldBasis(c.field),
        venueTypeBasis: "",
        schemaHome: ROLE_HOME[c.role],
        questions,
        tier: worse(tier, label || phrase ? (c.field === "description" ? "GREEN" : "AMBER") : "AMBER"),
      });
    };
    for (const c of checked.accepted) creditRow(c, "GREEN", []);
    for (const { credit, reason } of checked.rejected) rejectedRows.add(creditRow(credit, "RED", [`Rejected by the checker: ${reason}.`]));
    meta.get(id)!.credits = checked.accepted.length;

    // Performance date: AMBER; RED when it comes only from the title.
    if (checked.performanceDate.status !== "ABSENT") {
      const d = checked.performanceDate;
      const fromTitle = d.field === "title";
      add({
        kind: "performanceDate",
        name: d.value,
        roleLabel: lineLabel(d.quote ?? "") ?? "",
        workTitle: "",
        sourceField: d.field ?? "",
        quote: d.quote ?? "",
        basis: fieldBasis(d.field),
        venueTypeBasis: "",
        schemaHome: "Performance.performanceDate",
        questions: d.status === "REJECTED" ? [`Rejected by the checker: ${d.reason}.`] : fromTitle ? ["Date taken only from the YouTube title; the text does not say it is the performance date. Confirm or remove."] : [],
        tier: d.status === "REJECTED" || fromTitle ? "RED" : "AMBER",
      });
    }

    // Venue type: stated in the text (GREEN) or inferred from the venue's name (basis 5, AMBER); a venue without a type is RED.
    const venues = checked.accepted.filter((c) => c.role === "VENUE");
    if (checked.venueType.status !== "ABSENT") {
      const t = checked.venueType;
      const fromName = checked.venueTypeFromName;
      add({
        kind: "venueType",
        name: t.value,
        roleLabel: lineLabel(t.quote ?? "") ?? "",
        workTitle: "",
        sourceField: t.field ?? "",
        quote: t.quote ?? "",
        basis: fromName ? BASIS.INFERRED : fieldBasis(t.field),
        venueTypeBasis: fromName ? "inferred from name" : "stated in text",
        schemaHome: "Venue.type",
        questions: t.status === "REJECTED" ? [`Rejected by the checker: ${t.reason}.`] : fromName ? ["Venue type inferred from the venue's own name; confirm."] : [],
        tier: t.status === "REJECTED" ? "RED" : fromName ? "AMBER" : "GREEN",
      });
    } else if (venues.length > 0) {
      add({
        kind: "venueType",
        name: "",
        roleLabel: "",
        workTitle: "",
        sourceField: "",
        quote: "",
        basis: BASIS.INFERRED,
        venueTypeBasis: "missing",
        schemaHome: "Venue.type (required: a Venue cannot be stored without it)",
        questions: [`No venue type for ${venues.map((c) => c.name).join(" / ")}; the catalogue requires one. Supply it from a source.`],
        tier: "RED",
      });
    }

    // UNMODELLED entries (verified or detected): AMBER; one that failed its own quotation check: RED.
    for (const u of checked.unmodelled) {
      const field = quoteField(v, u.quote);
      add({
        kind: unmodelledKind(u.label),
        name: u.name,
        roleLabel: `UNMODELLED ${u.label}${u.source === "DETECTED" ? " (detected by the checker)" : ""}`,
        workTitle: "",
        sourceField: field,
        quote: u.quote,
        basis: field ? fieldBasis(field) : BASIS.INFERRED,
        venueTypeBasis: "",
        schemaHome: unmodelledHome(u.label),
        questions: u.status === "VERIFIED" ? [] : [`The entry failed its check: ${u.status}.`],
        tier: u.status === "VERIFIED" ? "AMBER" : "RED",
      });
    }
    meta.get(id)!.unmodelled = checked.unmodelled.length;

    // Gaps: CONFLICT / PLACEHOLDER / DUPLICATE make the rows they are about RED, or become an open-question row (never a named credit).
    for (const g of checked.gaps) {
      if (/^UNMODELLED:/i.test(g.missing)) continue;
      const cls = classifyGap(g.missing, g.reason);
      const text = `${g.missing}: ${g.reason}`;
      open.push(cls === "OTHER" ? text : `${cls}: ${text.replace(/^(CONFLICT|PLACEHOLDER):\s*/i, "")}`);
      if (cls === "OTHER") continue;
      const kinds = cls === "DUPLICATE" ? [] : gapKinds(g.missing);
      const targets = thisVideo.filter((r) => kinds.includes(r.kind));
      if (targets.length > 0) {
        for (const r of targets) {
          r.tier = "RED";
          r.questions.push(`${cls}: ${g.reason}`);
        }
      } else question(g.missing.replace(/^(CONFLICT|PLACEHOLDER):\s*/i, ""), `${cls}: ${g.reason}`, "RED");
    }

    // Reference videos: the editor's decisions.
    const ref = refById.get(id);
    if (ref) {
      for (const r of thisVideo) {
        const c = ref.contradictions.find((x) => ROLE_KIND[x.kind as VideoCreditRole] === r.kind && (x.name === null || matchKey(x.name) === matchKey(r.name)) && (!x.workTitle || matchKey(x.workTitle) === matchKey(r.workTitle)));
        if (c) {
          r.tier = "RED";
          r.questions.push(`Ruled out by the editor: ${c.note}`);
        }
      }
      for (const f of ref.facts.filter((x) => x.basis === "editor-supplied")) {
        const role = f.kind as VideoCreditRole;
        add({
          kind: ROLE_KIND[role] ?? "other unmodelled",
          name: f.name,
          roleLabel: `${f.kind} (editor-supplied)`,
          workTitle: f.workTitle ?? "",
          sourceField: "editor",
          quote: "",
          basis: BASIS.EDITOR,
          venueTypeBasis: "",
          schemaHome: ROLE_HOME[role] ?? "none",
          questions: [f.note ? `Editor-supplied: ${f.note}` : "Editor-supplied; not in the YouTube text."],
          tier: "AMBER",
        });
      }
      for (const flag of ref.flags) {
        question(flag.kind.toLowerCase(), `Editor flag${flag.workTitle ? ` (${flag.workTitle})` : ""}: ${flag.note}`, "AMBER");
        open.push(`Editor flag: ${flag.note}`);
      }
    }
  }

  // Names spelled differently elsewhere: the same person or group (grouped ignoring case, punctuation, a leading "The" and a parenthetical
  // alias) written with different letters, letter case or punctuation, e.g. "Ebenezer Arunkumar" / "Ebenezer ArunKumar". Adding or dropping an
  // alias ("(MCC)") or a leading "The" is not a different spelling; those variants are only listed in review-names.csv.
  const spellings = new Map<string, Set<string>>();
  for (const r of rows) if (SPELLING_KINDS.includes(r.kind) && r.name && !rejectedRows.has(r)) {
    const k = LOOSE(r.name);
    if (!spellings.has(k)) spellings.set(k, new Set());
    spellings.get(k)!.add(normaliseEvidenceText(r.name));
  }
  for (const r of rows) {
    if (!SPELLING_KINDS.includes(r.kind) || !r.name || rejectedRows.has(r)) continue;
    const seen = spellings.get(LOOSE(r.name))!;
    if (new Set([...seen].map(spellingVariantKey)).size > 1) {
      r.tier = "RED";
      r.questions.push(`Spelled differently elsewhere: ${[...seen].join(" | ")}. Choose the catalogue spelling.`);
    }
  }

  return { credits: rows, videos: videoRows(input.videos, rows, meta, openByVideo), names: nameRows(rows.filter((r) => !rejectedRows.has(r))) };
}

function recordingTitles(checked: CheckedVideoCredits): { proposed: string; original: string; translit: string } {
  const proposed = checked.suggestedTitle.status === "ACCEPTED" ? checked.suggestedTitle.value : "";
  return {
    proposed,
    original: proposed && hasNonLatinLetters(proposed) ? proposed : "",
    translit: checked.suggestedTitleAlternate.status === "ACCEPTED" ? checked.suggestedTitleAlternate.value : "",
  };
}

function videoRows(
  videos: readonly ReviewInputVideo[],
  rows: readonly CreditRow[],
  meta: Map<string, { proposalsFile: string; youtubeTitle: string; recordingTitle: string; credits: number; unmodelled: number }>,
  open: Map<string, string[]>
): VideoRow[] {
  return videos.map(({ video }) => {
    const id = video.youtubeVideoId;
    const mine = rows.filter((r) => r.youtubeVideoId === id);
    const count = (t: Tier) => mine.filter((r) => r.tier === t).length;
    const m = meta.get(id)!;
    return {
      youtubeVideoId: id,
      youtubeUrl: `https://www.youtube.com/watch?v=${id}`,
      youtubeTitle: m.youtubeTitle,
      proposedRecordingTitle: m.recordingTitle,
      isReference: mine.some((r) => r.isReference),
      proposalsFile: m.proposalsFile,
      worstTier: mine.reduce<Tier>((w, r) => worse(w, r.tier), "GREEN"),
      rows: mine.length,
      green: count("GREEN"),
      amber: count("AMBER"),
      red: count("RED"),
      credits: m.credits,
      unmodelled: m.unmodelled,
      openQuestions: open.get(id) ?? [],
    };
  });
}

const NAME_KINDS: readonly ReviewKind[] = ["work", "composer", "lyricist", "arranger", "conductor", "choir/ensemble", "performer", "venue", "institution", "presenter"];

function nameRows(rows: readonly CreditRow[]): NameRow[] {
  const groups = new Map<string, { role: ReviewKind; counts: Map<string, number>; videos: Set<string> }>();
  for (const r of rows) {
    if (!NAME_KINDS.includes(r.kind) || !r.name) continue;
    const key = `${r.kind}\u0000${LOOSE(r.name)}`;
    const g = groups.get(key) ?? { role: r.kind, counts: new Map<string, number>(), videos: new Set<string>() };
    const spelling = normaliseEvidenceText(r.name);
    g.counts.set(spelling, (g.counts.get(spelling) ?? 0) + 1);
    g.videos.add(r.youtubeVideoId);
    groups.set(key, g);
  }
  const order = new Map(NAME_KINDS.map((k, i) => [k, i]));
  return [...groups.values()]
    .map((g) => {
      const spellings = [...g.counts.entries()].sort((a, b) => b[1] - a[1]);
      return { role: g.role, name: spellings[0][0], videoCount: g.videos.size, spellingsSeen: spellings.map(([s]) => s), youtubeVideoIds: [...g.videos].sort() };
    })
    .sort((a, b) => (order.get(a.role) ?? 0) - (order.get(b.role) ?? 0) || b.videoCount - a.videoCount || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// CSV (UTF-8 with BOM, CRLF), safe to open in Excel

export const UTF8_BOM = "﻿";

/** One CSV cell: a value that could start a spreadsheet formula (=, +, -, @, tab, CR) is prefixed with an apostrophe; quotes are doubled. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: readonly string[], rows: ReadonlyArray<readonly unknown[]>): string {
  return UTF8_BOM + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export const CREDITS_HEADER = [
  "youtubeVideoId",
  "youtubeUrl",
  "youtubeTitle",
  "proposedRecordingTitle",
  "originalLanguageTitle",
  "transliteration",
  "kind",
  "name",
  "roleLabel",
  "workTitle",
  "sourceField",
  "quote",
  "basis",
  "venueTypeBasis",
  "isReference",
  "schemaHome",
  "missingInformationAndQuestion",
  "tier",
  "decision",
  "editedName",
  "notes",
] as const;

export const VIDEOS_HEADER = [
  "youtubeVideoId",
  "youtubeUrl",
  "youtubeTitle",
  "proposedRecordingTitle",
  "isReference",
  "proposalsFile",
  "worstTier",
  "rows",
  "green",
  "amber",
  "red",
  "credits",
  "unmodelled",
  "openQuestions",
  "decision",
  "notes",
] as const;

export const NAMES_HEADER = ["role", "name", "videoCount", "spellingsSeen", "youtubeVideoIds", "decision", "canonicalName"] as const;

export function sheetToCsv(sheet: ReviewSheet): { credits: string; videos: string; names: string } {
  return {
    credits: toCsv(
      CREDITS_HEADER,
      sheet.credits.map((r) => [
        r.youtubeVideoId,
        r.youtubeUrl,
        r.youtubeTitle,
        r.proposedRecordingTitle,
        r.originalLanguageTitle,
        r.transliteration,
        r.kind,
        r.name,
        r.roleLabel,
        r.workTitle,
        r.sourceField,
        r.quote,
        r.basis,
        r.venueTypeBasis,
        r.isReference ? "true" : "false",
        r.schemaHome,
        r.questions.join(" | "),
        r.tier,
        "",
        "",
        "",
      ])
    ),
    videos: toCsv(
      VIDEOS_HEADER,
      sheet.videos.map((v) => [
        v.youtubeVideoId,
        v.youtubeUrl,
        v.youtubeTitle,
        v.proposedRecordingTitle,
        v.isReference ? "true" : "false",
        v.proposalsFile,
        v.worstTier,
        v.rows,
        v.green,
        v.amber,
        v.red,
        v.credits,
        v.unmodelled,
        v.openQuestions.join(" | "),
        "",
        "",
      ])
    ),
    names: toCsv(
      NAMES_HEADER,
      sheet.names.map((n) => [n.role, n.name, n.videoCount, n.spellingsSeen.join(" | "), n.youtubeVideoIds.join(" "), "", ""])
    ),
  };
}

export interface TierCounts {
  rows: Record<Tier, number>;
  videos: Record<Tier, number>;
}

export function countTiers(sheet: ReviewSheet): TierCounts {
  const rows: Record<Tier, number> = { GREEN: 0, AMBER: 0, RED: 0 };
  const videos: Record<Tier, number> = { GREEN: 0, AMBER: 0, RED: 0 };
  for (const r of sheet.credits) rows[r.tier]++;
  for (const v of sheet.videos) videos[v.worstTier]++;
  return { rows, videos };
}
