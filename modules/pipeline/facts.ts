// Upload-to-draft pipeline (R-34): the bridge from a pipeline bundle to the EXISTING credits planner and creation tool. Pure.
//
// When the owner approves a bundle, its validated credits (with the canonical names resolution chose) become the same VideoFacts the reviewed
// spreadsheets produce (modules/jobs/videoCreditsApproved.ts), so planVideo() and executeCreditsPlans() run unchanged: the same holds (a work
// without exactly one composer holds the video out), the same exact-normalised matching, the same slug rule, the same "never touch a Recording an
// editor changed" guard. EXCEPTION entities are left out: an unresolved name is never created or linked.

import type { CheckedVideoCredits } from "../ai/structuredOutput/validateVideoCreditsOutput";
import { hasNonLatinLetters } from "../ai/structuredOutput/validateVideoCreditsOutput";
import { BASIS, type ReviewKind } from "../jobs/videoCreditsReview";
import type { ApprovedFact, VideoFacts } from "../jobs/videoCreditsApproved";
import type { VideoCreditRole } from "../ai/prompts/videoCredits/videoCreditsPromptV1";
import { nameKey, type Resolution } from "./resolve";
import type { DraftCredit } from "./drafts";

const ROLE_KIND: Readonly<Record<VideoCreditRole, ReviewKind>> = {
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

const basisOf = (field: string) => (field === "title" ? BASIS.TITLE : field === "description" ? BASIS.DESCRIPTION : BASIS.INFERRED);

export function toVideoFacts(input: { youtubeVideoId: string; youtubeTitle: string; checked: CheckedVideoCredits; resolution: Resolution }): VideoFacts {
  const { checked, resolution } = input;
  const canonicalOf = (role: VideoCreditRole, name: string) => resolution.entities.find((e) => e.role === role && nameKey(e.nameInVideo) === nameKey(name));
  const facts: ApprovedFact[] = [];
  let row = 0;
  const workCanonical = (title: string | null) => (title ? canonicalOf("WORK", title)?.canonicalName ?? title : "");
  for (const c of checked.accepted) {
    const e = canonicalOf(c.role, c.name);
    if (!e || e.status === "EXCEPTION") continue; // never create or link an unresolved name
    facts.push({
      youtubeVideoId: input.youtubeVideoId,
      kind: ROLE_KIND[c.role],
      name: e.canonicalName,
      proposedName: c.name,
      roleLabel: `${c.role} (pipeline)`,
      workTitle: workCanonical(c.workTitle),
      sourceField: c.field,
      quote: c.quote,
      basis: basisOf(c.field),
      venueTypeBasis: "",
      tier: "AMBER",
      decision: "accept",
      notes: "approved in the Studio Pipeline inbox",
      sheetRow: ++row,
    });
  }
  if (checked.venueType.status === "ACCEPTED") {
    facts.push({ youtubeVideoId: input.youtubeVideoId, kind: "venueType", name: checked.venueType.value, proposedName: checked.venueType.value, roleLabel: "", workTitle: "", sourceField: checked.venueType.field, quote: checked.venueType.quote, basis: checked.venueTypeFromName ? BASIS.INFERRED : basisOf(checked.venueType.field), venueTypeBasis: checked.venueTypeFromName ? "inferred from name (editor-accepted)" : "stated in text", tier: "AMBER", decision: "accept", notes: "", sheetRow: ++row });
  }
  if (checked.performanceDate.status === "ACCEPTED") {
    facts.push({ youtubeVideoId: input.youtubeVideoId, kind: "performanceDate", name: checked.performanceDate.value, proposedName: checked.performanceDate.value, roleLabel: "Date", workTitle: "", sourceField: checked.performanceDate.field, quote: checked.performanceDate.quote, basis: basisOf(checked.performanceDate.field), venueTypeBasis: "", tier: "AMBER", decision: "accept", notes: "", sheetRow: ++row });
  }
  const title = checked.suggestedTitle.status === "ACCEPTED" ? checked.suggestedTitle.value : "";
  const translit = checked.suggestedTitleAlternate.status === "ACCEPTED" ? checked.suggestedTitleAlternate.value : "";
  return {
    youtubeVideoId: input.youtubeVideoId,
    youtubeTitle: input.youtubeTitle,
    proposedRecordingTitle: title,
    originalLanguageTitle: title && hasNonLatinLetters(title) ? title : "",
    transliteration: translit,
    isReference: false,
    approvedRecordingTitle: title || null,
    transliterationApproved: !!translit,
    facts,
    refused: [],
    ignored: 0,
  };
}

/** The credits the drafts may cite, numbered C1, C2 … (EXCEPTION entities are left out, like everywhere else). */
export function draftCredits(checked: CheckedVideoCredits, resolution: Resolution): DraftCredit[] {
  const out: DraftCredit[] = [];
  for (const c of checked.accepted) {
    const e = resolution.entities.find((x) => x.role === c.role && nameKey(x.nameInVideo) === nameKey(c.name));
    if (!e || e.status === "EXCEPTION") continue;
    out.push({ id: `C${out.length + 1}`, role: c.role, name: e.canonicalName, workTitle: c.workTitle, quote: c.quote, subjectKey: e.key });
  }
  if (checked.performanceDate.status === "ACCEPTED" && /^\d{4}(-\d{2}){0,2}$/.test(checked.performanceDate.value)) {
    out.push({ id: `C${out.length + 1}`, role: "DATE", name: checked.performanceDate.value, workTitle: null, quote: checked.performanceDate.quote, subjectKey: null });
  }
  return out;
}
