// Phase 6J-11C — the PURE planner for the revision-scoped relationship backfill. No database, no framework: it takes
// what the database holds (read by backfillDatabase.ts) and returns what to insert plus a report that accounts for every
// legacy row. Being pure, every counting rule below is unit-tested with synthetic data.
//
// What is being projected: the legacy Recording-level rows (entity_sources / entity_rights / entity_occasions with
// entityType "RECORDING") into the revision-scoped tables added in 6J-11B (recording_revision_sources / _rights /
// _occasions), onto each Recording's CURRENT PUBLISHED revision and its CURRENT DRAFT revision — and nowhere else:
// superseded revisions get nothing, and nothing is inferred (no titles, descriptions, AI or entity matching).
//
// The projection is insert-only and idempotent: rows that already exist are counted and left alone; nothing legacy is
// deleted or rewritten; revision-scoped rows that have no legacy counterpart (an editor's own post-11B edits) are
// reported and never touched. Source approval and Occasion archival are READ-TIME concerns, so unapproved Sources and
// archived Occasions are projected as they are (and counted, so the report shows what was preserved).

export type RelationshipKind = "source" | "rights" | "occasion";
export const RELATIONSHIP_KINDS: readonly RelationshipKind[] = ["source", "rights", "occasion"];

export interface BackfillRecording {
  id: string;
  status: string;
  currentPublishedRevisionId: string | null;
  currentDraftRevisionId: string | null;
}

/** Only the revisions the Recordings point at are needed. */
export interface BackfillRevision {
  id: string;
  recordingId: string;
  revisionStatus: string;
  /** Position in the Recording's revision history; used only to tell whether detach evidence is OLDER than a target. */
  revisionNumber?: number;
}

/** One legacy row. `recordingId` is the row's entityId (a Recording id when entityType is RECORDING). */
export interface LegacyLinkRow {
  rowId: string;
  recordingId: string;
  targetId: string;
}

export interface RevisionLinkRow {
  revisionId: string;
  targetId: string;
}

/** An editor's detach, read from the audit trail. recordingId / revisionNumber come from the revision it was detached from (null if that revision no longer exists). */
export interface DetachEvidenceRow extends RevisionLinkRow {
  recordingId?: string | null;
  revisionNumber?: number | null;
}

export interface BackfillInput {
  recordings: readonly BackfillRecording[];
  revisions: readonly BackfillRevision[];
  legacy: Readonly<Record<RelationshipKind, readonly LegacyLinkRow[]>>;
  /** Every row currently in the three revision-scoped tables. */
  existing: Readonly<Record<RelationshipKind, readonly RevisionLinkRow[]>>;
  /** Links an editor DETACHED from a revision (from the audit trail): never re-added to that revision. */
  detached: Readonly<Record<RelationshipKind, readonly DetachEvidenceRow[]>>;
  /** Informational only: Sources whose approval state is not APPROVED, and archived Occasions. */
  unapprovedSourceIds: readonly string[];
  archivedOccasionIds: readonly string[];
}

export interface PlannedInsert {
  kind: RelationshipKind;
  revisionId: string;
  targetId: string;
}

export type AnomalyCode =
  | "ORPHANED_LEGACY_LINK"
  | "DUPLICATE_LEGACY_LINK"
  | "NO_REVISION_POINTER"
  | "POINTER_REVISION_MISSING"
  | "POINTER_REVISION_OTHER_RECORDING"
  | "POINTER_STATUS_MISMATCH"
  | "DETACH_EVIDENCE_ON_OLDER_REVISION";

/**
 * Anomalies that make `--execute` REFUSE (the dry run still reports them). DETACH_EVIDENCE_ON_OLDER_REVISION: a link is planned
 * for a revision, but an editor detached the same link from an OLDER revision of the same Recording. Whether that detach carried
 * forward (the fork inherited its absence) or was superseded by a later legacy re-add cannot be established -- the legacy rows
 * carry no timestamps and revisions record no parent -- so the script neither re-adds nor drops it on its own: a person decides.
 */
export const EXECUTE_BLOCKING_ANOMALIES: readonly AnomalyCode[] = ["DETACH_EVIDENCE_ON_OLDER_REVISION"];

export interface AnomalySummary {
  code: AnomalyCode;
  count: number;
  /** At most SAMPLE_LIMIT identifiers (row ids or recording ids), enough to investigate; the count is exact. */
  samples: string[];
}
export const SAMPLE_LIMIT = 10;

