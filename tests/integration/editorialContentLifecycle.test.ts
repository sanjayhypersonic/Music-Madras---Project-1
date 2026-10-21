import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Must be at the true top level — vi.mock is hoisted above every import.
const mockGetCurrentStudioSession = vi.fn();
vi.mock("../../modules/auth/authService", () => ({ getCurrentStudioSession: () => mockGetCurrentStudioSession() }));

import { prisma } from "../../modules/db/client";
import {
  createEditorialDraft,
  deriveEditorialBlockState,
  getPublishedEditorialBlock,
  getPublishedEditorialBlocks,
  listEditorialPublications,
  publishEditorialContent,
  unpublishEditorialContent,
  updateEditorialDraft,
} from "../../modules/db/repositories/editorialContentRepository";
import { EDITORIAL_BLOCKS } from "../../modules/mmke/editorial/editorialBlocks";
import { EditorialBlockExistsError, EditorialBlockUnknownError, EditorialConflictError, EditorialInvalidError } from "../../modules/mmke/editorial/editorialErrors";
import { createDraftAction, publishAction, saveDraftAction, unpublishAction } from "../../app/(studio)/studio/(protected)/catalogue/site-content/[slug]/actions";

// Phase 6K-1 — EditorialContent lifecycle against the isolated test database: draft/public separation, version-checked publication,
// history, audit, permissions (CATALOGUE_WRITE edits, RECORDING_PUBLISH publishes).

const BODY_BLOCK = EDITORIAL_BLOCKS.find((b) => b.usesBody)!;
const SEO_BLOCK = EDITORIAL_BLOCKS.find((b) => b.usesSeo)!;
const TAG = randomUUID().slice(0, 8);
const T = 60000;
const users = {} as Record<"admin" | "editor" | "contributor", string>;
const roles = { admin: "ADMINISTRATOR", editor: "EDITOR", contributor: "CONTRIBUTOR" } as const;

function as(who: keyof typeof users) {
  mockGetCurrentStudioSession.mockResolvedValue({ user: { id: users[who], role: roles[who], name: who, email: `${who}@example.test`, status: "ACTIVE" } });
}
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
const row = (slug: string) => prisma.editorialContent.findUniqueOrThrow({ where: { slug } });

beforeAll(async () => {
  for (const who of Object.keys(roles) as (keyof typeof users)[]) {
    users[who] = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `ed-${who}-${TAG}@musicmadras.test`, name: `Ed ${who}`, role: roles[who], status: "ACTIVE" } })).id;
  }
  await prisma.editorialContent.deleteMany({ where: { slug: { in: EDITORIAL_BLOCKS.map((b) => b.slug) } } });
}, T);

afterAll(async () => {
  await prisma.editorialContent.deleteMany({ where: { slug: { in: EDITORIAL_BLOCKS.map((b) => b.slug) } } });
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityType: "EditorialContent" }, { actorId: { in: Object.values(users) } }] } });
  await prisma.studioUser.deleteMany({ where: { id: { in: Object.values(users) } } });
}, T);

describe("creating a draft", () => {
  it("only a block the site defines can be created, and only once", async () => {
    await expect(createEditorialDraft({ slug: "not-a-block", title: "x", actorId: users.editor })).rejects.toBeInstanceOf(EditorialBlockUnknownError);
    const created = await createEditorialDraft({ slug: BODY_BLOCK.slug, title: "", actorId: users.editor });
    expect(created).toMatchObject({ status: "DRAFT", version: 1, publishedTitle: null, publishedAt: null });
    await expect(createEditorialDraft({ slug: BODY_BLOCK.slug, title: "", actorId: users.editor })).rejects.toBeInstanceOf(EditorialBlockExistsError);
    expect(deriveEditorialBlockState(created)).toBe("DRAFT");
  }, T);

  it("an unpublished block is invisible to the public reader (nothing is invented)", async () => {
    expect(await getPublishedEditorialBlock(BODY_BLOCK.slug)).toBeNull();
    expect(await getPublishedEditorialBlock("not-a-block")).toBeNull();
    expect((await getPublishedEditorialBlocks([BODY_BLOCK.slug, "not-a-block"])).size).toBe(0);
  }, T);
});

