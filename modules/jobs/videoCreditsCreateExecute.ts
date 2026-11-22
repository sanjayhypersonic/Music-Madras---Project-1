import { findExactNormalizedDuplicate } from "../mmke/duplicate-detection/detectDuplicateName";
import { resolveCanonicalSlug } from "../mmke/slug/canonicalSlug";
import { createComposer, listActiveComposers } from "../db/repositories/composerRepository";
import { createMusicalWork, listMusicalWorkComposerIds, listMusicalWorksByComposer } from "../db/repositories/musicalWorkRepository";
import { addEnsembleToPerformance, addWorkContributor, ensureEnsemble, ensurePerson, linkRoleToPerson } from "../db/repositories/peopleRepository";
import { createChoir, listActiveChoirs } from "../db/repositories/choirRepository";
import { createConductor, listActiveConductors } from "../db/repositories/conductorRepository";
import { createArtist, listActiveArtists } from "../db/repositories/artistRepository";
import { createVenue, listActiveVenues } from "../db/repositories/venueRepository";
import { addProgrammeItem, createProgramme } from "../db/repositories/programmeRepository";
import { addChoirToPerformance, addConductorToPerformance, addPerformerToPerformance } from "../db/repositories/performanceRepository";
import { createRecordingFromYouTubeVideo, findRecordingLinkedToYouTubeVideo } from "../db/repositories/recordingIntakeRepository";
import { attachWorkToRevision, createPerformanceForDraft, editDraftPerformanceParticipants, updateDraftRevisionContent } from "../db/repositories/recordingRepository";
import { ensureImportActor, findMirroredVideoStates } from "../db/repositories/stagingSeedRepository";
import { findReusableImportProgramme, getCreditsDraftState, isSlugTaken, type SluggedEntity } from "../db/repositories/creditsCreateRepository";
import type { VideoCreatePlan } from "./videoCreditsCreate";

// Credits pipeline, Phase B2: CARRY OUT reviewed plans (modules/jobs/videoCreditsCreate.ts) against the database the application's client is already
// bound to. WHICH database that is, is decided and confirmed by scripts/createVideoCredits.ts with the staging loader's guard
// (modules/seed/stagingTarget.ts) before this module is even imported. Nothing here reads the environment or opens its own connection.
//
// Rules, for every READY video in turn:
//   - the video must be in the database, public and OBSERVED (stored state, never the sheet's claim); otherwise the video is skipped;
//   - an existing linked Recording is touched only while it is DRAFT with an open draft LAST CHANGED BY THE IMPORT ACTOR: once an editor has saved
//     anything, the Recording is left exactly as it is;
//   - catalogue records are matched by exact normalised name (title for a work, within its composer) and created only when absent, with slugs from
//     the canonical slug rule; an existing record is never modified (a differing venue type or missing alternate title is reported, not changed);
//   - only EMPTY draft slots are filled: title, works (in plan order), performance; participants are added only to a Performance created in this
//     same run, through the copy-on-write participant service;
//   - R-36: when the Recording already has a Performance, its participants are left alone, but the plan's conductors and performers are still
//     FOUND by exact normalised name and linked to their Person (nothing is created, added or changed);
//   - R-36: a work's composers are written in stated order (the first is MusicalWork.composerId; co-composers go to musical_work_composers); an
//     EXISTING work whose composers differ is reported, never changed. Lyricists, arrangers and translators are linked to the work as
//     contributors (musical_work_contributors), each a Person found by exact normalised name or the approved alias table, else created; links
//     are additive and idempotent. Ensembles and orchestras are found or created and linked to the Performance made in this run. Every Composer,
//     Conductor and Artist the run creates or finds is linked to its Person when it has none (one human, one person page across roles);
//   - it never publishes, never creates a video page, exposure approval or review, and never writes anything YouTube-controlled.
// Idempotent: a second run finds everything and reports it EXISTING. A failure stops the run; what was made is a valid draft the next run completes.

