// Phase 6K-3 — which videos the Museum features, as a pure, explainable function.
//
// Hybrid by design: editorially PINNED videos come first, in the order the editors set; any remaining slots are filled AUTOMATICALLY from the
// videos the Museum may list, ranked by evidence that actually exists in the database today — YouTube's own current view count and the
// video's publication date. No other signal is invented or implied (there is no watch-time, click or engagement data here). Every slot carries
// a plain-language reason so an editor can see exactly why it is there.
//
//   score = log(1 + views) × (1 − w + w × 0.5^(ageDays / halfLifeDays))
//
// The logarithm stops one runaway video from dominating forever; the bracket is a bounded recency decay: it is 1 for a brand-new video and
// falls toward (1 − w) as it ages, never below it, so an old classic can still outrank a new video with almost no views. `w` (recency weight)
// and `halfLifeDays` are settings, not constants. A video with no recorded view count scores 0 (and says so) rather than guessing.
// Eligibility is decided before this function runs — it only ever sees videos the shared exposure rule already allows.

export interface RankingCandidate {
  pageId: string;
  viewCount: number | null;
  publishedAt: Date | null;
}

export interface RankingParams {
  /** Days for the recency bracket to lose half of its decaying part. Must be > 0. */
  halfLifeDays: number;
  /** 0..1 — how much of the score recency may remove (0 = ignore age, 1 = a very old video can fall to 0). */
  recencyWeight: number;
  now: Date;
}

export interface ScoreBreakdown {
  score: number;
  viewTerm: number;
  recencyFactor: number;
  ageDays: number | null;
}

const DAY_MS = 86_400_000;

export function scoreCandidate(candidate: RankingCandidate, params: RankingParams): ScoreBreakdown {
  const views = candidate.viewCount !== null && candidate.viewCount > 0 ? candidate.viewCount : 0;
  const viewTerm = Math.log1p(views);
  const weight = Math.min(1, Math.max(0, params.recencyWeight));
  const halfLife = params.halfLifeDays > 0 ? params.halfLifeDays : 1;
  let ageDays: number | null = null;
  let recencyFactor: number;
  if (candidate.publishedAt === null) {
    recencyFactor = 1 - weight; // no date: treated as fully aged, never guessed to be new
  } else {
    ageDays = Math.max(0, (params.now.getTime() - candidate.publishedAt.getTime()) / DAY_MS);
    recencyFactor = 1 - weight + weight * Math.pow(0.5, ageDays / halfLife);
  }
  return { score: viewTerm * recencyFactor, viewTerm, recencyFactor, ageDays };
}

export interface FeaturedSlot {
  pageId: string;
  source: "PINNED" | "AUTOMATIC";
  /** Plain-language reason shown in Studio. */
  reason: string;
  score: number | null;
}

export interface SelectFeaturedInput {
  /** Pinned page ids in editorial order, already filtered to the ones currently eligible. */
  pinned: readonly string[];
  /** Every eligible candidate for automatic fill (pinned ones may be included; they are skipped). */
  candidates: readonly RankingCandidate[];
  count: number;
  autoFill: boolean;
  params: RankingParams;
}

function describeAutomatic(candidate: RankingCandidate, breakdown: ScoreBreakdown): string {
  const views = candidate.viewCount !== null && candidate.viewCount > 0 ? `${candidate.viewCount} views on YouTube` : "no view count recorded";
  const age = breakdown.ageDays === null ? "no publication date recorded" : `published ${Math.floor(breakdown.ageDays)} day${Math.floor(breakdown.ageDays) === 1 ? "" : "s"} ago`;
  return `Automatic: ${views}, ${age} (score ${breakdown.score.toFixed(2)}).`;
}

export function selectFeatured(input: SelectFeaturedInput): FeaturedSlot[] {
  const count = Math.max(0, Math.floor(input.count));
  const slots: FeaturedSlot[] = [];
  const taken = new Set<string>();
  for (const pageId of input.pinned) {
    if (slots.length >= count) break;
    if (taken.has(pageId)) continue;
    taken.add(pageId);
    slots.push({ pageId, source: "PINNED", reason: `Pinned by the editors (position ${slots.length + 1}).`, score: null });
  }
  if (!input.autoFill || slots.length >= count) return slots;

  const ranked = input.candidates
    .filter((c) => !taken.has(c.pageId))
    .map((candidate) => ({ candidate, breakdown: scoreCandidate(candidate, input.params) }))
    .sort((a, b) => {
      if (b.breakdown.score !== a.breakdown.score) return b.breakdown.score - a.breakdown.score;
      const ta = a.candidate.publishedAt?.getTime() ?? -Infinity;
      const tb = b.candidate.publishedAt?.getTime() ?? -Infinity;
      if (tb !== ta) return tb - ta; // newer first on a tie
      return a.candidate.pageId < b.candidate.pageId ? -1 : 1; // then a stable order
    });
  for (const { candidate, breakdown } of ranked) {
    if (slots.length >= count) break;
    slots.push({ pageId: candidate.pageId, source: "AUTOMATIC", reason: describeAutomatic(candidate, breakdown), score: breakdown.score });
  }
  return slots;
}
