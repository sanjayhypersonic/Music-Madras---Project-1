import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../modules/db/client";
import { EXPECTED_MIGRATIONS } from "../../modules/config/expectedMigrations";
import { loadReadinessFacts } from "../../modules/db/repositories/readinessRepository";
import { assessReadiness } from "../../modules/ops/readiness";
import { compareMigrations } from "../../modules/ops/migrationPlan";
import { FINGERPRINT_TABLES, INTEGRITY_CHECKS } from "../../modules/ops/databaseFingerprint";
import { reportRequestError } from "../../modules/ops/reportRequestError";
import { createDraftRecording, findPublishedRecordingBySlug, publishCurrentDraft } from "../../modules/db/repositories/recordingRepository";
import * as entityPages from "../../modules/db/repositories/entityRelationshipsRepository";
import { getPublicOccasionPageData } from "../../modules/db/repositories/occasionPageRepository";
import { findPublishedBySlug } from "../../modules/db/repositories/youtubeVideoPageRepository";
import { findPublishedPlaylistBySlug } from "../../modules/db/repositories/playlistPageRepository";
import { searchArchiveAll, searchRecordings, searchWorks } from "../../modules/db/repositories/archiveSearchRepository";

// Launch readiness against the isolated test database: the readiness facts and route are real, the fingerprint SQL runs and DETECTS a corrupted pointer, and an
// unhandled error becomes one safe log line and one deduplicated incident. Synthetic fixtures only, prefix-named and removed afterwards.

const TAG = "phase7ops";
const TOKEN = randomUUID().replace(/-/g, "").slice(0, 8);
const T = 120000;
let actor = "";
const recordingIds: string[] = [];
const ROUTE = `/app/${TAG}-${TOKEN}/[slug]/page`;
const ROUTE_ID = `app-${TAG}-${TOKEN}-slug-page`;

beforeAll(async () => {
  actor = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `${TAG}-${TOKEN}@musicmadras.test`, name: "Ops probe", role: "ADMINISTRATOR", status: "ACTIVE" } })).id;
}, T);

afterAll(async () => {
  await prisma.operationalIncident.deleteMany({ where: { subjectId: ROUTE_ID } });
  await prisma.studioNotification.deleteMany({ where: { dedupeKey: "operational-incident-recurring-UNHANDLED_SERVER_ERROR" } });
  if (recordingIds.length > 0) {
    const revisions = (await prisma.recordingRevision.findMany({ where: { recordingId: { in: recordingIds } }, select: { id: true } })).map((r) => r.id);
    await prisma.auditLogEntry.deleteMany({ where: { entityId: { in: [...recordingIds, ...revisions] } } });
    await prisma.recording.updateMany({ where: { id: { in: recordingIds } }, data: { currentDraftRevisionId: null, currentPublishedRevisionId: null } });
    await prisma.recording.deleteMany({ where: { id: { in: recordingIds } } });
  }
  await prisma.auditLogEntry.deleteMany({ where: { actorId: actor } });
  await prisma.studioUser.deleteMany({ where: { id: actor } });
}, T);

