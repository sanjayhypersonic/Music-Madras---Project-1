import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Must be at the true top level — vi.mock is hoisted above every import.
const mockGetCurrentStudioSession = vi.fn();
vi.mock("../../modules/auth/authService", () => ({ getCurrentStudioSession: () => mockGetCurrentStudioSession() }));

import { prisma } from "../../modules/db/client";
import { applyApprovalReconciliation, planApprovalReconciliation } from "../../modules/db/repositories/approvalReconciliationRepository";
import { CARRIED_OVER_NOTIFICATION_KEY, confirmCarriedOverApprovals, listCarriedOverApprovals, syncCarriedOverNotification } from "../../modules/db/repositories/carriedOverApprovalsRepository";
import { UNLISTED_REVIEW_DEDUPE_KEY, runUnlistedReviewSweep, setReviewHold } from "../../modules/db/repositories/unlistedReviewRepository";
import { approveExposure, listActiveApprovals, listApprovalHistory, findApprovalFlagInconsistencies } from "../../modules/db/repositories/videoExposureRepository";
import { createDraftVideoPage, findPublishedBySlug, listPublishedVideoPages, publishVideoPage } from "../../modules/db/repositories/youtubeVideoPageRepository";
import { confirmCarriedOverAction, withdrawCarriedOverAction } from "../../app/(studio)/studio/(protected)/catalogue/unlisted-review/actions";

// F2 + F3 — carrying the old single approval over without delisting anything, the review path for those approvals, and the idempotent
// reconciliation procedure for approvals an earlier version recorded with the legacy flag only. Isolated test database, synthetic data only.

const TAG = randomUUID().slice(0, 8);
const T = 60000;
const users = {} as Record<"admin" | "editor" | "author", string>;
const roles = { admin: "ADMINISTRATOR", editor: "EDITOR", author: "EDITOR" } as const;
const videoIds: string[] = [];
const pageIds: string[] = [];
let counter = 0;
const LEGACY_AT = new Date("2026-03-01T10:00:00.000Z");

async function newPage(privacy: "public" | "unlisted" | "private" = "unlisted", opts: { publish?: boolean } = {}) {
  const video = await prisma.youTubeVideo.create({ data: { youtubeVideoId: `l${TAG}${++counter}`.slice(0, 11), title: `Legacy ${TAG} ${counter}`, privacyStatus: privacy, observabilityState: "OBSERVED" } });
  videoIds.push(video.id);
  const page = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: users.admin });
  if (opts.publish !== false) await publishVideoPage(page.id, users.admin);
  pageIds.push(page.id);
  return { video, page };
}

/** A pre-exposure-approval state: the flag only, written by an earlier version (last editor = "author"). */
async function legacyFlagOnly(pageId: string) {
  await prisma.youTubeVideoPage.update({ where: { id: pageId }, data: { unlistedPublicationApprovedAt: LEGACY_AT, updatedById: users.author } });
}

const listed = async (pageId: string) => (await listPublishedVideoPages(100_000)).some((p) => p.page.id === pageId);
const active = async (pageId: string) => ((await listActiveApprovals([pageId])).get(pageId) ?? []).map((a) => a.scope).sort();

const MIGRATION_2 = readFileSync(path.join(process.cwd(), "prisma", "migrations", "20261021110000_phase6k2_video_exposure_approvals_and_review", "migration.sql"), "utf8");
const MIGRATION_6 = readFileSync(path.join(process.cwd(), "prisma", "migrations", "20261021150000_phase6k_fix_carry_over_legacy_approvals", "migration.sql"), "utf8");
const MIGRATION_7 = readFileSync(path.join(process.cwd(), "prisma", "migrations", "20261022100000_phase6k_hardening_lifecycle_provenance", "migration.sql"), "utf8");

/** One SQL statement of a migration: from its first line to the next semicolon that ends a line (a semicolon inside a string never does). */
function statementFrom(sql: string, after: string, anchor: string): string {
  const start = sql.indexOf(anchor, sql.indexOf(after));
  if (start < 0) throw new Error(`statement not found: ${anchor}`);
  const end = /;\r?\n/.exec(sql.slice(start));
  if (!end) throw new Error(`statement is not terminated: ${anchor}`);
  return sql.slice(start, start + end.index + 1);
}
function restrictTo(statement: string, anchor: string, replacement: string): string {
  if (!statement.includes(anchor)) throw new Error(`anchor not found in statement: ${anchor}`);
  return statement.replace(anchor, replacement);
}

