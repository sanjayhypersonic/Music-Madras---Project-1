// GATE 1, SOURCES (docs/content-guardrails.md section 2). PURE and Prisma-free.
//
// Tiers:  A  authoritative for the claim: the work's publisher or a library / score catalogue (IMSLP), or the performing body's own record of its
//            own performance (the video's credits, the institution's official page);
//         B  reputable secondary: reference works and hymnal indexes (Hymnary.org), national newspapers;
//         C  weak: fan sites, blogs, social media and video pages, pages with no identifiable owner; corroboration only, never enough alone;
//         X  excluded: never counts (unverified pages, Wikipedia used as a source rather than a pointer, lyrics sites as evidence, AI output,
//            search-result snippets, our own unapproved drafts).
// Only an APPROVED source counts. Two sources are INDEPENDENT when their registrable domains differ and their excerpts are not near-copies.

import { fold, tokens } from "./text";

export type SourceTier = "A" | "B" | "C" | "X";
export const SOURCE_TIERS: readonly SourceTier[] = ["A", "B", "C", "X"];

/** The research sheet's source strengths (modules/jobs/videoResearch.ts) mapped to tiers. A pointer-only source (Wikipedia) is X. */
export function tierForStrength(strength: string, pointerOnly = false): SourceTier {
  if (pointerOnly) return "X";
  switch (strength) {
    case "catalogue/publisher":
      return "A";
    case "reference work":
    case "news":
      return "B";
    case "fan site":
      return "C";
    default:
      return "X";
  }
}

export type ClaimType = "performance" | "credit" | "title" | "publication" | "background";

/** Subject kinds that are never claims at all (excluded by gate 2). */
export const EXCLUDED_KINDS: Readonly<Record<string, string>> = {
  lyrics: "Lyrics are never a claim (copyright, and not a fact about the recording).",
  interpretation: "Theological or musical interpretation is the editor's own writing, never a researched claim.",
  reception: "Popularity, reception and superlatives ('beloved', 'most famous') are not claims we state.",
  personal: "Private facts about living people are out of scope.",
  motive: "What someone intended or felt is not stated unless they said it themselves, and then it is a quotation, not a claim.",
};

const TYPE_OF: Readonly<Record<string, ClaimType>> = {
  conductor: "performance",
  choir: "performance",
  performer: "performance",
  venue: "performance",
  performanceDate: "performance",
  institution: "performance",
  composer: "credit",
  lyricist: "credit",
  arranger: "credit",
  translator: "credit",
  "work-title": "title",
  "alternate-title": "title",
  publisher: "publication",
  publication: "publication",
  "composition-date": "publication",
  "text-source": "publication",
  background: "background",
};

export function claimTypeOf(subjectKind: string): ClaimType | "excluded" | "unknown" {
  if (EXCLUDED_KINDS[subjectKind]) return "excluded";
  return TYPE_OF[subjectKind] ?? "unknown";
}

/**
 * The minimum approved, independent evidence each claim type needs before it may be stated as fact. Below it a claim is WEAK.
 * `videoText` is true when the video's own title or description states the same value (R-34): for a credit, the video text plus one tier-B
 * source is enough, because the performers' own credit and an independent reference agree.
 */
export const MINIMUM_EVIDENCE: Readonly<Record<ClaimType, { rule: string; met: (n: { A: number; B: number; videoText: boolean }) => boolean }>> = {
  performance: { rule: "one tier-A source (the performers' own record or the institution's official page)", met: (n) => n.A >= 1 },
  credit: { rule: "one tier-A source, or two independent tier-B sources, or the video's own text plus one tier-B source", met: (n) => n.A >= 1 || n.B >= 2 || (n.videoText && n.B >= 1) },
  title: { rule: "one tier-A or tier-B source", met: (n) => n.A + n.B >= 1 },
  publication: { rule: "one tier-A source, or two independent tier-B sources", met: (n) => n.A >= 1 || n.B >= 2 },
  background: { rule: "two independent sources, at least one of them tier A", met: (n) => n.A >= 1 && n.A + n.B >= 2 },
};

