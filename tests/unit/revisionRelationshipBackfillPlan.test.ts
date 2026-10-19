import { describe, expect, it } from "vitest";
import {
  RELATIONSHIP_KINDS,
  SAMPLE_LIMIT,
  formatBackfillReport,
  planRevisionRelationshipBackfill,
  type BackfillInput,
  type BackfillRecording,
  type BackfillRevision,
  type DetachEvidenceRow,
  type LegacyLinkRow,
  type RelationshipKind,
  type RevisionLinkRow,
} from "../../modules/backfill/revisionRelationships/backfillPlan";

// Phase 6J-11C — the pure planner: what is projected where, and how every legacy row is accounted for.

const recording = (id: string, published: string | null, draft: string | null, status = "PUBLISHED"): BackfillRecording => ({
  id,
  status,
  currentPublishedRevisionId: published,
  currentDraftRevisionId: draft,
});
const revision = (id: string, recordingId: string, revisionStatus: string): BackfillRevision => ({ id, recordingId, revisionStatus });
const legacyRow = (rowId: string, recordingId: string, targetId: string): LegacyLinkRow => ({ rowId, recordingId, targetId });
const link = (revisionId: string, targetId: string): RevisionLinkRow => ({ revisionId, targetId });

const empty = <T,>(): Record<RelationshipKind, T[]> => ({ source: [], rights: [], occasion: [] });

function input(overrides: Partial<BackfillInput> & Pick<BackfillInput, "recordings" | "revisions">): BackfillInput {
  return { legacy: empty(), existing: empty(), detached: empty(), unapprovedSourceIds: [], archivedOccasionIds: [], ...overrides };
}

/** A recording R1 with a published revision P1 and an open draft D1, plus a superseded revision S1 that must never be touched. */
const standard = {
  recordings: [recording("R1", "P1", "D1")],
  revisions: [revision("P1", "R1", "PUBLISHED"), revision("D1", "R1", "DRAFT"), revision("S1", "R1", "SUPERSEDED")],
};

describe("projection targets", () => {
  it("projects each legacy link to the published AND the draft revision, and to nothing else (never a superseded revision)", () => {
    const plan = planRevisionRelationshipBackfill(
      input({ ...standard, legacy: { source: [legacyRow("a", "R1", "src1")], rights: [legacyRow("b", "R1", "rt1")], occasion: [legacyRow("c", "R1", "oc1")] } })
    );
    const byKind = (kind: RelationshipKind) => plan.inserts.filter((i) => i.kind === kind).map((i) => `${i.revisionId}:${i.targetId}`).sort();
    expect(byKind("source")).toEqual(["D1:src1", "P1:src1"]);
    expect(byKind("rights")).toEqual(["D1:rt1", "P1:rt1"]);
    expect(byKind("occasion")).toEqual(["D1:oc1", "P1:oc1"]);
    expect(plan.inserts.some((i) => i.revisionId === "S1")).toBe(false);
    expect(plan.report.recordings).toMatchObject({ total: 1, withPublishedPointer: 1, withDraftPointer: 1, withSafeTarget: 1, safeTargetRevisions: 2 });
  });

  it("a Recording with only a published revision, or only a draft, gets exactly that one target", () => {
    const plan = planRevisionRelationshipBackfill(
      input({
        recordings: [recording("R1", "P1", null), recording("R2", null, "D2", "DRAFT")],
        revisions: [revision("P1", "R1", "PUBLISHED"), revision("D2", "R2", "DRAFT")],
        legacy: { source: [legacyRow("a", "R1", "s1"), legacyRow("b", "R2", "s1")], rights: [], occasion: [] },
      })
    );
    expect(plan.inserts.map((i) => `${i.revisionId}:${i.targetId}`).sort()).toEqual(["D2:s1", "P1:s1"]);
  });

  it("an archived Recording keeps its pointers and is projected like any other", () => {
    const plan = planRevisionRelationshipBackfill(
      input({
        recordings: [recording("R1", "P1", null, "ARCHIVED")],
        revisions: [revision("P1", "R1", "PUBLISHED")],
        legacy: { source: [legacyRow("a", "R1", "s1")], rights: [], occasion: [] },
      })
    );
    expect(plan.inserts).toHaveLength(1);
    expect(plan.report.recordings.archived).toBe(1);
  });
});

