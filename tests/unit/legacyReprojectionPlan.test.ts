import { describe, expect, it } from "vitest";
import {
  BLOCKING_ANOMALIES,
  RELATIONSHIP_KINDS,
  SAMPLE_LIMIT,
  formatReprojectionReport,
  planLegacyReprojection,
  type DetachProof,
  type LegacyRow,
  type ReprojectionInput,
  type ReprojectionPlan,
  type ReprojectionRecording,
  type ReprojectionRevision,
  type RelationshipKind,
  type RevisionLink,
} from "../../modules/backfill/legacyReprojection/reprojectionPlan";

// Phase 6J-12B — the pure planner of the revision-to-legacy re-projection (rollback direction). Synthetic data only.

const recording = (id: string, published: string | null, draft: string | null, status = "PUBLISHED"): ReprojectionRecording => ({ id, status, currentPublishedRevisionId: published, currentDraftRevisionId: draft });
const revision = (id: string, recordingId: string, revisionStatus: string): ReprojectionRevision => ({ id, recordingId, revisionStatus });
const link = (revisionId: string, targetId: string): RevisionLink => ({ revisionId, targetId });
const legacyRow = (rowId: string, recordingId: string, targetId: string): LegacyRow => ({ rowId, recordingId, targetId });
const proof = (revisionId: string, targetId: string, recordingId: string | null, revisionStatus: string | null): DetachProof => ({ revisionId, targetId, recordingId, revisionStatus });

type PerKind<T> = Record<RelationshipKind, T[]>;
const none = <T,>(): PerKind<T> => ({ source: [], rights: [], occasion: [] });

function input(parts: Partial<ReprojectionInput> & Pick<ReprojectionInput, "recordings" | "revisions">): ReprojectionInput {
  return { revisionLinks: none(), legacy: none(), detached: none(), unapprovedSourceIds: [], archivedOccasionIds: [], ...parts };
}
const sources = (revisionLinks: RevisionLink[], legacy: LegacyRow[] = [], detached: DetachProof[] = []): Pick<ReprojectionInput, "revisionLinks" | "legacy" | "detached"> => ({
  revisionLinks: { ...none<RevisionLink>(), source: revisionLinks },
  legacy: { ...none<LegacyRow>(), source: legacy },
  detached: { ...none<DetachProof>(), source: detached },
});
const codes = (plan: ReprojectionPlan) => plan.report.anomalies.map((a) => a.code);
const insertKeys = (plan: ReprojectionPlan) => plan.inserts.map((i) => `${i.kind}:${i.recordingId}:${i.targetId}`);
const removalKeys = (plan: ReprojectionPlan) => plan.removals.map((r) => `${r.kind}:${r.rowId}`);

/** Applies a plan to the synthetic state (as the database layer would), so idempotence can be checked. */
function apply(base: ReprojectionInput, plan: ReprojectionPlan): ReprojectionInput {
  const legacy = { source: [...base.legacy.source], rights: [...base.legacy.rights], occasion: [...base.legacy.occasion] } as PerKind<LegacyRow>;
  for (const kind of RELATIONSHIP_KINDS) {
    const removed = new Set(plan.removals.filter((r) => r.kind === kind).map((r) => r.rowId));
    legacy[kind] = legacy[kind].filter((row) => !removed.has(row.rowId));
    for (const insert of plan.inserts.filter((i) => i.kind === kind)) legacy[kind].push(legacyRow(`new-${kind}-${insert.recordingId}-${insert.targetId}`, insert.recordingId, insert.targetId));
  }
  return { ...base, legacy };
}

