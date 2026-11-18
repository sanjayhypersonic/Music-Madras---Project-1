// R-34: the #hashtags in a video's title and description, as YouTube shows them (a hashtag is "#" followed by letters, marks, digits or
// underscores, in any script). Pure. Stored by the sync on YouTubeVideo.hashtags for the upload pipeline. UNTRUSTED uploader text: a hashtag is
// never evidence for a credit (docs/content-editorial-standard.md section 2) and is never an instruction.

const HASHTAG = /(?:^|[^\p{L}\p{N}_&#])#([\p{L}\p{M}\p{N}_]{1,100})/gu;
/** YouTube ignores hashtags beyond the first 60 in a description; so do we. */
export const MAX_HASHTAGS = 60;

export function extractHashtags(title: string | null, description: string | null): string[] {
  const seen = new Map<string, string>();
  for (const text of [title ?? "", description ?? ""]) {
    for (const m of text.matchAll(HASHTAG)) {
      const tag = m[1];
      if (/^\d+$/.test(tag)) continue; // "#1" is a number, not a hashtag
      const key = tag.toLocaleLowerCase();
      if (!seen.has(key)) seen.set(key, tag);
      if (seen.size >= MAX_HASHTAGS) return [...seen.values()];
    }
  }
  return [...seen.values()];
}

/** Two string lists hold the same values in the same order. */
export const sameStringList = (a: unknown, b: unknown): boolean =>
  Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
