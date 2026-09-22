import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../modules/db/client";
import { can } from "../../modules/auth/policy";
import { DuplicateEntityError } from "../../modules/mmke/duplicate-detection/detectDuplicateName";
import { SlugConflictError } from "../../modules/mmke/slug/SlugConflictError";
import {
  archiveOrganisation,
  createOrganisation,
  listOrganisationsForStudio,
  restoreOrganisation,
  updateOrganisation,
} from "../../modules/db/repositories/organisationRepository";
import {
  archiveVenue,
  createVenue,
  findVenueById,
  linkVenueToOrganisation,
  listVenuesByOrganisation,
  listVenuesForStudio,
  restoreVenue,
  updateVenue,
} from "../../modules/db/repositories/venueRepository";

// Phase 6G-4E: proves the Studio Venue/Organisation catalogue
// repositories against the real database, mirroring
// tests/integration/studioComposerWorkCatalogue.test.ts's pattern
// exactly. Real DB, disposable test-prefixed fixtures only.

const TEST_TAG = "phase6g4e";
const TEST_EMAIL = `${TEST_TAG}-integration-test@musicmadras.test`;

function uniqueSlug(base: string): string {
  return `${TEST_TAG}-${base}-${randomUUID().slice(0, 8)}`;
}

function uniqueName(base: string): string {
  return `${base} ${randomUUID().slice(0, 8)}`;
}

async function createTestUser() {
  return prisma.studioUser.create({
    data: { id: randomUUID(), email: TEST_EMAIL, name: "Phase 6G-4E Test User", role: "EDITOR", status: "ACTIVE" },
  });
}

async function cleanupVenue(venueId: string) {
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Venue", entityId: venueId } });
  await prisma.venue.delete({ where: { id: venueId } });
}

async function cleanupOrganisation(organisationId: string) {
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Organisation", entityId: organisationId } });
  await prisma.organisation.delete({ where: { id: organisationId } });
}

describe("Studio permission policy for Venue/Organisation (brief §14, cross-checked against §4/§7/§16 of 6G-4C)", () => {
  it("CATALOGUE_WRITE is the only permission gating Venue/Organisation writes — no new permission was introduced", () => {
    expect(can("CONTRIBUTOR", "CATALOGUE_WRITE")).toBe(false);
    expect(can("EDITOR", "CATALOGUE_WRITE")).toBe(true);
    expect(can("ADMINISTRATOR", "CATALOGUE_WRITE")).toBe(true);
  });
});

