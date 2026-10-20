// Phase 6J-12B — the PURE planner for re-projecting revision-scoped relationships back into the legacy Recording-level tables
// (entity_sources / entity_rights / entity_occasions, entityType "RECORDING"). This is the ROLLBACK direction of the 6J-11C backfill:
// it exists so a future cutover can be reversed. Preparing it is NOT approving a cutover.
//
// It is deliberately NOT the inverse of the insert-only backfill. The backfill adds rows; reversing a cutover must also REMOVE the
// legacy links an editor deliberately removed since, and the legacy tables cannot say why a row is there (no timestamps, no origin).
// So the contract below only removes a legacy link when the audit trail PROVES it was removed, and otherwise reports a conflict and
// keeps the row. Nothing is guessed.
//
// PROJECTION CONTRACT
//  1. Authoritative revision (per Recording; Recording.status is NOT consulted, so unpublished/archived Recordings are projected too):
//       - the current PUBLISHED revision, if the Recording has a published pointer. Legacy rows are what visitors see once the
//         readers are rolled back, so the published set is what they must hold; a draft's unpublished edits must not become public.
//       - otherwise the current DRAFT revision (a Recording that was never published has only its draft; nothing public is affected).
//       - SUPERSEDED revisions are never authoritative.
//     A pointer is safe only if its revision exists, belongs to the Recording and has the expected status. An unsafe authoritative
//     pointer is a BLOCKING conflict and the Recording is skipped (no fall-back to the draft: that would publish unpublished edits).
//     No pointer at all: skipped and counted (legacy rows untouched).
//  2. For each kind, with D = the authoritative revision's links and L = the Recording's legacy links:
//       - D \ L          -> INSERT (unapproved Sources and archived Occasions are inserted as they are; approval/archival are read-time filters)
//       - D n L          -> retained, untouched (duplicate legacy rows are left as they are and counted)
//       - L \ D with PROOF  -> REMOVE (every legacy row of that link). Proof = an audit "detached" entry for that link on a revision of the
//                              same Recording that was PUBLISHED (published or since superseded) or on the authoritative revision itself.
//                              A published detachment is canonical (6J-12A). A detach that stayed in an unpublished draft is not proof.
//       - L \ D without proof -> CONFLICT (LEGACY_LINK_NOT_IN_REVISION_SET): the row is KEPT and the run is BLOCKED. It may be a link the
//                              backfill never projected or one added by a legacy writer; the tables cannot tell. A person decides.
//  3. Legacy rows whose entityId matches no Recording (orphans) are never touched. Unknown revision status is never proof.
//  4. Unpublished draft edits cannot be represented in the legacy tables (they have no draft concept): where the draft's set differs from
//     the published one the Recording is reported (UNPUBLISHED_DRAFT_DIFFERENCE) — information only, those edits are not carried back.
//  5. The plan is deterministic (sorted) and has a fingerprint; execution must present the fingerprint of the plan that was reviewed.

import { createHash } from "crypto";
import { RELATIONSHIP_KINDS, type RelationshipKind } from "../revisionRelationships/backfillPlan";

export { RELATIONSHIP_KINDS };
export type { RelationshipKind };

export interface ReprojectionRecording {
  id: string;
  status: string;
  currentPublishedRevisionId: string | null;
  currentDraftRevisionId: string | null;
}
export interface ReprojectionRevision {
  id: string;
  recordingId: string;
  revisionStatus: string;
}
export interface RevisionLink {
  revisionId: string;
  targetId: string;
}
export interface LegacyRow {
  rowId: string;
  recordingId: string;
  targetId: string;
}
/** An audit "detached" entry; recordingId / revisionStatus come from the revision it was detached from (null if that revision is gone). */
export interface DetachProof {
  revisionId: string;
  targetId: string;
  recordingId: string | null;
  revisionStatus: string | null;
}

