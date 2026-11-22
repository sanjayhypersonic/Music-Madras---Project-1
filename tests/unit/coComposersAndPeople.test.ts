import { describe, expect, it, vi } from "vitest";
import type { ApprovedFact, VideoFacts } from "../../modules/jobs/videoCreditsApproved";
import { planVideo, describePlan, type VideoCreatePlan } from "../../modules/jobs/videoCreditsCreate";
import { executeCreditsPlans, type ExecuteDeps } from "../../modules/jobs/videoCreditsCreateExecute";
import { changeComposerOrder, composerWorks, orderContributors, orderWorkComposers, workJsonLd } from "../../modules/mmke/workPage/workCredits";
import { matchPerson, type PersonAlias } from "../../modules/mmke/people/personMatch";
import { assemblePersonPageParts } from "../../modules/mmke/people/personPage";
import { normalizeNameForComparison } from "../../modules/mmke/duplicate-detection/detectDuplicateName";

// The executor imports the repositories, which import the database client; every dependency below is a fake, so the client is never used.
vi.mock("../../modules/db/client", () => ({ prisma: {} }));

// R-36: co-composers, contributors, ensembles and one person page per human. FAKE data only (invented ids, slugs and facts; the names follow
// the owner's examples); an in-memory catalogue stands in for the database. No real API, no database.

let row = 0;
const fact = (youtubeVideoId: string, kind: ApprovedFact["kind"], name: string, extra: Partial<ApprovedFact> = {}): ApprovedFact => ({
  youtubeVideoId,
  kind,
  name,
  proposedName: name,
  roleLabel: "",
  workTitle: "",
  sourceField: "description",
  quote: `${kind}: ${name}`,
  basis: "2 stated in description",
  venueTypeBasis: "",
  tier: "GREEN",
  decision: "accept",
  notes: "",
  sheetRow: ++row,
  ...extra,
});
const video = (youtubeVideoId: string, title: string, facts: ApprovedFact[]): VideoFacts => ({
  youtubeVideoId,
  youtubeTitle: title,
  proposedRecordingTitle: "",
  originalLanguageTitle: "",
  transliteration: "",
  isReference: false,
  approvedRecordingTitle: null,
  transliterationApproved: false,
  facts,
  refused: [],
  ignored: 0,
});

const MANGER = "fakeManger1";
const PROMISE = "fakePromis1";
const LULLABY = "fakeLullab1";

const theManger = video(MANGER, "The Manger | Fake Choir", [
  fact(MANGER, "work", "The Manger"),
  fact(MANGER, "composer", "Anne Wilson", { workTitle: "The Manger" }),
  fact(MANGER, "composer", "Jeff Pardo", { workTitle: "The Manger" }),
  fact(MANGER, "composer", "Matthew West", { workTitle: "The Manger" }),
]);

const comeNow = video(PROMISE, "Come Now, Child of Promise | BHC Choir", [
  fact(PROMISE, "work", "Come Now, Child of Promise"),
  fact(PROMISE, "composer", "Nicole Elsey", { workTitle: "Come Now, Child of Promise" }),
  fact(PROMISE, "lyricist", "Nicole Elsey", { workTitle: "Come Now, Child of Promise", roleLabel: 'LYRICIST (label "Words and Music")' }),
  fact(PROMISE, "arranger", "Douglas Nolan", { workTitle: "Come Now, Child of Promise", roleLabel: 'ARRANGER (label "Arranged by")' }),
  fact(PROMISE, "other unmodelled", "Tess Translator", { workTitle: "Come Now, Child of Promise", roleLabel: 'UNMODELLED TRANSLATOR (label "Translated by")' }),
  fact(PROMISE, "choir/ensemble", "Bishop Heber Chapel Choir", { roleLabel: 'CHOIR (label "Choir")' }),
  fact(PROMISE, "choir/ensemble", "Fake Strings", { roleLabel: 'ENSEMBLE (label "Strings")' }),
  fact(PROMISE, "conductor", "Jacob George"),
  fact(PROMISE, "venue", "Bishop Heber Chapel"),
  fact(PROMISE, "venueType", "CHURCH", { venueTypeBasis: "inferred from name (editor-accepted)" }),
  fact(PROMISE, "performanceDate", "2025-12-12"),
  fact(PROMISE, "presenter", "Music Madras", { roleLabel: "UNMODELLED PRESENTER" }),
  fact(PROMISE, "institution", "Madras Christian College", { roleLabel: "UNMODELLED INSTITUTION" }),
  fact(PROMISE, "other unmodelled", "Long-Awaited One", { roleLabel: 'UNMODELLED PUBLISHED TITLE (label "Published title")' }),
  fact(PROMISE, "other unmodelled", "Fake Dancer", { roleLabel: 'UNMODELLED CHOREOGRAPHER (label "Choreography")' }),
]);