describe("idempotence and what is left alone", () => {
  const legacy = { source: [legacyRow("a", "R1", "s1")], rights: [], occasion: [] };

  it("rows that already exist are counted and not planned again", () => {
    const plan = planRevisionRelationshipBackfill(input({ ...standard, legacy, existing: { source: [link("P1", "s1"), link("D1", "s1")], rights: [], occasion: [] } }));
    expect(plan.inserts).toEqual([]);
    expect(plan.report.kinds.source).toMatchObject({ plannedInserts: 0, alreadyPresent: 2 });
  });

  it("a partially applied state plans only the missing target", () => {
    const plan = planRevisionRelationshipBackfill(input({ ...standard, legacy, existing: { source: [link("P1", "s1")], rights: [], occasion: [] } }));
    expect(plan.inserts).toEqual([{ kind: "source", revisionId: "D1", targetId: "s1" }]);
    expect(plan.report.kinds.source).toMatchObject({ plannedInserts: 1, alreadyPresent: 1 });
  });

  it("a link an editor detached from a revision is not re-added to THAT revision (and only that one)", () => {
    const plan = planRevisionRelationshipBackfill(input({ ...standard, legacy, detached: { source: [link("D1", "s1")], rights: [], occasion: [] } }));
    expect(plan.inserts).toEqual([{ kind: "source", revisionId: "P1", targetId: "s1" }]);
    expect(plan.report.kinds.source).toMatchObject({ plannedInserts: 1, skippedEditorDetached: 1 });
  });

  it("revision-scoped rows with no legacy counterpart (an editor's own edits) are reported and never removed or replanned", () => {
    const plan = planRevisionRelationshipBackfill(input({ ...standard, legacy, existing: { source: [link("D1", "editorOnly")], rights: [], occasion: [] } }));
    expect(plan.report.kinds.source.revisionRowsWithoutLegacy).toBe(1);
    expect(plan.inserts.every((i) => i.targetId === "s1")).toBe(true);
  });

  it("is a pure function of its input: planning twice gives the same plan", () => {
    const given = input({ ...standard, legacy });
    expect(planRevisionRelationshipBackfill(given)).toEqual(planRevisionRelationshipBackfill(given));
  });
});