/** The REAL data statements of the lifecycle/provenance migration, limited to the given fixture pages. Run after migrations 2 and 6, as in a real rollout. */
async function runProvenanceSteps(pageIds: string[]) {
  const list = pageIds.map((id) => `'${id}'`).join(", ");
  const a = restrictTo(statementFrom(MIGRATION_7, "-- Data step a", 'UPDATE "video_exposure_approvals"'), `AND "approvedById" IS NOT NULL`, `AND "approvedById" IS NOT NULL AND "videoPageId" IN (${list})`);
  const b = restrictTo(statementFrom(MIGRATION_7, "-- Data step b", "WITH affected AS ("), `WHERE p."archivedAt" IS NOT NULL OR v."privacyStatus" = 'private'`, `WHERE p."id" IN (${list}) AND (p."archivedAt" IS NOT NULL OR v."privacyStatus" = 'private')`);
  const flag = restrictTo(statementFrom(MIGRATION_7, "-- The legacy flag is the cache", 'UPDATE "youtube_video_pages" p'), `WHERE p."unlistedPublicationApprovedAt" IS NOT NULL`, `WHERE p."id" IN (${list}) AND p."unlistedPublicationApprovedAt" IS NOT NULL`);
  const c = restrictTo(statementFrom(MIGRATION_7, "-- Data step c", "WITH revoked AS ("), `WHERE a."videoPageId" = p."id"`, `WHERE a."videoPageId" = p."id" AND a."videoPageId" IN (${list})`);
  for (const statement of [a, b, flag, c]) await prisma.$executeRawUnsafe(statement);
}

/**
 * Runs the REAL data statements of both migrations, limited to the given fixture pages (the statements are matched exactly, so a change to them fails here).
 * `ids` go through both migrations in order, as in a real rollout (the approvals table is brand new when migration 2 runs). `laterOnly` are pages that
 * already hold an editor's approval, which can only exist AFTER migration 2, so they meet migration 6's steps alone.
 */
async function runMigrationDataSteps(ids: string[], laterOnly: string[] = []) {
  const list = ids.map((id) => `'${id}'`).join(", ");
  const all = [...ids, ...laterOnly].map((id) => `'${id}'`).join(", ");
  const step2 = MIGRATION_2.slice(MIGRATION_2.indexOf("INSERT INTO"));
  expect(step2).toContain('WHERE p."unlistedPublicationApprovedAt" IS NOT NULL;');
  if (ids.length > 0) await prisma.$executeRawUnsafe(step2.replace('WHERE p."unlistedPublicationApprovedAt" IS NOT NULL;', `WHERE p."unlistedPublicationApprovedAt" IS NOT NULL AND p."id" IN (${list});`));

  const data = MIGRATION_6.slice(MIGRATION_6.indexOf("-- Data step 1"));
  const statements = data.split(/^-- Data step \d:.*$/m).map((s) => s.trim()).filter((s) => s.startsWith("UPDATE") || s.startsWith("INSERT"));
  expect(statements).toHaveLength(3);
  const [mark, preserve, audit] = statements;
  expect(mark).toContain(`WHERE "scope" = 'PAGE'`);
  expect(preserve).toContain(`WHERE a."origin" = 'MIGRATED_LEGACY'`);
  expect(audit).toContain(`WHERE a."origin" = 'MIGRATED_LEGACY';`);
  await prisma.$executeRawUnsafe(mark.replace(`WHERE "scope" = 'PAGE'`, `WHERE "videoPageId" IN (${all}) AND "scope" = 'PAGE'`));
  await prisma.$executeRawUnsafe(preserve.replace(`WHERE a."origin" = 'MIGRATED_LEGACY'`, `WHERE a."videoPageId" IN (${all}) AND a."origin" = 'MIGRATED_LEGACY'`));
  await prisma.$executeRawUnsafe(audit.replace(`WHERE a."origin" = 'MIGRATED_LEGACY';`, `WHERE a."videoPageId" IN (${all}) AND a."origin" = 'MIGRATED_LEGACY';`));
  // The lifecycle/provenance migration that follows them in a real rollout: no invented approver, nothing carried onto archived/private/draft pages.
  await runProvenanceSteps([...ids, ...laterOnly]);
}

const as = (who: keyof typeof users) => mockGetCurrentStudioSession.mockResolvedValue({ user: { id: users[who], role: roles[who], name: who, email: `${who}@example.test`, status: "ACTIVE" } });
async function redirectOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    const digest = (err as { digest?: unknown })?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) return decodeURIComponent(digest.split(";").slice(2, -2).join(";").replace(/\+/g, " "));
    throw err;
  }
  throw new Error("did not redirect");
}
const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(entries)) data.set(k, v);
  return data;
};

