import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { isRecordingPublished, isRecordingPubliclyVisible } from "../../modules/mmke/catalogue/isRecordingPublished";
import { classifyRecording } from "../../modules/mmke/occasionWorkspace/occasionConnections";
import { can } from "../../modules/auth/policy";

// Recording-level holds (project register R-20): the predicate, and source-level guarantees that enforcement lives in the canonical public readers, that the hold
// actions are authorized on the server, and that a hold can never change publication state or touch the legacy relationship rows.

const root = path.resolve(__dirname, "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");
const code = (relative: string) => read(relative).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("isRecordingPubliclyVisible", () => {
  const base = { status: "PUBLISHED" as const, currentPublishedRevisionId: "rev" };

  it("is published AND not held; a hold never changes what 'published' means", () => {
    expect(isRecordingPubliclyVisible({ ...base, holdReason: null })).toBe(true);
    expect(isRecordingPubliclyVisible({ ...base, holdReason: "RIGHTS" })).toBe(false);
    expect(isRecordingPubliclyVisible({ ...base, holdReason: "OTHER" })).toBe(false);
    // publication state is untouched by the hold
    expect(isRecordingPublished(base)).toBe(true);
  });

  it("an unpublished or pointer-less recording is not visible whether or not it is held (lifting a hold never publishes)", () => {
    for (const holdReason of [null, "COPYRIGHT"]) {
      expect(isRecordingPubliclyVisible({ status: "DRAFT", currentPublishedRevisionId: "rev", holdReason })).toBe(false);
      expect(isRecordingPubliclyVisible({ status: "IN_REVIEW", currentPublishedRevisionId: null, holdReason })).toBe(false);
      expect(isRecordingPubliclyVisible({ status: "ARCHIVED", currentPublishedRevisionId: "rev", holdReason })).toBe(false);
      expect(isRecordingPubliclyVisible({ status: "PUBLISHED", currentPublishedRevisionId: null, holdReason })).toBe(false);
    }
  });
});

describe("the Occasion workspace explains a held recording", () => {
  it("a held, published recording is EXCLUDED with the hold as the reason (not 'not determined')", () => {
    const r = classifyRecording({ visible: false, via: "PUBLISHED_REVISION", recordingStatus: "PUBLISHED", publishedRevisionCarries: true, draftRevisionCarries: false, held: true });
    expect(r).toMatchObject({ status: "EXCLUDED", reason: expect.stringMatching(/Recording hold/) });
  });
});

