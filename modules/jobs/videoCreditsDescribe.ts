// Credits pipeline, Phase B2: DRAFT descriptions from approved facts. PURE and DETERMINISTIC (no fs, no network, no database, no API): a fixed
// template following docs/content-editorial-standard.md section 7, filled only with facts the editor approved in the review sheets.
//
//   1. opening line: the title (original script kept; an approved transliteration in brackets), an em dash, and who performed it, where and when;
//   2. creators: "The words and music are by …, with an arrangement by …, conducted by …" (one work), or the conductor alone (a medley, whose
//      creators are listed per work in the details);
//   3. context, only when approved: a published title or subtitle;
//   4. archive sentence, and the presenter when approved ("Recorded and presented by");
//   5. "Performance Details": one labelled line per fact, emoji-led; a medley lists its works as a numbered list with credit lines under each;
//   6. optional invitation.
// Never: a characterisation of the music ("an Advent carol"), a historical or theological claim, an adjective about performers, a fact the editor
// did not approve, hashtags, or anything that would replace the YouTube text: the result is a DRAFT in review-descriptions.csv for an editor.

import { hasNonLatinScript } from "../mmke/slug/canonicalSlug";
import { looseNameKey, roleLabelLine, roleOf, type ApprovedFact, type VideoFacts } from "./videoCreditsApproved";
import { toCsv } from "./videoCreditsReview";

export const INVITATION = "Explore more performances in the Music Madras archive, and subscribe for new recordings.";
export const ARCHIVE_SENTENCE = "This performance is part of the Music Madras archive.";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2025-12-12" -> "12 December 2025"; "2025-12" -> "December 2025"; "2025" -> "2025". */
export function formatPerformanceDate(value: string): string {
  const [y, m, d] = value.split("-");
  if (d) return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
  if (m) return `${MONTHS[Number(m) - 1]} ${y}`;
  return y;
}

const same = (a: string, b: string) => looseNameKey(a) === looseNameKey(b);
const names = (facts: ApprovedFact[]) => [...new Map(facts.map((f) => [looseNameKey(f.name), f.name])).values()];
const list = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
const withThe = (choir: string) => (/^the\s/i.test(choir) ? choir : `the ${choir}`);

interface WorkCredits {
  title: string;
  composers: string[];
  lyricists: string[];
  arrangers: string[];
}

export interface DescriptionDraft {
  youtubeVideoId: string;
  recordingTitle: string;
  draft: string;
  factsUsed: number;
  notes: string[];
}

