import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

// Phase 6L — the STATIC GUARD of the relationship cutover. A Recording's Source, Rights and Occasion links are revision-scoped; the legacy
// Recording-level rows (entity_sources / entity_rights / entity_occasions, entityType "RECORDING") are frozen history. Nothing in app/, modules/,
// components/ or scripts/ may read them or write them, except the code that is meant to: the three generic repositories (which carry the write
// guard), the backfill and re-projection tools (guarded to the isolated test database), and the guard module itself.
//
// This is deliberately a source scan, like the Collection-membership guard of Phase 6J-12A: a new caller added later fails here, in CI, instead of
// quietly reintroducing a live path around the draft/publish workflow. Tests are not scanned (they seed legacy rows on purpose).

const root = path.resolve(__dirname, "../..");
const SCANNED = ["app", "modules", "components", "scripts"];

/** Files that may touch the legacy tables directly. Anything else is a violation. */
const MAY_TOUCH_LEGACY_TABLES = [
  "modules/db/repositories/sourceRepository.ts",
  "modules/db/repositories/rightsInformationRepository.ts",
  "modules/db/repositories/occasionRepository.ts",
  "modules/mmke/provenance/legacyRecordingRelationshipsFrozen.ts",
  "modules/backfill/legacyReprojection/reprojectionDatabase.ts",
  "modules/backfill/legacyReprojection/reprojectionPlan.ts",
  "modules/backfill/revisionRelationships/backfillDatabase.ts",
  "modules/backfill/revisionRelationships/backfillPlan.ts",
  "scripts/reprojectLegacyRelationships.ts",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

/** Source with comments removed, so prose that merely mentions a table is not a violation. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

export interface Violation {
  rule: "LEGACY_CALL_FOR_RECORDING" | "LEGACY_TABLE_ACCESS";
  excerpt: string;
}

const LEGACY_FUNCTIONS = "(?:list(?:Sources|ApprovedSources|Rights|Occasions)ForEntity|attach(?:Source|RightsInformation|Occasion)ToEntity|detach(?:Source|RightsInformation|Occasion)FromEntity)";
const CALL_FOR_RECORDING = new RegExp(`${LEGACY_FUNCTIONS}\\(\\s*(?:\\{[^}]*?entityType\\s*:\\s*)?["'\`]RECORDING["'\`]`);
const TABLE_ACCESS = /\.(?:entitySource|entityRights|entityOccasion)\b|\bentity_(?:sources|rights|occasions)\b/;

export function findViolations(source: string, relativePath: string): Violation[] {
  const code = stripComments(source);
  const found: Violation[] = [];
  const call = CALL_FOR_RECORDING.exec(code);
  if (call) found.push({ rule: "LEGACY_CALL_FOR_RECORDING", excerpt: call[0].slice(0, 80) });
  const table = TABLE_ACCESS.exec(code);
  if (table && !MAY_TOUCH_LEGACY_TABLES.includes(relativePath)) found.push({ rule: "LEGACY_TABLE_ACCESS", excerpt: table[0] });
  return found;
}

describe("the guard itself detects what it is meant to detect", () => {
  it("flags a legacy read or write for a Recording, in either call style", () => {
    expect(findViolations('await attachSourceToEntity({ entityType: "RECORDING", entityId: id, sourceId, actorId });', "app/x.ts")).toHaveLength(1);
    expect(findViolations('await detachOccasionFromEntity("RECORDING", id, occasionId, actor);', "app/x.ts")).toHaveLength(1);
    expect(findViolations('const a = await listApprovedSourcesForEntity("RECORDING", r.id);', "modules/x.ts")).toHaveLength(1);
    expect(findViolations("listRightsForEntity(`RECORDING`, id)", "modules/x.ts")).toHaveLength(1);
    expect(findViolations('await attachRightsInformationToEntity({\n  entityType: "RECORDING",\n  entityId })', "modules/x.ts")).toHaveLength(1);
  });

  it("does not flag the same functions for other entity types, or prose in comments", () => {
    expect(findViolations('await attachSourceToEntity({ entityType: "WORK", entityId: id, sourceId, actorId });', "app/x.ts")).toEqual([]);
    expect(findViolations('await listOccasionsForEntity("PERFORMANCE", p.id);', "modules/x.ts")).toEqual([]);
    expect(findViolations('// listSourcesForEntity("RECORDING", id) used to be here\nconst x = 1;', "modules/x.ts")).toEqual([]);
    expect(findViolations('/* prisma.entitySource.findMany for RECORDING */ const x = 1;', "modules/x.ts")).toEqual([]);
  });

  it("flags direct access to the legacy tables outside the allowed files, and allows it inside them", () => {
    expect(findViolations("await prisma.entitySource.findMany({});", "modules/db/repositories/somethingNew.ts")).toHaveLength(1);
    expect(findViolations("await tx.entityOccasion.deleteMany({});", "app/(studio)/x.ts")).toHaveLength(1);
    expect(findViolations('await sql`select * from entity_rights`;', "modules/x.ts")).toHaveLength(1);
    expect(findViolations("await prisma.entitySource.findMany({});", "modules/backfill/revisionRelationships/backfillDatabase.ts")).toEqual([]);
  });
});