export interface ReprojectionInput {
  recordings: readonly ReprojectionRecording[];
  /** At least the revisions the Recordings point at. */
  revisions: readonly ReprojectionRevision[];
  /** Revision-scoped rows of (at least) the pointed-at revisions. */
  revisionLinks: Readonly<Record<RelationshipKind, readonly RevisionLink[]>>;
  legacy: Readonly<Record<RelationshipKind, readonly LegacyRow[]>>;
  detached: Readonly<Record<RelationshipKind, readonly DetachProof[]>>;
  unapprovedSourceIds: readonly string[];
  archivedOccasionIds: readonly string[];
}

export interface PlannedLegacyInsert {
  kind: RelationshipKind;
  recordingId: string;
  targetId: string;
}
export interface PlannedLegacyRemoval {
  kind: RelationshipKind;
  rowId: string;
  recordingId: string;
  targetId: string;
}

export type ReprojectionAnomalyCode =
  | "ORPHANED_LEGACY_LINK" // information: untouched
  | "DUPLICATE_LEGACY_LINK" // information: untouched
  | "NO_REVISION_POINTER" // information: Recording skipped, legacy rows untouched
  | "DRAFT_POINTER_UNSAFE" // information: the draft pointer is bad but the published revision is authoritative
  | "UNPUBLISHED_DRAFT_DIFFERENCE" // information: draft edits that legacy cannot hold
  | "AUTHORITATIVE_POINTER_MISSING" // BLOCKING
  | "AUTHORITATIVE_POINTER_OTHER_RECORDING" // BLOCKING
  | "AUTHORITATIVE_POINTER_STATUS_MISMATCH" // BLOCKING
  | "LEGACY_LINK_NOT_IN_REVISION_SET"; // BLOCKING

/** Conflicts that stop `--execute` (the dry run still reports them). There is no override. */
export const BLOCKING_ANOMALIES: readonly ReprojectionAnomalyCode[] = [
  "AUTHORITATIVE_POINTER_MISSING",
  "AUTHORITATIVE_POINTER_OTHER_RECORDING",
  "AUTHORITATIVE_POINTER_STATUS_MISMATCH",
  "LEGACY_LINK_NOT_IN_REVISION_SET",
];

export const SAMPLE_LIMIT = 10;

export interface AnomalySummary {
  code: ReprojectionAnomalyCode;
  count: number;
  samples: string[];
}

export interface ReprojectionKindReport {
  legacyRows: number;
  orphanedLegacyRows: number;
  duplicateLegacyRows: number;
  /** Distinct (Recording, target) links on existing Recordings. */
  distinctLinks: number;
  /** Links of Recordings with no safe authoritative revision: untouched. */
  skippedNoAuthority: number;
  /** distinctLinks - skippedNoAuthority = retained + removed + conflicts. */
  retained: number;
  removedLinks: number;
  /** Legacy ROWS deleted (a removed link may have duplicate rows). */
  removedRows: number;
  /** Links in neither set explained: kept, and blocking. */
  conflicts: number;
  /** Authoritative links (over Recordings that have an authority) = retained + inserted. */
  authoritativeLinks: number;
  inserted: number;
  preservedUnapprovedSources: number;
  preservedArchivedOccasions: number;
}

export interface ReprojectionReport {
  recordings: { total: number; withAuthority: number; authorityPublished: number; authorityDraft: number; withoutAuthority: number };
  kinds: Record<RelationshipKind, ReprojectionKindReport>;
  anomalies: AnomalySummary[];
  totals: { inserts: number; removalRows: number; conflicts: number };
}

export interface ReprojectionPlan {
  inserts: PlannedLegacyInsert[];
  removals: PlannedLegacyRemoval[];
  report: ReprojectionReport;
  /** SHA-256 over the sorted inserts, removals and blocking-anomaly counts: identifies exactly what a run would do. */
  fingerprint: string;
  /** Blocking anomalies present (empty means a run is allowed). */
  blocking: AnomalySummary[];
}

