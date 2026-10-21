import { writeAuditLog } from "../../audit/writeAuditLog";
import { EDITORIAL_BLOCKS, findEditorialBlock, listPublishProblems, validateEditorialFieldLimits, type EditorialBlockDefinition, type EditorialFields } from "../../mmke/editorial/editorialBlocks";
import {
  EditorialBlockExistsError,
  EditorialBlockUnknownError,
  EditorialConflictError,
  EditorialContentNotFoundError,
  EditorialInvalidError,
} from "../../mmke/editorial/editorialErrors";
import { findBuiltInCopy } from "../../mmke/editorial/builtInCopy";
import { prisma } from "../client";
import { isUniqueConstraintViolation } from "../isUniqueConstraintViolation";
import type { EditorialContent, EditorialContentPublication } from "@prisma/client";

// Phase 6K-1 — EditorialContent with a real draft/publish lifecycle (site-level copy: homepage introduction and story, footer tagline,
// section introductions, site SEO). The public site reads ONLY the published snapshot columns (`published*`), so editing the draft can
// never silently change the live website. Each publish and unpublish writes a history row (the exact snapshot) and an audit entry in
// the same transaction; `version` counts draft edits and publishing requires the version the editor reviewed (a draft edited after a
// preview cannot be published unseen). Authorization is decided by the calling Server Action (CATALOGUE_WRITE to edit,
// RECORDING_PUBLISH to publish or unpublish).

export type EditorialBlockState = "NOT_CREATED" | "DRAFT" | "PUBLISHED" | "PUBLISHED_WITH_CHANGES" | "UNPUBLISHED";

export function deriveEditorialBlockState(row: Pick<EditorialContent, "status" | "version" | "publishedVersion" | "publishedAt"> | null): EditorialBlockState {
  if (!row) return "NOT_CREATED";
  if (row.status === "PUBLISHED") return row.publishedVersion !== null && row.publishedVersion !== row.version ? "PUBLISHED_WITH_CHANGES" : "PUBLISHED";
  return row.publishedAt ? "UNPUBLISHED" : "DRAFT";
}

export interface EditorialBlockSummary {
  definition: EditorialBlockDefinition;
  row: EditorialContent | null;
  state: EditorialBlockState;
}

export async function listEditorialBlocksForStudio(): Promise<EditorialBlockSummary[]> {
  const rows = await prisma.editorialContent.findMany({ where: { slug: { in: EDITORIAL_BLOCKS.map((b) => b.slug) } } });
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  return EDITORIAL_BLOCKS.map((definition) => {
    const row = bySlug.get(definition.slug) ?? null;
    return { definition, row, state: deriveEditorialBlockState(row) };
  });
}

export function findEditorialContentBySlug(slug: string): Promise<EditorialContent | null> {
  return prisma.editorialContent.findUnique({ where: { slug } });
}

export function listEditorialPublications(contentId: string): Promise<EditorialContentPublication[]> {
  return prisma.editorialContentPublication.findMany({ where: { contentId }, orderBy: { createdAt: "desc" } });
}

export async function createEditorialDraft(input: { slug: string; title: string; actorId: string }): Promise<EditorialContent> {
  const block = findEditorialBlock(input.slug);
  if (!block) throw new EditorialBlockUnknownError(input.slug);
  const title = input.title.trim();
  const problems = validateEditorialFieldLimits({ title, body: null, seoTitle: null, seoDescription: null });
  if (problems.length > 0) throw new EditorialInvalidError(problems);
  return prisma.$transaction(async (tx) => {
    let row: EditorialContent;
    try {
      row = await tx.editorialContent.create({ data: { slug: block.slug, title, createdById: input.actorId, updatedById: input.actorId } });
    } catch (err) {
      if (isUniqueConstraintViolation(err)) throw new EditorialBlockExistsError();
      throw err;
    }
    await writeAuditLog({ actorId: input.actorId, action: "EDITORIAL_CONTENT_CREATED", entityType: "EditorialContent", entityId: row.id, afterSnapshot: { slug: row.slug, version: row.version } }, tx);
    return row;
  });
}

export interface UpdateEditorialDraftInput {
  slug: string;
  fields: EditorialFields;
  expectedVersion: number;
  actorId: string;
}

const clean = (value: string | null): string | null => {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
};