beforeAll(async () => {
  for (const who of Object.keys(roles) as (keyof typeof users)[]) {
    users[who] = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `x6kf2-${who}-${TAG}@musicmadras.test`, name: `Legacy ${who}`, role: roles[who], status: "ACTIVE" } })).id;
  }
}, T);

afterAll(async () => {
  await prisma.studioNotification.deleteMany({ where: { dedupeKey: { in: [CARRIED_OVER_NOTIFICATION_KEY, UNLISTED_REVIEW_DEDUPE_KEY] } } });
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityId: { in: [...pageIds, ...videoIds] } }, { actorId: { in: Object.values(users) } }] } });
  await prisma.youTubeVideoPage.deleteMany({ where: { id: { in: pageIds } } });
  await prisma.youTubeVideo.deleteMany({ where: { id: { in: videoIds } } });
  await prisma.studioUser.deleteMany({ where: { id: { in: Object.values(users) } } });
}, T);

describe("F2 — the migration keeps existing exposure and marks it", () => {
  it("a page that carried the legacy approval stays reachable AND listed; the carried-over approvals are marked, attributed and audited", async () => {
    const { page } = await newPage("unlisted");
    await legacyFlagOnly(page.id);
    await runMigrationDataSteps([page.id]);

    const history = await listApprovalHistory(page.id);
    expect(history.map((h) => h.scope).sort()).toEqual(["DISCOVERY", "PAGE"]);
    for (const row of history) {
      // No approver: the legacy flag recorded none, and the page's last editor is not evidence of who approved.
      expect(row).toMatchObject({ origin: "MIGRATED_LEGACY", approvedById: null, revokedAt: null, confirmedAt: null });
      expect(row.approvedAt.toISOString()).toBe(LEGACY_AT.toISOString()); // the original approval time is kept
      expect(row.note).toMatch(/Carried over from the legacy single approval flag.*recorded no approver.*Reconsider it in Studio/);
    }
    expect(await findPublishedBySlug(page.slug)).toMatchObject({ discoverable: true });
    expect(await listed(page.id)).toBe(true); // NOT silently delisted
    const audit = await prisma.auditLogEntry.findMany({ where: { entityId: page.id, action: "VIDEO_EXPOSURE_CARRIED_OVER" } });
    expect(audit).toHaveLength(2);
    expect(audit.every((a) => a.actorId === null)).toBe(true); // the platform did it, not a person
    expect(await findApprovalFlagInconsistencies()).toEqual({ flagWithoutApproval: [], approvalWithoutFlag: [] });
  }, T);

  it("grants nothing else: an unlisted video that was never approved, a public video, and an approval an editor made in Studio are untouched", async () => {
    const neverApproved = await newPage("unlisted");
    const publicVideo = await newPage("public");
    const editorApproved = await newPage("unlisted");
    await approveExposure({ videoPageId: editorApproved.page.id, scope: "PAGE", actorId: users.admin }); // page only, decided by an editor
    const flagged = await newPage("unlisted");
    await legacyFlagOnly(flagged.page.id);

    await runMigrationDataSteps([neverApproved.page.id, publicVideo.page.id, flagged.page.id], [editorApproved.page.id]);

    expect(await active(neverApproved.page.id)).toEqual([]);
    expect(await findPublishedBySlug(neverApproved.page.slug)).toBeNull();
    expect(await listed(neverApproved.page.id)).toBe(false);
    expect(await active(publicVideo.page.id)).toEqual([]);
    expect(await listed(publicVideo.page.id)).toBe(true); // public needs no approval
    expect(await active(editorApproved.page.id)).toEqual(["PAGE"]); // no listing was added to an editor's page-only decision
    expect((await listApprovalHistory(editorApproved.page.id))[0].origin).toBe("EDITOR");
    expect(await listed(editorApproved.page.id)).toBe(false);
    expect(await active(flagged.page.id)).toEqual(["DISCOVERY", "PAGE"]);
  }, T);

  it("a legacy-approved page whose approval was later revoked is not resurrected by the data step", async () => {
    const { page } = await newPage("unlisted");
    await legacyFlagOnly(page.id);
    await runMigrationDataSteps([page.id]);
    await prisma.videoExposureApproval.updateMany({ where: { videoPageId: page.id }, data: { revokedAt: new Date(), revokedById: users.admin } });
    await prisma.youTubeVideoPage.update({ where: { id: page.id }, data: { unlistedPublicationApprovedAt: null } });
    await runMigrationDataSteps([page.id]); // run again: nothing active carries the legacy mark, so nothing is recreated
    expect(await active(page.id)).toEqual([]);
    expect(await listed(page.id)).toBe(false);
  }, T);
});