describe("readiness against the real database", () => {
  it("the facts show every shipped migration applied, so this release is READY here, and a migration it does not have yet makes it NOT ready", async () => {
    const facts = await loadReadinessFacts();
    expect(facts.databaseReachable).toBe(true);
    expect(assessReadiness(EXPECTED_MIGRATIONS, facts)).toEqual({ ready: true });
    if (facts.databaseReachable && facts.migrationRows) {
      expect(compareMigrations(EXPECTED_MIGRATIONS, facts.migrationRows)).toMatchObject({ pending: [], failed: [], unknownApplied: [] });
    }
    expect(assessReadiness([...EXPECTED_MIGRATIONS, "29991231235959_not_yet_applied"], facts)).toMatchObject({ ready: false, code: "MIGRATIONS_PENDING", detail: ["29991231235959_not_yet_applied"] });
  }, T);

  it("the route answers 200 {status:ready} here; with an unapplied migration it answers 503 {status:not-ready}, tells the caller nothing else, and logs the code", async () => {
    vi.resetModules();
    const ready = await (await import("../../app/api/ready/route")).GET();
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: "ready" });
    expect(ready.headers.get("cache-control")).toBe("no-store");

    vi.resetModules();
    vi.doMock("../../modules/config/expectedMigrations", () => ({ EXPECTED_MIGRATIONS: [...EXPECTED_MIGRATIONS, "29991231235959_not_yet_applied"] }));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const notReady = await (await import("../../app/api/ready/route")).GET();
      expect(notReady.status).toBe(503);
      const body = await notReady.json();
      expect(body).toEqual({ status: "not-ready" }); // no code, no migration name, no database detail for the caller
      expect(JSON.stringify(body)).not.toContain("29991231235959");
      const line = JSON.parse(String(logged.mock.calls.at(-1)![0]));
      expect(line).toMatchObject({ event: "readiness", ready: false, code: "MIGRATIONS_PENDING", detail: ["29991231235959_not_yet_applied"] });
    } finally {
      logged.mockRestore();
      vi.doUnmock("../../modules/config/expectedMigrations");
      vi.resetModules();
    }
  }, T);
});

describe("the database fingerprint, run for real", () => {
  const present = async () => new Set((await prisma.$queryRaw<Array<{ table_name: string }>>`select table_name from information_schema.tables where table_schema = 'public'`).map((r) => r.table_name));
  const run = async (sql: string) => Number((await prisma.$queryRawUnsafe<Array<{ n: number }>>(sql))[0].n);

  it("every fingerprinted table exists, and every integrity check runs", async () => {
    const tables = await present();
    for (const table of FINGERPRINT_TABLES) expect(tables.has(table), table).toBe(true);
    for (const check of INTEGRITY_CHECKS) expect(await run(check.sql), check.name).toBeGreaterThanOrEqual(0);
  }, T);

  it("DETECTS a lifecycle pointer that has been corrupted, and sees it clean again after repair", async () => {
    const d = await createDraftRecording({ slug: `${TAG}-${TOKEN}-rec`, actorId: actor, title: `Ops probe ${TOKEN}` });
    recordingIds.push(d.id);
    await publishCurrentDraft(d.id, actor);
    const count = (name: string) => run(INTEGRITY_CHECKS.find((c) => c.name === name)!.sql);
    const before = await count("publishedWithoutRevision");
    const pointer = (await prisma.recording.findUniqueOrThrow({ where: { id: d.id } })).currentPublishedRevisionId;
    await prisma.recording.update({ where: { id: d.id }, data: { currentPublishedRevisionId: null } });
    try {
      expect(await count("publishedWithoutRevision")).toBe(before + 1);
    } finally {
      await prisma.recording.update({ where: { id: d.id }, data: { currentPublishedRevisionId: pointer } });
    }
    expect(await count("publishedWithoutRevision")).toBe(before);
    for (const check of INTEGRITY_CHECKS) expect(await run(check.sql), check.name).toBeGreaterThanOrEqual(0); // every check still runs after the repair
  }, T);
});