describe("no code outside the allowed files reads or writes a Recording's legacy relationship rows", () => {
  const files = SCANNED.flatMap((dir) => walk(path.join(root, dir))).map((f) => ({ full: f, relative: path.relative(root, f).split(path.sep).join("/") }));

  it("scans a meaningful amount of code (the scan cannot silently pass on an empty tree)", () => {
    expect(files.length).toBeGreaterThan(200);
    for (const required of ["modules/db/repositories/recordingRelationshipReadersRepository.ts", "app/(studio)/studio/(protected)/recordings/[id]/relationships/actions.ts"]) {
      expect(files.map((f) => f.relative), required).toContain(required);
    }
  });

  it("finds no violation in app/, modules/, components/ or scripts/", () => {
    const violations = files.flatMap((f) => findViolations(readFileSync(f.full, "utf8"), f.relative).map((v) => `${f.relative}: ${v.rule} (${v.excerpt})`));
    expect(violations).toEqual([]);
  }, 60_000); // reads several hundred files; the default 5 s is not enough when the whole suite runs in parallel

  it("the Studio Relationships step is wired to the revision-scoped writers and the revision readers, not the generic ones", () => {
    const actions = readFileSync(path.join(root, "app/(studio)/studio/(protected)/recordings/[id]/relationships/actions.ts"), "utf8");
    const page = readFileSync(path.join(root, "app/(studio)/studio/(protected)/recordings/[id]/relationships/page.tsx"), "utf8");
    for (const fn of ["attachSourceToRevision", "detachSourceFromRevision", "attachRightsToRevision", "detachRightsFromRevision", "attachOccasionToRevision", "detachOccasionFromRevision"]) expect(actions).toContain(fn);
    expect(actions).not.toMatch(/(attach|detach)\w*(To|From)Entity/);
    expect(actions).toMatch(/can\(session\.user\.role, "CATALOGUE_WRITE"\)/); // permission semantics preserved
    expect(page).toContain("loadRecordingRelationshipWorkspace");
    expect(page).not.toMatch(/list\w*ForEntity/);
  });

  it("the three readers of a Recording's links (Organisation page, AI context, Studio page) go through the revision readers", () => {
    const org = readFileSync(path.join(root, "modules/db/repositories/entityRelationshipsRepository.ts"), "utf8");
    const ai = readFileSync(path.join(root, "modules/db/repositories/recordingContextRepository.ts"), "utf8");
    expect(org).toContain("loadPublishedRecordingRelationships");
    expect(ai).toContain("sourceLinks");
    expect(ai).toContain("rightsLinks");
  });
});
