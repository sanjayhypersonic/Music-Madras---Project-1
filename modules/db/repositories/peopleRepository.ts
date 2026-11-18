import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import { findExactNormalizedDuplicate } from "../../mmke/duplicate-detection/detectDuplicateName";
import { resolveCanonicalSlug } from "../../mmke/slug/canonicalSlug";
import type { Ensemble, Person, Prisma, WorkContributorRole } from "@prisma/client";

// R-34: Person (one public page per human across roles) and Ensemble (orchestras and instrumental groups), with the same rules as every other
// simple catalogue entity: exact-normalised duplicate guard, the canonical slug rule for a new record, an audit entry, and never a slug change.
// "ensure" finds by exact normalised name and creates only when absent.

type Client = Prisma.TransactionClient | typeof prisma;

export async function ensurePerson(name: string, actorId: string, client: Client = prisma): Promise<{ person: Person; created: boolean }> {
  const existing = await client.person.findMany({ where: { archivedAt: null } });
  const match = findExactNormalizedDuplicate(name, existing.map((p) => p.name));
  const found = match ? existing.find((p) => p.name === match) : undefined;
  if (found) return { person: found, created: false };
  const slug = await resolveCanonicalSlug({ title: name, fallback: "person" }, async (s) => (await client.person.findUnique({ where: { slug: s }, select: { id: true } })) !== null);
  const person = await client.person.create({ data: { slug, name: name.trim(), createdById: actorId, updatedById: actorId } });
  await writeAuditLog({ actorId, action: "PERSON_CREATED", entityType: "Person", entityId: person.id, afterSnapshot: person }, client);
  return { person, created: true };
}

export async function ensureEnsemble(name: string, actorId: string, client: Client = prisma): Promise<{ ensemble: Ensemble; created: boolean }> {
  const existing = await client.ensemble.findMany({ where: { archivedAt: null } });
  const match = findExactNormalizedDuplicate(name, existing.map((e) => e.name));
  const found = match ? existing.find((e) => e.name === match) : undefined;
  if (found) return { ensemble: found, created: false };
  const slug = await resolveCanonicalSlug({ title: name, fallback: "ensemble" }, async (s) => (await client.ensemble.findUnique({ where: { slug: s }, select: { id: true } })) !== null);
  const ensemble = await client.ensemble.create({ data: { slug, name: name.trim(), createdById: actorId, updatedById: actorId } });
  await writeAuditLog({ actorId, action: "ENSEMBLE_CREATED", entityType: "Ensemble", entityId: ensemble.id, afterSnapshot: ensemble }, client);
  return { ensemble, created: true };
}

/** Links an arranger, lyricist or translator to a work. Idempotent (the composite key); never removes a link. */
export async function addWorkContributor(input: { musicalWorkId: string; personId: string; role: WorkContributorRole; actorId: string }, client: Client = prisma): Promise<boolean> {
  const key = { musicalWorkId_personId_role: { musicalWorkId: input.musicalWorkId, personId: input.personId, role: input.role } };
  if (await client.musicalWorkContributor.findUnique({ where: key })) return false;
  await client.musicalWorkContributor.create({ data: { musicalWorkId: input.musicalWorkId, personId: input.personId, role: input.role } });
  await writeAuditLog({ actorId: input.actorId, action: "WORK_CONTRIBUTOR_LINKED", entityType: "MusicalWork", entityId: input.musicalWorkId, afterSnapshot: { personId: input.personId, role: input.role } }, client);
  return true;
}

/** Sets the person behind a composer, conductor or artist record, only when it has none (an editor's existing link is never replaced). */
export async function linkPersonIfUnset(kind: "COMPOSER" | "CONDUCTOR" | "ARTIST", recordId: string, personId: string, actorId: string, client: Client = prisma): Promise<boolean> {
  const where = { id: recordId, personId: null };
  const data = { personId, updatedById: actorId };
  const { count } =
    kind === "COMPOSER" ? await client.composer.updateMany({ where, data }) : kind === "CONDUCTOR" ? await client.conductor.updateMany({ where, data }) : await client.artist.updateMany({ where, data });
  if (count === 1) await writeAuditLog({ actorId, action: "PERSON_LINKED", entityType: kind === "COMPOSER" ? "Composer" : kind === "CONDUCTOR" ? "Conductor" : "Artist", entityId: recordId, afterSnapshot: { personId } }, client);
  return count === 1;
}
