// Credits pipeline, Phase B2: PLAN the staging DRAFT records for approved credits. PURE (no fs, no network, no database). The executor that carries a
// plan out against the staging database is modules/jobs/videoCreditsCreateExecute.ts; scripts/createVideoCredits.ts wires both.
//
// From each video's approved facts (modules/jobs/videoCreditsApproved.ts) the planner decides, per the written exception
// (docs/video-credits-review-and-approval.md section 5) and the schema mapping (project register R-31):
//   - a video is HELD OUT entirely when any approved work has no editor-approved composer (a composer is never invented), when no work is
//     approved, or when it has several works and no approved Recording title (the slug is immutable);
//   - R-36: a work may have SEVERAL composers, kept in stated (sheet) order: the first is the primary composer (MusicalWork.composerId), the
//     others are co-composers (musical_work_composers);
//   - a medley is ONE Recording with its works in sheet order; each work keeps its own composer;
//   - an original-script work title stays the title; its transliteration (approved) and an editor's Latin spelling become alternate titles;
//   - a Venue is planned only with exactly one approved venue and one approved venue type; the type keeps its basis (an inferred type stays
//     "inferred from name (editor-accepted)"); without a Venue there is no Performance, and its participants go to the sidecar;
//   - a Performance needs a Programme (schema): one per Recording, titled with the approved Recording title, holding its works;
//   - a performance date is stored only when complete (YYYY-MM-DD); a partial date goes to the sidecar (a DateTime would invent a day);
//   - R-36: lyricists, arrangers and translators of a work are planned as its CONTRIBUTORS (musical_work_contributors, each a Person); an
//     ensemble or orchestra is planned on the Performance (performance_ensembles);
//   - only facts with NO schema home (presenter, institution, choreographer, original title, published title and other UNMODELLED facts), and
//     facts that cannot be placed (a contributor of no approved work, a participant with no Performance, a partial date), go to the SIDECAR report
//     with their basis and quote, never into a field that would distort them.

import { canonicalSlugBase, hasNonLatinScript, type CanonicalSlugInput } from "../mmke/slug/canonicalSlug";
import { isNonPersonName, isTranslatedTitleLabel, isTranslatorLabel } from "../mmke/people/personNames";
import { looseNameKey, roleLabelLine, roleOf, type ApprovedFact, type CatalogueVenueType, type RefusedRow, type VideoFacts } from "./videoCreditsApproved";

export interface PlannedName {
  name: string;
  basis: string;
  sheetRow: number;
}

export type PlannedContributorRole = "LYRICIST" | "ARRANGER" | "TRANSLATOR";

export interface PlannedWork {
  title: string;
  alternateTitles: string[];
  basis: string;
  /** R-36: every approved composer in stated order; [0] is the primary composer. Never empty for a planned work. */
  composers: PlannedName[];
  /** R-36: lyricists, arrangers and translators of this work, each found or created as a Person. */
  contributors: Array<PlannedName & { role: PlannedContributorRole }>;
  sheetRow: number;
}

export interface SidecarFact {
  youtubeVideoId: string;
  kind: string;
  label: string;
  name: string;
  workTitle: string;
  quote: string;
  basis: string;
  reason: string;
}

export interface VideoCreatePlan {
  youtubeVideoId: string;
  youtubeTitle: string;
  /** Non-empty: nothing is created for this video. */
  heldReasons: string[];
  recording: { title: string | null; titleBasis: string; slug: Omit<CanonicalSlugInput, "fallback">; plannedSlug: string } | null;
  works: PlannedWork[];
  programme: { title: string } | null;
  venue: { name: string; type: CatalogueVenueType; typeBasis: string; basis: string } | null;
  performance: { date: string | null } | null;
  choirs: PlannedName[];
  /** R-36: ensembles and orchestras on the Performance. */
  ensembles: PlannedName[];
  conductors: PlannedName[];
  performers: Array<PlannedName & { role: string | null }>;
  sidecar: SidecarFact[];
  notes: string[];
  refused: RefusedRow[];
  ignored: number;
}

const same = (a: string, b: string) => looseNameKey(a) === looseNameKey(b);
const unique = (values: string[]) => [...new Map(values.filter(Boolean).map((v) => [looseNameKey(v), v])).values()];

const KIND_LABEL: Partial<Record<ApprovedFact["kind"], string>> = { performanceDate: "DATE", venueType: "VENUE TYPE", "choir/ensemble": "CHOIR" };

function sidecarOf(f: ApprovedFact, reason: string): SidecarFact {
  return { youtubeVideoId: f.youtubeVideoId, kind: f.kind, label: roleOf(f.roleLabel) || KIND_LABEL[f.kind] || f.kind.toUpperCase(), name: f.name, workTitle: f.workTitle, quote: f.quote, basis: f.basis, reason };
}

