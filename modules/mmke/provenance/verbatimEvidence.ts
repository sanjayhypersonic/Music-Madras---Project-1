// Verbatim evidence: the check that a quotation really occurs in the YouTube title or description it cites. PURE (no fs, no network, no database).
//
// Shared by the staging content loader (modules/seed/stagingContentSpec.ts), where a person writes the quotation, and the video-credits extraction
// (modules/ai/structuredOutput/validateVideoCreditsOutput.ts), where a model proposes it. The rule is the same for both: the quotation must occur in the
// cited field, ignoring only zero-width characters and runs of white space (YouTube descriptions carry invisible characters). Nothing else is forgiven:
// not case, not punctuation, not spelling.

export type EvidenceField = "title" | "description";

export interface Evidence {
  youtubeVideoId: string;
  field: EvidenceField;
  quote: string;
}

/** The text of one video, as the evidence check needs it. */
export interface VideoText {
  youtubeVideoId: string;
  title: string | null;
  description: string | null;
}

/** Removes zero-width characters and collapses white space, so a quotation survives the invisible characters YouTube descriptions carry. */
export const normaliseEvidenceText = (s: string): string => s.replace(/[​‌‍⁠﻿]/g, "").replace(/\s+/g, " ").trim();

/** The text of the cited field of a video ("" when it has none). */
export const fieldText = (video: VideoText, field: EvidenceField): string => (field === "title" ? video.title ?? "" : video.description ?? "");

/** True when `quote` is non-empty and occurs in `text` (both normalised). Case-sensitive. */
export function quoteOccursIn(text: string, quote: string): boolean {
  const needle = normaliseEvidenceText(quote);
  return needle.length > 0 && normaliseEvidenceText(text).includes(needle);
}

/** Every quotation must occur verbatim in the cited video's title or description. Returns the problems (empty = every quotation is traceable). */
export function verifyEvidence(items: ReadonlyArray<{ where: string; evidence: Evidence }>, videos: readonly VideoText[]): string[] {
  const problems: string[] = [];
  for (const { where, evidence } of items) {
    const video = videos.find((v) => v.youtubeVideoId === evidence.youtubeVideoId);
    if (!video) {
      problems.push(`${where}: cites video ${evidence.youtubeVideoId}, which is not in the fixtures.`);
      continue;
    }
    if (!quoteOccursIn(fieldText(video, evidence.field), evidence.quote)) {
      problems.push(`${where}: the quotation "${evidence.quote}" does not occur in the ${evidence.field} of ${evidence.youtubeVideoId}.`);
    }
  }
  return problems;
}