describe("enforcement is in the canonical readers, not in the UI", () => {
  it("every public reader of Recordings asks the hold-aware predicate or fragment", () => {
    const readers: Record<string, RegExp> = {
      "modules/db/repositories/recordingRepository.ts": /isRecordingPubliclyVisible/,
      "modules/db/repositories/archiveSearchRepository.ts": /RECORDING_NOT_HELD_WHERE[\s\S]*isRecordingPubliclyVisible/,
      "modules/db/repositories/sitemapRepository.ts": /PUBLIC_RECORDING_WHERE[\s\S]*isRecordingPubliclyVisible/,
      "modules/db/repositories/entityRelationshipsRepository.ts": /RECORDING_NOT_HELD_WHERE[\s\S]*isRecordingPubliclyVisible/,
      "modules/db/repositories/learningGuideRepository.ts": /holdReason: true[\s\S]*isRecordingPubliclyVisible/,
      "modules/db/repositories/mediaResourceRepository.ts": /holdReason: true[\s\S]*isRecordingPubliclyVisible/,
      "modules/db/repositories/occasionPageRepository.ts": /RECORDING_NOT_HELD_WHERE[\s\S]*isRecordingPubliclyVisible/,
      "modules/db/repositories/occasionWorkspaceRepository.ts": /isRecordingPubliclyVisible/,
    };
    for (const [file, pattern] of Object.entries(readers)) expect(code(file), file).toMatch(pattern);
  });

  it("the shared eligibility fragments are hold-aware, so a held recording also stops lifting its performance, venue, work and composer into discovery", () => {
    const eligibility = code("modules/db/repositories/publicEligibility.ts");
    expect(eligibility).toMatch(/RECORDING_NOT_HELD_WHERE\s*=\s*\{\s*holdReason:\s*null\s*\}/);
    expect(eligibility).toMatch(/PUBLISHED_REVISION_WHERE[^=]*=\s*\{\s*currentPublishedOf:\s*\{\s*is:\s*\{\s*status:\s*"PUBLISHED",\s*\.\.\.RECORDING_NOT_HELD_WHERE/);
  });

  it("nothing public still uses the publication-only predicate: the remaining callers are Studio-internal workflow, plus the visibility workspace itself", () => {
    const allowed = new Set([
      "modules/mmke/catalogue/isRecordingPublished.ts",
      "modules/mmke/recordingVisibility/recordingVisibility.ts",
      "modules/db/repositories/editorialQueueRepository.ts",
      "modules/mmke/contentIntelligence/editorialOperationsQueue.ts",
      "app/(studio)/studio/(protected)/content-suggestions/page.tsx",
    ]);
    const users: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(path.join(root, dir))) {
        const relative = `${dir}/${name}`;
        if (statSync(path.join(root, relative)).isDirectory()) walk(relative);
        else if (/\.(ts|tsx)$/.test(name) && /\bisRecordingPublished\(/.test(code(relative))) users.push(relative);
      }
    };
    for (const dir of ["app", "modules", "components"]) walk(dir);
    expect(users.filter((u) => !allowed.has(u))).toEqual([]);
  });
});

describe("the hold actions and repository", () => {
  const actions = code("app/(studio)/studio/(protected)/recordings/[id]/review/actions.ts");

  it("both actions require RECORDING_PUBLISH on the server before touching the repository", () => {
    for (const name of ["imposeHoldAction", "liftHoldAction"]) {
      const body = actions.slice(actions.indexOf(`export async function ${name}`));
      const end = body.indexOf("export async function", 10);
      const fn = end === -1 ? body : body.slice(0, end);
      expect(fn.indexOf('can(session.user.role, "RECORDING_PUBLISH")'), name).toBeGreaterThan(-1);
      expect(fn.indexOf("!session"), name).toBeLessThan(fn.search(/imposeRecordingHold\(|liftRecordingHold\(/));
      expect(fn.indexOf('can(session.user.role, "RECORDING_PUBLISH")'), name).toBeLessThan(fn.search(/imposeRecordingHold\(|liftRecordingHold\(/));
    }
  });

  it("the repository writes ONLY the four hold columns and the audit entry: no status, pointer, revision, relationship or legacy write", () => {
    const repo = code("modules/db/repositories/recordingHoldRepository.ts");
    expect(repo).not.toMatch(/status\s*:|currentPublishedRevisionId|currentDraftRevisionId|recordingRevision|entitySource|entityRights|entityOccasion|recordingRevisionOccasion|recordingRevisionSource|recordingRevisionRights|\.create\(|\.createMany\(|\.delete\(|\.deleteMany\(/);
    expect(repo).toMatch(/RECORDING_HOLD_SET/);
    expect(repo).toMatch(/RECORDING_HOLD_LIFTED/);
    expect(repo).toMatch(/withRecordingEditLock/);
    expect((repo.match(/writeAuditLog\(/g) ?? []).length).toBe(2);
  });

  it("the review page shows the controls only to a user who may publish, and hands the server actions their permission check regardless", () => {
    const page = read("app/(studio)/studio/(protected)/recordings/[id]/review/page.tsx");
    expect(page).toMatch(/canManage=\{mayPublish\}/);
    expect(page).toMatch(/impose=\{imposeHoldAction\.bind\(null, id\)\}/);
    expect(page).toMatch(/lift=\{liftHoldAction\.bind\(null, id\)\}/);
  });
});

describe("who may do what with a Recording hold", () => {
  it("only roles that may publish can impose or lift a hold (the same permission as a video hold and as publish/unpublish/archive)", () => {
    const allowed = ["ADMINISTRATOR", "SUPER_ADMINISTRATOR", "FOUNDER"] as const;
    const refused = ["CONTRIBUTOR", "EDITOR", "REVIEWER"] as const;
    for (const role of allowed) expect(can(role, "RECORDING_PUBLISH"), role).toBe(true);
    for (const role of refused) expect(can(role, "RECORDING_PUBLISH"), role).toBe(false);
  });

  it("hold NOTES are for those roles only: the loader drops them unless told otherwise, and both pages pass the permission, never a constant", () => {
    const loader = code("modules/db/repositories/recordingVisibilityRepository.ts");
    expect(loader).toMatch(/includeHoldNotes\?:\s*boolean/);
    expect(loader).toMatch(/note:\s*input\.includeHoldNotes === true \? row\.holdNote : null/); // secure by default: only an explicit true shows it
    const workspace = code("app/(studio)/studio/(protected)/recordings/visibility/page.tsx");
    expect(workspace).toMatch(/includeHoldNotes:\s*can\(session\.user\.role,\s*"RECORDING_PUBLISH"\)/);
    const review = code("app/(studio)/studio/(protected)/recordings/[id]/review/page.tsx");
    expect(review).toMatch(/note:\s*mayPublish \? recording\.holdNote : null/);
    expect(review).toMatch(/const mayPublish = can\(session\.user\.role, "RECORDING_PUBLISH"\)/);
  });

  it("nothing else reads a Recording's hold note: not a public reader, not the Occasion workspace, not the Recordings list", () => {
    for (const file of [
      "modules/db/repositories/recordingRepository.ts",
      "modules/db/repositories/archiveSearchRepository.ts",
      "modules/db/repositories/sitemapRepository.ts",
      "modules/db/repositories/entityRelationshipsRepository.ts",
      "modules/db/repositories/learningGuideRepository.ts",
      "modules/db/repositories/mediaResourceRepository.ts",
      "modules/db/repositories/occasionPageRepository.ts",
      "modules/db/repositories/occasionWorkspaceRepository.ts",
      "modules/db/repositories/publicEligibility.ts",
      "app/(studio)/studio/(protected)/recordings/page.tsx",
    ]) {
      expect(code(file), file).not.toMatch(/holdNote/);
    }
  });
});