class Anomalies {
  private readonly byCode = new Map<ReprojectionAnomalyCode, AnomalySummary>();
  add(code: ReprojectionAnomalyCode, sample: string): void {
    const entry = this.byCode.get(code) ?? { code, count: 0, samples: [] };
    entry.count += 1;
    if (entry.samples.length < SAMPLE_LIMIT) entry.samples.push(sample);
    this.byCode.set(code, entry);
  }
  list(): AnomalySummary[] {
    return [...this.byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
  }
}

const PUBLISHED_HISTORY = new Set(["PUBLISHED", "SUPERSEDED"]);
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

interface Authority {
  revisionId: string;
  source: "published" | "draft";
}

function resolveAuthority(recording: ReprojectionRecording, revisions: ReadonlyMap<string, ReprojectionRevision>, anomalies: Anomalies): Authority | null {
  const check = (revisionId: string, expected: "PUBLISHED" | "DRAFT"): "ok" | "missing" | "other" | "status" => {
    const revision = revisions.get(revisionId);
    if (!revision) return "missing";
    if (revision.recordingId !== recording.id) return "other";
    if (revision.revisionStatus !== expected) return "status";
    return "ok";
  };
  const refuse = (verdict: "missing" | "other" | "status", revisionId: string) => {
    const code = verdict === "missing" ? "AUTHORITATIVE_POINTER_MISSING" : verdict === "other" ? "AUTHORITATIVE_POINTER_OTHER_RECORDING" : "AUTHORITATIVE_POINTER_STATUS_MISMATCH";
    anomalies.add(code, `${recording.id}:${revisionId}`);
  };

  if (recording.currentPublishedRevisionId) {
    const verdict = check(recording.currentPublishedRevisionId, "PUBLISHED");
    if (verdict !== "ok") {
      refuse(verdict, recording.currentPublishedRevisionId);
      return null; // never fall back to the draft: its unpublished edits would become public
    }
    if (recording.currentDraftRevisionId && check(recording.currentDraftRevisionId, "DRAFT") !== "ok") {
      anomalies.add("DRAFT_POINTER_UNSAFE", `${recording.id}:${recording.currentDraftRevisionId}`);
    }
    return { revisionId: recording.currentPublishedRevisionId, source: "published" };
  }
  if (recording.currentDraftRevisionId) {
    const verdict = check(recording.currentDraftRevisionId, "DRAFT");
    if (verdict !== "ok") {
      refuse(verdict, recording.currentDraftRevisionId);
      return null;
    }
    return { revisionId: recording.currentDraftRevisionId, source: "draft" };
  }
  anomalies.add("NO_REVISION_POINTER", recording.id);
  return null;
}

export function planLegacyReprojection(input: ReprojectionInput): ReprojectionPlan {
  const anomalies = new Anomalies();
  const recordings = [...input.recordings].sort((a, b) => cmp(a.id, b.id));
  const recordingIds = new Set(recordings.map((r) => r.id));
  const revisions = new Map(input.revisions.map((r) => [r.id, r]));

  const authority = new Map<string, Authority>();
  let authorityPublished = 0;
  let authorityDraft = 0;
  for (const recording of recordings) {
    const found = resolveAuthority(recording, revisions, anomalies);
    if (!found) continue;
    authority.set(recording.id, found);
    if (found.source === "published") authorityPublished += 1;
    else authorityDraft += 1;
  }

  const inserts: PlannedLegacyInsert[] = [];
  const removals: PlannedLegacyRemoval[] = [];
  const kinds = {} as Record<RelationshipKind, ReprojectionKindReport>;
  const unapproved = new Set(input.unapprovedSourceIds);
  const archivedOccasions = new Set(input.archivedOccasionIds);
  const draftDifferences = new Set<string>();

  for (const kind of RELATIONSHIP_KINDS) {
    const setsByRevision = new Map<string, Set<string>>();
    for (const link of input.revisionLinks[kind]) {
      const set = setsByRevision.get(link.revisionId);
      if (set) set.add(link.targetId);
      else setsByRevision.set(link.revisionId, new Set([link.targetId]));
    }

    const report: ReprojectionKindReport = {
      legacyRows: input.legacy[kind].length,
      orphanedLegacyRows: 0,
      duplicateLegacyRows: 0,
      distinctLinks: 0,
      skippedNoAuthority: 0,
      retained: 0,
      removedLinks: 0,
      removedRows: 0,
      conflicts: 0,
      authoritativeLinks: 0,
      inserted: 0,
      preservedUnapprovedSources: 0,
      preservedArchivedOccasions: 0,
    };

    // legacy rows grouped by Recording then target
    const byRecording = new Map<string, Map<string, LegacyRow[]>>();
    for (const row of [...input.legacy[kind]].sort((a, b) => cmp(a.rowId, b.rowId))) {
      if (!recordingIds.has(row.recordingId)) {
        report.orphanedLegacyRows += 1;
        anomalies.add("ORPHANED_LEGACY_LINK", `${kind}:${row.rowId}`);
        continue;
      }
      let targets = byRecording.get(row.recordingId);
      if (!targets) byRecording.set(row.recordingId, (targets = new Map()));
      const rows = targets.get(row.targetId);
      if (rows) {
        rows.push(row);
        report.duplicateLegacyRows += 1;
        anomalies.add("DUPLICATE_LEGACY_LINK", `${kind}:${row.rowId}`);
      } else {
        targets.set(row.targetId, [row]);
        report.distinctLinks += 1;
      }
    }

    // proof of removal: audit "detached" entries on published history (or on the authoritative revision itself), per Recording
    const proof = new Map<string, Set<string>>();
    for (const evidence of input.detached[kind]) {
      if (!evidence.recordingId) continue;
      const auth = authority.get(evidence.recordingId);
      const known = evidence.revisionStatus !== null; // an unknown status is never proof
      const canonical = known && (PUBLISHED_HISTORY.has(evidence.revisionStatus as string) || (auth !== undefined && auth.revisionId === evidence.revisionId));
      if (!canonical) continue;
      const set = proof.get(evidence.recordingId);
      if (set) set.add(evidence.targetId);
      else proof.set(evidence.recordingId, new Set([evidence.targetId]));
    }

    for (const recording of recordings) {
      const legacyTargets = byRecording.get(recording.id) ?? new Map<string, LegacyRow[]>();
      const auth = authority.get(recording.id);
      if (!auth) {
        report.skippedNoAuthority += legacyTargets.size;
        continue;
      }
      const wanted = setsByRevision.get(auth.revisionId) ?? new Set<string>();
      report.authoritativeLinks += wanted.size;
      for (const target of wanted) {
        if (kind === "source" && unapproved.has(target)) report.preservedUnapprovedSources += 1;
        if (kind === "occasion" && archivedOccasions.has(target)) report.preservedArchivedOccasions += 1;
      }

      for (const target of [...wanted].sort(cmp)) {
        if (legacyTargets.has(target)) {
          report.retained += 1;
        } else {
          report.inserted += 1;
          inserts.push({ kind, recordingId: recording.id, targetId: target });
        }
      }
      const canonicalRemovals = proof.get(recording.id) ?? new Set<string>();
      for (const target of [...legacyTargets.keys()].sort(cmp)) {
        if (wanted.has(target)) continue;
        const rows = legacyTargets.get(target) as LegacyRow[];
        if (canonicalRemovals.has(target)) {
          report.removedLinks += 1;
          for (const row of rows) {
            report.removedRows += 1;
            removals.push({ kind, rowId: row.rowId, recordingId: recording.id, targetId: target });
          }
        } else {
          report.conflicts += 1;
          anomalies.add("LEGACY_LINK_NOT_IN_REVISION_SET", `${kind}:${recording.id}:${target}`);
        }
      }

      // information: unpublished draft edits that the legacy tables cannot hold
      if (auth.source === "published" && recording.currentDraftRevisionId) {
        const draftRevision = revisions.get(recording.currentDraftRevisionId);
        if (draftRevision && draftRevision.recordingId === recording.id && draftRevision.revisionStatus === "DRAFT") {
          const draftSet = setsByRevision.get(draftRevision.id) ?? new Set<string>();
          const same = draftSet.size === wanted.size && [...draftSet].every((t) => wanted.has(t));
          if (!same && !draftDifferences.has(recording.id)) {
            draftDifferences.add(recording.id);
            anomalies.add("UNPUBLISHED_DRAFT_DIFFERENCE", recording.id);
          }
        }
      }
    }
    kinds[kind] = report;
  }

  inserts.sort((a, b) => cmp(a.kind, b.kind) || cmp(a.recordingId, b.recordingId) || cmp(a.targetId, b.targetId));
  removals.sort((a, b) => cmp(a.kind, b.kind) || cmp(a.rowId, b.rowId));

  const anomalyList = anomalies.list();
  const blocking = anomalyList.filter((a) => BLOCKING_ANOMALIES.includes(a.code));
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ inserts, removals, blocking: blocking.map((a) => [a.code, a.count]) }))
    .digest("hex");

  return {
    inserts,
    removals,
    blocking,
    fingerprint,
    report: {
      recordings: {
        total: recordings.length,
        withAuthority: authority.size,
        authorityPublished,
        authorityDraft,
        withoutAuthority: recordings.length - authority.size,
      },
      kinds,
      anomalies: anomalyList,
      totals: {
        inserts: inserts.length,
        removalRows: removals.length,
        conflicts: RELATIONSHIP_KINDS.reduce((sum, kind) => sum + kinds[kind].conflicts, 0),
      },
    },
  };
}