describe("Venue catalogue management against a real database", () => {
  let venueId: string | null = null;
  let organisationId: string | null = null;
  let userId: string | null = null;

  afterEach(async () => {
    if (venueId) {
      await cleanupVenue(venueId).catch(() => {});
      venueId = null;
    }
    if (organisationId) {
      await cleanupOrganisation(organisationId).catch(() => {});
      organisationId = null;
    }
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  it("creates a Venue and audit-logs the creation", async () => {
    const user = await createTestUser();
    userId = user.id;

    const venue = await createVenue({
      slug: uniqueSlug("venue"),
      name: uniqueName("St. QA Andrew's Church"),
      type: "CHURCH",
      city: "Chennai",
      actorId: user.id,
    });
    venueId = venue.id;

    expect(venue.type).toBe("CHURCH");
    expect(venue.archivedAt).toBeNull();

    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Venue", entityId: venue.id, action: "VENUE_CREATED" } });
    expect(audit).toHaveLength(1);
  });

  it("rejects a duplicate-normalized Venue name, and rejects a colliding slug for a different name", async () => {
    const user = await createTestUser();
    userId = user.id;
    const name = uniqueName("Duplicate Test Venue");

    const first = await createVenue({ slug: uniqueSlug("venue"), name, type: "CONCERT_HALL", actorId: user.id });
    venueId = first.id;

    await expect(
      createVenue({ slug: uniqueSlug("venue"), name: `  ${name.toUpperCase()}  `, type: "CONCERT_HALL", actorId: user.id })
    ).rejects.toThrow(DuplicateEntityError);

    const collidingSlug = uniqueSlug("collision");
    const second = await createVenue({ slug: collidingSlug, name: uniqueName("Totally Different Venue"), type: "CATHEDRAL", actorId: user.id });
    try {
      await expect(
        createVenue({ slug: collidingSlug, name: uniqueName("Yet Another Venue"), type: "STUDIO", actorId: user.id })
      ).rejects.toThrow(SlugConflictError);
    } finally {
      await cleanupVenue(second.id);
    }
  });

  it("edits a Venue's fields, keeping the slug immutable", async () => {
    const user = await createTestUser();
    userId = user.id;
    const venue = await createVenue({ slug: uniqueSlug("venue"), name: uniqueName("Editable Venue"), type: "CHURCH", actorId: user.id });
    venueId = venue.id;

    const updated = await updateVenue(venue.id, { name: "Renamed Venue", city: "Chennai", type: "CATHEDRAL", actorId: user.id });
    expect(updated.name).toBe("Renamed Venue");
    expect(updated.city).toBe("Chennai");
    expect(updated.type).toBe("CATHEDRAL");
    expect(updated.slug).toBe(venue.slug);

    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Venue", entityId: venue.id, action: "VENUE_UPDATED" } });
    expect(audit).toHaveLength(1);
  });

  it("links a Venue to an Organisation and unlinks it, with the established distinct audit events", async () => {
    const user = await createTestUser();
    userId = user.id;
    const organisation = await createOrganisation({ name: uniqueName("Link Test Organisation"), actorId: user.id });
    organisationId = organisation.id;
    const venue = await createVenue({ slug: uniqueSlug("venue"), name: uniqueName("Linkable Venue"), type: "CHURCH", actorId: user.id });
    venueId = venue.id;

    const linked = await linkVenueToOrganisation(venue.id, organisation.id, user.id);
    expect(linked.organisationId).toBe(organisation.id);
    const linkAudit = await prisma.auditLogEntry.findMany({
      where: { entityType: "Venue", entityId: venue.id, action: "VENUE_LINKED_TO_ORGANISATION" },
    });
    expect(linkAudit).toHaveLength(1);

    const unlinked = await linkVenueToOrganisation(venue.id, null, user.id);
    expect(unlinked.organisationId).toBeNull();
    const unlinkAudit = await prisma.auditLogEntry.findMany({
      where: { entityType: "Venue", entityId: venue.id, action: "VENUE_UNLINKED_FROM_ORGANISATION" },
    });
    expect(unlinkAudit).toHaveLength(1);
  });

  it("archives and restores a Venue, audit-logging both, without deleting the record", async () => {
    const user = await createTestUser();
    userId = user.id;
    const venue = await createVenue({ slug: uniqueSlug("venue"), name: uniqueName("Archivable Venue"), type: "CHURCH", actorId: user.id });
    venueId = venue.id;

    const archived = await archiveVenue(venue.id, user.id);
    expect(archived.archivedAt).not.toBeNull();
    expect(await findVenueById(venue.id)).not.toBeNull();

    const restored = await restoreVenue(venue.id, user.id);
    expect(restored.archivedAt).toBeNull();

    const archiveAudit = await prisma.auditLogEntry.findMany({ where: { entityType: "Venue", entityId: venue.id, action: "VENUE_ARCHIVED" } });
    const restoreAudit = await prisma.auditLogEntry.findMany({ where: { entityType: "Venue", entityId: venue.id, action: "VENUE_RESTORED" } });
    expect(archiveAudit).toHaveLength(1);
    expect(restoreAudit).toHaveLength(1);
  });

  it("lists and searches Venues for Studio, including archived ones, with the Organisation joined", async () => {
    const user = await createTestUser();
    userId = user.id;
    const organisation = await createOrganisation({ name: uniqueName("List Test Organisation"), actorId: user.id });
    organisationId = organisation.id;
    const uniqueMarker = randomUUID().slice(0, 8);
    const venue = await createVenue({
      slug: uniqueSlug("venue"),
      name: `Searchable ${uniqueMarker} Venue`,
      type: "CHURCH",
      organisationId: organisation.id,
      actorId: user.id,
    });
    venueId = venue.id;

    const found = await listVenuesForStudio(uniqueMarker);
    expect(found.map((v) => v.id)).toContain(venue.id);
    expect(found.find((v) => v.id === venue.id)?.organisation?.id).toBe(organisation.id);

    await archiveVenue(venue.id, user.id);
    const foundAfterArchive = await listVenuesForStudio(uniqueMarker);
    expect(foundAfterArchive.map((v) => v.id)).toContain(venue.id); // Studio list includes archived, clearly labelled by archivedAt
  });
});

describe("Organisation catalogue management against a real database", () => {
  let organisationId: string | null = null;
  let venueId: string | null = null;
  let userId: string | null = null;

  afterEach(async () => {
    if (venueId) {
      await cleanupVenue(venueId).catch(() => {});
      venueId = null;
    }
    if (organisationId) {
      await cleanupOrganisation(organisationId).catch(() => {});
      organisationId = null;
    }
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  it("creates an Organisation and audit-logs the creation", async () => {
    const user = await createTestUser();
    userId = user.id;

    const organisation = await createOrganisation({ name: uniqueName("Test Organisation"), description: "A test description.", actorId: user.id });
    organisationId = organisation.id;

    expect(organisation.description).toBe("A test description.");
    const audit = await prisma.auditLogEntry.findMany({
      where: { entityType: "Organisation", entityId: organisation.id, action: "ORGANISATION_CREATED" },
    });
    expect(audit).toHaveLength(1);
  });

  it("rejects a duplicate-normalized Organisation name", async () => {
    const user = await createTestUser();
    userId = user.id;
    const name = uniqueName("Duplicate Test Organisation");

    const first = await createOrganisation({ name, actorId: user.id });
    organisationId = first.id;

    await expect(createOrganisation({ name: `  ${name.toUpperCase()}  `, actorId: user.id })).rejects.toThrow(DuplicateEntityError);
  });

  it("edits an Organisation's fields and audit-logs before/after", async () => {
    const user = await createTestUser();
    userId = user.id;
    const organisation = await createOrganisation({ name: uniqueName("Editable Organisation"), actorId: user.id });
    organisationId = organisation.id;

    const updated = await updateOrganisation(organisation.id, { name: "Renamed Organisation", description: "New description.", actorId: user.id });
    expect(updated.name).toBe("Renamed Organisation");
    expect(updated.description).toBe("New description.");

    const audit = await prisma.auditLogEntry.findMany({
      where: { entityType: "Organisation", entityId: organisation.id, action: "ORGANISATION_UPDATED" },
    });
    expect(audit).toHaveLength(1);
  });

  it("archives and restores an Organisation, audit-logging both, without deleting the record", async () => {
    const user = await createTestUser();
    userId = user.id;
    const organisation = await createOrganisation({ name: uniqueName("Archivable Organisation"), actorId: user.id });
    organisationId = organisation.id;

    const archived = await archiveOrganisation(organisation.id, user.id);
    expect(archived.archivedAt).not.toBeNull();

    const restored = await restoreOrganisation(organisation.id, user.id);
    expect(restored.archivedAt).toBeNull();

    const archiveAudit = await prisma.auditLogEntry.findMany({
      where: { entityType: "Organisation", entityId: organisation.id, action: "ORGANISATION_ARCHIVED" },
    });
    const restoreAudit = await prisma.auditLogEntry.findMany({
      where: { entityType: "Organisation", entityId: organisation.id, action: "ORGANISATION_RESTORED" },
    });
    expect(archiveAudit).toHaveLength(1);
    expect(restoreAudit).toHaveLength(1);
  });

  it("lists and searches Organisations for Studio, including archived ones, with a Venue count", async () => {
    const user = await createTestUser();
    userId = user.id;
    const uniqueMarker = randomUUID().slice(0, 8);
    const organisation = await createOrganisation({ name: `Searchable ${uniqueMarker} Organisation`, actorId: user.id });
    organisationId = organisation.id;
    const venue = await createVenue({
      slug: uniqueSlug("venue"),
      name: uniqueName("Counted Venue"),
      type: "CHURCH",
      organisationId: organisation.id,
      actorId: user.id,
    });
    venueId = venue.id;

    const found = await listOrganisationsForStudio(uniqueMarker);
    expect(found.map((o) => o.id)).toContain(organisation.id);
    expect(found.find((o) => o.id === organisation.id)?._count.venues).toBe(1);

    await archiveOrganisation(organisation.id, user.id);
    const foundAfterArchive = await listOrganisationsForStudio(uniqueMarker);
    expect(foundAfterArchive.map((o) => o.id)).toContain(organisation.id);
  });
});

describe("Venue ↔ Organisation relationship integrity", () => {
  let organisationId: string | null = null;
  let venueId: string | null = null;
  let userId: string | null = null;

  afterEach(async () => {
    if (venueId) {
      await cleanupVenue(venueId).catch(() => {});
      venueId = null;
    }
    if (organisationId) {
      await cleanupOrganisation(organisationId).catch(() => {});
      organisationId = null;
    }
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  it("a linked Venue resolves through listVenuesByOrganisation, and the Organisation relationship survives archiving the Venue", async () => {
    const user = await createTestUser();
    userId = user.id;
    const organisation = await createOrganisation({ name: uniqueName("Relationship Test Organisation"), actorId: user.id });
    organisationId = organisation.id;
    const venue = await createVenue({
      slug: uniqueSlug("venue"),
      name: uniqueName("Relationship Test Venue"),
      type: "CHURCH",
      organisationId: organisation.id,
      actorId: user.id,
    });
    venueId = venue.id;

    const venuesForOrg = await listVenuesByOrganisation(organisation.id);
    expect(venuesForOrg.map((v) => v.id)).toEqual([venue.id]);

    await archiveVenue(venue.id, user.id);
    const venueAfterArchive = await findVenueById(venue.id);
    expect(venueAfterArchive?.organisationId).toBe(organisation.id); // relationship preserved through archive
    expect(venueAfterArchive?.organisation?.id).toBe(organisation.id);
  });

  it("archiving an Organisation preserves its Venues' organisationId — no cascade, no orphaning", async () => {
    const user = await createTestUser();
    userId = user.id;
    const organisation = await createOrganisation({ name: uniqueName("Archivable Parent Organisation"), actorId: user.id });
    organisationId = organisation.id;
    const venue = await createVenue({
      slug: uniqueSlug("venue"),
      name: uniqueName("Child Venue"),
      type: "CHURCH",
      organisationId: organisation.id,
      actorId: user.id,
    });
    venueId = venue.id;

    await archiveOrganisation(organisation.id, user.id);

    const venueAfterOrgArchive = await findVenueById(venue.id);
    expect(venueAfterOrgArchive?.organisationId).toBe(organisation.id); // never nulled/cascaded
    expect(venueAfterOrgArchive?.archivedAt).toBeNull(); // Venue itself is untouched

    const venuesForOrg = await listVenuesByOrganisation(organisation.id);
    expect(venuesForOrg.map((v) => v.id)).toContain(venue.id); // still resolvable even though the Organisation is archived
  });
});