describe("authoritative revision (per lifecycle state)", () => {
  it("published + draft: the PUBLISHED set is projected; the draft's unpublished edits are not, and are reported", () => {
    const base = input({
      recordings: [recording("R1", "P1", "D1")],
      revisions: [revision("P1", "R1", "PUBLISHED"), revision("D1", "R1", "DRAFT")],
      ...sources([link("P1", "a"), link("D1", "a"), link("D1", "draftOnly")], [legacyRow("l1", "R1", "a")]),
    });
    const plan = planLegacyReprojection(base);
    expect(plan.inserts).toEqual([]); // 'draftOnly' must NOT become public
    expect(plan.removals).toEqual([]);
    expect(plan.report.recordings).toMatchObject({ withAuthority: 1, authorityPublished: 1, authorityDraft: 0 });
    expect(codes(plan)).toEqual(["UNPUBLISHED_DRAFT_DIFFERENCE"]);
    expect(plan.blocking).toEqual([]); // information only
  });

  it("draft only (never published): the draft IS authoritative", () => {
    const plan = planLegacyReprojection(input({ recordings: [recording("R1", null, "D1", "DRAFT")], revisions: [revision("D1", "R1", "DRAFT")], ...sources([link("D1", "a"), link("D1", "b")], [legacyRow("l1", "R1", "a")]) }));
    expect(insertKeys(plan)).toEqual(["source:R1:b"]);
    expect(plan.report.recordings).toMatchObject({ withAuthority: 1, authorityPublished: 0, authorityDraft: 1 });
  });

  it("a superseded revision is never authoritative: a pointer to one is an unsafe pointer (blocking), not a source of links", () => {
    const plan = planLegacyReprojection(input({ recordings: [recording("R1", "S1", null)], revisions: [revision("S1", "R1", "SUPERSEDED")], ...sources([link("S1", "a")], [legacyRow("l1", "R1", "z")]) }));
    expect(plan.inserts).toEqual([]);
    expect(codes(plan)).toEqual(["AUTHORITATIVE_POINTER_STATUS_MISMATCH"]);
    expect(plan.blocking.map((b) => b.code)).toEqual(["AUTHORITATIVE_POINTER_STATUS_MISMATCH"]);
    expect(plan.report.kinds.source.skippedNoAuthority).toBe(1); // its legacy link is left alone
  });

  it("no pointer at all: skipped and counted, legacy rows untouched, not blocking", () => {
    const plan = planLegacyReprojection(input({ recordings: [recording("R1", null, null)], revisions: [], ...sources([], [legacyRow("l1", "R1", "a")]) }));
    expect(plan.inserts).toEqual([]);
    expect(plan.removals).toEqual([]);
    expect(codes(plan)).toEqual(["NO_REVISION_POINTER"]);
    expect(plan.blocking).toEqual([]);
    expect(plan.report.kinds.source).toMatchObject({ skippedNoAuthority: 1, retained: 0 });
  });

  it("an unsafe published pointer (missing / another Recording's / wrong status) is blocking and NEVER falls back to the draft", () => {
    const cases: [string, ReprojectionRevision[], string][] = [
      ["missing", [revision("D1", "R1", "DRAFT")], "AUTHORITATIVE_POINTER_MISSING"],
      ["other recording", [revision("P1", "R2", "PUBLISHED"), revision("D1", "R1", "DRAFT")], "AUTHORITATIVE_POINTER_OTHER_RECORDING"],
      ["wrong status", [revision("P1", "R1", "DRAFT"), revision("D1", "R1", "DRAFT")], "AUTHORITATIVE_POINTER_STATUS_MISMATCH"],
    ];
    for (const [label, revisions, code] of cases) {
      const plan = planLegacyReprojection(input({ recordings: [recording("R1", "P1", "D1"), recording("R2", null, null)], revisions, ...sources([link("D1", "fromDraft")], [legacyRow("l1", "R1", "a")]) }));
      expect(codes(plan), label).toContain(code);
      expect(plan.blocking.map((b) => b.code), label).toContain(code);
      expect(plan.inserts, label).toEqual([]); // the draft's link was NOT used
      expect(plan.removals, label).toEqual([]);
    }
  });

  it("an unsafe draft pointer next to a good published one is information only", () => {
    const plan = planLegacyReprojection(input({ recordings: [recording("R1", "P1", "D9")], revisions: [revision("P1", "R1", "PUBLISHED")], ...sources([link("P1", "a")]) }));
    expect(codes(plan)).toEqual(["DRAFT_POINTER_UNSAFE"]);
    expect(plan.blocking).toEqual([]);
    expect(insertKeys(plan)).toEqual(["source:R1:a"]);
  });

  it("an archived Recording is projected like any other (status is not consulted)", () => {
    const plan = planLegacyReprojection(input({ recordings: [recording("R1", "P1", null, "ARCHIVED")], revisions: [revision("P1", "R1", "PUBLISHED")], ...sources([link("P1", "a")]) }));
    expect(insertKeys(plan)).toEqual(["source:R1:a"]);
  });
});