/** Human-readable report: counts and opaque ids only, never a connection string or credential. */
export function formatReprojectionReport(plan: ReprojectionPlan, mode: "DRY RUN" | "EXECUTE"): string {
  const r = plan.report;
  const lines: string[] = [];
  lines.push(`Revision-to-legacy re-projection - ${mode}${mode === "DRY RUN" ? " (no writes)" : ""}`);
  lines.push("");
  lines.push("Recordings");
  lines.push(`  total ${r.recordings.total}; with an authoritative revision ${r.recordings.withAuthority} (published ${r.recordings.authorityPublished}, draft-only ${r.recordings.authorityDraft}); without ${r.recordings.withoutAuthority}`);
  for (const kind of RELATIONSHIP_KINDS) {
    const k = r.kinds[kind];
    lines.push("");
    lines.push(`${kind.toUpperCase()} links`);
    lines.push(`  legacy rows ${k.legacyRows} = orphaned ${k.orphanedLegacyRows} + duplicates ${k.duplicateLegacyRows} + distinct links ${k.distinctLinks}`);
    lines.push(`  distinct links ${k.distinctLinks} = skipped (no authoritative revision) ${k.skippedNoAuthority} + retained ${k.retained} + removed ${k.removedLinks} + conflicts ${k.conflicts}`);
    lines.push(`  authoritative links ${k.authoritativeLinks} = retained ${k.retained} + inserts ${k.inserted}`);
    lines.push(`  legacy rows to delete ${k.removedRows} (published detachments proven by the audit trail)`);
    if (kind === "source") lines.push(`  in the authoritative sets: sources not APPROVED ${k.preservedUnapprovedSources} (inserted/kept as they are; approval is a read-time filter)`);
    if (kind === "occasion") lines.push(`  in the authoritative sets: archived occasions ${k.preservedArchivedOccasions} (inserted/kept as they are; archival is a read-time filter)`);
  }
  lines.push("");
  if (r.anomalies.length === 0) lines.push("Anomalies: none");
  else {
    lines.push("Anomalies (nothing is discarded silently; a conflict keeps its legacy row)");
    for (const a of r.anomalies) {
      const blocks = BLOCKING_ANOMALIES.includes(a.code) ? "  [BLOCKS --execute until a person has decided]" : "";
      lines.push(`  ${a.code}: ${a.count}${a.samples.length > 0 ? `  e.g. ${a.samples.join(", ")}` : ""}${blocks}`);
    }
  }
  lines.push("");
  lines.push(`Totals: legacy inserts ${r.totals.inserts}, legacy row deletions ${r.totals.removalRows}, conflicts ${r.totals.conflicts}`);
  lines.push(`Plan fingerprint: ${plan.fingerprint}`);
  return lines.join("\n");
}