export type ExecuteOutcome = "CREATED" | "EXISTING" | "FILLED" | "SKIPPED" | "REPORTED";
export interface ExecuteStep {
  youtubeVideoId: string;
  entity: string;
  outcome: ExecuteOutcome;
  name: string;
  basis?: string;
  detail?: string;
}

export interface ExecuteDeps {
  findMirroredVideoStates: typeof findMirroredVideoStates;
  ensureImportActor: typeof ensureImportActor;
  listActiveComposers: typeof listActiveComposers;
  createComposer: typeof createComposer;
  listMusicalWorksByComposer: typeof listMusicalWorksByComposer;
  createMusicalWork: typeof createMusicalWork;
  listMusicalWorkComposerIds: typeof listMusicalWorkComposerIds;
  ensurePerson: (name: string, actorId: string) => Promise<{ person: { id: string; name: string; slug: string }; created: boolean }>;
  linkRoleToPerson: (kind: "COMPOSER" | "CONDUCTOR" | "ARTIST", record: { id: string; name: string; personId: string | null }, actorId: string) => Promise<{ personId: string | null; personCreated: boolean; linked: boolean }>;
  addWorkContributor: (input: { musicalWorkId: string; personId: string; role: "LYRICIST" | "ARRANGER" | "TRANSLATOR"; actorId: string }) => Promise<boolean>;
  ensureEnsemble: (name: string, actorId: string) => Promise<{ ensemble: { id: string; name: string; slug: string }; created: boolean }>;
  addEnsembleToPerformance: typeof addEnsembleToPerformance;
  listActiveChoirs: typeof listActiveChoirs;
  createChoir: typeof createChoir;
  listActiveConductors: typeof listActiveConductors;
  createConductor: typeof createConductor;
  listActiveArtists: typeof listActiveArtists;
  createArtist: typeof createArtist;
  listActiveVenues: typeof listActiveVenues;
  createVenue: typeof createVenue;
  createProgramme: typeof createProgramme;
  addProgrammeItem: typeof addProgrammeItem;
  findReusableImportProgramme: typeof findReusableImportProgramme;
  isSlugTaken: typeof isSlugTaken;
  findRecordingLinkedToYouTubeVideo: typeof findRecordingLinkedToYouTubeVideo;
  createRecordingFromYouTubeVideo: typeof createRecordingFromYouTubeVideo;
  getCreditsDraftState: typeof getCreditsDraftState;
  updateDraftRevisionContent: typeof updateDraftRevisionContent;
  attachWorkToRevision: typeof attachWorkToRevision;
  createPerformanceForDraft: typeof createPerformanceForDraft;
  editDraftPerformanceParticipants: typeof editDraftPerformanceParticipants;
  addChoirToPerformance: typeof addChoirToPerformance;
  addConductorToPerformance: typeof addConductorToPerformance;
  addPerformerToPerformance: typeof addPerformerToPerformance;
}

export const defaultExecuteDeps: ExecuteDeps = {
  findMirroredVideoStates,
  ensureImportActor,
  listActiveComposers,
  createComposer,
  listMusicalWorksByComposer,
  createMusicalWork,
  listMusicalWorkComposerIds,
  ensurePerson: (name, actorId) => ensurePerson(name, actorId),
  linkRoleToPerson: (kind, record, actorId) => linkRoleToPerson(kind, record, actorId),
  addWorkContributor: (input) => addWorkContributor(input),
  ensureEnsemble: (name, actorId) => ensureEnsemble(name, actorId),
  addEnsembleToPerformance,
  listActiveChoirs,
  createChoir,
  listActiveConductors,
  createConductor,
  listActiveArtists,
  createArtist,
  listActiveVenues,
  createVenue,
  createProgramme,
  addProgrammeItem,
  findReusableImportProgramme,
  isSlugTaken,
  findRecordingLinkedToYouTubeVideo,
  createRecordingFromYouTubeVideo,
  getCreditsDraftState,
  updateDraftRevisionContent,
  attachWorkToRevision,
  createPerformanceForDraft,
  editDraftPerformanceParticipants,
  addChoirToPerformance,
  addConductorToPerformance,
  addPerformerToPerformance,
};