describe("F2 — the lifecycle/provenance corrections of the hardening migration", () => {
  const reasonsOf = async (pageId: string) => (await listApprovalHistory(pageId)).map((r) => [r.scope, r.revokedAt === null ? "active" : r.revokedReason]).sort();

  it("a legacy flag on a DRAFT page keeps the page approval but does not grant listing: published later, it is reachable, not listed", async () => {
    const { page } = await newPage("unlisted", { publish: false });
    await legacyFlagOnly(page.id);
    await runMigrationDataSteps([page.id]);
    expect(await reasonsOf(page.id)).toEqual([["DISCOVERY", "MIGRATION"], ["PAGE", "active"]]);
    const revoked = (await listApprovalHistory(page.id)).find((r) => r.scope === "DISCOVERY")!;
    expect(revoked.revokeNote).toMatch(/draft.*never publicly listed/);
    expect(revoked.revokedById).toBeNull(); // the platform, not a person
    await publishVideoPage(page.id, users.admin);
    expect(await findPublishedBySlug(page.slug)).toMatchObject({ discoverable: false });
    expect(await listed(page.id)).toBe(false);
    expect(await prisma.auditLogEntry.count({ where: { entityId: page.id, action: "VIDEO_EXPOSURE_REVOKED", actorId: null } })).toBe(1);
  }, T);

  it("a legacy flag on an ARCHIVED page carries nothing over: every approval ends (page archived), the flag is cleared, and restoring the page does not bring it back", async () => {
    const { page } = await newPage("unlisted");
    await legacyFlagOnly(page.id);
    await prisma.youTubeVideoPage.update({ where: { id: page.id }, data: { archivedAt: new Date() } });
    await runMigrationDataSteps([page.id]);
    expect(await reasonsOf(page.id)).toEqual([["DISCOVERY", "PAGE_ARCHIVED"], ["PAGE", "PAGE_ARCHIVED"]]);
    expect((await prisma.youTubeVideoPage.findUniqueOrThrow({ where: { id: page.id } })).unlistedPublicationApprovedAt).toBeNull();
    await prisma.youTubeVideoPage.update({ where: { id: page.id }, data: { archivedAt: null } });
    expect(await findPublishedBySlug(page.slug)).toBeNull();
    expect(await listed(page.id)).toBe(false);
  }, T);

  it("a legacy flag on a PRIVATE video carries nothing over; it does not return when the video becomes unlisted again", async () => {
    const { page, video } = await newPage("private");
    await legacyFlagOnly(page.id);
    await runMigrationDataSteps([page.id]);
    expect(await reasonsOf(page.id)).toEqual([["DISCOVERY", "VIDEO_PRIVATE"], ["PAGE", "VIDEO_PRIVATE"]]);
    expect((await prisma.youTubeVideoPage.findUniqueOrThrow({ where: { id: page.id } })).unlistedPublicationApprovedAt).toBeNull();
    await prisma.youTubeVideo.update({ where: { id: video.id }, data: { privacyStatus: "unlisted" } });
    expect(await findPublishedBySlug(page.slug)).toBeNull();
  }, T);

  it("applies the lifecycle rule to every approval on such a page, whoever made it", async () => {
    const { page } = await newPage("unlisted");
    await prisma.videoExposureApproval.create({ data: { videoPageId: page.id, scope: "PAGE", approvedById: users.admin, origin: "EDITOR" } });
    await prisma.youTubeVideoPage.update({ where: { id: page.id }, data: { unlistedPublicationApprovedAt: new Date(), archivedAt: new Date() } });
    await runMigrationDataSteps([], [page.id]);
    expect(await reasonsOf(page.id)).toEqual([["PAGE", "PAGE_ARCHIVED"]]);
    expect((await listApprovalHistory(page.id))[0].approvedById).toBe(users.admin); // an editor's own approval keeps its approver
  }, T);

  it("an approval an editor made keeps its approver; only carried-over approvals lose the inferred one", async () => {
    const editorMade = await newPage("unlisted");
    await approveExposure({ videoPageId: editorMade.page.id, scope: "PAGE", actorId: users.admin });
    await runMigrationDataSteps([], [editorMade.page.id]);
    expect((await listApprovalHistory(editorMade.page.id))[0]).toMatchObject({ origin: "EDITOR", approvedById: users.admin });
  }, T);

  it("is idempotent: running the corrections again changes and records nothing more", async () => {
    const archived = await newPage("unlisted");
    await legacyFlagOnly(archived.page.id);
    await prisma.youTubeVideoPage.update({ where: { id: archived.page.id }, data: { archivedAt: new Date() } });
    const draft = await newPage("unlisted", { publish: false });
    await legacyFlagOnly(draft.page.id);
    await runMigrationDataSteps([archived.page.id, draft.page.id]);
    const count = () => prisma.auditLogEntry.count({ where: { entityId: { in: [archived.page.id, draft.page.id] } } });
    const before = { audit: await count(), rows: JSON.stringify(await reasonsOf(archived.page.id)) + JSON.stringify(await reasonsOf(draft.page.id)) };
    await runProvenanceSteps([archived.page.id, draft.page.id]);
    await runProvenanceSteps([archived.page.id, draft.page.id]);
    expect(await count()).toBe(before.audit);
    expect(JSON.stringify(await reasonsOf(archived.page.id)) + JSON.stringify(await reasonsOf(draft.page.id))).toBe(before.rows);
  }, T);

  it("the migration text itself says what it does and that it deletes nothing", () => {
    expect(MIGRATION_7).toMatch(/Additive and idempotent/);
    expect(MIGRATION_7).not.toMatch(/\bDELETE\s+FROM\b|\bTRUNCATE\b|\bDROP\s+(TABLE|COLUMN|TYPE|INDEX|CONSTRAINT)\b/i); // it revokes and relaxes one NOT NULL; it removes nothing
  });
});