describe("anomalies are reported, never silently dropped", () => {
  it("duplicate legacy rows produce one insert per target and are counted", () => {
    const plan = planRevisionRelationshipBackfill(
      input({ ...standard, legacy: { source: [legacyRow("a1", "R1", "s1"), legacyRow("a2", "R1", "s1"), legacyRow("a3", "R1", "s1")], rights: [legacyRow("b1", "R1", "r1"), legacyRow("b2", "R1", "r1")], occasion: [] } })
    );
    expect(plan.inserts.filter((i) => i.kind === "source")).toHaveLength(2); // P1 + D1, once
    expect(plan.report.kinds.source).toMatchObject({ legacyRows: 3, duplicateLegacyRows: 2, distinctLinks: 1 });
    expect(plan.report.kinds.rights).toMatchObject({ legacyRows: 2, duplicateLegacyRows: 1, distinctLinks: 1 });
    expect(plan.report.anomalies.find((a) => a.code === "DUPLICATE_LEGACY_LINK")).toMatchObject({ count: 3 });
  });

  it("orphaned legacy rows (no such Recording) are counted as orphans only — not as duplicates, never projected", () => {
    const plan = planRevisionRelationshipBackfill(
      input({ ...standard, legacy: { source: [legacyRow("a", "GONE", "s1"), legacyRow("b", "GONE", "s1"), legacyRow("c", "R1", "s2")], rights: [], occasion: [legacyRow("d", "GONE", "o1")] } })
    );
    expect(plan.report.kinds.source).toMatchObject({ legacyRows: 3, orphanedLegacyRows: 2, duplicateLegacyRows: 0, distinctLinks: 1 });
    expect(plan.report.kinds.occasion).toMatchObject({ orphanedLegacyRows: 1, distinctLinks: 0 });
    expect(plan.inserts.map((i) => i.targetId)).toEqual(["s2", "s2"]);
    expect(plan.report.anomalies.find((a) => a.code === "ORPHANED_LEGACY_LINK")).toMatchObject({ count: 3 });
  });

  it("a Recording with no revision pointer is reported and its links are skipped (counted), not invented onto anything", () => {
    const plan = planRevisionRelationshipBackfill(
      input({ recordings: [recording("R1", null, null, "DRAFT")], revisions: [], legacy: { source: [legacyRow("a", "R1", "s1")], rights: [legacyRow("b", "R1", "r1")], occasion: [] } })
    );
    expect(plan.inserts).toEqual([]);
    expect(plan.report.kinds.source).toMatchObject({ distinctLinks: 1, skippedNoSafeRevision: 1, eligibleLinks: 0 });
    expect(plan.report.recordings).toMatchObject({ withSafeTarget: 0, withoutSafeTarget: 1 });
    expect(plan.report.anomalies.find((a) => a.code === "NO_REVISION_POINTER")).toMatchObject({ count: 1, samples: ["R1"] });
  });

  it("an unsafe pointer is skipped and reported; a safe sibling pointer still receives the links", () => {
    const cases: Array<[string, BackfillInput, string]> = [
      ["missing revision", input({ recordings: [recording("R1", "P1", "D1")], revisions: [revision("D1", "R1", "DRAFT")], legacy: { source: [legacyRow("a", "R1", "s1")], rights: [], occasion: [] } }), "POINTER_REVISION_MISSING"],
      [
        "revision of another Recording",
        input({ recordings: [recording("R1", "P1", "D1")], revisions: [revision("P1", "OTHER", "PUBLISHED"), revision("D1", "R1", "DRAFT")], legacy: { source: [legacyRow("a", "R1", "s1")], rights: [], occasion: [] } }),
        "POINTER_REVISION_OTHER_RECORDING",
      ],
      [
        "unexpected status",
        input({ recordings: [recording("R1", "P1", "D1")], revisions: [revision("P1", "R1", "SUPERSEDED"), revision("D1", "R1", "DRAFT")], legacy: { source: [legacyRow("a", "R1", "s1")], rights: [], occasion: [] } }),
        "POINTER_STATUS_MISMATCH",
      ],
    ];
    for (const [name, given, code] of cases) {
      const plan = planRevisionRelationshipBackfill(given);
      expect(plan.inserts.map((i) => i.revisionId), name).toEqual(["D1"]);
      expect(plan.report.anomalies.find((a) => a.code === code), name).toMatchObject({ count: 1 });
    }
  });

  it("when both pointers are unsafe the links are skipped, not guessed", () => {
    const plan = planRevisionRelationshipBackfill(
      input({ recordings: [recording("R1", "P1", "D1")], revisions: [], legacy: { source: [legacyRow("a", "R1", "s1")], rights: [], occasion: [] } })
    );
    expect(plan.inserts).toEqual([]);
    expect(plan.report.kinds.source.skippedNoSafeRevision).toBe(1);
  });

  it("anomaly samples are bounded but the counts are exact", () => {
    const rows = Array.from({ length: SAMPLE_LIMIT + 7 }, (_, i) => legacyRow(`row${i}`, "GONE", `s${i}`));
    const plan = planRevisionRelationshipBackfill(input({ ...standard, legacy: { source: rows, rights: [], occasion: [] } }));
    const orphan = plan.report.anomalies.find((a) => a.code === "ORPHANED_LEGACY_LINK")!;
    expect(orphan.count).toBe(SAMPLE_LIMIT + 7);
    expect(orphan.samples).toHaveLength(SAMPLE_LIMIT);
  });
});

