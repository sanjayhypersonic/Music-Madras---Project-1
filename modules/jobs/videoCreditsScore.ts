// Credits extraction, Phase B0 (editorial learning): score checked credit proposals against an editor's verified reference records. PURE: no fs,
// no network, no database; scripts/scoreVideoCredits.ts reads the files.
//
// What is compared is what the checker ACCEPTS (validateVideoCreditsOutput), turned into "facts":
//   accepted credits -> their role (WORK, COMPOSER, LYRICIST, ARRANGER, CONDUCTOR, CHOIR, ENSEMBLE, PERFORMER, VENUE)
//   performanceDate -> PERFORMANCE_DATE;  suggestedTitle -> RECORDING_TITLE (+ ORIGINAL_LANGUAGE_TITLE when non-Latin);  alternateTitle -> TRANSLITERATION
//   verified UNMODELLED gap entries -> PRESENTER, INSTITUTION, PUBLISHED_TITLE, SUBTITLE, ORIGINAL_PERFORMER, TRANSLITERATION, or "UNMODELLED:<label>"
//
// Each reference fact is MATCHED, MISSED (source-stated, so the text says it: a recall failure) or MISSED-EDITOR (editor-supplied: the text cannot
// say it, so its absence is expected). Each proposed fact not used by a match is CONTRADICTS (listed as a contradiction for that video, or a
// different value for a single-valued kind the reference has) or NOT-IN-REFERENCE (for review, not an error).
//   recall    = MATCHED source-stated / (MATCHED source-stated + MISSED)
//   precision = MATCHED / (MATCHED + CONTRADICTS)      (NOT-IN-REFERENCE is unknown, so it counts for neither)
// Names match when they are equal after Unicode normalisation, dropping parenthetical aliases ("(MCC)"), letter case and punctuation:
// "ECI Hope Cathedral Mens Choir" matches "ECI Hope Cathedral Men's Choir"; "Paalan Pirandha Raavil" never matches the Tamil title.

import { hasNonLatinLetters, type CheckedVideoCredits } from "../ai/structuredOutput/validateVideoCreditsOutput";
import { VIDEO_CREDIT_ROLES } from "../ai/prompts/videoCredits/videoCreditsPromptV1";

export const REFERENCE_ONLY_KINDS = ["RECORDING_TITLE", "PUBLISHED_TITLE", "SUBTITLE", "ORIGINAL_LANGUAGE_TITLE", "TRANSLITERATION", "INSTITUTION", "PRESENTER", "ORIGINAL_PERFORMER", "PERFORMANCE_DATE"] as const;
export const FACT_KINDS = [...VIDEO_CREDIT_ROLES, ...REFERENCE_ONLY_KINDS] as const;
export type FactKind = (typeof FACT_KINDS)[number];
export type Basis = "source-stated" | "editor-supplied";

export interface ReferenceFact {
  kind: FactKind;
  name: string;
  workTitle?: string;
  basis: Basis;
  note?: string;
  city?: string;
  language?: string;
}

export interface ReferenceContradiction {
  kind: FactKind;
  /** null = any name of this kind (with this workTitle) contradicts. */
  name: string | null;
  workTitle?: string;
  note: string;
}

export interface ReferenceVideo {
  youtubeVideoId: string;
  facts: ReferenceFact[];
  contradictions: ReferenceContradiction[];
  flags: Array<{ kind: string; workTitle?: string; note: string }>;
}

/** A proposed fact; kind is a FactKind, or "UNMODELLED:<label>" for an unmodelled entry the reference vocabulary does not cover. */
export interface ProposedFact {
  kind: string;
  name: string;
  workTitle: string | null;
}

export type ScoreCategory = "MATCHED" | "MISSED" | "MISSED-EDITOR" | "CONTRADICTS" | "NOT-IN-REFERENCE";

export interface ScoreRow {
  category: ScoreCategory;
  kind: string;
  name: string;
  workTitle: string | null;
  basis?: Basis;
  note?: string;
}

