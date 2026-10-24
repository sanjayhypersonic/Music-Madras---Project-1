// Database FINGERPRINT for backup and recovery verification (launch readiness; docs/deployment-readiness-gate.md §1 "restore point ... confirm it opens and holds the
// expected state", and docs/phase-6j-12c-backup-restore-verification.md). PURE: it defines what is measured and how two measurements are compared; scripts/verifyDatabase.ts
// takes the measurement with READ-ONLY queries.
//
// Counts only, never row data: a fingerprint holds no content, no name, no address and no value from any record, so it is safe to keep next to a ticket.
//
// Use: (1) when a restore point is created, take a fingerprint of the SOURCE and save it; (2) open the restore point as a branch or clone and fingerprint THAT;
// (3) compare. After an actual restore, compare the restored database with the saved fingerprint again. A restore point that does not match is not a restore point.

/** Tables whose row counts are part of the fingerprint: the archive's own content and the records that make a restore worth having. A fixed list, never user input. */
export const FINGERPRINT_TABLES = [
  "recordings",
  "recording_revisions",
  "recording_revision_works",
  "recording_revision_sources",
  "recording_revision_rights",
  "recording_revision_occasions",
  "media_resources",
  "musical_works",
  "composers",
  "performances",
  "programmes",
  "venues",
  "organisations",
  "collections",
  "learning_guides",
  "occasions",
  "youtube_videos",
  "youtube_video_pages",
  "video_exposure_approvals",
  "studio_users",
  "audit_log_entries",
  "operational_incidents",
] as const;

/** Lifecycle integrity checks. Each query counts VIOLATIONS; a healthy database reports 0 for every one. */
/**
 * `introducedBy` names the migration that creates what the check reads. While that migration is NOT yet applied the check is NOT APPLICABLE (null), not a failure:
 * the pre-change fingerprint of a database that is about to receive the migration (runbook section 2) must be able to pass. Once the migration IS applied, a check
 * that cannot run is a problem again.
 */
export const INTEGRITY_CHECKS: ReadonlyArray<{ name: string; description: string; sql: string; introducedBy?: string }> = [
  { name: "publishedWithoutRevision", description: "PUBLISHED recordings with no published revision", sql: `select count(*)::int as n from recordings where status = 'PUBLISHED' and "currentPublishedRevisionId" is null` },
  { name: "publishedPointerOfAnotherRecording", description: "published pointers naming a revision of a different recording", sql: `select count(*)::int as n from recordings r join recording_revisions v on v.id = r."currentPublishedRevisionId" where v."recordingId" <> r.id` },
  { name: "publishedPointerNotPublished", description: "published pointers naming a revision that is not marked PUBLISHED", sql: `select count(*)::int as n from recordings r join recording_revisions v on v.id = r."currentPublishedRevisionId" where v."revisionStatus" <> 'PUBLISHED'` },
  { name: "draftPointerNotDraft", description: "draft pointers naming a revision that is not a DRAFT of that recording", sql: `select count(*)::int as n from recordings r join recording_revisions v on v.id = r."currentDraftRevisionId" where v."revisionStatus" <> 'DRAFT' or v."recordingId" <> r.id` },
  {
    name: "holdWithoutTime",
    description: "recording holds recorded without a time (should be impossible: a CHECK enforces it)",
    sql: `select count(*)::int as n from recordings where ("holdReason" is null) <> ("holdSetAt" is null)`,
    introducedBy: "20261024100000_recording_level_holds",
  },
];

export interface DatabaseFingerprint {
  takenAt: string;
  /** host:port/database, never credentials. */
  target: string;
  migrations: { applied: number; latest: string | null; failed: string[] };
  counts: Record<string, number>;
  /** Violations per check; null = not applicable yet (the migration that introduces the check has not been applied to this database). */
  integrity: Record<string, number | null>;
}