describe("F2 — the review path for carried-over approvals", () => {
  async function carried() {
    const { page, video } = await newPage("unlisted");
    await legacyFlagOnly(page.id);
    await runMigrationDataSteps([page.id]);
    return { page, video };
  }

  it("lists carried-over approvals (and only those), with their origin; an editor's own approvals never appear", async () => {
    const one = await carried();
    const editorMade = await newPage("unlisted");
    await approveExposure({ videoPageId: editorMade.page.id, scope: "PAGE", actorId: users.admin });
    const items = await listCarriedOverApprovals();
    const mine = items.find((i) => i.videoPageId === one.page.id)!;
    expect(mine.approvals.map((a) => [a.scope, a.origin]).sort()).toEqual([["DISCOVERY", "MIGRATED_LEGACY"], ["PAGE", "MIGRATED_LEGACY"]]);
    expect(mine).toMatchObject({ videoId: one.video.id, slug: one.page.slug });
    expect(items.some((i) => i.videoPageId === editorMade.page.id)).toBe(false);
  }, T);

  it("'keep' records who reconsidered and removes it from the list without changing what visitors see", async () => {
    const { page } = await carried();
    as("admin");
    expect(await redirectOf(() => confirmCarriedOverAction(form({ videoPageId: page.id })))).toMatch(/Kept/);
    expect((await listCarriedOverApprovals()).some((i) => i.videoPageId === page.id)).toBe(false);
    const rows = await listApprovalHistory(page.id);
    expect(rows.every((r) => r.confirmedById === users.admin && r.confirmedAt !== null && r.origin === "MIGRATED_LEGACY")).toBe(true); // the origin stays on record
    expect(await listed(page.id)).toBe(true);
    expect(await prisma.auditLogEntry.count({ where: { entityId: page.id, action: "VIDEO_EXPOSURE_CARRIED_OVER_CONFIRMED" } })).toBe(1);
    expect(await redirectOf(() => confirmCarriedOverAction(form({ videoPageId: page.id })))).toMatch(/nothing waiting/i);
  }, T);

  it("'stop listing' keeps the page reachable and unlists it; 'withdraw completely' removes both — each revocation is recorded", async () => {
    const stop = await carried();
    const withdraw = await carried();
    as("admin");
    expect(await redirectOf(() => withdrawCarriedOverAction(form({ videoPageId: stop.page.id, scope: "DISCOVERY" })))).toMatch(/No longer listed/);
    expect(await findPublishedBySlug(stop.page.slug)).toMatchObject({ discoverable: false });
    expect(await listed(stop.page.id)).toBe(false);
    expect(await active(stop.page.id)).toEqual(["PAGE"]);
    expect((await listCarriedOverApprovals()).find((i) => i.videoPageId === stop.page.id)!.approvals.map((a) => a.scope)).toEqual(["PAGE"]); // the page approval still awaits reconsideration

    expect(await redirectOf(() => withdrawCarriedOverAction(form({ videoPageId: withdraw.page.id, scope: "PAGE" })))).toMatch(/Withdrawn/);
    expect(await findPublishedBySlug(withdraw.page.slug)).toBeNull();
    expect(await active(withdraw.page.id)).toEqual([]);
    expect((await prisma.youTubeVideoPage.findUniqueOrThrow({ where: { id: withdraw.page.id } })).unlistedPublicationApprovedAt).toBeNull();
    expect((await listCarriedOverApprovals()).some((i) => i.videoPageId === withdraw.page.id)).toBe(false);
    expect((await listApprovalHistory(withdraw.page.id)).every((r) => r.revokedById === users.admin && /Reconsidered/.test(r.revokeNote ?? ""))).toBe(true);
  }, T);

  it("needs RECORDING_PUBLISH: an editor and an unauthenticated caller are refused and nothing changes", async () => {
    const { page } = await carried();
    as("editor");
    expect(await redirectOf(() => confirmCarriedOverAction(form({ videoPageId: page.id })))).toMatch(/permission/i);
    expect(await redirectOf(() => withdrawCarriedOverAction(form({ videoPageId: page.id, scope: "PAGE" })))).toMatch(/permission/i);
    mockGetCurrentStudioSession.mockResolvedValue(null);
    expect(await redirectOf(() => confirmCarriedOverAction(form({ videoPageId: page.id })))).toMatch(/permission/i);
    as("admin");
    expect(await redirectOf(() => withdrawCarriedOverAction(form({ videoPageId: page.id, scope: "BOGUS" })))).toMatch(/incomplete/i);
    expect(await active(page.id)).toEqual(["DISCOVERY", "PAGE"]);
    expect((await listCarriedOverApprovals()).some((i) => i.videoPageId === page.id)).toBe(true);
  }, T);

  it("one quiet notification stands while any wait: raised once, never repeated while unchanged, updated if the set changes, resolved when none remain", async () => {
    // start clean: reconsider everything that is waiting from earlier tests in this file
    for (const item of await listCarriedOverApprovals()) await confirmCarriedOverApprovals({ videoPageId: item.videoPageId, actorId: users.admin });
    expect(await syncCarriedOverNotification()).toMatch(/RESOLVED|NONE/);

    const first = await carried();
    expect((await runUnlistedReviewSweep()).enabled).toBe(true);
    const raised = await prisma.studioNotification.findUniqueOrThrow({ where: { dedupeKey: CARRIED_OVER_NOTIFICATION_KEY } });
    expect(raised).toMatchObject({ kind: "CARRIED_OVER_APPROVALS", status: "OPEN", severity: "INFO", audienceAction: "RECORDING_PUBLISH", href: "/studio/catalogue/unlisted-review" });
    expect(raised.title).toMatch(/^1 unlisted video kept their earlier public approval$/);

    await runUnlistedReviewSweep();
    await runUnlistedReviewSweep();
    expect((await prisma.studioNotification.findUniqueOrThrow({ where: { dedupeKey: CARRIED_OVER_NOTIFICATION_KEY } })).occurrenceCount).toBe(raised.occurrenceCount); // not repeated

    const second = await carried();
    await runUnlistedReviewSweep();
    const updated = await prisma.studioNotification.findUniqueOrThrow({ where: { dedupeKey: CARRIED_OVER_NOTIFICATION_KEY } });
    expect(updated.occurrenceCount).toBe(raised.occurrenceCount + 1);
    expect(updated.title).toMatch(/^2 unlisted videos/);

    await confirmCarriedOverApprovals({ videoPageId: first.page.id, actorId: users.admin });
    await confirmCarriedOverApprovals({ videoPageId: second.page.id, actorId: users.admin });
    await runUnlistedReviewSweep();
    expect((await prisma.studioNotification.findUniqueOrThrow({ where: { dedupeKey: CARRIED_OVER_NOTIFICATION_KEY } })).status).toBe("RESOLVED");
  }, T);
});