describe("draft versus published", () => {
  it("saving bumps the version, is checked against the version the editor saw, and does not touch anything public", async () => {
    const fields = { title: "Welcome", body: "First version.", seoTitle: null, seoDescription: null };
    const saved = await updateEditorialDraft({ slug: BODY_BLOCK.slug, fields, expectedVersion: 1, actorId: users.editor });
    expect(saved).toEqual({ version: 2, changed: true });
    await expect(updateEditorialDraft({ slug: BODY_BLOCK.slug, fields, expectedVersion: 1, actorId: users.editor })).rejects.toBeInstanceOf(EditorialConflictError); // stale
    expect(await updateEditorialDraft({ slug: BODY_BLOCK.slug, fields, expectedVersion: 2, actorId: users.editor })).toEqual({ version: 2, changed: false }); // no change, no bump
    expect(await getPublishedEditorialBlock(BODY_BLOCK.slug)).toBeNull();
  }, T);

  it("limits are enforced on save", async () => {
    await expect(updateEditorialDraft({ slug: BODY_BLOCK.slug, fields: { title: "x".repeat(500), body: "b", seoTitle: null, seoDescription: null }, expectedVersion: 2, actorId: users.editor })).rejects.toBeInstanceOf(EditorialInvalidError);
  }, T);

  it("publishing needs the exact version reviewed and a complete block; it copies the draft to the published snapshot", async () => {
    await expect(publishEditorialContent({ slug: BODY_BLOCK.slug, expectedVersion: 1, actorId: users.admin })).rejects.toBeInstanceOf(EditorialConflictError);
    const published = await publishEditorialContent({ slug: BODY_BLOCK.slug, expectedVersion: 2, actorId: users.admin });
    expect(published).toMatchObject({ status: "PUBLISHED", publishedTitle: "Welcome", publishedBody: "First version.", publishedVersion: 2, publishedById: users.admin });
    expect(await getPublishedEditorialBlock(BODY_BLOCK.slug)).toMatchObject({ title: "Welcome", body: "First version." });
  }, T);

  it("DRAFT EDITS CANNOT SILENTLY CHANGE THE LIVE SITE: the public reader keeps the published snapshot until the next publish", async () => {
    await updateEditorialDraft({ slug: BODY_BLOCK.slug, fields: { title: "Welcome (revised)", body: "Second version.", seoTitle: null, seoDescription: null }, expectedVersion: 2, actorId: users.editor });
    expect(await getPublishedEditorialBlock(BODY_BLOCK.slug)).toMatchObject({ title: "Welcome", body: "First version." });
    expect(deriveEditorialBlockState(await row(BODY_BLOCK.slug))).toBe("PUBLISHED_WITH_CHANGES");
    await publishEditorialContent({ slug: BODY_BLOCK.slug, expectedVersion: 3, actorId: users.admin });
    expect(await getPublishedEditorialBlock(BODY_BLOCK.slug)).toMatchObject({ title: "Welcome (revised)", body: "Second version." });
    expect(deriveEditorialBlockState(await row(BODY_BLOCK.slug))).toBe("PUBLISHED");
  }, T);

  it("an incomplete block cannot be published (a body block without a body; an SEO block without SEO text)", async () => {
    await createEditorialDraft({ slug: SEO_BLOCK.slug, title: "SEO", actorId: users.editor });
    await expect(publishEditorialContent({ slug: SEO_BLOCK.slug, expectedVersion: 1, actorId: users.admin })).rejects.toBeInstanceOf(EditorialInvalidError);
    expect(await getPublishedEditorialBlock(SEO_BLOCK.slug)).toBeNull();
    await updateEditorialDraft({ slug: SEO_BLOCK.slug, fields: { title: "SEO", body: null, seoTitle: "A title", seoDescription: "A description" }, expectedVersion: 1, actorId: users.editor });
    await publishEditorialContent({ slug: SEO_BLOCK.slug, expectedVersion: 2, actorId: users.admin });
    expect(await getPublishedEditorialBlock(SEO_BLOCK.slug)).toMatchObject({ seoTitle: "A title", seoDescription: "A description" });
  }, T);

  it("two simultaneous publishes of the same version write exactly one snapshot and one history entry (publishing it again is a no-op)", async () => {
    const current = await row(BODY_BLOCK.slug);
    const before = (await listEditorialPublications(current.id)).filter((p) => p.kind === "PUBLISHED").length;
    const { version } = await updateEditorialDraft({ slug: BODY_BLOCK.slug, fields: { title: "Race", body: "Race body.", seoTitle: null, seoDescription: null }, expectedVersion: current.version, actorId: users.editor });
    const results = await Promise.allSettled([
      publishEditorialContent({ slug: BODY_BLOCK.slug, expectedVersion: version, actorId: users.admin }),
      publishEditorialContent({ slug: BODY_BLOCK.slug, expectedVersion: version, actorId: users.admin }),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    const after = (await listEditorialPublications(current.id)).filter((p) => p.kind === "PUBLISHED").length;
    expect(after - before).toBe(1);
    expect((await getPublishedEditorialBlock(BODY_BLOCK.slug))?.title).toBe("Race");
    await publishEditorialContent({ slug: BODY_BLOCK.slug, expectedVersion: version, actorId: users.admin }); // a later repeat is also a no-op
    expect((await listEditorialPublications(current.id)).filter((p) => p.kind === "PUBLISHED").length).toBe(after);
  }, T);
});

describe("unpublishing, history and audit", () => {
  it("unpublishing removes the block from the public reader, keeps the draft, and records the snapshot that was live", async () => {
    expect(await unpublishEditorialContent({ slug: BODY_BLOCK.slug, actorId: users.admin })).toBe(true);
    expect(await getPublishedEditorialBlock(BODY_BLOCK.slug)).toBeNull();
    expect(await unpublishEditorialContent({ slug: BODY_BLOCK.slug, actorId: users.admin })).toBe(false); // already unpublished: no-op
    const current = await row(BODY_BLOCK.slug);
    expect(current).toMatchObject({ status: "DRAFT", title: "Race" });
    expect(deriveEditorialBlockState(current)).toBe("UNPUBLISHED");
    const history = await listEditorialPublications(current.id);
    expect(history[0]).toMatchObject({ kind: "UNPUBLISHED", title: "Race" });
    expect(history.map((h) => h.kind)).toContain("PUBLISHED");
  }, T);

  it("every lifecycle step is audited with the actor", async () => {
    const id = (await row(BODY_BLOCK.slug)).id;
    const entries = await prisma.auditLogEntry.findMany({ where: { entityType: "EditorialContent", entityId: id } });
    const actions = new Set(entries.map((e) => e.action));
    for (const action of ["EDITORIAL_CONTENT_CREATED", "EDITORIAL_CONTENT_DRAFT_UPDATED", "EDITORIAL_CONTENT_PUBLISHED", "EDITORIAL_CONTENT_UNPUBLISHED"]) expect(actions.has(action), action).toBe(true);
    expect(entries.every((e) => e.actorId !== null)).toBe(true);
  }, T);
});

describe("permissions (Server Actions)", () => {
  it("a Contributor can neither edit nor publish; an Editor can edit but not publish or unpublish; an Administrator can do all", async () => {
    const slug = EDITORIAL_BLOCKS.find((b) => !b.usesBody && !b.usesSeo)!.slug;
    as("contributor");
    expect(await redirectOf(() => createDraftAction(slug))).toMatch(/permission/i);
    expect(await prisma.editorialContent.findUnique({ where: { slug } })).toBeNull();

    as("editor");
    await redirectOf(() => createDraftAction(slug));
    const form = new FormData();
    form.set("expectedVersion", "1");
    form.set("title", "A tagline");
    expect(await redirectOf(() => saveDraftAction(slug, form))).toMatch(/saved=1/);
    const publishForm = new FormData();
    publishForm.set("expectedVersion", "2");
    expect(await redirectOf(() => publishAction(slug, publishForm))).toMatch(/permission/i);
    expect(await getPublishedEditorialBlock(slug)).toBeNull();

    as("admin");
    expect(await redirectOf(() => publishAction(slug, publishForm))).toMatch(/published=1/);
    expect(await getPublishedEditorialBlock(slug)).toMatchObject({ title: "A tagline" });

    as("editor");
    expect(await redirectOf(() => unpublishAction(slug))).toMatch(/permission/i);
    expect(await getPublishedEditorialBlock(slug)).not.toBeNull();
    as("admin");
    await redirectOf(() => unpublishAction(slug));
    expect(await getPublishedEditorialBlock(slug)).toBeNull();
  }, T);

  it("a stale save through the action reports the conflict and writes nothing", async () => {
    const slug = EDITORIAL_BLOCKS.find((b) => !b.usesBody && !b.usesSeo)!.slug;
    const before = await row(slug);
    as("editor");
    const form = new FormData();
    form.set("expectedVersion", String(before.version - 1));
    form.set("title", "Stale write");
    expect(await redirectOf(() => saveDraftAction(slug, form))).toMatch(/changed by someone else/i);
    expect((await row(slug)).title).toBe(before.title);
  }, T);
});