export interface KindReport {
  /** Every legacy row of this kind with entityType RECORDING. */
  legacyRows: number;
  /** Rows whose entityId matches no Recording. Counted here ONLY (not as duplicates, never projected). */
  orphanedLegacyRows: number;
  /** Rows beyond the first for the same (Recording, target) among rows on existing Recordings. */
  duplicateLegacyRows: number;
  /** Distinct (Recording, target) links on existing Recordings. */
  distinctLinks: number;
  /** Distinct links of Recordings that have no safe target revision (no pointer, or only unsafe pointers). Not projected. */
  skippedNoSafeRevision: number;
  /** distinctLinks - skippedNoSafeRevision. */
  eligibleLinks: number;
  /** Counted per (eligible link, safe target revision): the three below sum to eligibleLinks x target revisions. */
  plannedInserts: number;
  alreadyPresent: number;
  /** Not re-added because an editor detached this link from this revision (audit trail). */
  skippedEditorDetached: number;
  /** Revision-scoped rows on safe target revisions with no legacy counterpart: reported, left untouched. */
  revisionRowsWithoutLegacy: number;
  /** Informational: eligible links to unapproved Sources / archived Occasions (projected as they are). */
  preservedUnapprovedSources: number;
  preservedArchivedOccasions: number;
}

export interface RecordingsReport {
  total: number;
  archived: number;
  withPublishedPointer: number;
  withDraftPointer: number;
  /** Recordings with at least one safe target revision. */
  withSafeTarget: number;
  /** Recordings with no safe target revision (their legacy links are skipped, not lost). */
  withoutSafeTarget: number;
  /** Safe target revisions in total (published + draft). */
  safeTargetRevisions: number;
}

export interface BackfillReport {
  recordings: RecordingsReport;
  kinds: Record<RelationshipKind, KindReport>;
  anomalies: AnomalySummary[];
  totals: { plannedInserts: number; alreadyPresent: number; skippedEditorDetached: number };
}

export interface BackfillPlan {
  inserts: PlannedInsert[];
  report: BackfillReport;
}

const pairKey = (recordingId: string, targetId: string) => `${recordingId}\u0000${targetId}`;

