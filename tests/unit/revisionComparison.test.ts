import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { compareRevisions, describeSummary, normaliseValue, type RevisionSnapshot, type SnapshotItem } from "../../modules/mmke/recordingPreview/revisionComparison";

// Draft-versus-published comparison: the pure semantics, and the source-level guarantees that the preview is read-only and leaves publishing alone.

const item = (id: string, label = id, extra: Partial<SnapshotItem> = {}): SnapshotItem => ({ id, label, ...extra });
const snapshot = (over: Partial<RevisionSnapshot> = {}): RevisionSnapshot => ({
  revisionId: "rev",
  title: null,
  description: null,
  seoMetaTitle: null,
  seoMetaDescription: null,
  seoCanonicalPath: null,
  difficultyLevel: null,
  listeningGuide: null,
  analysis: null,
  programme: null,
  venue: null,
  performanceDate: null,
  works: [],
  performers: [],
  choirs: [],
  conductors: [],
  media: [],
  sources: [],
  rights: [],
  occasions: [],
  ...over,
});
const field = (c: ReturnType<typeof compareRevisions>, key: string) => c.fields.find((f) => f.key === key)!;
const list = (c: ReturnType<typeof compareRevisions>, key: string) => c.lists.find((l) => l.key === key)!;

describe("normaliseValue", () => {
  it("treats empty, blank and missing as no value, and ignores line-ending and edge-whitespace differences", () => {
    expect(normaliseValue(null)).toBeNull();
    expect(normaliseValue("")).toBeNull();
    expect(normaliseValue("  \n ")).toBeNull();
    expect(normaliseValue("  a\r\nb  ")).toBe("a\nb");
  });
});

describe("an update: published revision versus the open draft", () => {
  const published = snapshot({ revisionId: "pub", title: "Messiah", description: "Old text", programme: "Advent", venue: "St Mary's", works: [item("w1"), item("w2")], sources: [item("s1", "Programme book")], occasions: [item("o1", "Advent")] });
  const proposed = snapshot({ revisionId: "draft", title: "Messiah (1998)", description: null, programme: "Advent", venue: "St Mary's", works: [item("w1"), item("w2")], sources: [item("s2", "Review")], occasions: [item("o1", "Advent")], listeningGuide: "Listen for the chorus" });
  const result = compareRevisions(published, proposed);

  it("is an UPDATE comparison naming both revisions", () => {
    expect(result).toMatchObject({ mode: "UPDATE", publishedRevisionId: "pub", proposedRevisionId: "draft" });
  });

  it("distinguishes changed, removed and added fields, and leaves unchanged ones unchanged", () => {
    expect(field(result, "title")).toMatchObject({ published: "Messiah", proposed: "Messiah (1998)", change: "CHANGED" });
    expect(field(result, "description")).toMatchObject({ published: "Old text", proposed: null, change: "REMOVED" });
    expect(field(result, "listeningGuide")).toMatchObject({ published: null, proposed: "Listen for the chorus", change: "ADDED" });
    expect(field(result, "programme").change).toBe("UNCHANGED");
    expect(field(result, "seoMetaTitle").change).toBe("UNCHANGED"); // empty on both sides is no change
  });

  it("reports added and removed relationships by identity, and keeps unchanged ones", () => {
    const sources = list(result, "sources");
    expect(sources.items.map((i) => `${i.change}:${i.id}`).sort()).toEqual(["ADDED:s2", "REMOVED:s1"]);
    expect(sources).toMatchObject({ added: 1, removed: 1, changed: 0, unchanged: 0 });
    expect(list(result, "occasions")).toMatchObject({ added: 0, removed: 0, unchanged: 1 });
  });

  it("summarises what visitors would see change", () => {
    expect(result.summary).toMatchObject({ changedFields: 3, addedItems: 1, removedItems: 1, changedItems: 0, reorderedLists: 0, hasChanges: true });
    expect(describeSummary(result)).toBe("Publishing will change what visitors see: 3 fields changed, 1 item added, 1 item removed.");
  });
});