const UNMODELLED_REASON: Record<string, string> = {
  presenter: "No presenter credit in the catalogue.",
  institution: "Venue.organisationId exists, but the sheet does not say whether the institution is the venue's or the choir's (Choir has no organisation relation).",
  "other unmodelled": "No catalogue field for this fact.",
};

export function planVideo(v: VideoFacts): VideoCreatePlan {
  const plan: VideoCreatePlan = {
    youtubeVideoId: v.youtubeVideoId,
    youtubeTitle: v.youtubeTitle,
    heldReasons: [],
    recording: null,
    works: [],
    programme: null,
    venue: null,
    performance: null,
    choirs: [],
    ensembles: [],
    conductors: [],
    performers: [],
    sidecar: [],
    notes: [],
    refused: v.refused,
    ignored: v.ignored,
  };
  const of = (kind: ApprovedFact["kind"]) => v.facts.filter((f) => f.kind === kind);
  const translit = v.transliterationApproved ? v.transliteration : "";

  // Works and their composers.
  const works = of("work");
  const composers = of("composer");
  const attributed = new Set<ApprovedFact>();
  if (works.length === 0) plan.heldReasons.push("no approved work.");
  for (const w of works) {
    // An original-script title is never replaced: an editor's Latin spelling of it becomes an alternate title instead.
    const keepOriginal = hasNonLatinScript(w.proposedName) && !hasNonLatinScript(w.name);
    const title = keepOriginal ? w.proposedName : w.name;
    const alternates = unique([keepOriginal ? w.name : "", hasNonLatinScript(title) && (same(w.proposedName, v.originalLanguageTitle) || works.length === 1) ? translit : ""]).filter((a) => !same(a, title));
    if (keepOriginal) plan.notes.push(`Work "${title}": the edited Latin spelling "${w.name}" is kept as an alternate title; the original-script title stays the title.`);

    const forWork = composers.filter((c) => c.workTitle && (same(c.workTitle, w.name) || same(c.workTitle, w.proposedName)));
    const candidates = forWork.length > 0 ? forWork : works.length === 1 ? composers.filter((c) => !c.workTitle) : [];
    const names = unique(candidates.map((c) => c.name));
    if (names.length === 0) {
      plan.heldReasons.push(`work "${title}" has no editor-approved composer (a composer is never invented).`);
      continue;
    }
    // R-36: several approved composers are co-composers, in stated (sheet) order; the first is the primary composer.
    const ordered = names.map((n) => candidates.filter((x) => same(x.name, n)).sort((a, b) => a.sheetRow - b.sheetRow)[0]).sort((a, b) => a.sheetRow - b.sheetRow);
    candidates.forEach((x) => attributed.add(x));
    plan.works.push({ title, alternateTitles: alternates, basis: w.basis, composers: ordered.map((c) => ({ name: c.name, basis: c.basis, sheetRow: c.sheetRow })), contributors: [], sheetRow: w.sheetRow });
  }

  // R-36: lyricists, arrangers and translators become the CONTRIBUTORS of the work they belong to (its title, or the video's only work).
  const contributorFacts: Array<{ fact: ApprovedFact; role: PlannedContributorRole }> = [
    ...of("lyricist").map((fact) => ({ fact, role: "LYRICIST" as const })),
    ...of("arranger").map((fact) => ({ fact, role: "ARRANGER" as const })),
    // R-38: only a "Translator" or "Translated by" label is a translator (a person); "Translation" and the like carry a translated title.
    ...of("other unmodelled").filter((f) => isTranslatorLabel(roleOf(f.roleLabel))).map((fact) => ({ fact, role: "TRANSLATOR" as const })),
  ];
  for (const { fact, role } of contributorFacts) {
    // R-38: "Traditional", "Anonymous", "Unknown" and "Various" are not people: no Person, no contributor link.
    if (isNonPersonName(fact.name)) {
      plan.sidecar.push(sidecarOf(fact, `"${fact.name}" is not a person's name: no person page and no ${role.toLowerCase()} link.`));
      continue;
    }
    const workIndex = fact.workTitle ? works.findIndex((w) => same(fact.workTitle, w.name) || same(fact.workTitle, w.proposedName)) : works.length === 1 ? 0 : -1;
    const planned = workIndex >= 0 ? plan.works.find((pw) => pw.sheetRow === works[workIndex].sheetRow) : undefined;
    if (!planned) {
      plan.sidecar.push(sidecarOf(fact, fact.workTitle ? `${role.toLowerCase()} of "${fact.workTitle}", which is not a planned work of this video.` : `${role.toLowerCase()} not attributable to one work (several works, no work title).`));
      continue;
    }
    if (!planned.contributors.some((c) => c.role === role && same(c.name, fact.name))) planned.contributors.push({ name: fact.name, basis: fact.basis, sheetRow: fact.sheetRow, role });
  }
  for (const c of composers) if (!attributed.has(c)) plan.sidecar.push(sidecarOf(c, c.workTitle ? `Composer of "${c.workTitle}", which is not an approved work of this video.` : "Composer not attributable to one work (several works, no work title)."));

  // Recording title and slug.
  const recordingTitle = v.approvedRecordingTitle ?? (works.length === 1 ? plan.works[0]?.title ?? null : null);
  if (works.length > 1 && !v.approvedRecordingTitle) plan.heldReasons.push("several works and no approved Recording title: accept the video in review-videos.csv to approve its proposed title (the slug is built from it and never changes).");
  if (recordingTitle && hasNonLatinScript(recordingTitle) && !translit) plan.notes.push(`"${recordingTitle}" has no approved transliteration, so its slug falls back to "recording".`);

  // Performance context.
  const venues = of("venue");
  const types = of("venueType");
  const dates = of("performanceDate");
  const date = dates.length === 1 ? dates[0].name : null;
  if (dates.length > 1) plan.notes.push(`several approved performance dates (${dates.map((d) => d.name).join(", ")}); none stored.`);
  const year = date ? date.slice(0, 4) : null;
  if (venues.length > 1) plan.notes.push(`several approved venues (${venues.map((x) => x.name).join(", ")}); no Venue or Performance planned.`);
  if (venues.length === 1) {
    if (types.length === 1) plan.venue = { name: venues[0].name, type: types[0].name as CatalogueVenueType, typeBasis: types[0].venueTypeBasis || types[0].basis, basis: venues[0].basis };
    else plan.notes.push(types.length === 0 ? `Venue "${venues[0].name}" not planned: no approved venue type (Venue.type is required; choose one with edit on its venueType row).` : "several approved venue types; no Venue planned.");
  } else if (types.length > 0 && venues.length === 0) for (const t of types) plan.sidecar.push(sidecarOf(t, "Venue type approved without an approved venue."));
  if (plan.venue) {
    plan.performance = { date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null };
    if (date && !plan.performance.date) for (const d of dates) plan.sidecar.push(sidecarOf(d, "Partial date: Performance.performanceDate is a full date, and storing it would invent a day."));
  } else {
    for (const d of dates) plan.sidecar.push(sidecarOf(d, "No Performance to hold the date (no Venue)."));
  }

  // Participants.
  for (const f of of("choir/ensemble")) {
    const ensemble = roleOf(f.roleLabel) === "ENSEMBLE";
    if (plan.performance) (ensemble ? plan.ensembles : plan.choirs).push({ name: f.name, basis: f.basis, sheetRow: f.sheetRow });
    else plan.sidecar.push(sidecarOf(f, `No Performance to attach the ${ensemble ? "ensemble" : "choir"} to (no Venue).`));
  }
  for (const f of of("conductor")) {
    if (plan.performance) plan.conductors.push({ name: f.name, basis: f.basis, sheetRow: f.sheetRow });
    else plan.sidecar.push(sidecarOf(f, "No Performance to attach the conductor to (no Venue)."));
  }
  for (const f of of("performer")) {
    if (plan.performance) plan.performers.push({ name: f.name, basis: f.basis, sheetRow: f.sheetRow, role: roleLabelLine(f.roleLabel) });
    else plan.sidecar.push(sidecarOf(f, "No Performance to attach the performer to (no Venue)."));
  }
  for (const kind of ["presenter", "institution", "other unmodelled"] as const)
    for (const f of of(kind)) {
      if (kind === "other unmodelled" && isTranslatorLabel(roleOf(f.roleLabel))) continue; // planned as a translator above
      if (kind === "other unmodelled" && isTranslatedTitleLabel(roleOf(f.roleLabel))) plan.sidecar.push(sidecarOf(f, "A translated title, not a person: no catalogue field (an editor may add it to the work's alternate titles)."));
      else plan.sidecar.push(sidecarOf(f, UNMODELLED_REASON[kind]));
    }
  if (v.transliteration && translit && recordingTitle && hasNonLatinScript(recordingTitle)) {
    plan.sidecar.push({ youtubeVideoId: v.youtubeVideoId, kind: "transliteration", label: "TRANSLITERATION", name: translit, workTitle: recordingTitle, quote: "", basis: "", reason: "Kept as the work's alternate title; MusicalWork.alternateTitles cannot mark it as the transliteration, and a Recording has no alternate titles." });
  }

  if (plan.heldReasons.length > 0) {
    plan.works = [];
    plan.venue = null;
    plan.performance = null;
    plan.choirs = [];
    plan.ensembles = [];
    plan.conductors = [];
    plan.performers = [];
    return plan;
  }
  const slug = { title: recordingTitle!, transliteration: translit || null, year };
  plan.recording = { title: recordingTitle, titleBasis: v.approvedRecordingTitle ? "approved in review-videos.csv" : "the approved work title", slug, plannedSlug: canonicalSlugBase({ ...slug, fallback: "recording" }) };
  if (plan.performance) plan.programme = { title: recordingTitle! };
  return plan;
}