/** Whether a check can be judged on a database whose finished migrations are `finished`. */
export function isCheckApplicable(check: { introducedBy?: string }, finished: ReadonlySet<string>): boolean {
  return check.introducedBy === undefined || finished.has(check.introducedBy);
}

export interface FingerprintDifference {
  kind: "MIGRATIONS" | "COUNT" | "INTEGRITY" | "MISSING_TABLE";
  message: string;
}

/** A check that could NOT run reports -1 (a missing table or column); that is a problem, never a pass. */
const integrityMessage = (name: string, n: number) => (n < 0 ? `${name}: the check could not run (a table or column is missing)` : `${name}: ${n} violation(s)`);

/** What differs between the fingerprint taken at the restore point's creation (`expected`) and the one taken of the database being verified (`actual`). */
export function compareFingerprints(expected: DatabaseFingerprint, actual: DatabaseFingerprint, options: { afterMigration?: boolean } = {}): FingerprintDifference[] {
  const out: FingerprintDifference[] = [];
  if (actual.migrations.failed.length > 0) out.push({ kind: "MIGRATIONS", message: `a migration is failed or half-applied: ${actual.migrations.failed.join(", ")}` });
  // After a CONTROLLED migration the database legitimately has more migrations (and the tables they add) than the pre-change fingerprint; it must never have FEWER,
  // and every table the old fingerprint counted must still hold the same number of rows.
  const moreMigrationsAreExpected = options.afterMigration === true && actual.migrations.applied > expected.migrations.applied;
  if (!moreMigrationsAreExpected && (expected.migrations.latest !== actual.migrations.latest || expected.migrations.applied !== actual.migrations.applied)) {
    out.push({ kind: "MIGRATIONS", message: `migrations differ: expected ${expected.migrations.applied} applied, latest ${expected.migrations.latest ?? "none"}; found ${actual.migrations.applied} applied, latest ${actual.migrations.latest ?? "none"}` });
  }
  if (options.afterMigration === true && actual.migrations.applied < expected.migrations.applied) {
    out.push({ kind: "MIGRATIONS", message: `fewer migrations applied after the change (${actual.migrations.applied}) than before it (${expected.migrations.applied})` });
  }
  for (const table of Object.keys(expected.counts)) {
    if (!(table in actual.counts)) out.push({ kind: "MISSING_TABLE", message: `${table}: present in the expected fingerprint, absent in the database checked` });
    else if (expected.counts[table] !== actual.counts[table]) out.push({ kind: "COUNT", message: `${table}: expected ${expected.counts[table]} rows, found ${actual.counts[table]}` });
  }
  for (const table of Object.keys(actual.counts)) {
    if (!(table in expected.counts) && !moreMigrationsAreExpected) out.push({ kind: "MISSING_TABLE", message: `${table}: present in the database checked, absent in the expected fingerprint` });
  }
  for (const [name, n] of Object.entries(actual.integrity)) if (n !== null && n !== 0) out.push({ kind: "INTEGRITY", message: integrityMessage(name, n) });
  return out;
}

/** Integrity only (no expected fingerprint): used to judge a database in isolation. */
export function integrityProblems(fingerprint: DatabaseFingerprint): FingerprintDifference[] {
  const out: FingerprintDifference[] = [];
  if (fingerprint.migrations.failed.length > 0) out.push({ kind: "MIGRATIONS", message: `a migration is failed or half-applied: ${fingerprint.migrations.failed.join(", ")}` });
  for (const [name, n] of Object.entries(fingerprint.integrity)) if (n !== null && n !== 0) out.push({ kind: "INTEGRITY", message: integrityMessage(name, n) });
  return out;
}

export function isFingerprint(value: unknown): value is DatabaseFingerprint {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<DatabaseFingerprint>;
  return typeof v.takenAt === "string" && typeof v.target === "string" && typeof v.migrations === "object" && v.migrations !== null && typeof v.counts === "object" && v.counts !== null && typeof v.integrity === "object" && v.integrity !== null;
}