export interface VideoScore {
  youtubeVideoId: string;
  rows: ScoreRow[];
  counts: Record<ScoreCategory, number>;
  /** MATCHED rows whose reference fact is source-stated (the recall numerator). */
  matchedStated: number;
  flags: ReferenceVideo["flags"];
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Arguments and file pairing

export const DEFAULT_REFERENCE_FILE = "tests/fixtures/videoCreditsReference.json";

export interface ScoreArgs {
  proposals: string[];
  reference: string;
  /** Optional, only with exactly one proposals file; otherwise each proposals file is paired with the export that has the same timestamp. */
  exportFile: string | null;
}

/** `--proposals a.json b.json ... [--reference r.json] [--export e.json]`. */
export function parseScoreArgs(argv: readonly string[]): { ok: true; args: ScoreArgs } | { ok: false; error: string } {
  const proposals: string[] = [];
  let reference: string | null = null;
  let exportFile: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--proposals") {
      while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) proposals.push(argv[++i]);
      continue;
    }
    if (flag === "--reference" || flag === "--export") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) return { ok: false, error: `${flag} needs a value.` };
      if (flag === "--reference") reference = value;
      else exportFile = value;
      i++;
      continue;
    }
    return { ok: false, error: `Unknown argument "${flag}".` };
  }
  if (proposals.length === 0) return { ok: false, error: "--proposals <file> [<file> ...] is required." };
  if (exportFile !== null && proposals.length !== 1) return { ok: false, error: "--export can only be given with exactly one proposals file; otherwise exports are paired by timestamp." };
  return { ok: true, args: { proposals, reference: reference ?? DEFAULT_REFERENCE_FILE, exportFile } };
}