describe("what counts as a difference", () => {
  it("ignores whitespace and line-ending noise, and a label change when the identity is the same", () => {
    const result = compareRevisions(snapshot({ revisionId: "a", title: "Messiah", description: "Line one\r\nLine two ", sources: [item("s1", "Old label")] }), snapshot({ revisionId: "b", title: " Messiah ", description: "Line one\nLine two", sources: [item("s1", "New label")] }));
    expect(result.summary.hasChanges).toBe(false);
    expect(describeSummary(result)).toMatch(/identical to the published version/);
  });

  it("reports a changed detail on the same item (a media URL) as CHANGED with the earlier and new value", () => {
    const result = compareRevisions(snapshot({ revisionId: "a", media: [item("m1", "video", { detail: "https://old.example/v" })] }), snapshot({ revisionId: "b", media: [item("m1", "video", { detail: "https://new.example/v" })] }));
    expect(list(result, "media").items[0]).toMatchObject({ change: "CHANGED", was: "https://old.example/v", now: "https://new.example/v" });
    expect(result.summary.changedItems).toBe(1);
  });

  it("reports a reordering of the works (order is content) but not of unordered lists", () => {
    const ordered = compareRevisions(snapshot({ revisionId: "a", works: [item("w1"), item("w2"), item("w3")] }), snapshot({ revisionId: "b", works: [item("w3"), item("w1"), item("w2")] }));
    expect(list(ordered, "works")).toMatchObject({ reordered: true, added: 0, removed: 0 });
    expect(ordered.summary).toMatchObject({ reorderedLists: 1, hasChanges: true });
    const unordered = compareRevisions(snapshot({ revisionId: "a", performers: [item("p1"), item("p2")] }), snapshot({ revisionId: "b", performers: [item("p2"), item("p1")] }));
    expect(list(unordered, "performers").reordered).toBe(false);
    expect(unordered.summary.hasChanges).toBe(false);
  });

  it("carries a note about the proposed item (for example an unapproved source) without treating it as a change", () => {
    const result = compareRevisions(snapshot({ revisionId: "a", sources: [item("s1")] }), snapshot({ revisionId: "b", sources: [item("s1", "s1", { note: "Not approved" })] }));
    expect(list(result, "sources").items[0]).toMatchObject({ change: "UNCHANGED", note: "Not approved" });
    expect(result.summary.hasChanges).toBe(false);
  });

  it("is deterministic and does not modify its inputs", () => {
    const a = snapshot({ revisionId: "a", title: "x", sources: [item("s1")] });
    const b = snapshot({ revisionId: "b", title: "y", sources: [item("s2")] });
    const before = JSON.stringify([a, b]);
    expect(JSON.stringify(compareRevisions(a, b))).toBe(JSON.stringify(compareRevisions(a, b)));
    expect(JSON.stringify([a, b])).toBe(before);
  });
});

describe("a first publication", () => {
  const proposed = snapshot({ revisionId: "draft", title: "Messiah", venue: "St Mary's", works: [item("w1", "Messiah — Handel")], sources: [item("s1", "Programme book")], rights: [item("r1", "Choir")] });
  const result = compareRevisions(null, proposed);

  it("is its own mode: nothing is 'removed' or 'changed', every filled value is NEW (added)", () => {
    expect(result).toMatchObject({ mode: "FIRST_PUBLICATION", publishedRevisionId: null, proposedRevisionId: "draft" });
    expect(field(result, "title")).toMatchObject({ published: null, proposed: "Messiah", change: "ADDED" });
    expect(field(result, "description").change).toBe("UNCHANGED"); // empty stays empty: not shown as a change
    expect(result.summary.removedItems).toBe(0);
    expect(result.summary.changedItems).toBe(0);
    for (const l of result.lists) for (const i of l.items) expect(i.change).toBe("ADDED");
    expect(result.lists.find((l) => l.key === "works")!.reordered).toBe(false);
  });

  it("says what will go live, not what changed", () => {
    expect(describeSummary(result)).toBe("First publication: nothing is public yet. Publishing makes 2 filled-in fields and 3 linked items public.");
  });
});

describe("source-level guarantees", () => {
  const root = path.resolve(__dirname, "../..");
  const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

  it("the comparison component renders no form, no action and no write: it is a read-only view", () => {
    const component = read("components/studio/RevisionComparison.tsx");
    expect(component).not.toMatch(/<form|action=|"use server"|<button|formAction/);
    expect(component).toMatch(/Public now/);
    expect(component).toMatch(/After publishing/);
  });

  it("the loader and the pure module contain no write: no create/update/delete/upsert, no raw execute, no audit write, no lifecycle call", () => {
    for (const file of ["modules/db/repositories/recordingRevisionComparisonRepository.ts", "modules/mmke/recordingPreview/revisionComparison.ts"]) {
      const code = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect(code, file).not.toMatch(/\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(|\$executeRaw|writeAuditLog|forkDraftFromPublished|publishRecordingDraft|publishCurrentDraft|\$transaction/);
    }
  });

  it("never reads the frozen legacy Recording-level rows (the static guard also forbids it everywhere under modules/)", () => {
    const loader = read("modules/db/repositories/recordingRevisionComparisonRepository.ts");
    expect(loader).not.toMatch(/entitySource|entityRights|entityOccasion|ForEntity\(/);
    expect(loader).toMatch(/listSourcesForRevision/);
    expect(loader).toMatch(/listRightsForRevision/);
    expect(loader).toMatch(/listOccasionsForRevision/);
  });

  it("the Review & Publish page keeps the existing, authorized publish action bound to the open draft, and places the preview before it", () => {
    const page = read("app/(studio)/studio/(protected)/recordings/[id]/review/page.tsx");
    expect(page).toMatch(/const canPublish = mayPublish && recording\.currentDraftRevisionId !== null && ready && recording\.status !== "ARCHIVED"/);
    expect(page).toMatch(/\{canPublish && \(\s*<form action=\{publishAction\.bind\(null, id, recording\.currentDraftRevisionId!\)\}>/);
    expect(page.indexOf("<RevisionComparison")).toBeGreaterThan(-1);
    expect(page.indexOf("<RevisionComparison")).toBeLessThan(page.indexOf("publishAction.bind"));
    expect(page).not.toMatch(/publishRecordingDraft|publishCurrentDraft/); // the page never publishes itself
  });
});
