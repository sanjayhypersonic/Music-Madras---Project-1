// GATE 2, CLAIMS (docs/content-guardrails.md section 3). PURE and Prisma-free.
//
// A claim is one statement about one subject of one video, with its sources. Its lifecycle status is:
//   proposed  (no decision) -> accepted (with an approver) | rejected | deferred
//   conflict  another live claim about the same subject gives a different value; NEVER resolved by code: it blocks both until an editor has
//             rejected all but one value
//   stale     a source changed, or the claim is older than STALE_AFTER_DAYS; it must be re-researched and re-approved before use.
// A claim is USABLE only when accepted by a named approver, not stale, not in an unresolved conflict and not excluded. A usable claim whose evidence is
// below its type's minimum (sources.ts) is WEAK: it may only be stated with attribution ("According to ..."), never as plain fact.

import { normaliseEvidenceText } from "../provenance/verbatimEvidence";
import { containsSentenceBoundary, fold } from "./text";
import { assessEvidence, claimTypeOf, type EvidenceAssessment, type EvidenceSource } from "./sources";
import { findBannedPhrases } from "./generation";

export type ClaimStatus = "proposed" | "accepted" | "rejected" | "deferred" | "conflict" | "stale";
export const CLAIM_STATUSES: readonly ClaimStatus[] = ["proposed", "accepted", "rejected", "deferred", "conflict", "stale"];
export const STALE_AFTER_DAYS = 365;
export const STATEMENT_MAX_CHARS = 300;

export interface GuardedClaim {
  claimId: string;
  youtubeVideoId: string;
  subjectKind: string;
  /** The work the claim is about, when it is about one. */
  workTitle: string | null;
  /** The name, title or date the claim states, when it states one. */
  value: string | null;
  /** The one sentence that may be written, saying only what the sources say. */
  statement: string;
  sources: EvidenceSource[];
  status: ClaimStatus;
  approver: string | null;
  approvedAt: string | null;
  /** When the sources were read (ISO date). */
  retrievedAt: string | null;
}

/** Schema and scope problems of one claim (empty = well-formed). */
export function claimProblems(c: GuardedClaim): string[] {
  const p: string[] = [];
  if (!/^[A-Za-z][\w-]{2,40}$/.test(c.claimId)) p.push("claimId is missing or malformed");
  if (!/^[A-Za-z0-9_-]{11}$/.test(c.youtubeVideoId)) p.push("youtubeVideoId is not a YouTube id");
  if (!(["proposed", "accepted", "rejected", "deferred", "conflict", "stale"] as string[]).includes(c.status)) p.push(`unknown status "${c.status}"`);
  const type = claimTypeOf(c.subjectKind);
  if (type === "excluded") p.push(`excluded subject: ${assessEvidence(c.subjectKind, []).reason}`);
  if (type === "unknown") p.push(`unknown subject kind "${c.subjectKind}"`);
  const statement = normaliseEvidenceText(c.statement);
  if (!statement) p.push("no statement");
  if (statement.length > STATEMENT_MAX_CHARS) p.push(`statement longer than ${STATEMENT_MAX_CHARS} characters`);
  if (containsSentenceBoundary(statement)) p.push("statement is more than one sentence (one claim, one sentence)");
  const banned = findBannedPhrases(statement);
  if (banned.length) p.push(`statement uses banned wording: ${banned.join(", ")}`);
  if (c.value && !fold(statement).includes(fold(c.value))) p.push(`statement does not contain its value "${c.value}"`);
  if (c.value && !c.sources.some((s) => fold(s.excerpt).includes(fold(c.value!)))) p.push(`no source excerpt contains the value "${c.value}"`);
  if (c.sources.length === 0) p.push("no source");
  if (c.status === "accepted" && (!c.approver || !c.approvedAt)) p.push("accepted without a named approver and date");
  return p;
}

const subjectKey = (c: GuardedClaim) => `${c.youtubeVideoId}\u0000${c.subjectKind}\u0000${fold(c.workTitle ?? "")}`;
const LIVE: readonly ClaimStatus[] = ["proposed", "accepted", "deferred", "conflict"];

export interface ClaimConflict {
  key: string;
  subjectKind: string;
  workTitle: string | null;
  values: string[];
  claimIds: string[];
}

/** Groups of live claims about the same subject that give different values. Reported, never resolved. */
export function detectConflicts(claims: readonly GuardedClaim[]): ClaimConflict[] {
  const groups = new Map<string, GuardedClaim[]>();
  for (const c of claims) if (c.value && LIVE.includes(c.status)) groups.set(subjectKey(c), [...(groups.get(subjectKey(c)) ?? []), c]);
  const out: ClaimConflict[] = [];
  for (const [key, group] of groups) {
    const values = [...new Map(group.map((c) => [fold(c.value!), c.value!])).values()];
    if (values.length > 1) out.push({ key, subjectKind: group[0].subjectKind, workTitle: group[0].workTitle, values, claimIds: group.map((c) => c.claimId) });
  }
  return out;
}

/** Marks claims stale (never deletes, never un-approves silently): a changed source URL, or older than maxAgeDays. Returns new objects. */
export function markStaleClaims(claims: readonly GuardedClaim[], options: { now: Date; maxAgeDays?: number; changedUrls?: readonly string[] }): Array<GuardedClaim & { staleReason?: string }> {
  const maxAge = (options.maxAgeDays ?? STALE_AFTER_DAYS) * 86_400_000;
  const changed = new Set(options.changedUrls ?? []);
  return claims.map((c) => {
    if (c.status === "rejected") return c;
    const changedSource = c.sources.find((s) => changed.has(s.url));
    if (changedSource) return { ...c, status: "stale" as const, staleReason: `source changed: ${changedSource.url}` };
    if (c.retrievedAt && options.now.getTime() - new Date(c.retrievedAt).getTime() > maxAge) return { ...c, status: "stale" as const, staleReason: `retrieved ${c.retrievedAt.slice(0, 10)}, older than ${options.maxAgeDays ?? STALE_AFTER_DAYS} days` };
    return c;
  });
}

export interface ClaimUsability {
  claim: GuardedClaim;
  usable: boolean;
  /** Usable only with attribution. */
  weak: boolean;
  evidence: EvidenceAssessment;
  reasons: string[];
}

/** Applies gates 1 and 2 to every claim: what may be stated as fact, what only with attribution, and what not at all (with the reasons). */
export function assessClaims(claims: readonly GuardedClaim[], options: { now: Date; maxAgeDays?: number; changedUrls?: readonly string[] }): ClaimUsability[] {
  const marked = markStaleClaims(claims, options);
  const conflicts = detectConflicts(marked);
  return marked.map((c) => {
    const reasons: string[] = [];
    const evidence = assessEvidence(c.subjectKind, c.sources);
    reasons.push(...claimProblems(c));
    if (c.status === "stale") reasons.push(`stale: ${(c as { staleReason?: string }).staleReason ?? "re-research and re-approve"}`);
    else if (c.status !== "accepted") reasons.push(`status is ${c.status}, not accepted`);
    // A conflict blocks every claim in it until an editor has REJECTED the other values: code never picks a side.
    for (const k of conflicts.filter((x) => x.claimIds.includes(c.claimId))) reasons.push(`unresolved conflict on ${k.subjectKind}${k.workTitle ? ` of "${k.workTitle}"` : ""}: ${k.values.join(" / ")}`);
    if (!evidence.sufficient && !evidence.weak) reasons.push(evidence.reason);
    const usable = reasons.length === 0;
    return { claim: c, usable, weak: usable && evidence.weak, evidence, reasons };
  });
}