export async function updateEditorialDraft(input: UpdateEditorialDraftInput): Promise<{ version: number; changed: boolean }> {
  if (!findEditorialBlock(input.slug)) throw new EditorialBlockUnknownError(input.slug);
  const fields: EditorialFields = { title: input.fields.title.trim(), body: clean(input.fields.body), seoTitle: clean(input.fields.seoTitle), seoDescription: clean(input.fields.seoDescription) };
  const problems = validateEditorialFieldLimits(fields);
  if (problems.length > 0) throw new EditorialInvalidError(problems);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.editorialContent.findUnique({ where: { slug: input.slug } });
    if (!existing) throw new EditorialContentNotFoundError();
    if (existing.version !== input.expectedVersion) throw new EditorialConflictError();

    const changedFields = (["title", "body", "seoTitle", "seoDescription"] as const).filter((f) => (existing[f] ?? null) !== (fields[f] ?? null));
    if (changedFields.length === 0) return { version: existing.version, changed: false };

    const moved = await tx.editorialContent.updateMany({
      where: { id: existing.id, version: input.expectedVersion },
      data: { ...fields, version: { increment: 1 }, updatedById: input.actorId },
    });
    if (moved.count !== 1) throw new EditorialConflictError();
    await writeAuditLog({ actorId: input.actorId, action: "EDITORIAL_CONTENT_DRAFT_UPDATED", entityType: "EditorialContent", entityId: existing.id, afterSnapshot: { version: existing.version + 1, changedFields } }, tx);
    return { version: existing.version + 1, changed: true };
  });
}

/** Publishes the draft the editor reviewed (`expectedVersion`), after checking it is complete for its block. */
export async function publishEditorialContent(input: { slug: string; expectedVersion: number; actorId: string }): Promise<EditorialContent> {
  const block = findEditorialBlock(input.slug);
  if (!block) throw new EditorialBlockUnknownError(input.slug);
  return prisma.$transaction(async (tx) => {
    const row = await tx.editorialContent.findUnique({ where: { slug: input.slug } });
    if (!row) throw new EditorialContentNotFoundError();
    if (row.version !== input.expectedVersion) throw new EditorialConflictError();
    const problems = listPublishProblems(block, { title: row.title, body: row.body, seoTitle: row.seoTitle, seoDescription: row.seoDescription });
    if (problems.length > 0) throw new EditorialInvalidError(problems);

    // Already published at exactly this version: publishing it again is a no-op (no second history entry, publishedAt unchanged).
    if (row.status === "PUBLISHED" && row.publishedVersion === row.version) return row;

    const now = new Date();
    const moved = await tx.editorialContent.updateMany({
      // The guard also requires that this version is not already the published one, so two simultaneous publishes of the same version
      // write exactly one snapshot and one history entry (the loser re-reads below and treats it as already done).
      where: { id: row.id, version: input.expectedVersion, OR: [{ status: "DRAFT" }, { publishedVersion: null }, { publishedVersion: { not: input.expectedVersion } }] },
      data: {
        status: "PUBLISHED",
        publishedTitle: row.title,
        publishedBody: row.body,
        publishedSeoTitle: row.seoTitle,
        publishedSeoDescription: row.seoDescription,
        publishedVersion: row.version,
        publishedAt: now,
        publishedById: input.actorId,
      },
    });
    if (moved.count !== 1) {
      const current = await tx.editorialContent.findUnique({ where: { id: row.id } });
      if (current && current.status === "PUBLISHED" && current.publishedVersion === input.expectedVersion) return current; // the concurrent publish of this same version won
      throw new EditorialConflictError();
    }
    await tx.editorialContentPublication.create({
      data: { contentId: row.id, kind: "PUBLISHED", version: row.version, title: row.title, body: row.body, seoTitle: row.seoTitle, seoDescription: row.seoDescription, actorId: input.actorId },
    });
    await writeAuditLog({ actorId: input.actorId, action: "EDITORIAL_CONTENT_PUBLISHED", entityType: "EditorialContent", entityId: row.id, beforeSnapshot: { status: row.status, publishedVersion: row.publishedVersion }, afterSnapshot: { status: "PUBLISHED", version: row.version } }, tx);
    return tx.editorialContent.findUniqueOrThrow({ where: { id: row.id } });
  });
}

/** Takes the block off the public site. The draft and the history stay. Returns false when it was not published. */
export async function unpublishEditorialContent(input: { slug: string; actorId: string }): Promise<boolean> {
  if (!findEditorialBlock(input.slug)) throw new EditorialBlockUnknownError(input.slug);
  return prisma.$transaction(async (tx) => {
    const row = await tx.editorialContent.findUnique({ where: { slug: input.slug } });
    if (!row) throw new EditorialContentNotFoundError();
    if (row.status !== "PUBLISHED") return false;
    const moved = await tx.editorialContent.updateMany({ where: { id: row.id, status: "PUBLISHED" }, data: { status: "DRAFT" } });
    if (moved.count !== 1) return false;
    await tx.editorialContentPublication.create({
      data: {
        contentId: row.id,
        kind: "UNPUBLISHED",
        version: row.publishedVersion ?? row.version,
        title: row.publishedTitle ?? row.title,
        body: row.publishedBody,
        seoTitle: row.publishedSeoTitle,
        seoDescription: row.publishedSeoDescription,
        actorId: input.actorId,
      },
    });
    await writeAuditLog({ actorId: input.actorId, action: "EDITORIAL_CONTENT_UNPUBLISHED", entityType: "EditorialContent", entityId: row.id, beforeSnapshot: { status: "PUBLISHED" }, afterSnapshot: { status: "DRAFT" } }, tx);
    return true;
  });
}