export function planVideos(videos: readonly VideoFacts[], only: readonly string[] | null): VideoCreatePlan[] {
  const wanted = only ? new Set(only) : null;
  return videos.filter((v) => !wanted || wanted.has(v.youtubeVideoId)).map(planVideo);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Arguments

export interface CreditsCreateArgs {
  dir: string;
  only: string[] | null;
  execute: boolean;
  confirmHost: string | null;
}

export function parseCreditsCreateArgs(argv: readonly string[]): { ok: true; args: CreditsCreateArgs } | { ok: false; error: string } {
  const args: CreditsCreateArgs = { dir: "reports/video-credits", only: null, execute: false, confirmHost: null };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--execute") {
      args.execute = true;
      continue;
    }
    const value = argv[i + 1];
    if (!["--dir", "--only", "--confirm-host"].includes(flag)) return { ok: false, error: `Unknown argument "${flag}".` };
    if (value === undefined || value.startsWith("--")) return { ok: false, error: `${flag} needs a value.` };
    if (flag === "--dir") args.dir = value;
    if (flag === "--confirm-host") args.confirmHost = value;
    if (flag === "--only") {
      const ids = value.split(",").map((s) => s.trim()).filter(Boolean);
      if (ids.length === 0 || ids.some((id) => !/^[A-Za-z0-9_-]{11}$/.test(id))) return { ok: false, error: "--only takes comma-separated 11-character YouTube video ids." };
      args.only = ids;
    }
    i++;
  }
  if (args.execute && !args.confirmHost) return { ok: false, error: "--execute needs --confirm-host <host:port/database> (the staging target, typed by the operator)." };
  return { ok: true, args };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Printing