describe("detach evidence on an OLDER revision of the same Recording (Phase 6J-12: never resurrected silently)", () => {
  const legacy = { source: [legacyRow("a", "R1", "s1")], rights: [], occasion: [] };
  // History: P0 (1, superseded) -> P1 (2, published; an editor detached s1 from it before it was published) -> D1 (3, draft forked from P1)
  const numbered = {
    recordings: [recording("R1", "P1", "D1")],
    revisions: [
      { ...revision("P1", "R1", "PUBLISHED"), revisionNumber: 2 },
      { ...revision("D1", "R1", "DRAFT"), revisionNumber: 3 },
    ],
  };
  const evidence = (revisionId: string, revisionNumber: number | null, recordingId: string | null = "R1") => ({ revisionId, targetId: "s1", recordingId, revisionNumber });

  it("flags a link planned for a NEWER revision when an editor detached it from an older one — and still counts the plan, so a person decides", () => {
    const plan = planRevisionRelationshipBackfill(input({ ...numbered, legacy, detached: { source: [evidence("P1", 2)], rights: [], occasion: [] } }));
    // P1 itself: detached there (skipped). D1: newer than the evidence -> planned AND flagged.
    expect(plan.report.kinds.source).toMatchObject({ plannedInserts: 1, skippedEditorDetached: 1 });
    expect(plan.inserts).toEqual([{ kind: "source", revisionId: "D1", targetId: "s1" }]);
    expect(plan.report.anomalies).toEqual([{ code: "DETACH_EVIDENCE_ON_OLDER_REVISION", count: 1, samples: ["source:R1:s1"] }]);
    expect(formatBackfillReport(plan.report, "DRY RUN")).toMatch(/DETACH_EVIDENCE_ON_OLDER_REVISION: 1.*BLOCKS --execute/);
  });

  it("does NOT flag the normal case: a detach on a NEWER draft leaves the older published revision to be backfilled", () => {
    const plan = planRevisionRelationshipBackfill(input({ ...numbered, legacy, detached: { source: [evidence("D1", 3)], rights: [], occasion: [] } }));
    expect(plan.inserts).toEqual([{ kind: "source", revisionId: "P1", targetId: "s1" }]);
    expect(plan.report.anomalies).toEqual([]);
  });

  it("does not flag a detach on the SAME revision, on another Recording, for another target, or with unknown history", () => {
    const flagged = (detached: DetachEvidenceRow[]) =>
      planRevisionRelationshipBackfill(input({ ...numbered, legacy, detached: { source: detached, rights: [], occasion: [] } })).report.anomalies.some((a) => a.code === "DETACH_EVIDENCE_ON_OLDER_REVISION");
    expect(flagged([evidence("D1", 3)])).toBe(false); // same revision as the target
    expect(flagged([evidence("X9", 1, "R2")])).toBe(false); // an older revision of a DIFFERENT Recording
    expect(flagged([{ ...evidence("P1", 2), targetId: "otherSource" }])).toBe(false); // a different link
    expect(flagged([evidence("GONE", null, null)])).toBe(false); // the revision no longer exists: nothing to order
    expect(flagged([{ revisionId: "P1", targetId: "s1" }])).toBe(false); // legacy-shaped evidence without history
    expect(flagged([evidence("P1", 2)])).toBe(true); // control: the flagged shape
  });

  it("is not triggered when the link already exists on the newer revision (nothing would be added)", () => {
    const plan = planRevisionRelationshipBackfill(
      input({ ...numbered, legacy, existing: { source: [link("D1", "s1")], rights: [], occasion: [] }, detached: { source: [evidence("P1", 2)], rights: [], occasion: [] } })
    );
    expect(plan.inserts).toEqual([]);
    expect(plan.report.anomalies).toEqual([]);
  });

  it("applies to rights and occasions as well as sources", () => {
    const plan = planRevisionRelationshipBackfill(
      input({
        ...numbered,
        legacy: { source: [], rights: [legacyRow("b", "R1", "s1")], occasion: [legacyRow("c", "R1", "s1")] },
        detached: { source: [], rights: [evidence("P1", 2)], occasion: [evidence("P1", 2)] },
      })
    );
    expect(plan.report.anomalies).toHaveLength(1);
    expect(plan.report.anomalies[0]).toMatchObject({ code: "DETACH_EVIDENCE_ON_OLDER_REVISION", count: 2 });
    expect([...plan.report.anomalies[0].samples].sort()).toEqual(["occasion:R1:s1", "rights:R1:s1"]);
  });
});