describe("what is removed, what is kept, and what is a conflict", () => {
  const base = { recordings: [recording("R1", "P2", "D3")], revisions: [revision("P2", "R1", "PUBLISHED"), revision("D3", "R1", "DRAFT"), revision("P1", "R1", "SUPERSEDED")] };

  it("a PUBLISHED detachment is proven by the audit trail and removes the legacy link; a later fork (which lacks it too) never brings it back", () => {
    // P1 had L; an editor detached it from the draft that became P2; D3 was forked from P2 (so it lacks L as well). Legacy still has L.
    const state = input({ ...base, ...sources([link("P2", "keep"), link("D3", "keep")], [legacyRow("l-keep", "R1", "keep"), legacyRow("l-L", "R1", "L")], [proof("P2", "L", "R1", "PUBLISHED")]) });
    const plan = planLegacyReprojection(state);
    expect(removalKeys(plan)).toEqual(["source:l-L"]);
    expect(plan.inserts).toEqual([]);
    expect(plan.blocking).toEqual([]);
    expect(plan.report.kinds.source).toMatchObject({ retained: 1, removedLinks: 1, removedRows: 1, conflicts: 0 });
  });

  it("proof on a SUPERSEDED (once published) revision counts; proof on the authoritative draft of a never-published Recording counts", () => {
    const superseded = planLegacyReprojection(input({ ...base, ...sources([link("P2", "keep")], [legacyRow("l-keep", "R1", "keep"), legacyRow("l-L", "R1", "L")], [proof("P1", "L", "R1", "SUPERSEDED")]) }));
    expect(removalKeys(superseded)).toEqual(["source:l-L"]);
    const draftOnly = planLegacyReprojection(
      input({ recordings: [recording("R1", null, "D1", "DRAFT")], revisions: [revision("D1", "R1", "DRAFT")], ...sources([], [legacyRow("l-L", "R1", "L")], [proof("D1", "L", "R1", "DRAFT")]) })
    );
    expect(removalKeys(draftOnly)).toEqual(["source:l-L"]);
  });

  it("an UNPUBLISHED draft detachment is not proof: the published set keeps the link (retained); and where the published set lacks it, it is a conflict, not a removal", () => {
    const kept = planLegacyReprojection(input({ ...base, ...sources([link("P2", "L")], [legacyRow("l-L", "R1", "L")], [proof("D3", "L", "R1", "DRAFT")]) }));
    expect(kept.removals).toEqual([]);
    expect(kept.report.kinds.source).toMatchObject({ retained: 1, removedLinks: 0, conflicts: 0 });
    const conflict = planLegacyReprojection(input({ ...base, ...sources([link("P2", "x")], [legacyRow("l-L", "R1", "L")], [proof("D3", "L", "R1", "DRAFT")]) }));
    expect(conflict.removals).toEqual([]);
    expect(codes(conflict)).toContain("LEGACY_LINK_NOT_IN_REVISION_SET");
  });

  it("a legacy link the revision set does not explain is a BLOCKING conflict: the row is kept, never deleted", () => {
    const plan = planLegacyReprojection(input({ ...base, ...sources([link("P2", "a")], [legacyRow("l-a", "R1", "a"), legacyRow("l-mystery", "R1", "mystery")]) }));
    expect(plan.removals).toEqual([]);
    expect(plan.blocking.map((b) => [b.code, b.count])).toEqual([["LEGACY_LINK_NOT_IN_REVISION_SET", 1]]);
    expect(plan.report.anomalies[0].samples).toEqual(["source:R1:mystery"]);
    expect(plan.report.totals.conflicts).toBe(1);
  });

  it("unknown or missing evidence is never proof (conservative: the opposite direction from the backfill)", () => {
    for (const evidence of [proof("P2", "L", "R1", null), proof("GONE", "L", null, null), proof("P2", "L", "R2", "PUBLISHED"), proof("P2", "other", "R1", "PUBLISHED")]) {
      const plan = planLegacyReprojection(input({ ...base, ...sources([link("P2", "keep")], [legacyRow("l-keep", "R1", "keep"), legacyRow("l-L", "R1", "L")], [evidence]) }));
      expect(plan.removals, JSON.stringify(evidence)).toEqual([]);
      expect(codes(plan), JSON.stringify(evidence)).toContain("LEGACY_LINK_NOT_IN_REVISION_SET");
    }
  });

  it("a link re-attached after a detach is simply in the authoritative set: retained, whatever the audit trail says", () => {
    const plan = planLegacyReprojection(input({ ...base, ...sources([link("P2", "L")], [legacyRow("l-L", "R1", "L")], [proof("P1", "L", "R1", "SUPERSEDED")]) }));
    expect(plan.removals).toEqual([]);
    expect(plan.report.kinds.source.retained).toBe(1);
  });

  it("links are inserted when the authoritative set has them and legacy does not (unapproved Sources and archived Occasions as they are)", () => {
    const plan = planLegacyReprojection(
      input({
        ...base,
        revisionLinks: { source: [link("P2", "s-unapproved"), link("P2", "s-ok")], rights: [link("P2", "r1")], occasion: [link("P2", "o-archived")] },
        unapprovedSourceIds: ["s-unapproved"],
        archivedOccasionIds: ["o-archived"],
      })
    );
    expect(insertKeys(plan)).toEqual(["occasion:R1:o-archived", "rights:R1:r1", "source:R1:s-ok", "source:R1:s-unapproved"]);
    expect(plan.report.kinds.source.preservedUnapprovedSources).toBe(1);
    expect(plan.report.kinds.occasion.preservedArchivedOccasions).toBe(1);
  });
});