export function describePlan(plan: VideoCreatePlan): string[] {
  const lines = [`${plan.youtubeVideoId}  ${plan.heldReasons.length > 0 ? "HELD OUT" : "READY"}  (${plan.youtubeTitle.slice(0, 70)})`];
  for (const r of plan.heldReasons) lines.push(`    held: ${r}`);
  if (plan.recording) lines.push(`    Recording (DRAFT): title "${plan.recording.title ?? "(left empty)"}" [${plan.recording.titleBasis}], slug ${plan.recording.plannedSlug} (year then a number if taken)`);
  plan.works.forEach((w, i) => {
    lines.push(`    Work ${i + 1}: "${w.title}" [${w.basis}]${w.alternateTitles.length ? `, alternate titles: ${w.alternateTitles.map((a) => `"${a}"`).join(", ")}` : ""}`);
    w.composers.forEach((c, j) => lines.push(`      ${j === 0 ? "Composer" : `Co-composer ${j + 1}`}: ${c.name} [${c.basis}]  (find by exact normalised name, else create; ${isNonPersonName(c.name) ? "not a person's name: no person page" : "linked to its person"})`));
    for (const c of w.contributors) lines.push(`      ${c.role === "LYRICIST" ? "Lyricist" : c.role === "ARRANGER" ? "Arranger" : "Translator"}: ${c.name} [${c.basis}]  (person: exact name or approved alias, else create)`);
  });
  if (plan.programme) lines.push(`    Programme (schema container): "${plan.programme.title}" holding ${plan.works.length} work(s)`);
  if (plan.venue) lines.push(`    Venue: ${plan.venue.name} [${plan.venue.basis}], type ${plan.venue.type} [${plan.venue.typeBasis}]`);
  if (plan.performance) lines.push(`    Performance: date ${plan.performance.date ?? "not stored"}`);
  for (const c of plan.choirs) lines.push(`      Choir: ${c.name} [${c.basis}]`);
  for (const e of plan.ensembles) lines.push(`      Ensemble: ${e.name} [${e.basis}]`);
  for (const c of plan.conductors) lines.push(`      Conductor: ${c.name} [${c.basis}]`);
  for (const p of plan.performers) lines.push(`      Performer: ${p.name}${p.role ? ` (${p.role})` : ""} [${p.basis}]`);
  for (const n of plan.notes) lines.push(`    note: ${n}`);
  for (const s of plan.sidecar) lines.push(`    sidecar: ${s.label} ${s.name}${s.workTitle ? ` (${s.workTitle})` : ""} [${s.basis || "-"}]: ${s.reason}`);
  for (const r of plan.refused) lines.push(`    refused row ${r.sheetRow} (${r.kind} ${r.name}): ${r.reason}`);
  if (plan.ignored > 0) lines.push(`    ignored: ${plan.ignored} row(s) with no decision, defer or reject`);
  return lines;
}
