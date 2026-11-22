import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import { findExactNormalizedDuplicate } from "../../mmke/duplicate-detection/detectDuplicateName";
import { resolveCanonicalSlug } from "../../mmke/slug/canonicalSlug";
import { matchPerson } from "../../mmke/people/personMatch";
import type { Ensemble, Person, Prisma, WorkContributorRole } from "@prisma/client";

// R-34: Person (one public page per human across roles) and Ensemble (orchestras and instrumental groups), with the same rules as every other
// simple catalogue entity: exact-normalised duplicate guard, the canonical slug rule for a new record, an audit entry, and never a slug change.
// "ensure" finds by exact normalised name and creates only when absent.

type Client = Prisma.TransactionClient | typeof prisma;

/**
 * R-36: the Person a name is, by EXACT normalised name or the APPROVED ALIAS TABLE (EntityAlias, kind PERSON), else a new Person (named with the
 * alias's canonical spelling when an alias matched). Rules: modules/mmke/people/personMatch.ts.
 */
export async function ensurePerson(name: string, actorId: string, client: Client = prisma): Promise<{ person: Person; created: boolean }> {
  const [existing, aliases] = await Promise.all([client.person.findMany({ where: { archivedAt: null } }), client.entityAlias.findMany({ where: { entityKind: "PERSON" }, select: { aliasKey: true, canonicalName: true } })]);
  const match = matchPerson(name, existing, aliases);
  if (match.kind !== "new") return { person: match.person, created: false };
  const slug = await resolveCanonicalSlug({ title: match.name, fallback: "person" }, async (s) => (await client.person.findUnique({ where: { slug: s }, select: { id: true } })) !== null);
  const person = await client.person.create({ data: { slug, name: match.name, createdById: actorId, updatedById: actorId } });
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

/**
 * R-36: one human, one person page. Links a Composer, Conductor or Artist record to its Person (found by exact normalised name or the approved
 * alias table, else created), only when the record has none: an editor's existing link is never replaced. Called when a role record is created
 * (composer, conductor and artist repositories) and by the credits create tool for records it finds.
 */
export async function linkRoleToPerson(
  kind: "COMPOSER" | "CONDUCTOR" | "ARTIST",
  record: { id: string; name: string; personId: string | null },
  actorId: string,
  client: Client = prisma
): Promise<{ personId: string | null; personCreated: boolean; linked: boolean }> {
  if (record.personId) return { personId: record.personId, personCreated: false, linked: false };
  const { person, created } = await ensurePerson(record.name, actorId, client);
  const linked = await linkPersonIfUnset(kind, record.id, person.id, actorId, client);
  return { personId: linked ? person.id : null, personCreated: created, linked };
}

/** R-36: links an ensemble or orchestra to a Performance (idempotent), inside the participant service's transaction. */
export async function addEnsembleToPerformance(performanceId: string, ensembleId: string, actorId: string, client: Client = prisma): Promise<void> {
  const key = { performanceId_ensembleId: { performanceId, ensembleId } };
  if (await client.performanceEnsemble.findUnique({ where: key })) return;
  await client.performanceEnsemble.create({ data: { performanceId, ensembleId } });
  await writeAuditLog({ actorId, action: "ENSEMBLE_LINKED_TO_PERFORMANCE", entityType: "Performance", entityId: performanceId, afterSnapshot: { ensembleId } }, client);
}
