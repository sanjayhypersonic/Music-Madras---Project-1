const fs = require("fs");
const p = "modules/db/repositories/personPageRepository.ts";
let s = fs.readFileSync(p, "utf8");
const rep = (a, b) => { if (!s.includes(a)) throw new Error("missing " + a.slice(0, 70)); s = s.replace(a, b); };
rep('import { resolveRelatedContent, type RelatedContent } from "./entityRelationshipsRepository";', 'import { resolveRelatedContent, type RelatedContent } from "./entityRelationshipsRepository";\nimport { assemblePersonPageParts } from "../../mmke/people/personPage";');
rep('// reachable through any of their roles: composer (works), arranger, lyricist or translator (MusicalWorkContributor), conductor, or performer.',
    '// reachable through any of their roles: composer (works composed or co-composed), arranger, lyricist or translator (MusicalWorkContributor),\n// conductor, or performer. The page itself is assembled by modules/mmke/people/personPage.ts (pure, unit-tested).');
rep('composers: { where: eligibleComposerWhere, select: { slug: true, name: true, works: { where: eligibleWorkWhere, select: { id: true } } } },',
    'composers: { where: eligibleComposerWhere, select: { slug: true, name: true, works: { where: eligibleWorkWhere, select: { id: true } }, workCredits: { where: { work: eligibleWorkWhere }, select: { work: { select: { id: true } } } } } },');
rep(`  if (!person) return null;
  const workIds = [...person.composers.flatMap((c) => c.works.map((w) => w.id)), ...person.workContributions.map((c) => c.musicalWork.id)];
  const performanceIds = [...person.conductors.flatMap((c) => c.performances.map((p) => p.performanceId)), ...person.artists.flatMap((a) => a.performances.map((p) => p.performanceId))];
  const related = await resolveRelatedContent({ workIds: [...new Set(workIds)], performanceIds: [...new Set(performanceIds)] });
  return {
    id: person.id,
    slug: person.slug,
    name: person.name,
    biography: person.biography,
    roles: [
      ...person.composers.map((c) => ({ role: "Composer" as const, name: c.name, href: \`/composers/\${c.slug}\` })),
      ...person.conductors.map((c) => ({ role: "Conductor" as const, name: c.name, href: \`/conductors/\${c.slug}\` })),
      ...person.artists.map((a) => ({ role: "Performer" as const, name: a.name, href: \`/artists/\${a.slug}\` })),
    ],
    contributions: person.workContributions.map((c) => ({ role: c.role, workTitle: c.musicalWork.title, workHref: \`/works/\${c.musicalWork.slug}\` })),
    related,
  };`, `  if (!person) return null;
  const parts = assemblePersonPageParts(person);
  const related = await resolveRelatedContent({ workIds: parts.workIds, performanceIds: parts.performanceIds });
  return { id: person.id, slug: person.slug, name: person.name, biography: person.biography, roles: parts.roles, contributions: parts.contributions, related };`);
fs.writeFileSync(p, s);
// eligibility: a composer is public through a work they composed OR co-composed
const e = "modules/db/repositories/publicEligibility.ts";
let t = fs.readFileSync(e, "utf8");
const a = `export const eligibleComposerWhere: Prisma.ComposerWhereInput = {
  archivedAt: null,
  works: { some: eligibleWorkWhere },
};`;
if (!t.includes(a)) throw new Error("eligibleComposerWhere not found");
t = t.replace(a, `// R-36: a composer is public through a work they composed (MusicalWork.composerId) OR co-composed (musical_work_composers).
export const eligibleComposerWhere: Prisma.ComposerWhereInput = {
  archivedAt: null,
  OR: [{ works: { some: eligibleWorkWhere } }, { workCredits: { some: { work: eligibleWorkWhere } } }],
};`);
fs.writeFileSync(e, t);
console.log("ok");
