import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../modules/db/client";
import {
  findFieldOwnership,
  recordExternalFieldValue,
  setFieldOwnership,
} from "../../modules/db/repositories/fieldOwnershipRepository";
import {
  createSyncConflict,
  listOpenSyncConflicts,
  resolveSyncConflict,
} from "../../modules/db/repositories/syncConflictRepository";
import { recordObservabilityTransition } from "../../modules/db/repositories/observabilityTransitionRepository";
import {
  DEFAULT_DELETION_EVIDENCE_REQUIRED_PASSES,
  findSyncPolicy,
  upsertSyncPolicy,
} from "../../modules/db/repositories/syncPolicyRepository";
import { findSyncCheckpoint, upsertSyncCheckpoint } from "../../modules/db/repositories/syncCheckpointRepository";
import {
  completeSyncJobRun,
  listFullSyncJobRunsSince,
  startSyncJobRun,
} from "../../modules/db/repositories/syncJobRunRepository";

// Phase 6B: real, disposable-fixture integration tests against the
// configured development Postgres database — mirrors the pattern
// established in tests/integration/credentialsSignIn.test.ts. These
// exercise the six new tables' repository behavior, uniqueness
// constraints, and foreign-key relationships against a real database, not
// a fake — exactly the kind of thing a pure-function unit test cannot
// verify. No sync engine, API adapter, or escalation logic is exercised
// here, because none exists yet.

const TEST_RESOURCE_ID = "phase6b-test-video-id";
const TEST_EMAIL = "phase6b-integration-test@musicmadras.test";

async function createTestActor() {
  return prisma.studioUser.create({
    data: { email: TEST_EMAIL, name: "Phase 6B Test User", role: "EDITOR", status: "ACTIVE" },
  });
}