describe("an unhandled server error", () => {
  const count = () => prisma.operationalIncident.findMany({ where: { subjectId: ROUTE_ID } });
  const leaky = () => Object.assign(new Error("password=hunter2 SELECT * FROM studio_users WHERE email='a@b.c' at /srv/app/secret.ts"), { name: "PrismaClientKnownRequestError", digest: "9876543210" });

  it("becomes ONE safe log line and ONE deduplicated incident that is counted on repeat; nothing from the message or request reaches either", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await reportRequestError(leaky(), { routePath: ROUTE, routeType: "render" });
      await reportRequestError(leaky(), { routePath: ROUTE, routeType: "render" });
      const rows = await count();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: "UNHANDLED_SERVER_ERROR", reasonCode: "PRISMA_CLIENT_KNOWN_REQUEST_ERROR", subjectType: "Route", subjectId: ROUTE_ID, occurrenceCount: 2, status: "OPEN" });
      const lines = logged.mock.calls.map((c) => String(c[0]));
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0])).toMatchObject({ level: "error", event: "unhandled_server_error", errorName: "PrismaClientKnownRequestError", routeType: "render", route: ROUTE, digest: "9876543210" });
      const everything = JSON.stringify([lines, rows]);
      for (const secret of ["hunter2", "studio_users", "a@b.c", "secret.ts"]) expect(everything).not.toContain(secret);
    } finally {
      logged.mockRestore();
    }
  }, T);

  it("ignores the framework's own control flow (notFound, redirect): no line, no incident", async () => {
    const before = (await count()).length;
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await reportRequestError(Object.assign(new Error("x"), { digest: "NEXT_NOT_FOUND" }), { routePath: ROUTE, routeType: "render" });
      await reportRequestError(Object.assign(new Error("x"), { digest: "NEXT_REDIRECT;replace;/a;307" }), { routePath: ROUTE, routeType: "render" });
      expect(logged).not.toHaveBeenCalled();
      expect((await count()).length).toBe(before);
    } finally {
      logged.mockRestore();
    }
  }, T);

  it("never throws, even when the database is down (the error hook runs on the error path); the log line is still written", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const down = vi.spyOn(prisma, "$queryRaw").mockRejectedValue(new Error("connection lost: password=hunter2"));
    try {
      await expect(reportRequestError(leaky(), { routePath: ROUTE, routeType: "route" })).resolves.toBeUndefined();
      expect(logged.mock.calls.some((c) => String(c[0]).includes('"unhandled_server_error"'))).toBe(true);
      expect(logged.mock.calls.map((c) => String(c[0])).join("\n")).not.toMatch(/hunter2|connection lost/);
    } finally {
      down.mockRestore();
      logged.mockRestore();
    }
  }, T);
});

describe("visitor-controlled input is 'not found' or 'no results', never an unhandled error", () => {
  const hostile = ["\u0000", "x\u0000y", "a\nb", "\u007f", "z".repeat(5000), ""];

  it("every public page reader treats an impossible slug exactly like an unknown one (found on a production build: %00 in the URL gave HTTP 500)", async () => {
    const readers: Array<[string, (slug: string) => Promise<unknown>]> = [
      ["composer", entityPages.getComposerEntityPageData],
      ["venue", entityPages.getVenueEntityPageData],
      ["work", entityPages.getPublicWorkPageData],
      ["artist", entityPages.getArtistEntityPageData],
      ["choir", entityPages.getChoirEntityPageData],
      ["conductor", entityPages.getConductorEntityPageData],
      ["programme", entityPages.getPublicProgrammePageData],
      ["performance", entityPages.getPublicPerformancePageData],
      ["recording", entityPages.getPublicRecordingPageData],
      ["collection", entityPages.getPublicCollectionPageData],
      ["organisation", entityPages.getPublicOrganisationPageData],
      ["learning guide", entityPages.getPublicLearningGuidePageData],
      ["occasion", getPublicOccasionPageData],
      ["recording lookup", findPublishedRecordingBySlug],
      ["video", findPublishedBySlug],
      ["playlist", findPublishedPlaylistBySlug],
    ];
    for (const [name, read] of readers) for (const slug of hostile) expect(await read(slug), `${name} ${JSON.stringify(slug).slice(0, 30)}`).toBeNull();
  }, T);

  it("search with control characters or an absurd length returns results or nothing, and never throws", async () => {
    for (const q of ["\u0000", "bach\u0000", "a\u0001b", "\u007f", "q".repeat(5000)]) {
      await expect(searchArchiveAll(q)).resolves.toBeDefined();
      await expect(searchRecordings(q)).resolves.toMatchObject({ items: expect.any(Array) });
      await expect(searchWorks(q)).resolves.toMatchObject({ items: expect.any(Array) });
    }
  }, T);
});