export interface EvidenceSource {
  url: string;
  tier: SourceTier;
  excerpt: string;
  approved: boolean;
}

const SECOND_LEVEL = new Set(["co", "ac", "gov", "org", "com", "edu", "net", "nic", "res", "gen"]);

/** "news.bbc.co.uk" -> "bbc.co.uk", "www.thehindu.com" -> "thehindu.com". A heuristic (no public-suffix list); good enough to stop one site counting twice. */
export function registrableDomain(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const tld = parts.at(-1)!;
  const sld = parts.at(-2)!;
  return tld.length === 2 && SECOND_LEVEL.has(sld) ? parts.slice(-3).join(".") : parts.slice(-2).join(".");
}

/** Word-trigram Jaccard similarity of two texts (0..1), after folding. Shared by the near-duplicate checks. */
export function shingleSimilarity(a: string, b: string, size = 3): number {
  const grams = (t: string) => {
    const w = tokens(fold(t));
    const out = new Set<string>();
    if (w.length < size) {
      if (w.length) out.add(w.join(" "));
      return out;
    }
    for (let i = 0; i + size <= w.length; i++) out.add(w.slice(i, i + size).join(" "));
    return out;
  };
  const x = grams(a);
  const y = grams(b);
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const g of x) if (y.has(g)) shared++;
  return shared / (x.size + y.size - shared);
}

export const EXCERPT_COPY_THRESHOLD = 0.6;

/** The approved, countable sources that are independent of each other (one per registrable domain; near-copied excerpts count once). */
export function independentSources(sources: readonly EvidenceSource[]): EvidenceSource[] {
  const kept: EvidenceSource[] = [];
  const order: Record<SourceTier, number> = { A: 0, B: 1, C: 2, X: 3 };
  for (const s of [...sources].filter((x) => x.approved && x.tier !== "X").sort((a, b) => order[a.tier] - order[b.tier])) {
    if (kept.some((k) => registrableDomain(k.url) === registrableDomain(s.url) || shingleSimilarity(k.excerpt, s.excerpt) >= EXCERPT_COPY_THRESHOLD)) continue;
    kept.push(s);
  }
  return kept;
}

export interface EvidenceAssessment {
  claimType: ClaimType | "excluded" | "unknown";
  /** Meets the minimum for its type: may be stated as plain fact. */
  sufficient: boolean;
  /** Has some countable support (A, B or C) but not the minimum: may be stated only with attribution ("according to ..."). */
  weak: boolean;
  counts: { A: number; B: number; C: number };
  reason: string;
}

export function assessEvidence(subjectKind: string, sources: readonly EvidenceSource[], options: { videoTextSupports?: boolean } = {}): EvidenceAssessment {
  const claimType = claimTypeOf(subjectKind);
  const independent = independentSources(sources);
  const counts = { A: independent.filter((s) => s.tier === "A").length, B: independent.filter((s) => s.tier === "B").length, C: independent.filter((s) => s.tier === "C").length };
  if (claimType === "excluded") return { claimType, sufficient: false, weak: false, counts, reason: EXCLUDED_KINDS[subjectKind] };
  if (claimType === "unknown") return { claimType, sufficient: false, weak: false, counts, reason: `unknown subject kind "${subjectKind}"` };
  const min = MINIMUM_EVIDENCE[claimType];
  if (min.met({ ...counts, videoText: options.videoTextSupports === true })) return { claimType, sufficient: true, weak: false, counts, reason: `meets the minimum: ${min.rule}` };
  const any = counts.A + counts.B + counts.C > 0;
  return { claimType, sufficient: false, weak: any, counts, reason: any ? `WEAK: needs ${min.rule}; has A ${counts.A}, B ${counts.B}, C ${counts.C}` : "no approved, countable source" };
}