describe("preservation: approval and archival are read-time filters", () => {
  it("unapproved Sources and archived Occasions are projected like any other and counted as preserved", () => {
    const plan = planRevisionRelationshipBackfill(
      input({
        ...standard,
        legacy: { source: [legacyRow("a", "R1", "unapproved"), legacyRow("b", "R1", "approved")], rights: [], occasion: [legacyRow("c", "R1", "archivedOccasion"), legacyRow("d", "R1", "liveOccasion")] },
        unapprovedSourceIds: ["unapproved"],
        archivedOccasionIds: ["archivedOccasion"],
      })
    );
    expect(plan.inserts.filter((i) => i.revisionId === "P1").map((i) => i.targetId).sort()).toEqual(["approved", "archivedOccasion", "liveOccasion", "unapproved"]);
    expect(plan.report.kinds.source.preservedUnapprovedSources).toBe(1);
    expect(plan.report.kinds.occasion.preservedArchivedOccasions).toBe(1);
  });
});

describe("the report accounts for every row", () => {
  it("legacy rows = orphaned + duplicates + distinct; distinct = skipped + eligible; eligible x targets = planned + present + detached", () => {
    const given = input({
      recordings: [recording("R1", "P1", "D1"), recording("R2", null, null, "DRAFT"), recording("R3", "P3", null)],
      revisions: [revision("P1", "R1", "PUBLISHED"), revision("D1", "R1", "DRAFT"), revision("P3", "R3", "PUBLISHED")],
      legacy: {
        source: [legacyRow("1", "R1", "a"), legacyRow("2", "R1", "a"), legacyRow("3", "R1", "b"), legacyRow("4", "R2", "a"), legacyRow("5", "R3", "a"), legacyRow("6", "GONE", "a")],
        rights: [legacyRow("7", "R1", "x")],
        occasion: [],
      },
      existing: { source: [link("P1", "b")], rights: [], occasion: [] },
      detached: { source: [link("D1", "a")], rights: [], occasion: [] },
    });
    const { report } = planRevisionRelationshipBackfill(given);
    for (const kind of RELATIONSHIP_KINDS) {
      const k = report.kinds[kind];
      expect(k.legacyRows).toBe(k.orphanedLegacyRows + k.duplicateLegacyRows + k.distinctLinks);
      expect(k.distinctLinks).toBe(k.skippedNoSafeRevision + k.eligibleLinks);
    }
    const s = report.kinds.source;
    expect(s).toMatchObject({ legacyRows: 6, orphanedLegacyRows: 1, duplicateLegacyRows: 1, distinctLinks: 4, skippedNoSafeRevision: 1, eligibleLinks: 3 });
    // eligible links a@R1 (2 targets), b@R1 (2 targets), a@R3 (1 target) = 5 (link, revision) pairs
    expect(s.plannedInserts + s.alreadyPresent + s.skippedEditorDetached).toBe(5);
    expect(s).toMatchObject({ plannedInserts: 3, alreadyPresent: 1, skippedEditorDetached: 1 });
    expect(report.totals).toEqual({ plannedInserts: 3 + 2, alreadyPresent: 1, skippedEditorDetached: 1 });
  });
});

describe("formatBackfillReport", () => {
  const plan = planRevisionRelationshipBackfill(
    input({ ...standard, legacy: { source: [legacyRow("a", "R1", "s1"), legacyRow("b", "GONE", "s1")], rights: [], occasion: [] } })
  );

  it("labels the mode, shows each kind's accounting and the anomalies, and says a dry run writes nothing", () => {
    const dry = formatBackfillReport(plan.report, "DRY RUN");
    expect(dry).toContain("DRY RUN (no writes)");
    expect(dry).toMatch(/SOURCE links/);
    expect(dry).toMatch(/RIGHTS links/);
    expect(dry).toMatch(/OCCASION links/);
    expect(dry).toMatch(/orphaned 1/);
    expect(dry).toMatch(/ORPHANED_LEGACY_LINK: 1/);
    const executed = formatBackfillReport(plan.report, "EXECUTE", { source: 2, rights: 0, occasion: 0 });
    expect(executed).toContain("EXECUTE");
    expect(executed).toMatch(/inserted 2/);
  });

  it("contains counts and opaque ids only: no connection string or credential", () => {
    expect(formatBackfillReport(plan.report, "DRY RUN")).not.toMatch(/postgres(ql)?:\/\/|password|secret/i);
  });
});