export interface PublishedEditorialBlock {
  slug: string;
  title: string;
  body: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  publishedAt: Date | null;
}

/** What the public site may render: the PUBLISHED SNAPSHOT of a defined block, or null. Never the draft. */
export async function getPublishedEditorialBlock(slug: string): Promise<PublishedEditorialBlock | null> {
  if (!findEditorialBlock(slug)) return null;
  const row = await prisma.editorialContent.findUnique({ where: { slug } });
  if (!row || row.status !== "PUBLISHED" || row.archivedAt !== null || row.publishedTitle === null) return null;
  return { slug: row.slug, title: row.publishedTitle, body: row.publishedBody, seoTitle: row.publishedSeoTitle, seoDescription: row.publishedSeoDescription, publishedAt: row.publishedAt };
}

/** Several blocks at once (one query), for pages that use more than one. */
export async function getPublishedEditorialBlocks(slugs: readonly string[]): Promise<Map<string, PublishedEditorialBlock>> {
  const defined = slugs.filter((slug) => findEditorialBlock(slug));
  if (defined.length === 0) return new Map();
  const rows = await prisma.editorialContent.findMany({ where: { slug: { in: defined }, status: "PUBLISHED", archivedAt: null } });
  const out = new Map<string, PublishedEditorialBlock>();
  for (const row of rows) {
    if (row.publishedTitle === null) continue;
    out.set(row.slug, { slug: row.slug, title: row.publishedTitle, body: row.publishedBody, seoTitle: row.publishedSeoTitle, seoDescription: row.publishedSeoDescription, publishedAt: row.publishedAt });
  }
  return out;
}

export interface ResolvedEditorialBlock extends Omit<PublishedEditorialBlock, "publishedAt"> {
  /** "published" is stored content; "built-in" is the transitional launch wording (modules/mmke/editorial/builtInCopy.ts). */
  source: "published" | "built-in";
}

/**
 * What the public site renders for a block: its published snapshot; or, only while it has never been published, the registered built-in
 * wording; or nothing. A block taken off the site on purpose (unpublished after having been published) renders nothing.
 */
export async function resolveEditorialBlocks(slugs: readonly string[]): Promise<Map<string, ResolvedEditorialBlock>> {
  const defined = slugs.filter((slug) => findEditorialBlock(slug));
  const out = new Map<string, ResolvedEditorialBlock>();
  if (defined.length === 0) return out;
  const rows = await prisma.editorialContent.findMany({ where: { slug: { in: [...defined] } } });
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  for (const slug of defined) {
    const row = bySlug.get(slug) ?? null;
    const state = deriveEditorialBlockState(row);
    if (row && (state === "PUBLISHED" || state === "PUBLISHED_WITH_CHANGES") && row.archivedAt === null && row.publishedTitle !== null) {
      out.set(slug, { slug, title: row.publishedTitle, body: row.publishedBody, seoTitle: row.publishedSeoTitle, seoDescription: row.publishedSeoDescription, source: "published" });
    } else if (state === "NOT_CREATED" || state === "DRAFT") {
      const builtIn = findBuiltInCopy(slug);
      if (builtIn) out.set(slug, { slug, ...builtIn, source: "built-in" });
    }
  }
  return out;
}

export async function resolveEditorialBlock(slug: string): Promise<ResolvedEditorialBlock | null> {
  return (await resolveEditorialBlocks([slug])).get(slug) ?? null;
}

/** Creates the draft pre-filled with the registered built-in wording, so editing starts from what the site already says. */
export async function createEditorialDraftFromBuiltIn(input: { slug: string; actorId: string }): Promise<EditorialContent> {
  const block = findEditorialBlock(input.slug);
  if (!block) throw new EditorialBlockUnknownError(input.slug);
  const builtIn = findBuiltInCopy(input.slug);
  if (!builtIn) throw new EditorialInvalidError(["There is no built-in text for this block."]);
  return prisma.$transaction(async (tx) => {
    let row: EditorialContent;
    try {
      row = await tx.editorialContent.create({
        data: { slug: block.slug, title: builtIn.title, body: builtIn.body, seoTitle: builtIn.seoTitle, seoDescription: builtIn.seoDescription, createdById: input.actorId, updatedById: input.actorId },
      });
    } catch (err) {
      if (isUniqueConstraintViolation(err)) throw new EditorialBlockExistsError();
      throw err;
    }
    await writeAuditLog({ actorId: input.actorId, action: "EDITORIAL_CONTENT_CREATED", entityType: "EditorialContent", entityId: row.id, afterSnapshot: { slug: row.slug, version: row.version, from: "built-in text" } }, tx);
    return row;
  });
}