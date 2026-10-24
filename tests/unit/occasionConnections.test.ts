import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  KIND_LABEL,
  STATUS_LABEL,
  classifyCollection,
  classifyPerformance,
  classifyProgramme,
  classifyRecording,
  sortConnections,
  summarisePublicPage,
  underArchivedOccasion,
  type ConnectedItem,
} from "../../modules/mmke/occasionWorkspace/occasionConnections";

// The Occasion workspace's classification: visibility arrives as a fact from the database (the public page's own fragments); these rules only explain a "no",
// and answer "not determined" rather than guess. Plus source-level guarantees that the workspace is read-only and gated.

const perf = { visible: false, archived: false, programmeArchived: false, venueArchived: false, hasPublishedRecording: true };

describe("performances", () => {
  it("visible is visible; each reason for 'no' is named, most specific first", () => {
    expect(classifyPerformance({ ...perf, visible: true }).status).toBe("VISIBLE");
    expect(classifyPerformance({ ...perf, archived: true })).toMatchObject({ status: "ARCHIVED", reason: expect.stringMatching(/archived performance is never public/) });
    expect(classifyPerformance({ ...perf, programmeArchived: true })).toMatchObject({ status: "EXCLUDED", reason: expect.stringMatching(/programme is archived/) });
    expect(classifyPerformance({ ...perf, venueArchived: true })).toMatchObject({ status: "EXCLUDED", reason: expect.stringMatching(/venue is archived/) });
    expect(classifyPerformance({ ...perf, hasPublishedRecording: false })).toMatchObject({ status: "DRAFT", reason: expect.stringMatching(/no published recording/) });
  });

  it("says 'not determined' when the facts give no reason, and never calls an unexplained item draft or archived", () => {
    expect(classifyPerformance(perf)).toMatchObject({ status: "UNKNOWN", reason: expect.stringMatching(/^Not determined/) });
  });

  it("trusts the database's verdict over the facts: a visible item is visible even if a fact looks like an obstacle", () => {
    expect(classifyPerformance({ ...perf, visible: true, archived: true, hasPublishedRecording: false }).status).toBe("VISIBLE");
  });
});

describe("programmes and collections", () => {
  it("programme: visible, archived, or (not archived, not visible) simply no public performance yet", () => {
    expect(classifyProgramme({ visible: true, archived: false }).status).toBe("VISIBLE");
    expect(classifyProgramme({ visible: false, archived: true }).status).toBe("ARCHIVED");
    expect(classifyProgramme({ visible: false, archived: false })).toMatchObject({ status: "DRAFT", reason: expect.stringMatching(/none of its performances is public/) });
  });

  it("collection: visible, archived, draft, otherwise not determined", () => {
    expect(classifyCollection({ visible: true, published: true, archived: false }).status).toBe("VISIBLE");
    expect(classifyCollection({ visible: false, published: true, archived: true }).status).toBe("ARCHIVED");
    expect(classifyCollection({ visible: false, published: false, archived: false })).toMatchObject({ status: "DRAFT", reason: expect.stringMatching(/still a draft/) });
    expect(classifyCollection({ visible: false, published: true, archived: false }).status).toBe("UNKNOWN");
  });
});

describe("recordings (revision-scoped)", () => {
  const rec = { visible: false, via: "PUBLISHED_REVISION" as const, recordingStatus: "PUBLISHED", publishedRevisionCarries: false, draftRevisionCarries: false };

  it("visible through its published revision, or through a listed performance, each said differently", () => {
    expect(classifyRecording({ ...rec, visible: true, publishedRevisionCarries: true })).toMatchObject({ status: "VISIBLE", reason: expect.stringMatching(/published revision carries this occasion/) });
    expect(classifyRecording({ ...rec, visible: true, via: "VIA_PERFORMANCE" })).toMatchObject({ status: "VISIBLE", reason: expect.stringMatching(/recording of a performance listed/) });
  });

  it("a link that exists only in the open draft is DRAFT: public only after that draft is published", () => {
    expect(classifyRecording({ ...rec, draftRevisionCarries: true, via: "DRAFT_REVISION_ONLY" })).toMatchObject({ status: "DRAFT", reason: expect.stringMatching(/only in the open draft revision/) });
  });

  it("an archived recording is archived; an unpublished recording whose published revision carries it is excluded with its status; an older-revision-only link is excluded", () => {
    expect(classifyRecording({ ...rec, recordingStatus: "ARCHIVED", publishedRevisionCarries: true }).status).toBe("ARCHIVED");
    expect(classifyRecording({ ...rec, recordingStatus: "DRAFT", publishedRevisionCarries: true })).toMatchObject({ status: "EXCLUDED", reason: expect.stringMatching(/not published \(status DRAFT\)/) });
    expect(classifyRecording({ ...rec, onlyOlderRevisionCarries: true, via: "OLDER_REVISION_ONLY" })).toMatchObject({ status: "EXCLUDED", reason: expect.stringMatching(/older revision/) });
    expect(classifyRecording(rec).status).toBe("UNKNOWN");
  });
});