describe("duplicates, orphans and the accounting", () => {
  const base = { recordings: [recording("R1", "P1", null)], revisions: [revision("P1", "R1", "PUBLISHED")] };

  it("duplicate legacy rows: all rows of a removed link go; the duplicates of a retained link stay; both are counted", () => {
    const plan = planLegacyReprojection(
      input({ ...base, ...sources([link("P1", "keep")], [legacyRow("k1", "R1", "keep"), legacyRow("k2", "R1", "keep"), legacyRow("g1", "R1", "gone"), legacyRow("g2", "R1", "gone")], [proof("P1", "gone", "R1", "PUBLISHED")]) })
    );
    expect(removalKeys(plan)).toEqual(["source:g1", "source:g2"]);
    expect(plan.report.kinds.source).toMatchObject({ legacyRows: 4, duplicateLegacyRows: 2, distinctLinks: 2, retained: 1, removedLinks: 1, removedRows: 2 });
    expect(codes(plan)).toContain("DUPLICATE_LEGACY_LINK");
  });

  it("orphaned legacy rows (no such Recording) are never touched and never removed, even with proof-shaped evidence", () => {
    const plan = planLegacyReprojection(input({ ...base, ...sources([], [legacyRow("o1", "NOPE", "a")], [proof("P1", "a", "NOPE", "PUBLISHED")]) }));
    expect(plan.removals).toEqual([]);
    expect(plan.report.kinds.source).toMatchObject({ orphanedLegacyRows: 1, distinctLinks: 0 });
    expect(codes(plan)).toEqual(["ORPHANED_LEGACY_LINK"]);
  });

  it("every legacy row is accounted for: rows = orphans + duplicates + distinct; distinct = skipped + retained + removed + conflicts; authoritative = retained + inserts", () => {
    const state = input({
      recordings: [recording("R1", "P1", null), recording("R2", null, null), recording("R3", "P3", null)],
      revisions: [revision("P1", "R1", "PUBLISHED"), revision("P3", "R3", "PUBLISHED")],
      ...sources(
        [link("P1", "a"), link("P1", "new"), link("P3", "b")],
        [legacyRow("1", "R1", "a"), legacyRow("2", "R1", "a"), legacyRow("3", "R1", "removeMe"), legacyRow("4", "R2", "x"), legacyRow("5", "R3", "mystery"), legacyRow("6", "ORPHAN", "o")],
        [proof("P1", "removeMe", "R1", "PUBLISHED")]
      ),
    });
    const plan = planLegacyReprojection(state);
    const k = plan.report.kinds.source;
    expect(k.legacyRows).toBe(k.orphanedLegacyRows + k.duplicateLegacyRows + k.distinctLinks);
    expect(k.distinctLinks).toBe(k.skippedNoAuthority + k.retained + k.removedLinks + k.conflicts);
    expect(k.authoritativeLinks).toBe(k.retained + k.inserted);
    expect(k).toMatchObject({ legacyRows: 6, orphanedLegacyRows: 1, duplicateLegacyRows: 1, distinctLinks: 4, skippedNoAuthority: 1, retained: 1, removedLinks: 1, conflicts: 1, inserted: 2 });
  });

  it("anomaly samples are bounded but the counts are exact", () => {
    const rows = Array.from({ length: SAMPLE_LIMIT + 5 }, (_, i) => legacyRow(`o${i}`, `NOPE${i}`, "a"));
    const plan = planLegacyReprojection(input({ ...base, ...sources([], rows) }));
    const orphan = plan.report.anomalies.find((a) => a.code === "ORPHANED_LEGACY_LINK");
    expect(orphan?.count).toBe(SAMPLE_LIMIT + 5);
    expect(orphan?.samples).toHaveLength(SAMPLE_LIMIT);
  });
});