export interface ExecuteReport {
  actorCreated: boolean;
  steps: ExecuteStep[];
}

export async function executeCreditsPlans(
  plans: readonly VideoCreatePlan[],
  overrides: Partial<ExecuteDeps> = {},
  onStep?: (step: ExecuteStep) => void,
  /** R-34: the Studio Pipeline inbox runs this AS THE APPROVING EDITOR (their id is the author of every record); default: the import actor. */
  options: { actorId?: string } = {}
): Promise<ExecuteReport> {
  const d: ExecuteDeps = { ...defaultExecuteDeps, ...overrides };
  const ready = plans.filter((p) => p.heldReasons.length === 0 && p.recording);
  const steps: ExecuteStep[] = [];
  const record = (step: ExecuteStep) => {
    steps.push(step);
    onStep?.(step);
  };
  const states = await d.findMirroredVideoStates(ready.map((p) => p.youtubeVideoId));
  const actor = options.actorId ? { id: options.actorId, created: false } : await d.ensureImportActor();
  const actorId = actor.id;
  const slug = (entity: SluggedEntity, title: string, fallback: string, extra: { transliteration?: string | null; year?: string | null } = {}) =>
    resolveCanonicalSlug({ title, fallback, ...extra }, (candidate) => d.isSlugTaken(entity, candidate));

  /** Exact normalised match among `existing`, else create. */
  async function findOrCreate<T extends { id: string }>(
    vid: string,
    entity: string,
    name: string,
    basis: string,
    existing: () => Promise<T[]>,
    label: (row: T) => string,
    create: () => Promise<T>
  ): Promise<T> {
    const rows = await existing();
    const match = findExactNormalizedDuplicate(name, rows.map(label));
    const found = match ? rows.find((r) => label(r) === match) : undefined;
    if (found) {
      record({ youtubeVideoId: vid, entity, outcome: "EXISTING", name: label(found), basis });
      return found;
    }
    const created = await create();
    record({ youtubeVideoId: vid, entity, outcome: "CREATED", name, basis });
    return created;
  }

  /** R-36: one human, one person page: links a role record (created or found) to its Person when it has none. */
  async function linkPerson(vid: string, kind: "COMPOSER" | "CONDUCTOR" | "ARTIST", role: { id: string; name: string; personId?: string | null }) {
    const link = await d.linkRoleToPerson(kind, { id: role.id, name: role.name, personId: role.personId ?? null }, actorId);
    if (link.linked) record({ youtubeVideoId: vid, entity: `${kind === "COMPOSER" ? "Composer" : kind === "CONDUCTOR" ? "Conductor" : "Artist"}.person`, outcome: "FILLED", name: role.name, detail: link.personCreated ? "new person page" : "existing person page" });
  }

  /** R-36: an EXISTING conductor or artist record, found by exact normalised name only (nothing is created or changed), linked to its Person. */
  async function linkExistingRole(vid: string, kind: "CONDUCTOR" | "ARTIST", name: string, basis: string, list: () => Promise<Array<{ id: string; name: string; personId?: string | null }>>) {
    const entity = kind === "CONDUCTOR" ? "Conductor" : "Artist";
    const rows = await list();
    const match = findExactNormalizedDuplicate(name, rows.map((r) => r.name));
    const found = match ? rows.find((r) => r.name === match) : undefined;
    if (!found) {
      record({ youtubeVideoId: vid, entity, outcome: "REPORTED", name, basis, detail: "no existing record with this name; not created (the Performance already exists, so participants are left to the editor)" });
      return;
    }
    record({ youtubeVideoId: vid, entity, outcome: "EXISTING", name: found.name, basis, detail: "found to link its person; the Performance is unchanged" });
    await linkPerson(vid, kind, found);
  }

  for (const plan of ready) {
    const vid = plan.youtubeVideoId;
    const stored = states.get(vid);
    if (!stored || stored.privacyStatus !== "public" || stored.observabilityState !== "OBSERVED") {
      record({ youtubeVideoId: vid, entity: "Video", outcome: "SKIPPED", name: vid, detail: stored ? `stored as ${stored.privacyStatus ?? "unknown privacy"} / ${stored.observabilityState}; a Recording is only made from a public, observed video` : "not in the database (run the full YouTube sync first)" });
      continue;
    }

    // An existing Recording an editor has worked on is never touched (checked before anything is created for it).
    const linkedBefore = await d.findRecordingLinkedToYouTubeVideo(stored.id);
    if (linkedBefore) {
      const state = await d.getCreditsDraftState(linkedBefore.recordingId);
      const why = !state || state.status !== "DRAFT" || !state.revisionId ? `it is ${state?.status ?? "missing"} or has no open draft` : state.revisionUpdatedById !== actorId ? "an editor has changed its draft" : null;
      if (why) {
        record({ youtubeVideoId: vid, entity: "Recording", outcome: "SKIPPED", name: linkedBefore.slug, detail: `${why}; left untouched` });
        continue;
      }
    }

    // Catalogue.
    const workIds: string[] = [];
    for (const w of plan.works) {
      // R-36: every composer in stated order; the first is the primary composer.
      const composers: Array<{ id: string; name: string }> = [];
      for (const pc of w.composers) {
        const composer = await findOrCreate(vid, "Composer", pc.name, pc.basis, d.listActiveComposers, (c) => c.name, async () =>
          d.createComposer({ slug: await slug("composer", pc.name, "composer"), name: pc.name, actorId })
        );
        await linkPerson(vid, "COMPOSER", composer);
        composers.push(composer);
      }
      const [primary, ...coComposers] = composers;
      const work = await findOrCreate(vid, "MusicalWork", w.title, w.basis, () => d.listMusicalWorksByComposer(primary.id), (x) => x.title, async () =>
        d.createMusicalWork({ slug: await slug("musicalWork", w.title, "work", { transliteration: w.alternateTitles[0] ?? null }), title: w.title, composerId: primary.id, coComposerIds: coComposers.map((c) => c.id), alternateTitles: w.alternateTitles, actorId })
      );
      const workExisted = steps.at(-1)?.outcome === "EXISTING";
      const missingAlternates = w.alternateTitles.filter((a) => !work.alternateTitles.includes(a));
      if (missingAlternates.length > 0 && workExisted) record({ youtubeVideoId: vid, entity: "MusicalWork.alternateTitles", outcome: "REPORTED", name: work.title, detail: `not added to the existing work (an existing record is never modified): ${missingAlternates.join(", ")}` });
      if (workExisted) {
        const stored = await d.listMusicalWorkComposerIds(work.id);
        const wanted = composers.map((c) => c.id);
        if (stored.join("\u0000") !== wanted.join("\u0000")) record({ youtubeVideoId: vid, entity: "MusicalWork.composers", outcome: "REPORTED", name: work.title, detail: `the existing work credits ${stored.length} composer(s) in another order or set; the sheet says ${composers.map((c) => c.name).join(", ")}. Not changed (Studio → the work → Composers).` });
      } else if (coComposers.length > 0) {
        record({ youtubeVideoId: vid, entity: "MusicalWork.composers", outcome: "FILLED", name: work.title, detail: `${composers.map((c, i) => `${i + 1}. ${c.name}`).join("; ")}` });
      }
      // R-36: lyricists, arrangers and translators: a Person each, linked to the work (additive and idempotent).
      for (const c of w.contributors) {
        const { person, created } = await d.ensurePerson(c.name, actorId);
        record({ youtubeVideoId: vid, entity: "Person", outcome: created ? "CREATED" : "EXISTING", name: person.name, basis: c.basis });
        const linked = await d.addWorkContributor({ musicalWorkId: work.id, personId: person.id, role: c.role, actorId });
        record({ youtubeVideoId: vid, entity: `MusicalWorkContributor.${c.role}`, outcome: linked ? "FILLED" : "EXISTING", name: `${person.name} → ${work.title}`, basis: c.basis });
      }
      workIds.push(work.id);
    }
    let venueId: string | null = null;
    if (plan.venue) {
      const v = plan.venue;
      const venue = await findOrCreate(vid, "Venue", v.name, `${v.basis}; type ${v.typeBasis}`, d.listActiveVenues, (x) => x.name, async () => d.createVenue({ slug: await slug("venue", v.name, "venue"), name: v.name, type: v.type, actorId }));
      if (venue.type !== v.type) record({ youtubeVideoId: vid, entity: "Venue.type", outcome: "REPORTED", name: venue.name, detail: `the existing venue is ${venue.type}; the sheet says ${v.type}. Not changed.` });
      venueId = venue.id;
    }

    // The Recording.
    let recordingId: string;
    let recordingSlug: string;
    if (linkedBefore) {
      recordingId = linkedBefore.recordingId;
      recordingSlug = linkedBefore.slug;
      record({ youtubeVideoId: vid, entity: "Recording", outcome: "EXISTING", name: recordingSlug });
    } else {
      const result = await d.createRecordingFromYouTubeVideo({ youtubeVideoId: stored.id, actorId, slugSource: plan.recording!.slug });
      if (result.ok) {
        recordingId = result.recording.id;
        recordingSlug = result.recording.slug;
        record({ youtubeVideoId: vid, entity: "Recording", outcome: "CREATED", name: recordingSlug, detail: "DRAFT" });
      } else if (result.reason === "ALREADY_LINKED") {
        record({ youtubeVideoId: vid, entity: "Recording", outcome: "SKIPPED", name: result.existing.slug, detail: "linked by someone else while this run was in progress; left untouched" });
        continue;
      } else {
        record({ youtubeVideoId: vid, entity: "Recording", outcome: "SKIPPED", name: vid, detail: `intake refused: ${result.reason}` });
        continue;
      }
    }

    // Fill EMPTY slots only.
    let state = await d.getCreditsDraftState(recordingId);
    if (!state?.revisionId || !state.revisionUpdatedAt) {
      record({ youtubeVideoId: vid, entity: "RecordingRevision", outcome: "SKIPPED", name: recordingSlug, detail: "no open draft" });
      continue;
    }
    if (state.title === null && plan.recording!.title) {
      await d.updateDraftRevisionContent(recordingId, state.revisionUpdatedAt, actorId, { title: plan.recording!.title }, undefined, { expectedRevisionId: state.revisionId });
      record({ youtubeVideoId: vid, entity: "RecordingRevision.title", outcome: "FILLED", name: plan.recording!.title });
    } else record({ youtubeVideoId: vid, entity: "RecordingRevision.title", outcome: "EXISTING", name: state.title ?? "" });
    if (state.workIds.length === 0) {
      for (const id of workIds) await d.attachWorkToRevision(state.revisionId, id, actorId);
      record({ youtubeVideoId: vid, entity: "RecordingRevision.works", outcome: "FILLED", name: `${workIds.length} work(s)` });
    } else record({ youtubeVideoId: vid, entity: "RecordingRevision.works", outcome: "EXISTING", name: `${state.workIds.length} work(s)` });

    if (!plan.performance || !plan.programme || venueId === null) continue;
    state = (await d.getCreditsDraftState(recordingId)) ?? state;
    if (state.performanceId !== null) {
      record({ youtubeVideoId: vid, entity: "Performance", outcome: "EXISTING", name: recordingSlug, detail: "participants are left to the editor (only a Performance made in this run gets them)" });
      // R-36: the people are still linked. Each conductor and performer of the plan is FOUND by exact normalised name (never created, never
      // added to the Performance, never changed) and linked to its Person when it has none, so one human keeps one person page across roles.
      for (const c of plan.conductors) await linkExistingRole(vid, "CONDUCTOR", c.name, c.basis, d.listActiveConductors);
      for (const p of plan.performers) await linkExistingRole(vid, "ARTIST", p.name, p.basis, d.listActiveArtists);
      continue;
    }
    let programme = await d.findReusableImportProgramme(plan.programme.title, actorId, workIds);
    if (programme) record({ youtubeVideoId: vid, entity: "Programme", outcome: "EXISTING", name: plan.programme.title, detail: "from an interrupted earlier run" });
    else {
      programme = await d.createProgramme({ slug: await slug("programme", plan.programme.title, "programme", { transliteration: plan.recording!.slug.transliteration, year: plan.recording!.slug.year === null || plan.recording!.slug.year === undefined ? null : String(plan.recording!.slug.year) }), title: plan.programme.title, actorId });
      for (const id of workIds) await d.addProgrammeItem({ programmeId: programme.id, musicalWorkId: id, actorId });
      record({ youtubeVideoId: vid, entity: "Programme", outcome: "CREATED", name: plan.programme.title, detail: `${workIds.length} item(s); a container the schema requires` });
    }
    const performance = await d.createPerformanceForDraft(recordingId, state.revisionId!, state.revisionUpdatedAt!, {
      programmeId: programme.id,
      venueId,
      performanceDate: plan.performance.date ? new Date(`${plan.performance.date}T00:00:00.000Z`) : undefined,
      actorId,
    });
    record({ youtubeVideoId: vid, entity: "Performance", outcome: "CREATED", name: performance.slug, detail: plan.performance.date ? `date ${plan.performance.date}` : "no date" });

    let performanceId = performance.id;
    const participant = async (entity: string, name: string, basis: string, link: (tx: Parameters<Parameters<ExecuteDeps["editDraftPerformanceParticipants"]>[0]["change"]>[0], performanceId: string) => Promise<unknown>) => {
      const result = await d.editDraftPerformanceParticipants({ recordingId, expectedPerformanceId: performanceId, actorId, change: link });
      performanceId = result.performanceId;
      record({ youtubeVideoId: vid, entity, outcome: "FILLED", name, basis });
    };
    for (const c of plan.choirs) {
      const choir = await findOrCreate(vid, "Choir", c.name, c.basis, d.listActiveChoirs, (x) => x.name, async () => d.createChoir({ slug: await slug("choir", c.name, "choir"), name: c.name, actorId }));
      await participant("PerformanceChoir", choir.name, c.basis, (tx, pid) => d.addChoirToPerformance(pid, choir.id, actorId, tx));
    }
    for (const e of plan.ensembles ?? []) {
      const { ensemble, created } = await d.ensureEnsemble(e.name, actorId);
      record({ youtubeVideoId: vid, entity: "Ensemble", outcome: created ? "CREATED" : "EXISTING", name: ensemble.name, basis: e.basis });
      await participant("PerformanceEnsemble", ensemble.name, e.basis, (tx, pid) => d.addEnsembleToPerformance(pid, ensemble.id, actorId, tx));
    }
    for (const c of plan.conductors) {
      const conductor = await findOrCreate(vid, "Conductor", c.name, c.basis, d.listActiveConductors, (x) => x.name, async () => d.createConductor({ slug: await slug("conductor", c.name, "conductor"), name: c.name, actorId }));
      await linkPerson(vid, "CONDUCTOR", conductor);
      await participant("PerformanceConductor", conductor.name, c.basis, (tx, pid) => d.addConductorToPerformance(pid, conductor.id, actorId, tx));
    }
    for (const p of plan.performers) {
      const artist = await findOrCreate(vid, "Artist", p.name, p.basis, d.listActiveArtists, (x) => x.name, async () => d.createArtist({ slug: await slug("artist", p.name, "artist"), name: p.name, actorId }));
      await linkPerson(vid, "ARTIST", artist);
      await participant("PerformancePerformer", artist.name, p.basis, (tx, pid) => d.addPerformerToPerformance(pid, artist.id, p.role ?? undefined, actorId, tx));
    }
  }

  return { actorCreated: actor.created, steps };
}
