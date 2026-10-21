import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../modules/db/client";
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import { searchArchiveAll, searchComposers, searchWorks } from "../../modules/db/repositories/archiveSearchRepository";
import { SEARCH_MAX_LENGTH } from "../../modules/mmke/search/searchText";
import { publishRecordingFor } from "./helpers/publishedContent";

// Phase 6K lifecycle hardening, F20 — the public /archive search treats the text a visitor types as TEXT: "%" and "_" are literal characters, never
// wildcards, and a very long input is bounded. (Prisma's `contains` does not escape LIKE wildcards; the repository does.) Isolated test database.

const MARK = randomUUID().slice(0, 8);
const T = 120000;
let userId = "";
const composerIds: string[] = [];
const workIds: string[] = [];
const cleanups: Array<() => Promise<void>> = [];
let counter = 0;

async function publishedComposer(name: string) {
  const composer = await createComposer({ slug: `wild-${MARK}-${++counter}`, name, actorId: userId });
  composerIds.push(composer.id);
  const work = await createMusicalWork({ slug: `wild-work-${MARK}-${counter}`, title: `Wildcard work ${MARK} ${counter}`, composerId: composer.id, actorId: userId });
  workIds.push(work.id);
  const published = await publishRecordingFor({ actorId: userId, workIds: [work.id] });
  cleanups.push(published.cleanup);
  return composer;
}

beforeAll(async () => {
  userId = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `wild-${MARK}@musicmadras.test`, name: "Wildcard tester", role: "EDITOR", status: "ACTIVE" } })).id;
}, T);

afterAll(async () => {
  for (const cleanup of cleanups) await cleanup();
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityId: { in: [...composerIds, ...workIds] } }, { actorId: userId }] } });
  await prisma.musicalWork.deleteMany({ where: { id: { in: workIds } } });
  await prisma.composer.deleteMany({ where: { id: { in: composerIds } } });
  await prisma.studioUser.deleteMany({ where: { id: userId } });
}, T);

describe("wildcard characters in the archive search are literal", () => {
  it("'%' matches only a literal percent sign, never 'anything'", async () => {
    const literal = await publishedComposer(`Zzwild 100% ${MARK}`);
    const plain = await publishedComposer(`Zzwild 1000x ${MARK}`);
    const result = await searchComposers("100%");
    const ids = result.items.map((c) => c.id);
    expect(ids).toContain(literal.id);
    expect(ids).not.toContain(plain.id); // an unescaped "%" would have matched this too
    const everything = await searchComposers("%");
    expect(everything.items.every((c) => c.name.includes("%"))).toBe(true);
    expect(everything.items.map((c) => c.id)).not.toContain(plain.id);
  }, T);

  it("'_' matches only a literal underscore, never 'any one character'", async () => {
    const literal = await publishedComposer(`Zzwild snake_case ${MARK}`);
    const plain = await publishedComposer(`Zzwild snakeXcase ${MARK}`);
    const ids = (await searchComposers("snake_case")).items.map((c) => c.id);
    expect(ids).toContain(literal.id);
    expect(ids).not.toContain(plain.id);
    expect((await searchComposers("_")).items.every((c) => c.name.includes("_"))).toBe(true);
  }, T);

  it("a backslash is literal too, and a query of only wildcards matches nothing that lacks them", async () => {
    const literal = await publishedComposer(`Zzwild back\\slash ${MARK}`);
    expect((await searchComposers("back\\slash")).items.map((c) => c.id)).toContain(literal.id);
    const wildcardsOnly = await searchComposers("%_%_%");
    expect(wildcardsOnly.items.every((c) => /%_%_%/.test(c.name))).toBe(true);
  }, T);

  it("works through every entry point: works, and the all-types discovery search", async () => {
    const composer = await publishedComposer(`Zzwild composer ${MARK}`);
    const work = await createMusicalWork({ slug: `wild-w100-${MARK}`, title: `Zzwild 50% finished ${MARK}`, composerId: composer.id, actorId: userId });
    workIds.push(work.id);
    const published = await publishRecordingFor({ actorId: userId, workIds: [work.id] });
    cleanups.push(published.cleanup);
    const decoy = await createMusicalWork({ slug: `wild-w500-${MARK}`, title: `Zzwild 500 finished ${MARK}`, composerId: composer.id, actorId: userId });
    workIds.push(decoy.id);
    const publishedDecoy = await publishRecordingFor({ actorId: userId, workIds: [decoy.id] });
    cleanups.push(publishedDecoy.cleanup);

    const works = (await searchWorks("50% finished")).items.map((w) => w.id);
    expect(works).toContain(work.id);
    expect(works).not.toContain(decoy.id);
    const all = await searchArchiveAll("50% finished");
    expect(all.works.items.map((w) => w.id)).toContain(work.id);
    expect(all.works.items.map((w) => w.id)).not.toContain(decoy.id);
  }, T);
});

describe("search input is bounded and safe", () => {
  it("a very long input is cut to a fixed length (it cannot be used to make the database evaluate an enormous pattern)", async () => {
    const result = await searchComposers("_".repeat(5000));
    expect(result.total).toBe(0);
    const longName = `Zzwild ${"long ".repeat(10)}${MARK}`;
    const composer = await publishedComposer(longName);
    const found = await searchComposers(`${longName.slice(0, SEARCH_MAX_LENGTH)} and then a great deal more that is ignored ${"x".repeat(1000)}`);
    expect(found.items.map((c) => c.id)).not.toContain(composer.id); // the extra text beyond the bound is ignored, but what is left no longer fits the name exactly
    expect((await searchComposers(longName.slice(0, SEARCH_MAX_LENGTH))).items.map((c) => c.id)).toContain(composer.id);
  }, T);

  it("empty, whitespace-only and undefined searches mean 'no filter' without error, and injection-shaped text is just text", async () => {
    for (const q of [undefined, "", "   ", "\n\t"]) await expect(searchComposers(q)).resolves.toHaveProperty("items");
    for (const q of ["'; drop table composers; --", "\" OR 1=1 --", "') or ('1'='1", "${process.env.SECRET}", "<script>alert(1)</script>"]) {
      const result = await searchComposers(q);
      expect(result.total).toBe(0);
    }
    expect(await prisma.composer.count()).toBeGreaterThan(0); // nothing was dropped
  }, T);
});