class AnomalyCollector {
  private readonly byCode = new Map<AnomalyCode, AnomalySummary>();
  add(code: AnomalyCode, sample: string): void {
    const entry = this.byCode.get(code) ?? { code, count: 0, samples: [] };
    entry.count += 1;
    if (entry.samples.length < SAMPLE_LIMIT) entry.samples.push(sample);
    this.byCode.set(code, entry);
  }
  list(): AnomalySummary[] {
    return [...this.byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
  }
}

/** The revisions of a Recording that may safely receive projected links, with the reasons any pointer was refused. */
function safeTargets(recording: BackfillRecording, revisions: ReadonlyMap<string, BackfillRevision>, anomalies: AnomalyCollector): string[] {
  const targets: string[] = [];
  const check = (revisionId: string | null, expectedStatus: "PUBLISHED" | "DRAFT") => {
    if (!revisionId) return;
    const revision = revisions.get(revisionId);
    if (!revision) return anomalies.add("POINTER_REVISION_MISSING", `${recording.id}:${revisionId}`);
    if (revision.recordingId !== recording.id) return anomalies.add("POINTER_REVISION_OTHER_RECORDING", `${recording.id}:${revisionId}`);
    if (revision.revisionStatus !== expectedStatus) return anomalies.add("POINTER_STATUS_MISMATCH", `${recording.id}:${revisionId}:${revision.revisionStatus}`);
    if (!targets.includes(revisionId)) targets.push(revisionId);
  };
  check(recording.currentPublishedRevisionId, "PUBLISHED");
  check(recording.currentDraftRevisionId, "DRAFT");
  return targets;
}

export function planRevisionRelationshipBackfill(input: BackfillInput): BackfillPlan {
  const anomalies = new AnomalyCollector();
  const recordings = new Map(input.recordings.map((r) => [r.id, r]));
  const revisions = new Map(input.revisions.map((r) => [r.id, r]));

  const targetsByRecording = new Map<string, string[]>();
  let archived = 0;
  let withPublishedPointer = 0;
  let withDraftPointer = 0;
  let safeTargetRevisions = 0;
  for (const recording of input.recordings) {
    if (recording.status === "ARCHIVED") archived += 1;
    if (recording.currentPublishedRevisionId) withPublishedPointer += 1;
    if (recording.currentDraftRevisionId) withDraftPointer += 1;
    if (!recording.currentPublishedRevisionId && !recording.currentDraftRevisionId) anomalies.add("NO_REVISION_POINTER", recording.id);
    const targets = safeTargets(recording, revisions, anomalies);
    targetsByRecording.set(recording.id, targets);
    safeTargetRevisions += targets.length;
  }
  const withSafeTarget = [...targetsByRecording.values()].filter((t) => t.length > 0).length;

  const inserts: PlannedInsert[] = [];
  const kinds = {} as Record<RelationshipKind, KindReport>;

  for (const kind of RELATIONSHIP_KINDS) {
    const rows = input.legacy[kind];
    const existing = new Set(input.existing[kind].map((row) => pairKey(row.revisionId, row.targetId)));
    const existingByRevision = new Map<string, string[]>();
    for (const row of input.existing[kind]) {
      const list = existingByRevision.get(row.revisionId);
      if (list) list.push(row.targetId);
      else existingByRevision.set(row.revisionId, [row.targetId]);
    }
    const detached = new Set(input.detached[kind].map((row) => pairKey(row.revisionId, row.targetId)));
    // Detach evidence by (Recording, target): which revision numbers it came from. Used only to flag evidence on OLDER revisions.
    const detachedNumbers = new Map<string, { revisionId: string; revisionNumber: number }[]>();
    for (const row of input.detached[kind]) {
      if (!row.recordingId || typeof row.revisionNumber !== "number") continue;
      const key = pairKey(row.recordingId, row.targetId);
      const list = detachedNumbers.get(key);
      const entry = { revisionId: row.revisionId, revisionNumber: row.revisionNumber };
      if (list) list.push(entry);
      else detachedNumbers.set(key, [entry]);
    }
    const unapproved = new Set(input.unapprovedSourceIds);
    const archivedOccasions = new Set(input.archivedOccasionIds);

    const report: KindReport = {
      legacyRows: rows.length,
      orphanedLegacyRows: 0,
      duplicateLegacyRows: 0,
      distinctLinks: 0,
      skippedNoSafeRevision: 0,
      eligibleLinks: 0,
      plannedInserts: 0,
      alreadyPresent: 0,
      skippedEditorDetached: 0,
      revisionRowsWithoutLegacy: 0,
      preservedUnapprovedSources: 0,
      preservedArchivedOccasions: 0,
    };

    const seen = new Set<string>();
    const legacyPairsByRecording = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!recordings.has(row.recordingId)) {
        report.orphanedLegacyRows += 1;
        anomalies.add("ORPHANED_LEGACY_LINK", `${kind}:${row.rowId}`);
        continue;
      }
      const key = pairKey(row.recordingId, row.targetId);
      if (seen.has(key)) {
        report.duplicateLegacyRows += 1;
        anomalies.add("DUPLICATE_LEGACY_LINK", `${kind}:${row.rowId}`);
        continue;
      }
      seen.add(key);
      report.distinctLinks += 1;
      let pairs = legacyPairsByRecording.get(row.recordingId);
      if (!pairs) legacyPairsByRecording.set(row.recordingId, (pairs = new Set()));
      pairs.add(row.targetId);

      const targets = targetsByRecording.get(row.recordingId) ?? [];
      if (targets.length === 0) {
        report.skippedNoSafeRevision += 1;
        continue;
      }
      report.eligibleLinks += 1;
      if (kind === "source" && unapproved.has(row.targetId)) report.preservedUnapprovedSources += 1;
      if (kind === "occasion" && archivedOccasions.has(row.targetId)) report.preservedArchivedOccasions += 1;
      for (const revisionId of targets) {
        const target = pairKey(revisionId, row.targetId);
        if (existing.has(target)) report.alreadyPresent += 1;
        else if (detached.has(target)) report.skippedEditorDetached += 1;
        else {
          report.plannedInserts += 1;
          inserts.push({ kind, revisionId, targetId: row.targetId });
          const targetNumber = revisions.get(revisionId)?.revisionNumber;
          const olderEvidence = typeof targetNumber === "number" && (detachedNumbers.get(pairKey(row.recordingId, row.targetId)) ?? []).some((e) => e.revisionId !== revisionId && e.revisionNumber < targetNumber);
          if (olderEvidence) anomalies.add("DETACH_EVIDENCE_ON_OLDER_REVISION", `${kind}:${row.recordingId}:${row.targetId}`);
        }
      }
    }