describe("Phase 6B YouTube sync foundation", () => {
  afterEach(async () => {
    // Cleanup order respects FK constraints: leaf rows before the
    // StudioUser and SyncJobRun/SyncCheckpoint rows they reference.
    await prisma.observabilityTransition.deleteMany({ where: { resourceId: TEST_RESOURCE_ID } });
    await prisma.syncConflict.deleteMany({ where: { resourceId: TEST_RESOURCE_ID } });
    await prisma.fieldOwnership.deleteMany({ where: { resourceId: TEST_RESOURCE_ID } });
    await prisma.syncCheckpoint.deleteMany({ where: { scopeKey: { startsWith: "phase6b-test-" } } });
    await prisma.syncJobRun.deleteMany({ where: { jobType: { startsWith: "phase6b-test-" } } });
    await prisma.syncPolicy.deleteMany({ where: { resourceType: "YOUTUBE_VIDEO", provider: "YOUTUBE" } });
    await prisma.studioUser.deleteMany({ where: { email: TEST_EMAIL } });
  });

  it("FieldOwnership: records external values without touching ownership, and setFieldOwnership changes ownership explicitly", async () => {
    const observedAt = new Date();
    await recordExternalFieldValue({
      provider: "YOUTUBE",
      resourceType: "YOUTUBE_VIDEO",
      resourceId: TEST_RESOURCE_ID,
      fieldName: "title",
      externalValue: "Original YouTube Title",
      observedAt,
    });

    const afterFirstSync = await findFieldOwnership("YOUTUBE", "YOUTUBE_VIDEO", TEST_RESOURCE_ID, "title");
    expect(afterFirstSync?.ownership).toBe("YOUTUBE_CONTROLLED");
    expect(afterFirstSync?.lastExternalValue).toBe("Original YouTube Title");

    const actor = await createTestActor();
    await setFieldOwnership({
      provider: "YOUTUBE",
      resourceType: "YOUTUBE_VIDEO",
      resourceId: TEST_RESOURCE_ID,
      fieldName: "title",
      ownership: "MUSIC_MADRAS_CONTROLLED",
      editorialValue: "Editorially Corrected Title",
      actorId: actor.id,
    });

    const afterOverride = await findFieldOwnership("YOUTUBE", "YOUTUBE_VIDEO", TEST_RESOURCE_ID, "title");
    expect(afterOverride?.ownership).toBe("MUSIC_MADRAS_CONTROLLED");
    expect(afterOverride?.lastEditorialValue).toBe("Editorially Corrected Title");
    expect(afterOverride?.changedById).toBe(actor.id);

    // A subsequent external sync must not silently overwrite the override.
    await recordExternalFieldValue({
      provider: "YOUTUBE",
      resourceType: "YOUTUBE_VIDEO",
      resourceId: TEST_RESOURCE_ID,
      fieldName: "title",
      externalValue: "A Different YouTube Title",
      observedAt: new Date(),
    });
    const afterSecondSync = await findFieldOwnership("YOUTUBE", "YOUTUBE_VIDEO", TEST_RESOURCE_ID, "title");
    expect(afterSecondSync?.ownership).toBe("MUSIC_MADRAS_CONTROLLED");
    expect(afterSecondSync?.lastEditorialValue).toBe("Editorially Corrected Title");
    expect(afterSecondSync?.lastExternalValue).toBe("A Different YouTube Title");
  });

  it("FieldOwnership: uniqueness constraint rejects a duplicate (provider, resourceType, resourceId, fieldName) row", async () => {
    await recordExternalFieldValue({
      provider: "YOUTUBE",
      resourceType: "YOUTUBE_VIDEO",
      resourceId: TEST_RESOURCE_ID,
      fieldName: "description",
      externalValue: "desc",
      observedAt: new Date(),
    });

    await expect(
      prisma.fieldOwnership.create({
        data: {
          provider: "YOUTUBE",
          resourceType: "YOUTUBE_VIDEO",
          resourceId: TEST_RESOURCE_ID,
          fieldName: "description",
        },
      })
    ).rejects.toThrow();
  });

  it("SyncConflict: full OPEN -> RESOLVED lifecycle, and listOpenSyncConflicts excludes resolved rows", async () => {
    const actor = await createTestActor();
    const conflict = await createSyncConflict({
      provider: "YOUTUBE",
      resourceType: "YOUTUBE_VIDEO",
      resourceId: TEST_RESOURCE_ID,
      fieldName: "title",
      ownershipAtDetection: "MUSIC_MADRAS_CONTROLLED",
      previousMusicMadrasValue: "Editorially Corrected Title",
      newProviderValue: "A Different YouTube Title",
    });
    expect(conflict.status).toBe("OPEN");

    const openBefore = await listOpenSyncConflicts();
    expect(openBefore.some((c) => c.id === conflict.id)).toBe(true);

    const resolved = await resolveSyncConflict(conflict.id, { resolution: "KEPT_MUSIC_MADRAS", resolvedById: actor.id });
    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.resolvedById).toBe(actor.id);
    expect(resolved.resolvedAt).not.toBeNull();

    const openAfter = await listOpenSyncConflicts();
    expect(openAfter.some((c) => c.id === conflict.id)).toBe(false);
  });

  it("SyncConflict: foreign key rejects a syncJobRunId that does not exist", async () => {
    await expect(
      createSyncConflict({
        provider: "YOUTUBE",
        resourceType: "YOUTUBE_VIDEO",
        resourceId: TEST_RESOURCE_ID,
        fieldName: "title",
        ownershipAtDetection: "YOUTUBE_CONTROLLED",
        previousMusicMadrasValue: null,
        newProviderValue: "x",
        syncJobRunId: randomUUID(),
      })
    ).rejects.toThrow();
  });

  it("SyncPolicy: upsert seeds the ADR §15 default and updates in place (unique per provider+resourceType)", async () => {
    const actor = await createTestActor();

    const created = await upsertSyncPolicy({ provider: "YOUTUBE", resourceType: "YOUTUBE_VIDEO", actorId: actor.id });
    expect(created.deletionEvidenceRequiredPasses).toBe(DEFAULT_DELETION_EVIDENCE_REQUIRED_PASSES);
    expect(created.deletionEvidenceRequiredPasses).toBe(3);

    const updated = await upsertSyncPolicy({
      provider: "YOUTUBE",
      resourceType: "YOUTUBE_VIDEO",
      deletionEvidenceRequiredPasses: 5,
      actorId: actor.id,
    });
    expect(updated.id).toBe(created.id);
    expect(updated.deletionEvidenceRequiredPasses).toBe(5);

    const found = await findSyncPolicy("YOUTUBE", "YOUTUBE_VIDEO");
    expect(found?.deletionEvidenceRequiredPasses).toBe(5);

    const allForResourceType = await prisma.syncPolicy.findMany({
      where: { provider: "YOUTUBE", resourceType: "YOUTUBE_VIDEO" },
    });
    expect(allForResourceType).toHaveLength(1);
  });

  it("SyncCheckpoint: upsert is idempotent per (provider, resourceType, scopeKey) and persists a resumable cursor", async () => {
    const scopeKey = "phase6b-test-uploads-playlist";

    await upsertSyncCheckpoint({
      provider: "YOUTUBE",
      resourceType: "YOUTUBE_PLAYLIST_ITEM",
      scopeKey,
      pageToken: "page-1-token",
    });
    await upsertSyncCheckpoint({
      provider: "YOUTUBE",
      resourceType: "YOUTUBE_PLAYLIST_ITEM",
      scopeKey,
      pageToken: "page-2-token",
      lastProcessedId: "video-42",
    });

    const checkpoint = await findSyncCheckpoint("YOUTUBE", "YOUTUBE_PLAYLIST_ITEM", scopeKey);
    expect(checkpoint?.pageToken).toBe("page-2-token");
    expect(checkpoint?.lastProcessedId).toBe("video-42");

    const rows = await prisma.syncCheckpoint.findMany({ where: { scopeKey } });
    expect(rows).toHaveLength(1);
  });

  it("SyncJobRun: FULL vs PARTIAL semantics — listFullSyncJobRunsSince excludes PARTIAL/FAILED runs", async () => {
    const since = new Date(Date.now() - 60_000);

    const fullRun = await startSyncJobRun("YOUTUBE", "phase6b-test-full");
    await completeSyncJobRun(fullRun.id, {
      status: "SUCCEEDED",
      completeness: "FULL",
      recordsDiscovered: 10,
      recordsCreated: 2,
      recordsUpdated: 3,
      recordsUnchanged: 5,
    });

    const partialRun = await startSyncJobRun("YOUTUBE", "phase6b-test-partial");
    await completeSyncJobRun(partialRun.id, {
      status: "PARTIAL",
      completeness: "PARTIAL",
      recordsDiscovered: 4,
      errorDetails: "quota exhausted mid-page",
    });

    const fullRuns = await listFullSyncJobRunsSince("YOUTUBE", since);
    const fullRunIds = fullRuns.map((r) => r.id);
    expect(fullRunIds).toContain(fullRun.id);
    expect(fullRunIds).not.toContain(partialRun.id);
  });

  it("ObservabilityTransition: records evidence linked to a real SyncJobRun and SyncCheckpoint (foreign keys enforced)", async () => {
    const run = await startSyncJobRun("YOUTUBE", "phase6b-test-observability");
    const checkpoint = await upsertSyncCheckpoint({
      provider: "YOUTUBE",
      resourceType: "YOUTUBE_VIDEO",
      scopeKey: "phase6b-test-observability-scope",
      syncJobRunId: run.id,
    });

    const transition = await recordObservabilityTransition({
      provider: "YOUTUBE",
      resourceType: "YOUTUBE_VIDEO",
      resourceId: TEST_RESOURCE_ID,
      fromState: "NOT_OBSERVED",
      toState: "DELETED",
      reason: "consecutive_full_passes",
      requiredPasses: 3,
      syncJobRunId: run.id,
      syncCheckpointId: checkpoint.id,
    });

    expect(transition.toState).toBe("DELETED");

    await expect(
      prisma.observabilityTransition.create({
        data: {
          provider: "YOUTUBE",
          resourceType: "YOUTUBE_VIDEO",
          resourceId: TEST_RESOURCE_ID,
          fromState: "OBSERVED",
          toState: "UNAVAILABLE",
          reason: "definitive_api_status",
          syncJobRunId: randomUUID(),
        },
      })
    ).rejects.toThrow();
  });
});