describe("F3 — the reconciliation procedure", () => {
  it("the dry run reports and writes nothing", async () => {
    const { page } = await newPage("unlisted");
    await legacyFlagOnly(page.id); // flag only: an earlier version approved it
    const before = await prisma.videoExposureApproval.count();
    const auditBefore = await prisma.auditLogEntry.count();
    const plan = await planApprovalReconciliation();
    expect(plan.actions.find((a) => a.videoPageId === page.id)?.decision).toEqual({ kind: "ADD_LEGACY_APPROVALS", addPage: true, addDiscovery: true });
    expect(plan.counts.addLegacyApprovals).toBeGreaterThanOrEqual(1);
    expect(await prisma.videoExposureApproval.count()).toBe(before);
    expect(await prisma.auditLogEntry.count()).toBe(auditBefore);
    expect(await findPublishedBySlug(page.slug)).toBeNull(); // still hidden: nothing applied
  }, T);

  it("rollout window and rollback: a flag-only approval is carried over and stays listed; a flag-only revocation clears the leftovers; a consistent page-only approval is respected", async () => {
    const approvedByOldCode = await newPage("unlisted");
    await legacyFlagOnly(approvedByOldCode.page.id);

    const revokedByOldCode = await newPage("unlisted");
    await approveExposure({ videoPageId: revokedByOldCode.page.id, scope: "PAGE", actorId: users.admin });
    await approveExposure({ videoPageId: revokedByOldCode.page.id, scope: "DISCOVERY", actorId: users.admin });
    await prisma.youTubeVideoPage.update({ where: { id: revokedByOldCode.page.id }, data: { unlistedPublicationApprovedAt: null } }); // old code's revoke: the flag only

    const pageOnlyByEditor = await newPage("unlisted");
    await approveExposure({ videoPageId: pageOnlyByEditor.page.id, scope: "PAGE", actorId: users.admin });

    const untouched = await newPage("unlisted"); // never approved by anything

    // before: the strict rule hides the flag-only approval, and the half-revoked page is hidden too (nothing public that should not be)
    expect(await findPublishedBySlug(approvedByOldCode.page.slug)).toBeNull();
    expect(await findPublishedBySlug(revokedByOldCode.page.slug)).toBeNull();
    expect((await findApprovalFlagInconsistencies()).flagWithoutApproval).toContain(approvedByOldCode.page.id);
    expect((await findApprovalFlagInconsistencies()).approvalWithoutFlag).toContain(revokedByOldCode.page.id);

    const result = await applyApprovalReconciliation({ actorId: users.admin });
    expect(result.applied.addedLegacyApprovals).toBeGreaterThanOrEqual(2);
    expect(result.applied.revokedApprovals).toBeGreaterThanOrEqual(2);

    // carried over, marked, attributed to the last editor with the original time, and still listed — not delisted
    const carriedHistory = await listApprovalHistory(approvedByOldCode.page.id);
    expect(carriedHistory.map((h) => h.scope).sort()).toEqual(["DISCOVERY", "PAGE"]);
    for (const row of carriedHistory) expect(row).toMatchObject({ origin: "RECONCILED_LEGACY", approvedById: null, confirmedAt: null, revokedAt: null }); // no approver is invented
    expect(carriedHistory.every((r) => /recorded no approver|stores no approver/.test(r.note ?? ""))).toBe(true);
    expect(carriedHistory[0].approvedAt.toISOString()).toBe(LEGACY_AT.toISOString());
    expect(await findPublishedBySlug(approvedByOldCode.page.slug)).toMatchObject({ discoverable: true });
    expect(await listed(approvedByOldCode.page.id)).toBe(true);
    expect((await listCarriedOverApprovals()).some((i) => i.videoPageId === approvedByOldCode.page.id)).toBe(true); // and it is up for reconsideration

    // the legacy revocation stands
    expect(await active(revokedByOldCode.page.id)).toEqual([]);
    expect((await listApprovalHistory(revokedByOldCode.page.id)).every((r) => r.revokedById === users.admin && /Reconciled/.test(r.revokeNote ?? ""))).toBe(true);
    expect(await findPublishedBySlug(revokedByOldCode.page.slug)).toBeNull();

    // nothing was invented
    expect(await active(pageOnlyByEditor.page.id)).toEqual(["PAGE"]);
    expect((await listApprovalHistory(pageOnlyByEditor.page.id))[0].origin).toBe("EDITOR");
    expect(await active(untouched.page.id)).toEqual([]);
    expect(await findPublishedBySlug(untouched.page.slug)).toBeNull();

    // auditable, with the operator recorded
    const audits = await prisma.auditLogEntry.findMany({ where: { entityId: { in: [approvedByOldCode.page.id, revokedByOldCode.page.id] }, action: "VIDEO_EXPOSURE_RECONCILED" } });
    expect(audits).toHaveLength(2);
    expect(audits.every((a) => a.actorId === users.admin)).toBe(true);

    // the flag and the rows agree again for these pages
    const inconsistencies = await findApprovalFlagInconsistencies();
    for (const id of [approvedByOldCode.page.id, revokedByOldCode.page.id, pageOnlyByEditor.page.id, untouched.page.id]) {
      expect(inconsistencies.flagWithoutApproval).not.toContain(id);
      expect(inconsistencies.approvalWithoutFlag).not.toContain(id);
    }
  }, T);

  it("is idempotent: applying again changes nothing, and two operators applying at the same time create one set of rows", async () => {
    const { page } = await newPage("unlisted");
    await legacyFlagOnly(page.id);
    const [a, b] = await Promise.all([applyApprovalReconciliation({ actorId: users.admin }), applyApprovalReconciliation({ actorId: users.admin })]);
    void a;
    void b;
    expect(await listApprovalHistory(page.id)).toHaveLength(2); // exactly one PAGE and one DISCOVERY, never doubled
    const again = await applyApprovalReconciliation({ actorId: users.admin });
    expect(again.plan.actions.filter((x) => x.decision.kind !== "BLOCKED_BY_HOLD")).toEqual([]);
    expect(again.applied.addedLegacyApprovals).toBe(0);
    expect(again.applied.revokedApprovals).toBe(0);
    expect(await listApprovalHistory(page.id)).toHaveLength(2);
  }, T);

  it("applies the lifecycle rules: a draft page is carried over without a listing; an archived page or a private video gets nothing and its stale flag is cleared; a public video gets nothing", async () => {
    const draft = await newPage("unlisted", { publish: false });
    await legacyFlagOnly(draft.page.id);
    const archived = await newPage("unlisted");
    await legacyFlagOnly(archived.page.id);
    await prisma.youTubeVideoPage.update({ where: { id: archived.page.id }, data: { archivedAt: new Date() } });
    const priv = await newPage("unlisted");
    await legacyFlagOnly(priv.page.id);
    await prisma.youTubeVideo.update({ where: { id: priv.video.id }, data: { privacyStatus: "private" } });
    const pub = await newPage("public");
    await legacyFlagOnly(pub.page.id);

    const plan = await planApprovalReconciliation();
    const decision = (id: string) => plan.actions.find((a) => a.videoPageId === id)?.decision;
    expect(decision(draft.page.id)).toEqual({ kind: "ADD_LEGACY_APPROVALS", addPage: true, addDiscovery: false });
    expect(decision(archived.page.id)).toEqual({ kind: "CLEAR_STALE_FLAG" });
    expect(decision(priv.page.id)).toEqual({ kind: "CLEAR_STALE_FLAG" });
    expect(decision(pub.page.id)).toBeUndefined();
    expect(plan.counts.clearStaleFlags).toBeGreaterThanOrEqual(2);

    const result = await applyApprovalReconciliation({ actorId: users.admin });
    expect(result.applied.clearedStaleFlags).toBeGreaterThanOrEqual(2);
    expect(await active(draft.page.id)).toEqual(["PAGE"]);
    expect((await listApprovalHistory(draft.page.id))[0]).toMatchObject({ origin: "RECONCILED_LEGACY", approvedById: null });
    for (const stale of [archived, priv]) {
      expect(await active(stale.page.id)).toEqual([]);
      expect((await prisma.youTubeVideoPage.findUniqueOrThrow({ where: { id: stale.page.id } })).unlistedPublicationApprovedAt).toBeNull();
      expect(await prisma.auditLogEntry.count({ where: { entityId: stale.page.id, action: "VIDEO_EXPOSURE_RECONCILED" } })).toBe(1);
    }
    expect(await active(pub.page.id)).toEqual([]);
    expect(await listed(pub.page.id)).toBe(true); // public needs no approval
    // The metadata baseline is recorded for the carried-over page, so later changes are noticed.
    expect((await prisma.youTubeVideoPage.findUniqueOrThrow({ where: { id: draft.page.id } })).metadataReviewedSnapshot).not.toBeNull();
  }, T);

  it("never creates an approval for a video under a hold: it is reported and skipped, and the video stays hidden", async () => {
    const { page, video } = await newPage("unlisted");
    await legacyFlagOnly(page.id);
    await prisma.videoExposureReview.create({ data: { youtubeVideoId: video.id, state: "DECLINED", proposalFingerprint: "x", holdReason: "RIGHTS" } });
    const plan = await planApprovalReconciliation();
    expect(plan.actions.find((x) => x.videoPageId === page.id)?.decision).toEqual({ kind: "BLOCKED_BY_HOLD" });
    const result = await applyApprovalReconciliation({ actorId: users.admin });
    expect(result.applied.skippedByHold).toBeGreaterThanOrEqual(1);
    expect(await active(page.id)).toEqual([]);
    expect(await findPublishedBySlug(page.slug)).toBeNull();
    expect(await prisma.auditLogEntry.count({ where: { entityId: page.id, action: "VIDEO_EXPOSURE_RECONCILE_SKIPPED" } })).toBeGreaterThanOrEqual(1);
    await setReviewHold({ videoId: video.id, hold: "RIGHTS", actorId: users.admin }); // setting the hold properly also clears the flag, so the page is consistent again
    expect((await planApprovalReconciliation()).actions.some((x) => x.videoPageId === page.id)).toBe(false);
  }, T);
});