describe("determinism, fingerprint, idempotence", () => {
  const state = input({
    recordings: [recording("R2", "P2", null), recording("R1", "P1", null)],
    revisions: [revision("P1", "R1", "PUBLISHED"), revision("P2", "R2", "PUBLISHED")],
    ...sources([link("P1", "a"), link("P2", "b"), link("P2", "c")], [legacyRow("z", "R1", "gone"), legacyRow("y", "R2", "b")], [proof("P1", "gone", "R1", "PUBLISHED")]),
  });

  it("the plan does not depend on the order of the input rows, and has a stable fingerprint", () => {
    const shuffled = input({
      recordings: [...state.recordings].reverse(),
      revisions: [...state.revisions].reverse(),
      revisionLinks: { ...state.revisionLinks, source: [...state.revisionLinks.source].reverse() },
      legacy: { ...state.legacy, source: [...state.legacy.source].reverse() },
      detached: state.detached,
    });
    const a = planLegacyReprojection(state);
    const b = planLegacyReprojection(shuffled);
    expect(b.fingerprint).toBe(a.fingerprint);
    expect(b.inserts).toEqual(a.inserts);
    expect(b.removals).toEqual(a.removals);
    expect(a.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a different plan has a different fingerprint", () => {
    const changed = input({ ...state, legacy: { ...state.legacy, source: [...state.legacy.source, legacyRow("extra", "R1", "a")] } });
    expect(planLegacyReprojection(changed).fingerprint).not.toBe(planLegacyReprojection(state).fingerprint);
  });

  it("applying the plan and planning again gives an empty plan (idempotent)", () => {
    const first = planLegacyReprojection(state);
    expect(first.inserts.length + first.removals.length).toBeGreaterThan(0);
    const second = planLegacyReprojection(apply(state, first));
    expect(second.inserts).toEqual([]);
    expect(second.removals).toEqual([]);
  });

  it("conflicts change the fingerprint (so a plan with a conflict cannot be confused with a clean one)", () => {
    const withConflict = input({ ...state, legacy: { ...state.legacy, source: [...state.legacy.source, legacyRow("m", "R1", "mystery")] } });
    expect(planLegacyReprojection(withConflict).blocking).toHaveLength(1);
    expect(planLegacyReprojection(withConflict).fingerprint).not.toBe(planLegacyReprojection(state).fingerprint);
  });
});

describe("report", () => {
  it("states the contract's numbers, labels blocking conflicts, shows the fingerprint, and holds ids only", () => {
    const plan = planLegacyReprojection(
      input({ recordings: [recording("R1", "P1", null)], revisions: [revision("P1", "R1", "PUBLISHED")], ...sources([link("P1", "a")], [legacyRow("m", "R1", "mystery")]) })
    );
    const text = formatReprojectionReport(plan, "DRY RUN");
    expect(text).toMatch(/DRY RUN \(no writes\)/);
    expect(text).toMatch(/LEGACY_LINK_NOT_IN_REVISION_SET: 1.*BLOCKS --execute/);
    expect(text).toContain(`Plan fingerprint: ${plan.fingerprint}`);
    expect(text).not.toMatch(/postgres(ql)?:\/\//i);
    expect(BLOCKING_ANOMALIES).toContain("LEGACY_LINK_NOT_IN_REVISION_SET");
  });
});
