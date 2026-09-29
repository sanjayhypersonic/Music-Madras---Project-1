import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../modules/db/client";
import {
  findAuditLogEntryById,
  listAuditLogEntriesForEntity,
  listAuditLogEntriesPage,
  listDistinctAuditActions,
  listDistinctAuditEntityTypes,
} from "../../modules/audit/listAuditLog";

// Phase 6G-15: proves the audit log's read-side filtering, pagination,
// detail lookup, and distinct-value queries against the real database.
// Entries are created directly (not via writeAuditLog) so each test
// controls exactly the rows it needs; a unique per-run marker keeps every
// assertion scoped to this test's own fixtures, never real audit history.

const TEST_TAG = "phase6g15";

function uniqueMarker(): string {
  return `${TEST_TAG}-${randomUUID().slice(0, 8)}`;
}

async function createTestUser(nameSuffix: string) {
  return prisma.studioUser.create({
    data: {
      id: randomUUID(),
      email: `${TEST_TAG}-${randomUUID().slice(0, 8)}@musicmadras.test`,
      name: `Phase 6G-15 Test User ${nameSuffix}`,
      role: "ADMINISTRATOR",
      status: "ACTIVE",
    },
  });
}

async function createEntry(opts: {
  actorId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  timestamp: Date;
  beforeSnapshot?: object;
  afterSnapshot?: object;
}) {
  return prisma.auditLogEntry.create({
    data: {
      actorId: opts.actorId,
      entityType: opts.entityType,
      entityId: opts.entityId,
      action: opts.action,
      timestamp: opts.timestamp,
      beforeSnapshot: opts.beforeSnapshot,
      afterSnapshot: opts.afterSnapshot,
    },
  });
}