export function draftDescription(v: VideoFacts, options: { invitation?: boolean; heldReasons?: string[] } = {}): DescriptionDraft {
  const of = (kind: ApprovedFact["kind"]) => v.facts.filter((f) => f.kind === kind);
  const notes: string[] = [];
  const translit = v.transliterationApproved ? v.transliteration : "";

  // Works, with their creators (a single work also takes the credits that name no work).
  const workFacts = of("work");
  const creditsFor = (kind: ApprovedFact["kind"], w: ApprovedFact) =>
    names(of(kind).filter((c) => (c.workTitle ? same(c.workTitle, w.name) || same(c.workTitle, w.proposedName) : workFacts.length === 1)));
  const works: WorkCredits[] = workFacts.map((w) => ({
    title: hasNonLatinScript(w.proposedName) && !hasNonLatinScript(w.name) ? w.proposedName : w.name,
    composers: creditsFor("composer", w),
    lyricists: creditsFor("lyricist", w),
    arrangers: creditsFor("arranger", w),
  }));
  const medley = works.length > 1;
  const title = v.approvedRecordingTitle ?? (works.length === 1 ? works[0].title : "");
  if (!title) notes.push(medley ? "No approved Recording title for these works: the opening names the works instead. Accept the video in review-videos.csv to use its proposed title." : "No approved work or title.");
  const titleWithTranslit = translit && hasNonLatinScript(title) ? `${title} (${translit})` : title;

  // Performance context.
  const institutions = names(of("institution"));
  const choirs = of("choir/ensemble").filter((f) => roleOf(f.roleLabel) !== "ENSEMBLE");
  const ensembles = of("choir/ensemble").filter((f) => roleOf(f.roleLabel) === "ENSEMBLE");
  const performers = of("performer").map((f) => ({ name: f.name, role: roleLabelLine(f.roleLabel) }));
  const conductors = names(of("conductor"));
  const venues = names(of("venue"));
  const dates = of("performanceDate");
  const date = dates.length === 1 ? formatPerformanceDate(dates[0].name) : "";
  if (dates.length > 1) notes.push("Several approved dates: none used.");
  const venue = venues.length === 1 ? venues[0] : "";
  if (venues.length > 1) notes.push("Several approved venues: none used.");
  const presenters = names(of("presenter"));
  const unmodelled = of("other unmodelled");
  const published = unmodelled.filter((f) => /PUBLISHED|CATALOGUE/i.test(roleOf(f.roleLabel))).map((f) => f.name);
  const subtitles = unmodelled.filter((f) => /SUBTITLE/i.test(roleOf(f.roleLabel))).map((f) => f.name);

  const choirText = names(choirs).map((c) => (institutions.length === 1 ? `${withThe(c)}, ${institutions[0]}` : withThe(c)));
  const who = [...choirText, ...names(ensembles).map(withThe), ...performers.map((p) => (p.role ? `${p.name} (${p.role})` : p.name))];

  const paragraphs: string[] = [];
  // 1. Opening line.
  const opening = medley && !title ? list(works.map((w) => w.title)) : titleWithTranslit;
  const lead = medley && title ? `${works.length} works performed` : "performed";
  const fullDate = dates.length === 1 && /^\d{4}-\d{2}-\d{2}$/.test(dates[0].name);
  const where = `${venue ? ` at ${venue}` : ""}${date ? ` ${fullDate ? "on" : "in"} ${date}` : ""}`;
  if (who.length > 0) paragraphs.push(`${opening} — ${lead} by ${list(who)}${where}.`);
  else paragraphs.push(where ? `${opening} — ${lead}${where}.` : `${opening}.`);

  // 2. Creators and conductor.
  const conducted = conductors.length > 0 ? `conducted by ${list(conductors)}` : "";
  if (!medley && works.length === 1) {
    const w = works[0];
    const sameWriter = w.composers.length > 0 && w.lyricists.length > 0 && w.composers.length === w.lyricists.length && w.composers.every((c) => w.lyricists.some((l) => same(c, l)));
    const parts: string[] = [];
    if (sameWriter) parts.push(`The words and music are by ${list(w.composers)}`);
    else {
      if (w.lyricists.length) parts.push(`The words are by ${list(w.lyricists)}`);
      if (w.composers.length) parts.push(`${parts.length ? "the music is" : "The music is"} by ${list(w.composers)}`);
    }
    let sentence = parts.join(" and ");
    if (w.arrangers.length) sentence = sentence ? `${sentence}, with an arrangement by ${list(w.arrangers)}` : `The arrangement is by ${list(w.arrangers)}`;
    if (conducted) sentence = sentence ? `${sentence}, ${conducted}` : `It is ${conducted}`;
    if (sentence) paragraphs.push(`${sentence}.`);
  } else if (conducted) paragraphs.push(`The performance is ${conducted}.`);

  // 3. Context (approved facts only).
  const context = [...published.map((p) => `Published as "${p}".`), ...subtitles.map((s) => `Also titled "${s}".`)];
  if (context.length) paragraphs.push(context.join(" "));

  // 4. Archive.
  paragraphs.push(presenters.length ? `${ARCHIVE_SENTENCE} It was recorded and presented by ${list(presenters)}.` : ARCHIVE_SENTENCE);

  // 5. Performance Details.
  const details: string[] = ["Performance Details"];
  const creditLines = (w: WorkCredits, indent: string) => [
    ...(w.lyricists.length && !(w.composers.length && w.lyricists.every((l) => w.composers.some((c) => same(c, l)))) ? [`${indent}✍️ Words: ${w.lyricists.join(", ")}`] : []),
    ...(w.lyricists.length && w.composers.length && w.lyricists.every((l) => w.composers.some((c) => same(c, l))) ? [`${indent}✍️ Words and music: ${w.composers.join(", ")}`] : w.composers.length ? [`${indent}🎼 Music: ${w.composers.join(", ")}`] : []),
    ...(w.arrangers.length ? [`${indent}🎹 Arrangement: ${w.arrangers.join(", ")}`] : []),
  ];
  if (medley) {
    if (title) details.push(`🎵 ${title}`);
    works.forEach((w, i) => details.push(`${i + 1}. ${w.title}`, ...creditLines(w, "   ")));
  } else if (works.length === 1) {
    details.push(`🎵 Work: ${works[0].title}`);
    if (translit && hasNonLatinScript(works[0].title)) details.push(`🔤 Transliteration: ${translit}`);
    details.push(...creditLines(works[0], ""));
  }
  for (const c of choirText) details.push(`👥 Choir: ${c.replace(/^the /, "")}`);
  for (const e of names(ensembles)) details.push(`🎻 Ensemble: ${e}`);
  for (const p of performers) details.push(`🎤 ${p.role ?? "Performer"}: ${p.name}`);
  for (const c of conductors) details.push(`🎶 Conductor: ${c}`);
  if (venue) details.push(`📍 Venue: ${venue}`);
  if (date) details.push(`📅 Date: ${date}`);
  for (const p of presenters) details.push(`🎥 Recorded and presented by: ${p}`);
  paragraphs.push(details.join("\n"));

  // 6. Invitation.
  if (options.invitation !== false) paragraphs.push(INVITATION);

  for (const h of options.heldReasons ?? []) notes.push(`Held out of ai:video-credits-create: ${h}`);
  if (v.refused.length) notes.push(`${v.refused.length} refused row(s) left out.`);
  return { youtubeVideoId: v.youtubeVideoId, recordingTitle: title, draft: paragraphs.join("\n\n"), factsUsed: v.facts.length, notes };
}

export const DESCRIPTIONS_HEADER = ["youtubeVideoId", "youtubeUrl", "youtubeTitle", "recordingTitle", "factsUsed", "draftDescription", "notes", "decision", "editedDescription", "editorNotes"] as const;

/** review-descriptions.csv: one DRAFT per video, for an editor; never written anywhere else. */
export function descriptionsToCsv(drafts: ReadonlyArray<DescriptionDraft & { youtubeTitle: string }>): string {
  return toCsv(
    DESCRIPTIONS_HEADER,
    drafts.map((d) => [d.youtubeVideoId, `https://www.youtube.com/watch?v=${d.youtubeVideoId}`, d.youtubeTitle, d.recordingTitle, d.factsUsed, d.draft, d.notes.join(" | "), "", "", ""])
  );
}