const lullaby = video(LULLABY, "Fake Lullaby | Finley Abraham", [
  fact(LULLABY, "work", "Fake Lullaby"),
  fact(LULLABY, "composer", "Finley Abraham", { workTitle: "Fake Lullaby" }),
  fact(LULLABY, "conductor", "Finley Abraham"),
  fact(LULLABY, "performer", "Allen Samuel", { roleLabel: 'PERFORMER (label "Tenor")' }),
  fact(LULLABY, "venue", "Fake Hall"),
  fact(LULLABY, "venueType", "INDOOR_AUDITORIUM", { venueTypeBasis: "editor-chosen" }),
]);

describe("the planner (co-composers, contributors, ensembles, sidecar)", () => {
  it("no longer holds out a work with several approved composers: The Manger keeps all three, in stated order", () => {
    const plan = planVideo(theManger);
    expect(plan.heldReasons).toEqual([]);
    expect(plan.works[0].composers.map((c) => c.name)).toEqual(["Anne Wilson", "Jeff Pardo", "Matthew West"]);
    expect(describePlan(plan).join("\n")).toContain("Co-composer 3: Matthew West");
  });

  it("plans lyricists, arrangers and translators as the work's contributors, an ensemble on the Performance, and keeps only homeless facts in the sidecar", () => {
    const plan = planVideo(comeNow);
    expect(plan.works[0].composers.map((c) => c.name)).toEqual(["Nicole Elsey"]);
    expect(plan.works[0].contributors.map((c) => `${c.role}:${c.name}`)).toEqual(["LYRICIST:Nicole Elsey", "ARRANGER:Douglas Nolan", "TRANSLATOR:Tess Translator"]);
    expect(plan.choirs.map((c) => c.name)).toEqual(["Bishop Heber Chapel Choir"]);
    expect(plan.ensembles.map((c) => c.name)).toEqual(["Fake Strings"]);
    expect(plan.sidecar.map((s) => `${s.label}:${s.name}`).sort()).toEqual(["CHOREOGRAPHER:Fake Dancer", "INSTITUTION:Madras Christian College", "PRESENTER:Music Madras", "PUBLISHED TITLE:Long-Awaited One"]);
  });

  it("sends a contributor of no planned work, and an ensemble with no Performance, to the sidecar with the reason", () => {
    const plan = planVideo(
      video("fakeOrphan1", "x", [
        fact("fakeOrphan1", "work", "A Work"),
        fact("fakeOrphan1", "composer", "Ann Example", { workTitle: "A Work" }),
        fact("fakeOrphan1", "arranger", "Cara Placeholder", { workTitle: "Some Other Work" }),
        fact("fakeOrphan1", "choir/ensemble", "Fake Orchestra", { roleLabel: "ENSEMBLE" }),
      ])
    );
    expect(plan.sidecar.map((s) => s.reason)).toEqual(['arranger of "Some Other Work", which is not a planned work of this video.', "No Performance to attach the ensemble to (no Venue)."]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// An in-memory catalogue: the executor writes into it through its dependencies; the public-page helpers read from it.

class FakeCatalogue {
  n = 0;
  composers: Array<{ id: string; slug: string; name: string; personId: string | null; archivedAt: null }> = [];
  conductors: Array<{ id: string; slug: string; name: string; personId: string | null; archivedAt: null }> = [];
  artists: Array<{ id: string; slug: string; name: string; personId: string | null; archivedAt: null }> = [];
  persons: Array<{ id: string; slug: string; name: string }> = [];
  aliases: PersonAlias[] = [{ aliasKey: normalizeNameForComparison("Allen Samuel"), canonicalName: "Allan Samuel" }];
  works: Array<{ id: string; slug: string; title: string; composerId: string; alternateTitles: string[] }> = [];
  workComposers: Array<{ workId: string; composerId: string; position: number }> = [];
  contributors: Array<{ musicalWorkId: string; personId: string; role: "LYRICIST" | "ARRANGER" | "TRANSLATOR" }> = [];
  ensembles: Array<{ id: string; slug: string; name: string }> = [];
  performanceEnsembles: Array<{ performanceId: string; ensembleId: string }> = [];
  performanceConductors: Array<{ performanceId: string; conductorId: string }> = [];
  performancePerformers: Array<{ performanceId: string; artistId: string }> = [];
  recordings = new Map<string, { id: string; slug: string; title: string | null; workIds: string[]; performanceId: string | null }>();
  id = (p: string) => `${p}-${++this.n}`;
  slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  findOrCreatePerson = (name: string) => {
    const m = matchPerson(name, this.persons, this.aliases);
    if (m.kind !== "new") return { person: m.person, created: false };
    const person = { id: this.id("person"), slug: this.slug(m.name), name: m.name };
    this.persons.push(person);
    return { person, created: true };
  };
  /** The repository's linkRoleToPerson, in memory. */
  link = (kind: "COMPOSER" | "CONDUCTOR" | "ARTIST", record: { id: string; name: string; personId: string | null }) => {
    const table = kind === "COMPOSER" ? this.composers : kind === "CONDUCTOR" ? this.conductors : this.artists;
    const stored = table.find((r) => r.id === record.id)!;
    if (stored.personId) return { personId: stored.personId, personCreated: false, linked: false };
    const { person, created } = this.findOrCreatePerson(stored.name);
    stored.personId = person.id;
    return { personId: person.id, personCreated: created, linked: true };
  };

  deps(): Partial<ExecuteDeps> {
    const draft = (recordingId: string) => {
      const r = this.recordings.get(recordingId)!;
      return { recordingId, status: "DRAFT" as const, revisionId: `rev-${recordingId}`, revisionUpdatedAt: new Date(0), revisionUpdatedById: "actor", title: r.title, performanceId: r.performanceId, workIds: r.workIds };
    };
    const role = <T extends { id: string; slug: string; name: string; personId: string | null; archivedAt: null }>(table: T[], prefix: string) => ({
      list: async () => table,
      create: async (input: { slug: string; name: string }) => {
        const rec = { id: this.id(prefix), slug: input.slug, name: input.name, personId: null, archivedAt: null } as T;
        table.push(rec);
        return rec;
      },
    });
    const composers = role(this.composers, "composer");
    const conductors = role(this.conductors, "conductor");
    const artists = role(this.artists, "artist");
    const deps = {
      findMirroredVideoStates: async (ids: string[]) => new Map(ids.map((id) => [id, { id: `yt-${id}`, privacyStatus: "public", observabilityState: "OBSERVED" }])),
      ensureImportActor: async () => ({ id: "actor", created: false }),
      listActiveComposers: composers.list,
      createComposer: composers.create,
      listActiveConductors: conductors.list,
      createConductor: conductors.create,
      listActiveArtists: artists.list,
      createArtist: artists.create,
      listMusicalWorksByComposer: async (composerId: string) => this.works.filter((w) => w.composerId === composerId || this.workComposers.some((c) => c.workId === w.id && c.composerId === composerId)),
      createMusicalWork: async (input: { slug: string; title: string; composerId: string; coComposerIds?: string[]; alternateTitles?: string[] }) => {
        const work = { id: this.id("work"), slug: input.slug, title: input.title, composerId: input.composerId, alternateTitles: input.alternateTitles ?? [] };
        this.works.push(work);
        [input.composerId, ...(input.coComposerIds ?? [])].forEach((composerId, i) => this.workComposers.push({ workId: work.id, composerId, position: i + 1 }));
        return work;
      },
      listMusicalWorkComposerIds: async (workId: string) => this.workComposers.filter((c) => c.workId === workId).sort((a, b) => a.position - b.position).map((c) => c.composerId),
      ensurePerson: async (name: string) => this.findOrCreatePerson(name),
      linkRoleToPerson: async (kind: "COMPOSER" | "CONDUCTOR" | "ARTIST", record: { id: string; name: string; personId: string | null }) => this.link(kind, record),
      addWorkContributor: async (input: { musicalWorkId: string; personId: string; role: "LYRICIST" | "ARRANGER" | "TRANSLATOR" }) => {
        if (this.contributors.some((c) => c.musicalWorkId === input.musicalWorkId && c.personId === input.personId && c.role === input.role)) return false;
        this.contributors.push({ musicalWorkId: input.musicalWorkId, personId: input.personId, role: input.role });
        return true;
      },
      ensureEnsemble: async (name: string) => {
        const found = this.ensembles.find((e) => normalizeNameForComparison(e.name) === normalizeNameForComparison(name));
        if (found) return { ensemble: found, created: false };
        const ensemble = { id: this.id("ensemble"), slug: this.slug(name), name };
        this.ensembles.push(ensemble);
        return { ensemble, created: true };
      },
      addEnsembleToPerformance: async (performanceId: string, ensembleId: string) => void this.performanceEnsembles.push({ performanceId, ensembleId }),
      listActiveChoirs: async () => [],
      createChoir: async (input: { slug: string; name: string }) => ({ id: this.id("choir"), slug: input.slug, name: input.name }),
      listActiveVenues: async () => [],
      createVenue: async (input: { slug: string; name: string; type: string }) => ({ id: this.id("venue"), slug: input.slug, name: input.name, type: input.type }),
      createProgramme: async (input: { slug: string; title: string }) => ({ id: this.id("programme"), slug: input.slug, title: input.title }),
      addProgrammeItem: async () => undefined,
      findReusableImportProgramme: async () => null,
      isSlugTaken: async () => false,
      findRecordingLinkedToYouTubeVideo: async () => null,
      createRecordingFromYouTubeVideo: async (input: { youtubeVideoId: string; slugSource: { title: string } }) => {
        const recording = { id: this.id("recording"), slug: this.slug(input.slugSource.title), title: null, workIds: [], performanceId: null };
        this.recordings.set(recording.id, recording);
        return { ok: true, recording };
      },
      getCreditsDraftState: async (recordingId: string) => draft(recordingId),
      updateDraftRevisionContent: async (recordingId: string, _at: Date, _actor: string, patch: { title?: string }) => void (this.recordings.get(recordingId)!.title = patch.title ?? null),
      attachWorkToRevision: async (revisionId: string, workId: string) => void this.recordings.get(revisionId.replace(/^rev-/, ""))!.workIds.push(workId),
      createPerformanceForDraft: async (recordingId: string) => {
        const performance = { id: this.id("performance"), slug: `performance-${recordingId}` };
        this.recordings.get(recordingId)!.performanceId = performance.id;
        return performance;
      },
      editDraftPerformanceParticipants: async (input: { expectedPerformanceId: string; change: (tx: unknown, performanceId: string) => Promise<unknown> }) => {
        await input.change({}, input.expectedPerformanceId);
        return { performanceId: input.expectedPerformanceId };
      },
      addChoirToPerformance: async () => undefined,
      addConductorToPerformance: async (performanceId: string, conductorId: string) => void this.performanceConductors.push({ performanceId, conductorId }),
      addPerformerToPerformance: async (performanceId: string, artistId: string) => void this.performancePerformers.push({ performanceId, artistId }),
    };
    return deps as unknown as Partial<ExecuteDeps>;
  }

  // Public-page helpers over the in-memory catalogue (the same pure functions the repositories use).
  composerPage(name: string) {
    const c = this.composers.find((x) => x.name === name)!;
    return composerWorks(c.id, this.works.map((w) => ({ ...w, composerCredits: this.workComposers.filter((x) => x.workId === w.id) })));
  }
  workPage(title: string) {
    const w = this.works.find((x) => x.title === title)!;
    const primary = this.composers.find((c) => c.id === w.composerId)!;
    const composers = orderWorkComposers(primary, this.workComposers.filter((x) => x.workId === w.id).map((x) => ({ position: x.position, composer: this.composers.find((c) => c.id === x.composerId)! })));
    const contributors = orderContributors(this.contributors.filter((x) => x.musicalWorkId === w.id).map((x) => ({ role: x.role, person: this.persons.find((p) => p.id === x.personId)! })));
    return { composers, contributors, jsonLd: workJsonLd({ title: w.title, url: `https://example.test/works/${w.slug}`, composers, contributors }) };
  }
  personPage(name: string) {
    const person = this.persons.find((p) => p.name === name)!;
    return assemblePersonPageParts({
      composers: this.composers.filter((c) => c.personId === person.id).map((c) => ({ slug: c.slug, name: c.name, works: this.works.filter((w) => w.composerId === c.id), workCredits: this.workComposers.filter((x) => x.composerId === c.id).map((x) => ({ work: { id: x.workId } })) })),
      conductors: this.conductors.filter((c) => c.personId === person.id).map((c) => ({ slug: c.slug, name: c.name, performances: this.performanceConductors.filter((x) => x.conductorId === c.id) })),
      artists: this.artists.filter((a) => a.personId === person.id).map((a) => ({ slug: a.slug, name: a.name, performances: this.performancePerformers.filter((x) => x.artistId === a.id) })),
      workContributions: this.contributors.filter((x) => x.personId === person.id).map((x) => ({ role: x.role, musicalWork: this.works.find((w) => w.id === x.musicalWorkId)! })),
    });
  }
  ensemblePerformanceIds(name: string) {
    const e = this.ensembles.find((x) => x.name === name)!;
    return this.performanceEnsembles.filter((x) => x.ensembleId === e.id).map((x) => x.performanceId);
  }
}

async function runAll(): Promise<{ cat: FakeCatalogue; steps: Awaited<ReturnType<typeof executeCreditsPlans>>["steps"]; plans: VideoCreatePlan[] }> {
  const cat = new FakeCatalogue();
  const plans = [theManger, comeNow, lullaby].map(planVideo);
  const { steps } = await executeCreditsPlans(plans, cat.deps());
  return { cat, steps, plans };
}

describe("the credits create tool writes the existing models", () => {
  it("a work with three composers is on each composer's page, and its page lists them in order (JSON-LD composer is an array)", async () => {
    const { cat, steps } = await runAll();
    for (const name of ["Anne Wilson", "Jeff Pardo", "Matthew West"]) expect(cat.composerPage(name).map((w) => w.title)).toEqual(["The Manger"]);
    expect(cat.composerPage("Anne Wilson")[0].coComposed).toBe(false);
    expect(cat.composerPage("Matthew West")[0].coComposed).toBe(true);
    const page = cat.workPage("The Manger");
    expect(page.composers.map((c) => c.name)).toEqual(["Anne Wilson", "Jeff Pardo", "Matthew West"]);
    expect(page.jsonLd.composer).toEqual([
      { "@type": "Person", name: "Anne Wilson" },
      { "@type": "Person", name: "Jeff Pardo" },
      { "@type": "Person", name: "Matthew West" },
    ]);
    expect(steps.find((s) => s.entity === "MusicalWork.composers")?.detail).toBe("1. Anne Wilson; 2. Jeff Pardo; 3. Matthew West");
  });

  it("the lyricist and arranger are written as contributors and appear on their person pages; Nicole Elsey is one person in two roles", async () => {
    const { cat } = await runAll();
    const page = cat.workPage("Come Now, Child of Promise");
    expect(page.contributors.map((c) => `${c.label} — ${c.person.name}`)).toEqual(["Words — Nicole Elsey", "Arrangement — Douglas Nolan", "Translation — Tess Translator"]);
    expect(page.jsonLd.lyricist).toEqual([{ "@type": "Person", name: "Nicole Elsey" }]);
    expect(page.jsonLd.contributor).toEqual([{ "@type": "Person", name: "Douglas Nolan" }, { "@type": "Person", name: "Tess Translator" }]);
    const nicole = cat.personPage("Nicole Elsey");
    expect(nicole.roles.map((r) => `${r.role}:${r.href}`)).toEqual(["Composer:/composers/nicole-elsey"]);
    expect(nicole.contributions).toEqual([{ role: "LYRICIST", workTitle: "Come Now, Child of Promise", workHref: "/works/come-now-child-of-promise" }]);
    expect(cat.persons.filter((p) => p.name === "Nicole Elsey")).toHaveLength(1);
    expect(cat.personPage("Douglas Nolan").contributions).toEqual([{ role: "ARRANGER", workTitle: "Come Now, Child of Promise", workHref: "/works/come-now-child-of-promise" }]);
  });

  it("the ensemble is written and linked to the Performance, so its page lists that performance", async () => {
    const { cat, steps } = await runAll();
    const performanceId = [...cat.recordings.values()].find((r) => r.slug === "come-now-child-of-promise")!.performanceId!;
    expect(cat.ensemblePerformanceIds("Fake Strings")).toEqual([performanceId]);
    expect(steps.filter((s) => s.entity === "Ensemble" || s.entity === "PerformanceEnsemble").map((s) => `${s.entity}:${s.outcome}`)).toEqual(["Ensemble:CREATED", "PerformanceEnsemble:FILLED"]);
  });

  it("one person across two roles: Finley Abraham as composer and conductor gets ONE person page listing both roles", async () => {
    const { cat } = await runAll();
    expect(cat.persons.filter((p) => p.name === "Finley Abraham")).toHaveLength(1);
    const finley = cat.personPage("Finley Abraham");
    expect(finley.roles.map((r) => r.role)).toEqual(["Composer", "Conductor"]);
    expect(finley.workIds).toHaveLength(1);
    expect(finley.performanceIds).toHaveLength(1);
  });

  it("finds the person through the approved alias table: performer 'Allen Samuel' is Allan Samuel's person page", async () => {
    const { cat } = await runAll();
    expect(cat.persons.map((p) => p.name)).toContain("Allan Samuel");
    expect(cat.persons.map((p) => p.name)).not.toContain("Allen Samuel");
    expect(cat.personPage("Allan Samuel").roles.map((r) => r.role)).toEqual(["Performer"]);
  });

  it("is repeatable: a second run creates nothing new and links nothing twice", async () => {
    const { cat } = await runAll();
    const before = { persons: cat.persons.length, contributors: cat.contributors.length, workComposers: cat.workComposers.length, works: cat.works.length };
    const again = await executeCreditsPlans([theManger, comeNow, lullaby].map(planVideo), { ...cat.deps(), findRecordingLinkedToYouTubeVideo: async () => null });
    expect({ persons: cat.persons.length, contributors: cat.contributors.length, workComposers: cat.workComposers.length, works: cat.works.length }).toEqual(before);
    expect(again.steps.filter((s) => s.entity === "MusicalWork").every((s) => s.outcome === "EXISTING")).toBe(true);
  });
});

describe("work credits, people and Studio ordering rules", () => {
  it("orders composers primary-first and drops archived co-composers and duplicates", () => {
    const a = { id: "a", slug: "a", name: "A" };
    const b = { id: "b", slug: "b", name: "B", archivedAt: null };
    const c = { id: "c", slug: "c", name: "C", archivedAt: new Date() };
    expect(orderWorkComposers(a, [{ position: 3, composer: b }, { position: 1, composer: { ...a, archivedAt: null } }, { position: 2, composer: c }]).map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("Studio: add, remove and reorder composers, never leaving a work without one", () => {
    expect(changeComposerOrder(["a", "b", "c"], { kind: "up", composerId: "c" })).toEqual({ ok: true, order: ["a", "c", "b"] });
    expect(changeComposerOrder(["a", "b"], { kind: "up", composerId: "b" })).toEqual({ ok: true, order: ["b", "a"] });
    expect(changeComposerOrder(["a", "b"], { kind: "down", composerId: "b" })).toEqual({ ok: true, order: ["a", "b"] });
    expect(changeComposerOrder(["a"], { kind: "add", composerId: "b" })).toEqual({ ok: true, order: ["a", "b"] });
    expect(changeComposerOrder(["a", "b"], { kind: "add", composerId: "a" })).toMatchObject({ ok: false });
    expect(changeComposerOrder(["a", "b"], { kind: "remove", composerId: "a" })).toEqual({ ok: true, order: ["b"] });
    expect(changeComposerOrder(["a"], { kind: "remove", composerId: "a" })).toEqual({ ok: false, reason: "A work needs at least one composer: add another before removing this one." });
  });

  it("matches a person by exact normalised name or an approved alias, never fuzzily", () => {
    const persons = [{ id: "p1", name: "Ebenezer Arunkumar" }, { id: "p2", name: "Allan Samuel" }];
    const aliases = [{ aliasKey: "allen samuel", canonicalName: "Allan Samuel" }, { aliasKey: "hanna jane", canonicalName: "Hannah Jane" }];
    expect(matchPerson("Ebenezer ArunKumar", persons, aliases)).toEqual({ kind: "exact", person: persons[0] });
    expect(matchPerson("Allen Samuel", persons, aliases)).toEqual({ kind: "alias", person: persons[1] });
    expect(matchPerson("Hanna Jane", persons, aliases)).toEqual({ kind: "new", name: "Hannah Jane", viaAlias: true });
    expect(matchPerson("Alan Samuel", persons, aliases)).toEqual({ kind: "new", name: "Alan Samuel", viaAlias: false });
  });
});

describe("a rerun on a Recording whose Performance already exists", () => {
  it("still finds the conductor and performer records and links each to its Person, adding no participant and creating no role record", async () => {
    const cat = new FakeCatalogue();
    const recordingByVideo = new Map<string, string>();
    const base = cat.deps() as unknown as Record<string, (...args: never[]) => Promise<unknown>>;
    const remember = {
      createRecordingFromYouTubeVideo: async (input: { youtubeVideoId: string; slugSource: { title: string } }) => {
        const result = (await (base.createRecordingFromYouTubeVideo as unknown as (i: typeof input) => Promise<{ ok: true; recording: { id: string; slug: string } }>)(input));
        recordingByVideo.set(input.youtubeVideoId, result.recording.id);
        return result;
      },
    };
    // First run as it happened on staging before R-36: the records are created, but no role record is linked to a person.
    await executeCreditsPlans([planVideo(lullaby)], { ...cat.deps(), ...remember, linkRoleToPerson: async () => ({ personId: null, personCreated: false, linked: false }) } as unknown as Partial<ExecuteDeps>);
    expect(cat.persons).toHaveLength(0);
    expect(cat.conductors.map((c) => [c.name, c.personId])).toEqual([["Finley Abraham", null]]);
    const before = { conductors: cat.conductors.length, artists: cat.artists.length, performanceConductors: cat.performanceConductors.length, performancePerformers: cat.performancePerformers.length };

    // The rerun: the Recording is linked to the video and already has its Performance (last changed by the import actor).
    const { steps } = await executeCreditsPlans([planVideo(lullaby)], {
      ...cat.deps(),
      findRecordingLinkedToYouTubeVideo: async (youtubeVideoRowId: string) => {
        const recordingId = recordingByVideo.get(youtubeVideoRowId);
        return recordingId ? { recordingId, slug: cat.recordings.get(recordingId)!.slug } : null;
      },
    } as unknown as Partial<ExecuteDeps>);

    expect(steps.find((s) => s.entity === "Performance")).toMatchObject({ outcome: "EXISTING" });
    expect(steps.filter((s) => s.entity === "Conductor" || s.entity === "Artist").map((s) => `${s.entity}:${s.outcome}:${s.name}`)).toEqual(["Conductor:EXISTING:Finley Abraham", "Artist:EXISTING:Allen Samuel"]);
    // One person for Finley Abraham across composer and conductor; Allen Samuel linked to Allan Samuel through the approved alias.
    const finley = cat.persons.filter((p) => p.name === "Finley Abraham");
    expect(finley).toHaveLength(1);
    expect(cat.composers.find((c) => c.name === "Finley Abraham")!.personId).toBe(finley[0].id);
    expect(cat.conductors.find((c) => c.name === "Finley Abraham")!.personId).toBe(finley[0].id);
    expect(cat.artists.find((a) => a.name === "Allen Samuel")!.personId).toBe(cat.persons.find((p) => p.name === "Allan Samuel")!.id);
    expect(cat.personPage("Finley Abraham").roles.map((r) => r.role)).toEqual(["Composer", "Conductor"]);
    // Nothing added to the Performance, no role record created.
    expect({ conductors: cat.conductors.length, artists: cat.artists.length, performanceConductors: cat.performanceConductors.length, performancePerformers: cat.performancePerformers.length }).toEqual(before);
    expect(steps.some((s) => s.entity === "PerformanceConductor" || s.entity === "PerformancePerformer")).toBe(false);
  });

  it("reports, and never creates, a conductor with no existing record", async () => {
    const cat = new FakeCatalogue();
    const recordingId = "recording-existing";
    cat.recordings.set(recordingId, { id: recordingId, slug: "fake-lullaby", title: "Fake Lullaby", workIds: ["work-x"], performanceId: "performance-existing" });
    const { steps } = await executeCreditsPlans([planVideo(lullaby)], { ...cat.deps(), findRecordingLinkedToYouTubeVideo: async () => ({ recordingId, slug: "fake-lullaby" }) } as unknown as Partial<ExecuteDeps>);
    expect(steps.find((s) => s.entity === "Conductor")).toMatchObject({ outcome: "REPORTED", name: "Finley Abraham", detail: expect.stringMatching(/not created/) });
    expect(cat.conductors).toHaveLength(0);
    expect(cat.artists).toHaveLength(0);
  });
});

describe("R-38: no Person for a translated title or for Traditional / Anonymous / Unknown / Various", () => {
  const HYMN = "fakeHymn001";
  const hymn = video(HYMN, "A Fake Hymn | Fake Choir", [
    fact(HYMN, "work", "A Fake Hymn"),
    fact(HYMN, "composer", "Traditional", { workTitle: "A Fake Hymn" }),
    fact(HYMN, "lyricist", "Anonymous", { workTitle: "A Fake Hymn", roleLabel: "LYRICIST" }),
    fact(HYMN, "other unmodelled", "Gerry Translator", { workTitle: "A Fake Hymn", roleLabel: "UNMODELLED Translator" }),
    fact(HYMN, "other unmodelled", "Praise the Fake Lord", { workTitle: "A Fake Hymn", roleLabel: "UNMODELLED Translation" }),
    fact(HYMN, "conductor", "Unknown"),
    fact(HYMN, "venue", "Fake Chapel"),
    fact(HYMN, "venueType", "CHURCH", { venueTypeBasis: "inferred from name (editor-accepted)" }),
  ]);

  it("the planner keeps a translated title and a non-person contributor in the sidecar, and marks a Traditional composer as no person page", () => {
    const plan = planVideo(hymn);
    expect(plan.works[0].composers.map((c) => c.name)).toEqual(["Traditional"]);
    expect(plan.works[0].contributors.map((c) => `${c.role}:${c.name}`)).toEqual(["TRANSLATOR:Gerry Translator"]);
    expect(plan.sidecar.map((s) => `${s.label}:${s.name}`).sort()).toEqual(["LYRICIST:Anonymous", "TRANSLATION:Praise the Fake Lord"]);
    expect(plan.sidecar.find((s) => s.name === "Praise the Fake Lord")?.reason).toMatch(/translated title, not a person/);
    expect(describePlan(plan).join("\n")).toContain("Composer: Traditional [2 stated in description]  (find by exact normalised name, else create; not a person's name: no person page)");
  });

  it("the executor creates the Traditional composer and the Unknown conductor but never a Person for them; the real translator gets one", async () => {
    const cat = new FakeCatalogue();
    await executeCreditsPlans([planVideo(hymn)], cat.deps());
    expect(cat.composers.map((c) => [c.name, c.personId])).toEqual([["Traditional", null]]);
    expect(cat.conductors.map((c) => [c.name, c.personId])).toEqual([["Unknown", null]]);
    expect(cat.persons.map((p) => p.name)).toEqual(["Gerry Translator"]);
    expect(cat.contributors.map((c) => c.role)).toEqual(["TRANSLATOR"]);
  });

  it("the rerun path for an existing Performance links nobody named Unknown either", async () => {
    const cat = new FakeCatalogue();
    cat.conductors.push({ id: "conductor-unknown", slug: "unknown", name: "Unknown", personId: null, archivedAt: null });
    const recordingId = "recording-existing";
    cat.recordings.set(recordingId, { id: recordingId, slug: "a-fake-hymn", title: "A Fake Hymn", workIds: ["work-x"], performanceId: "performance-existing" });
    const { steps } = await executeCreditsPlans([planVideo(hymn)], { ...cat.deps(), findRecordingLinkedToYouTubeVideo: async () => ({ recordingId, slug: "a-fake-hymn" }) } as unknown as Partial<ExecuteDeps>);
    expect(steps.find((s) => s.entity === "Conductor")).toMatchObject({ outcome: "EXISTING", name: "Unknown" });
    expect(steps.some((s) => s.entity === "Conductor.person" || s.entity === "Composer.person")).toBe(false);
    expect(cat.conductors[0].personId).toBeNull();
    expect(cat.persons.map((p) => p.name)).toEqual(["Gerry Translator"]);
  });
});
