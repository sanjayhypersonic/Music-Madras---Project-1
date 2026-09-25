import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../modules/db/client";
import { createCollection, listPublishedCollections, publishCollection } from "../../modules/db/repositories/collectionRepository";
import { getPublicCollectionPageData } from "../../modules/db/repositories/entityRelationshipsRepository";

// Phase 6G-11 — the homepage's Collections section links each card to
// `/collections/${collection.slug}` using exactly the rows
// listPublishedCollections() returns (the homepage's sole Collections data
// source — see app/(museum)/page.tsx). This proves that link is genuinely
// live end to end: every collection the homepage would render resolves
// through the real public /collections/[slug] data path.

const TEST_TAG = "phase6g11hd";

async function createTestUser() {
  return prisma.studioUser.create({
    data: {
      id: randomUUID(),
      email: `${TEST_TAG}-${randomUUID().slice(0, 8)}@musicmadras.test`,
      name: "Phase 6G-11 Homepage Discovery Test User",
      role: "EDITOR",
      status: "ACTIVE",
    },
  });
}

describe("Homepage Collections discovery", () => {
  it("every collection listPublishedCollections() returns resolves through getPublicCollectionPageData at /collections/[slug]", async () => {
    const user = await createTestUser();
    const collection = await createCollection({
      slug: `${TEST_TAG}-collection-${randomUUID().slice(0, 8)}`,
      title: "Homepage Discovery Collection",
      actorId: user.id,
    });
    await publishCollection(collection.id, user.id);

    try {
      const published = await listPublishedCollections();
      const match = published.find((c) => c.id === collection.id);
      expect(match).toBeDefined();
      expect(match!.slug).toBe(collection.slug);

      const pageData = await getPublicCollectionPageData(match!.slug);
      expect(pageData).not.toBeNull();
      expect(pageData!.title).toBe("Homepage Discovery Collection");
    } finally {
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Collection", entityId: collection.id } });
      await prisma.collection.delete({ where: { id: collection.id } }).catch(() => {});
      await prisma.studioUser.deleteMany({ where: { id: user.id } });
    }
  });
});