describe("the occasion's own page", () => {
  it("an archived occasion has no page: every item's own verdict is kept as context", () => {
    const own = classifyCollection({ visible: true, published: true, archived: false });
    expect(underArchivedOccasion(own)).toMatchObject({ status: "OCCASION_ARCHIVED", reason: expect.stringContaining("no public page") });
    expect(underArchivedOccasion(own).reason).toContain(own.reason);
  });

  it("summarises: archived, public with a count, nothing attached, or attached but nothing public", () => {
    expect(summarisePublicPage({ occasionArchived: true, linked: 3, visible: 3 })).toMatchObject({ state: "NOT_PUBLIC", reason: expect.stringMatching(/archived/) });
    expect(summarisePublicPage({ occasionArchived: false, linked: 3, visible: 2 })).toEqual({ state: "PUBLIC", reason: "The public page exists and lists 2 items." });
    expect(summarisePublicPage({ occasionArchived: false, linked: 1, visible: 1 }).reason).toMatch(/lists 1 item\./);
    expect(summarisePublicPage({ occasionArchived: false, linked: 0, visible: 0 })).toMatchObject({ state: "NOT_PUBLIC", reason: expect.stringMatching(/nothing is attached/) });
    expect(summarisePublicPage({ occasionArchived: false, linked: 2, visible: 0 })).toMatchObject({ state: "NOT_PUBLIC", reason: expect.stringMatching(/draft, archived or otherwise not public/) });
  });

  it("labels every status and kind, and sorts visible first, then drafts, deterministically", () => {
    expect(Object.keys(STATUS_LABEL).sort()).toEqual(["ARCHIVED", "DRAFT", "EXCLUDED", "OCCASION_ARCHIVED", "UNKNOWN", "VISIBLE"]);
    expect(Object.keys(KIND_LABEL).sort()).toEqual(["COLLECTION", "PERFORMANCE", "PROGRAMME", "RECORDING"]);
    const item = (id: string, status: ConnectedItem["status"], kind: ConnectedItem["kind"] = "PROGRAMME", label = id): ConnectedItem => ({ id, kind, label, via: "DIRECT", status, reason: "", studioHref: null, manageHref: null, publicHref: null, detail: null });
    const sorted = sortConnections([item("a", "ARCHIVED"), item("b", "DRAFT"), item("c", "VISIBLE", "RECORDING"), item("d", "VISIBLE", "COLLECTION"), item("e", "UNKNOWN")]);
    expect(sorted.map((i) => i.id)).toEqual(["d", "c", "b", "a", "e"]);
    expect(sortConnections([...sorted].reverse()).map((i) => i.id)).toEqual(sorted.map((i) => i.id));
  });
});

describe("source-level guarantees", () => {
  const root = path.resolve(__dirname, "../..");
  const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");
  const code = (relative: string) => read(relative).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("the workspace view is read-only: no form, button, action or write in the component, the loader or the classifier", () => {
    expect(code("components/studio/OccasionConnections.tsx")).not.toMatch(/<form|<button|action=|"use server"|formAction/);
    for (const file of ["modules/db/repositories/occasionWorkspaceRepository.ts", "modules/mmke/occasionWorkspace/occasionConnections.ts"]) {
      expect(code(file), file).not.toMatch(/\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(|\$executeRaw|\$queryRaw|writeAuditLog|\$transaction/);
    }
  });

  it("the loader reuses the public page's own eligibility fragments and never reads the frozen legacy rows", () => {
    const loader = code("modules/db/repositories/occasionWorkspaceRepository.ts");
    for (const reused of ["eligiblePerformanceWhere", "eligibleProgrammeWhere", "PUBLIC_COLLECTION_WHERE", "PUBLISHED_REVISION_WHERE", "isRecordingPubliclyVisible"]) expect(loader).toContain(reused);
    expect(loader).not.toMatch(/entitySource|entityRights|entityOccasion|ForEntity\(/);
    expect(loader).toContain("recordingRevisionOccasion");
  });

  it("the Occasion page loads the workspace only after the signed-in check, edits stay on the existing CATALOGUE_WRITE-gated actions, and no new action was added", () => {
    const page = read("app/(studio)/studio/(protected)/catalogue/occasions/[id]/page.tsx");
    expect(page.indexOf("if (!session) redirect(")).toBeGreaterThan(-1);
    expect(page.indexOf("if (!session) redirect(")).toBeLessThan(page.indexOf("loadOccasionWorkspace(occasion.id)"));
    expect(page).toMatch(/can\(session\.user\.role, "CATALOGUE_WRITE"\)/);
    expect(page).toMatch(/updateOccasionAction\.bind\(null, occasion\.id\)/);
    const actions = read("app/(studio)/studio/(protected)/catalogue/occasions/[id]/actions.ts");
    expect([...actions.matchAll(/export async function (\w+)/g)].map((m) => m[1]).sort()).toEqual(["archiveOccasionAction", "restoreOccasionAction", "updateOccasionAction"]);
    expect(actions.match(/can\(session\.user\.role, "CATALOGUE_WRITE"\)/g)).toHaveLength(3);
  });

  it("a failure to load shows a generic message, never the database's", () => {
    const page = read("app/(studio)/studio/(protected)/catalogue/occasions/[id]/page.tsx");
    expect(page).toMatch(/could not be loaded just now/);
    expect(page).toMatch(/err instanceof Error \? err\.name : "unknown error"/);
  });
});