    // Revision-scoped rows on the safe target revisions that legacy does not explain: an editor's own edits. Left alone.
    for (const recording of input.recordings) {
      const legacyPairs = legacyPairsByRecording.get(recording.id) ?? new Set<string>();
      for (const revisionId of targetsByRecording.get(recording.id) ?? []) {
        for (const targetId of existingByRevision.get(revisionId) ?? []) {
          if (!legacyPairs.has(targetId)) report.revisionRowsWithoutLegacy += 1;
        }
      }
    }

    kinds[kind] = report;
  }

  return {
    inserts,
    report: {
      recordings: {
        total: input.recordings.length,
        archived,
        withPublishedPointer,
        withDraftPointer,
        withSafeTarget,
        withoutSafeTarget: input.recordings.length - withSafeTarget,
        safeTargetRevisions,
      },
      kinds,
      anomalies: anomalies.list(),
      totals: {
        plannedInserts: RELATIONSHIP_KINDS.reduce((sum, kind) => sum + kinds[kind].plannedInserts, 0),
        alreadyPresent: RELATIONSHIP_KINDS.reduce((sum, kind) => sum + kinds[kind].alreadyPresent, 0),
        skippedEditorDetached: RELATIONSHIP_KINDS.reduce((sum, kind) => sum + kinds[kind].skippedEditorDetached, 0),
      },
    },
  };
}

/** Human-readable report. Contains counts and opaque ids only — never a connection string or any credential. */
export function formatBackfillReport(report: BackfillReport, mode: "DRY RUN" | "EXECUTE", inserted?: Record<RelationshipKind, number>): string {
  const lines: string[] = [];
  const r = report.recordings;
  lines.push(`Revision-scoped relationship backfill - ${mode}${mode === "DRY RUN" ? " (no writes)" : ""}`);
  lines.push("");
  lines.push("Recordings");
  lines.push(`  total ${r.total} (archived ${r.archived})`);
  lines.push(`  with a published pointer ${r.withPublishedPointer}, with a draft pointer ${r.withDraftPointer}`);
  lines.push(`  with a safe target revision ${r.withSafeTarget}, without ${r.withoutSafeTarget}; safe target revisions ${r.safeTargetRevisions}`);
  for (const kind of RELATIONSHIP_KINDS) {
    const k = report.kinds[kind];
    lines.push("");
    lines.push(`${kind.toUpperCase()} links`);
    lines.push(`  legacy rows ${k.legacyRows} = orphaned ${k.orphanedLegacyRows} + duplicates ${k.duplicateLegacyRows} + distinct links ${k.distinctLinks}`);
    lines.push(`  distinct links ${k.distinctLinks} = skipped (no safe revision) ${k.skippedNoSafeRevision} + eligible ${k.eligibleLinks}`);
    lines.push(`  per target revision: planned inserts ${k.plannedInserts}, already present ${k.alreadyPresent}, skipped (editor detached) ${k.skippedEditorDetached}`);
    lines.push(`  revision-scoped rows with no legacy counterpart (left untouched) ${k.revisionRowsWithoutLegacy}`);
    if (kind === "source") lines.push(`  preserved: links to sources not APPROVED ${k.preservedUnapprovedSources} (approval is a read-time filter)`);
    if (kind === "occasion") lines.push(`  preserved: links to archived occasions ${k.preservedArchivedOccasions} (archival is a read-time filter)`);
    if (inserted) lines.push(`  inserted ${inserted[kind]}`);
  }
  lines.push("");
  if (report.anomalies.length === 0) {
    lines.push("Anomalies: none");
  } else {
    lines.push("Anomalies (nothing is discarded silently: each is counted above or skipped for the reason shown)");
    for (const a of report.anomalies) {
      const blocks = EXECUTE_BLOCKING_ANOMALIES.includes(a.code) ? "  [BLOCKS --execute until a person has decided]" : "";
      lines.push(`  ${a.code}: ${a.count}${a.samples.length > 0 ? `  e.g. ${a.samples.join(", ")}` : ""}${blocks}`);
    }
  }
  lines.push("");
  lines.push(`Totals: planned inserts ${report.totals.plannedInserts}, already present ${report.totals.alreadyPresent}, skipped (editor detached) ${report.totals.skippedEditorDetached}`);
  return lines.join("\n");
}