/** The ISO-like timestamp at the end of an export/proposals file name (e.g. 2026-11-16T17-40-47-761Z), or null. */
export const fileTimestamp = (fileName: string): string | null => /(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.json$/.exec(fileName)?.[1] ?? null;

/** The export file in `candidates` written at the same moment as the proposals file (same timestamp), or null. */
export function pairedExport(proposalsFileName: string, candidates: readonly string[]): string | null {
  const ts = fileTimestamp(proposalsFileName);
  if (!ts) return null;
  return candidates.find((c) => c.startsWith("export-") && c.endsWith(`${ts}.json`)) ?? null;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Reference file

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isKind = (v: unknown): v is FactKind => typeof v === "string" && (FACT_KINDS as readonly string[]).includes(v);
const optionalString = (v: unknown) => v === undefined || typeof v === "string";

export function parseReference(raw: unknown): { ok: true; videos: ReferenceVideo[] } | { ok: false; problems: string[] } {
  if (!isObject(raw) || raw.version !== 1 || !Array.isArray(raw.videos)) return { ok: false, problems: ["The reference must be { version: 1, videos: [...] }."] };
  const problems: string[] = [];
  const videos: ReferenceVideo[] = [];
  raw.videos.forEach((v, i) => {
    const where = `videos[${i}]`;
    if (!isObject(v) || typeof v.youtubeVideoId !== "string" || !Array.isArray(v.facts) || !Array.isArray(v.contradictions) || !Array.isArray(v.flags)) {
      problems.push(`${where}: needs youtubeVideoId, facts, contradictions and flags.`);
      return;
    }
    v.facts.forEach((f, j) => {
      if (!isObject(f) || !isKind(f.kind) || typeof f.name !== "string" || f.name.trim() === "" || (f.basis !== "source-stated" && f.basis !== "editor-supplied") || !optionalString(f.workTitle)) {
        problems.push(`${where}.facts[${j}]: needs a known kind, a name, basis "source-stated" or "editor-supplied", and workTitle as text if given.`);
      }
    });
    v.contradictions.forEach((c, j) => {
      if (!isObject(c) || !isKind(c.kind) || (c.name !== null && typeof c.name !== "string") || typeof c.note !== "string" || !optionalString(c.workTitle)) {
        problems.push(`${where}.contradictions[${j}]: needs a known kind, a name (or null), and a note.`);
      }
    });
    videos.push(v as unknown as ReferenceVideo);
  });
  return problems.length > 0 ? { ok: false, problems } : { ok: true, videos };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Proposals -> facts

/** Equality key for names: Unicode-normalised, parenthetical aliases dropped, letter case and punctuation ignored. Letters, marks and digits kept. */
export const matchKey = (s: string): string =>
  s
    .normalize("NFKC")
    .replace(/\([^)]*\)/g, " ")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "");

const UNMODELLED_KIND: Record<string, FactKind> = {
  presenter: "PRESENTER",
  institution: "INSTITUTION",
  "published title": "PUBLISHED_TITLE",
  "catalogue title": "PUBLISHED_TITLE",
  "presented title": "SUBTITLE",
  subtitle: "SUBTITLE",
  "original artist": "ORIGINAL_PERFORMER",
  "original artists": "ORIGINAL_PERFORMER",
  "original performer": "ORIGINAL_PERFORMER",
  transliteration: "TRANSLITERATION",
};

export function proposedFacts(checked: CheckedVideoCredits): ProposedFact[] {
  const facts: ProposedFact[] = checked.accepted.map((c) => ({ kind: c.role, name: c.name, workTitle: c.workTitle }));
  if (checked.performanceDate.status === "ACCEPTED") facts.push({ kind: "PERFORMANCE_DATE", name: checked.performanceDate.value, workTitle: null });
  if (checked.suggestedTitle.status === "ACCEPTED") {
    facts.push({ kind: "RECORDING_TITLE", name: checked.suggestedTitle.value, workTitle: null });
    if (hasNonLatinLetters(checked.suggestedTitle.value)) facts.push({ kind: "ORIGINAL_LANGUAGE_TITLE", name: checked.suggestedTitle.value, workTitle: null });
  }
  if (checked.suggestedTitleAlternate.status === "ACCEPTED") facts.push({ kind: "TRANSLITERATION", name: checked.suggestedTitleAlternate.value, workTitle: null });
  for (const u of checked.unmodelled) {
    if (u.status !== "VERIFIED") continue;
    facts.push({ kind: UNMODELLED_KIND[u.label.trim().toLowerCase()] ?? `UNMODELLED:${u.label}`, name: u.name, workTitle: null });
  }
  const seen = new Set<string>();
  return facts.filter((f) => {
    const k = [f.kind, matchKey(f.name), matchKey(f.workTitle ?? "")].join("|");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Scoring

/** Kinds where a different proposed value is a contradiction when the reference has one. */
const SINGLE_VALUED: readonly string[] = ["PERFORMANCE_DATE", "CONDUCTOR", "VENUE", "RECORDING_TITLE"];

const sameWork = (a: string | null | undefined, b: string | null | undefined) => !a || !b || matchKey(a) === matchKey(b);

export function scoreVideo(reference: ReferenceVideo, proposed: readonly ProposedFact[]): VideoScore {
  const rows: ScoreRow[] = [];
  const used = new Set<number>();
  let matchedStated = 0;

  for (const r of reference.facts) {
    const i = proposed.findIndex((p, idx) => !used.has(idx) && p.kind === r.kind && matchKey(p.name) === matchKey(r.name) && sameWork(p.workTitle, r.workTitle));
    const base = { kind: r.kind, name: r.name, workTitle: r.workTitle ?? null, basis: r.basis, note: r.note };
    if (i >= 0) {
      used.add(i);
      rows.push({ category: "MATCHED", ...base });
      if (r.basis === "source-stated") matchedStated++;
    } else rows.push({ category: r.basis === "editor-supplied" ? "MISSED-EDITOR" : "MISSED", ...base });
  }

  proposed.forEach((p, idx) => {
    if (used.has(idx)) return;
    const listed = reference.contradictions.find(
      (c) => c.kind === p.kind && (c.name === null || matchKey(c.name) === matchKey(p.name)) && (!c.workTitle || (p.workTitle !== null && matchKey(c.workTitle) === matchKey(p.workTitle)))
    );
    if (listed) return rows.push({ category: "CONTRADICTS", kind: p.kind, name: p.name, workTitle: p.workTitle, note: listed.note });
    const expected = reference.facts.filter((r) => r.kind === p.kind && sameWork(p.workTitle, r.workTitle));
    if (SINGLE_VALUED.includes(p.kind) && expected.length > 0) {
      return rows.push({ category: "CONTRADICTS", kind: p.kind, name: p.name, workTitle: p.workTitle, note: `The reference has ${expected.map((r) => r.name).join(" / ")}.` });
    }
    rows.push({ category: "NOT-IN-REFERENCE", kind: p.kind, name: p.name, workTitle: p.workTitle });
  });

  const counts: Record<ScoreCategory, number> = { MATCHED: 0, MISSED: 0, "MISSED-EDITOR": 0, CONTRADICTS: 0, "NOT-IN-REFERENCE": 0 };
  for (const row of rows) counts[row.category]++;
  return { youtubeVideoId: reference.youtubeVideoId, rows, counts, matchedStated, flags: reference.flags };
}

export interface ScoreSummary {
  counts: Record<ScoreCategory, number>;
  matchedStated: number;
  /** null when there is nothing to divide (no source-stated reference facts / no judged proposals). */
  recall: number | null;
  precision: number | null;
}

export function summariseScores(scores: readonly VideoScore[]): ScoreSummary {
  const counts: Record<ScoreCategory, number> = { MATCHED: 0, MISSED: 0, "MISSED-EDITOR": 0, CONTRADICTS: 0, "NOT-IN-REFERENCE": 0 };
  let matchedStated = 0;
  for (const s of scores) {
    for (const k of Object.keys(counts) as ScoreCategory[]) counts[k] += s.counts[k];
    matchedStated += s.matchedStated;
  }
  const recallBase = matchedStated + counts.MISSED;
  const precisionBase = counts.MATCHED + counts.CONTRADICTS;
  return { counts, matchedStated, recall: recallBase === 0 ? null : matchedStated / recallBase, precision: precisionBase === 0 ? null : counts.MATCHED / precisionBase };
}

const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
const ORDER: ScoreCategory[] = ["MATCHED", "MISSED", "MISSED-EDITOR", "CONTRADICTS", "NOT-IN-REFERENCE"];

export function formatVideoScore(score: VideoScore, title: string | null, sourceFile: string | null): string[] {
  const lines = [`## ${score.youtubeVideoId}  ${title ?? "(not in any given proposals file)"}${sourceFile ? `  [${sourceFile}]` : ""}`];
  for (const category of ORDER) {
    for (const row of score.rows.filter((r) => r.category === category)) {
      lines.push(`  ${category.padEnd(17)} ${row.kind.padEnd(24)} ${row.name}${row.workTitle && row.kind !== "WORK" ? `  [${row.workTitle}]` : ""}${row.note && category !== "MATCHED" ? `  -- ${row.note}` : ""}`);
    }
  }
  for (const f of score.flags) lines.push(`  FLAG              ${f.kind.padEnd(24)} ${f.note}`);
  lines.push(`  counts: ${ORDER.map((c) => `${c} ${score.counts[c]}`).join(", ")}`);
  return lines;
}

export function formatSummary(summary: ScoreSummary): string[] {
  const c = summary.counts;
  return [
    `Totals: ${ORDER.map((k) => `${k} ${c[k]}`).join(", ")}`,
    `Recall    = MATCHED source-stated / (MATCHED source-stated + MISSED) = ${summary.matchedStated} / ${summary.matchedStated + c.MISSED} = ${pct(summary.recall)}`,
    `Precision = MATCHED / (MATCHED + CONTRADICTS) = ${c.MATCHED} / ${c.MATCHED + c.CONTRADICTS} = ${pct(summary.precision)}`,
    "MISSED-EDITOR (editor-supplied, not in the text) and NOT-IN-REFERENCE (for review) count for neither.",
  ];
}