describe("listAuditLog read-side against a real database", () => {
  let userIds: string[] = [];
  let entryIds: string[] = [];

  afterEach(async () => {
    if (entryIds.length > 0) {
      await prisma.auditLogEntry.deleteMany({ where: { id: { in: entryIds } } });
      entryIds = [];
    }
    if (userIds.length > 0) {
      await prisma.studioUser.deleteMany({ where: { id: { in: userIds } } });
      userIds = [];
    }
  });

  it("filters by entityType, action, actorId, q, and date range independently", async () => {
    const marker = uniqueMarker();
    const user = await createTestUser(marker);
    userIds.push(user.id);
    const otherUser = await createTestUser(`${marker}-other`);
    userIds.push(otherUser.id);

    const entityType = `${marker}-Entity`;
    const matching = await createEntry({
      actorId: user.id,
      entityType,
      entityId: `${marker}-target`,
      action: `${marker.toUpperCase().replace(/-/g, "_")}_CREATED`,
      timestamp: new Date("2026-01-10T12:00:00.000Z"),
      afterSnapshot: { name: "Matching Entry" },
    });
    entryIds.push(matching.id);

    const differentAction = await createEntry({
      actorId: user.id,
      entityType,
      entityId: `${marker}-target`,
      action: `${marker.toUpperCase().replace(/-/g, "_")}_UPDATED`,
      timestamp: new Date("2026-01-11T12:00:00.000Z"),
    });
    entryIds.push(differentAction.id);

    const differentActor = await createEntry({
      actorId: otherUser.id,
      entityType,
      entityId: `${marker}-target-2`,
      action: `${marker.toUpperCase().replace(/-/g, "_")}_CREATED`,
      timestamp: new Date("2026-01-12T12:00:00.000Z"),
    });
    entryIds.push(differentActor.id);

    const differentEntityType = await createEntry({
      actorId: user.id,
      entityType: `${marker}-OtherEntity`,
      entityId: `${marker}-target`,
      action: `${marker.toUpperCase().replace(/-/g, "_")}_CREATED`,
      timestamp: new Date("2026-01-13T12:00:00.000Z"),
    });
    entryIds.push(differentEntityType.id);

    const byEntityType = await listAuditLogEntriesPage({ entityType }, 1);
    expect(byEntityType.items.map((i) => i.id).sort()).toEqual([matching.id, differentAction.id, differentActor.id].sort());

    const byAction = await listAuditLogEntriesPage({ entityType, action: matching.action }, 1);
    expect(byAction.items.map((i) => i.id)).toEqual(expect.arrayContaining([matching.id]));
    expect(byAction.items.map((i) => i.id)).not.toEqual(expect.arrayContaining([differentAction.id]));

    const byActor = await listAuditLogEntriesPage({ entityType, actorId: user.id }, 1);
    expect(byActor.items.map((i) => i.id).sort()).toEqual([matching.id, differentAction.id].sort());

    const byQ = await listAuditLogEntriesPage({ q: user.name }, 1);
    expect(byQ.items.map((i) => i.id)).toEqual(expect.arrayContaining([matching.id, differentAction.id]));

    const byDateRange = await listAuditLogEntriesPage(
      { entityType, from: new Date("2026-01-10T00:00:00.000Z"), to: new Date("2026-01-11T23:59:59.999Z") },
      1
    );
    expect(byDateRange.items.map((i) => i.id).sort()).toEqual([matching.id, differentAction.id].sort());
  });

  it("paginates server-side with a stable total across pages", async () => {
    const marker = uniqueMarker();
    const user = await createTestUser(marker);
    userIds.push(user.id);
    const entityType = `${marker}-Entity`;

    for (let i = 0; i < 5; i++) {
      const entry = await createEntry({
        actorId: user.id,
        entityType,
        entityId: `${marker}-${i}`,
        action: `${marker.toUpperCase().replace(/-/g, "_")}_CREATED`,
        timestamp: new Date(Date.UTC(2026, 0, 1 + i)),
      });
      entryIds.push(entry.id);
    }

    const pageOne = await listAuditLogEntriesPage({ entityType }, 1, 2);
    expect(pageOne.items).toHaveLength(2);
    expect(pageOne.total).toBe(5);
    expect(pageOne.page).toBe(1);
    // Most recent first.
    expect(pageOne.items[0].timestamp.getTime()).toBeGreaterThan(pageOne.items[1].timestamp.getTime());

    const pageTwo = await listAuditLogEntriesPage({ entityType }, 2, 2);
    expect(pageTwo.items).toHaveLength(2);
    expect(pageTwo.total).toBe(5);

    const pageThree = await listAuditLogEntriesPage({ entityType }, 3, 2);
    expect(pageThree.items).toHaveLength(1);

    const allIds = [...pageOne.items, ...pageTwo.items, ...pageThree.items].map((i) => i.id).sort();
    expect(allIds).toEqual([...entryIds].sort());
  });

  it("finds a single entry by id with its actor, and returns null for an unknown id", async () => {
    const marker = uniqueMarker();
    const user = await createTestUser(marker);
    userIds.push(user.id);

    const entry = await createEntry({
      actorId: user.id,
      entityType: `${marker}-Entity`,
      entityId: `${marker}-target`,
      action: `${marker.toUpperCase().replace(/-/g, "_")}_CREATED`,
      timestamp: new Date(),
      beforeSnapshot: { name: "Before" },
      afterSnapshot: { name: "After" },
    });
    entryIds.push(entry.id);

    const found = await findAuditLogEntryById(entry.id);
    expect(found?.id).toBe(entry.id);
    expect(found?.actor?.id).toBe(user.id);
    expect(found?.beforeSnapshot).toEqual({ name: "Before" });
    expect(found?.afterSnapshot).toEqual({ name: "After" });

    expect(await findAuditLogEntryById(randomUUID())).toBeNull();
  });

  it("lists distinct entity types and actions including newly created values", async () => {
    const marker = uniqueMarker();
    const user = await createTestUser(marker);
    userIds.push(user.id);
    const entityType = `${marker}-Entity`;
    const action = `${marker.toUpperCase().replace(/-/g, "_")}_CREATED`;

    const entry = await createEntry({
      actorId: user.id,
      entityType,
      entityId: `${marker}-target`,
      action,
      timestamp: new Date(),
    });
    entryIds.push(entry.id);

    expect(await listDistinctAuditEntityTypes()).toContain(entityType);
    expect(await listDistinctAuditActions()).toContain(action);
  });

  it("caps listAuditLogEntriesForEntity at the given limit, most recent first", async () => {
    const marker = uniqueMarker();
    const user = await createTestUser(marker);
    userIds.push(user.id);
    const entityType = `${marker}-Entity`;
    const entityId = `${marker}-target`;

    for (let i = 0; i < 3; i++) {
      const entry = await createEntry({
        actorId: user.id,
        entityType,
        entityId,
        action: `${marker.toUpperCase().replace(/-/g, "_")}_STEP_${i}`,
        timestamp: new Date(Date.UTC(2026, 0, 1 + i)),
      });
      entryIds.push(entry.id);
    }

    const limited = await listAuditLogEntriesForEntity(entityType, entityId, 2);
    expect(limited).toHaveLength(2);
    expect(limited[0].timestamp.getTime()).toBeGreaterThan(limited[1].timestamp.getTime());
  });
});
