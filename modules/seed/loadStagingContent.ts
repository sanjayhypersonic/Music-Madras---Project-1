import type { Composer, Venue } from "@prisma/client";
import { findExactNormalizedDuplicate } from "../mmke/duplicate-detection/detectDuplicateName";
import { createComposer, listActiveComposers } from "../db/repositories/composerRepository";
import { createMusicalWork, findMusicalWorkBySlug, listMusicalWorksByComposer } from "../db/repositories/musicalWorkRepository";
import { createVenue, findVenueBySlug, listActiveVenues } from "../db/repositories/venueRepository";
import { addProgrammeItem, createProgramme, findProgrammeById } from "../db/repositories/programmeRepository";
import { createPerformance } from "../db/repositories/performanceRepository";
import { createRecordingFromYouTubeVideo, findRecordingLinkedToYouTubeVideo } from "../db/repositories/recordingIntakeRepository";
import { attachWorkToRevision, updateDraftRevisionContent } from "../db/repositories/recordingRepository";
import { ensureImportActor, findMirroredVideoStates, findPerformanceByProgrammeAndVenue, findProgrammeBySlug, getDraftFillState, importYouTubeMirror, type MirrorFixtures, type MirrorImportResult } from "../db/repositories/stagingSeedRepository";
import { verifyEvidence, type StagingContentSpec } from "./stagingContentSpec";

// THE STAGING CONTENT LOADER (orchestration). It loads the curated spec and the real YouTube fixtures into whatever database the application's client is already
// bound to; WHICH database that is, is decided and confirmed by scripts/seedStagingContent.ts (modules/seed/stagingTarget.ts) before this runs. Nothing here
// reads an environment variable or opens a connection of its own.
//
// What it does, in this order (each step is skipped when its result already exists, so a repeat run creates nothing twice):
//   1. verifies that every fact in the spec is quoted verbatim from the cited video (stagingContentSpec.verifyEvidence); refuses otherwise;
//   2. the YouTube mirror, in one of two explicit modes:
//        "existing"  the mirror was filled by the documented full YouTube sync (npm run youtube:full-sync): nothing is imported, the video must already be there
//                    and OBSERVED. This is the path that keeps the sync engine's semantics (field-ownership baselines, checkpoints, observability history).
//        "fixtures"  a key-less bootstrap: the five exported videos and two playlists are inserted in ONE transaction, never changing an existing row. They are a
//                    SNAPSHOT, not an observation: no ownership baselines, checkpoints or run record are written, and a later full sync overwrites them with live values.
//      Either way the decision about the Recording's video is taken on the STORED privacy and observability, never on the fixture's claim;
//   3. ensures the non-login import actor;
//   4. catalogue records, each found by slug (or by exact normalised name) and created only when absent: Composer, MusicalWork, Programme with its one item, and,
//      ONLY when the spec states the venue's type, the Venue and the Performance;
//   5. the Recording, through the existing recording-intake service (a DRAFT linked to the video as its primary video, atomically), then the revision's EMPTY slots
//      are filled: title, the work, and the performance when one exists. A slot that already holds anything is never changed.
// It never publishes, never creates a video page, an exposure approval or a review, and never touches a Recording that is not an open DRAFT.
// A failure in step 4 leaves valid, standalone catalogue records and no Recording; a failure in step 5 after the intake leaves an ordinary draft with its media
// (exactly what Studio's "start a Recording from a video" makes), and the next run completes it.

export type Outcome = "CREATED" | "EXISTING" | "FILLED" | "SKIPPED";
export interface Step {
  entity: string;
  slug: string;
  outcome: Outcome;
  detail?: string;
}
export type MirrorMode = "fixtures" | "existing";

export interface LoadReport {
  mirrorMode: MirrorMode;
  mirror: Pick<MirrorImportResult, "videosCreated" | "videosExisting" | "playlistsCreated" | "playlistsExisting" | "membershipsCreated">;
  actorCreated: boolean;
  steps: Step[];
  omissions: StagingContentSpec["omissions"];
}

export interface LoaderDeps {
  importYouTubeMirror: typeof importYouTubeMirror;
  findMirroredVideoStates: typeof findMirroredVideoStates;
  ensureImportActor: typeof ensureImportActor;
  listActiveComposers: typeof listActiveComposers;
  createComposer: typeof createComposer;
  findMusicalWorkBySlug: typeof findMusicalWorkBySlug;
  listMusicalWorksByComposer: typeof listMusicalWorksByComposer;
  createMusicalWork: typeof createMusicalWork;
  findProgrammeBySlug: typeof findProgrammeBySlug;
  createProgramme: typeof createProgramme;
  findProgrammeById: typeof findProgrammeById;
  addProgrammeItem: typeof addProgrammeItem;
  findVenueBySlug: typeof findVenueBySlug;
  listActiveVenues: typeof listActiveVenues;
  createVenue: typeof createVenue;
  findPerformanceByProgrammeAndVenue: typeof findPerformanceByProgrammeAndVenue;
  createPerformance: typeof createPerformance;
  findRecordingLinkedToYouTubeVideo: typeof findRecordingLinkedToYouTubeVideo;
  createRecordingFromYouTubeVideo: typeof createRecordingFromYouTubeVideo;
  getDraftFillState: typeof getDraftFillState;
  updateDraftRevisionContent: typeof updateDraftRevisionContent;
  attachWorkToRevision: typeof attachWorkToRevision;
}

export const defaultLoaderDeps: LoaderDeps = {
  importYouTubeMirror,
  findMirroredVideoStates,
  ensureImportActor,
  listActiveComposers,
  createComposer,
  findMusicalWorkBySlug,
  listMusicalWorksByComposer,
  createMusicalWork,
  findProgrammeBySlug,
  createProgramme,
  findProgrammeById,
  addProgrammeItem,
  findVenueBySlug,
  listActiveVenues,
  createVenue,
  findPerformanceByProgrammeAndVenue,
  createPerformance,
  findRecordingLinkedToYouTubeVideo,
  createRecordingFromYouTubeVideo,
  getDraftFillState,
  updateDraftRevisionContent,
  attachWorkToRevision,
};

export class StagingContentRefused extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`The staging content was refused: ${problems.join(" ")}`);
    this.name = "StagingContentRefused";
    this.problems = problems;
  }
}

export async function loadStagingContent(spec: StagingContentSpec, fixtures: MirrorFixtures, overrides: Partial<LoaderDeps> = {}, options: { mirror?: MirrorMode } = {}): Promise<LoadReport> {
  const d: LoaderDeps = { ...defaultLoaderDeps, ...overrides };
  const mirrorMode: MirrorMode = options.mirror ?? "fixtures";

  // 1. every fact traceable; the Recording's video public in the fixture too, so a refusal happens before anything is written
  const problems = verifyEvidence(spec, fixtures.videos);
  const video = fixtures.videos.find((v) => v.youtubeVideoId === spec.recording.youtubeVideoId);
  if (video && video.privacyStatus !== "public") problems.push(`recording: video ${video.youtubeVideoId} is ${video.privacyStatus ?? "of unknown privacy"}; a Recording is only started from a public video.`);
  if (problems.length > 0) throw new StagingContentRefused(problems);

  const steps: Step[] = [];

  // 2. the mirror, then the STORED state of the Recording's video decides (an existing row keeps what the database holds, which may differ from the fixture)
  const noImport = { videosCreated: 0, videosExisting: 0, playlistsCreated: 0, playlistsExisting: 0, membershipsCreated: 0 };
  let mirror: Pick<MirrorImportResult, "videosCreated" | "videosExisting" | "playlistsCreated" | "playlistsExisting" | "membershipsCreated"> = noImport;
  let states: Map<string, { id: string; privacyStatus: string | null; observabilityState: string }>;
  if (mirrorMode === "fixtures") {
    const imported = await d.importYouTubeMirror(fixtures);
    mirror = imported;
    states = imported.videoStates;
  } else {
    states = await d.findMirroredVideoStates([spec.recording.youtubeVideoId]);
  }
  const stored = states.get(spec.recording.youtubeVideoId);
  if (!stored) throw new StagingContentRefused([`video ${spec.recording.youtubeVideoId} is not in the database. Run the YouTube full sync first (npm run youtube:full-sync), or choose --mirror fixtures. Nothing was written.`]);
  const storedProblems: string[] = [];
  if (stored.privacyStatus !== "public") storedProblems.push(`recording: the stored privacy of video ${spec.recording.youtubeVideoId} is ${stored.privacyStatus ?? "unknown"}, not public; a Recording is only started from a public video.`);
  if (stored.observabilityState !== "OBSERVED") storedProblems.push(`recording: video ${spec.recording.youtubeVideoId} is ${stored.observabilityState} in the synchronized catalogue, so a Recording cannot be started from it.`);
  if (storedProblems.length > 0) throw new StagingContentRefused(storedProblems);
  const internalVideoId = stored.id;

  // 3. the actor
  const actor = await d.ensureImportActor();
  const actorId = actor.id;

  // 4. catalogue
  const composers = await d.listActiveComposers();
  let composer: Composer | undefined = composers.find((c) => c.slug === spec.composer.slug);
  if (!composer) {
    const sameName = findExactNormalizedDuplicate(spec.composer.name, composers.map((c) => c.name));
    composer = sameName ? composers.find((c) => c.name === sameName) : undefined;
    if (composer) steps.push({ entity: "Composer", slug: composer.slug, outcome: "EXISTING", detail: "matched by name" });
  } else {
    steps.push({ entity: "Composer", slug: composer.slug, outcome: "EXISTING" });
  }
  if (!composer) {
    composer = await d.createComposer({ slug: spec.composer.slug, name: spec.composer.name, actorId });
    steps.push({ entity: "Composer", slug: composer.slug, outcome: "CREATED" });
  }

  let work = await d.findMusicalWorkBySlug(spec.work.slug);
  if (!work) {
    const ofComposer = await d.listMusicalWorksByComposer(composer.id);
    const sameTitle = findExactNormalizedDuplicate(spec.work.title, ofComposer.map((w) => w.title));
    work = sameTitle ? ofComposer.find((w) => w.title === sameTitle) ?? null : null;
  }
  if (work) steps.push({ entity: "MusicalWork", slug: work.slug, outcome: "EXISTING" });
  else {
    work = await d.createMusicalWork({ slug: spec.work.slug, title: spec.work.title, composerId: composer.id, actorId });
    steps.push({ entity: "MusicalWork", slug: work.slug, outcome: "CREATED" });
  }

  let programme = await d.findProgrammeBySlug(spec.programme.slug);
  if (programme) steps.push({ entity: "Programme", slug: programme.slug, outcome: "EXISTING" });
  else {
    programme = await d.createProgramme({ slug: spec.programme.slug, title: spec.programme.title, actorId });
    steps.push({ entity: "Programme", slug: programme.slug, outcome: "CREATED" });
  }
  const programmeWithItems = await d.findProgrammeById(programme.id);
  if (programmeWithItems?.items.some((i) => i.musicalWorkId === work!.id)) steps.push({ entity: "ProgrammeItem", slug: programme.slug, outcome: "EXISTING" });
  else {
    await d.addProgrammeItem({ programmeId: programme.id, musicalWorkId: work.id, actorId });
    steps.push({ entity: "ProgrammeItem", slug: programme.slug, outcome: "CREATED" });
  }

  let performanceId: string | null = null;
  if (spec.venue.type === null) {
    steps.push({ entity: "Venue", slug: spec.venue.slug, outcome: "SKIPPED", detail: "the sources do not state the venue type" });
    steps.push({ entity: "Performance", slug: spec.programme.slug, outcome: "SKIPPED", detail: "needs a Venue" });
  } else {
    let venue: Venue | null | undefined = await d.findVenueBySlug(spec.venue.slug);
    if (!venue) {
      const venues = await d.listActiveVenues();
      const sameName = findExactNormalizedDuplicate(spec.venue.name, venues.map((v) => v.name));
      venue = sameName ? venues.find((v) => v.name === sameName) : undefined;
    }
    if (venue) steps.push({ entity: "Venue", slug: venue.slug, outcome: "EXISTING" });
    else {
      venue = await d.createVenue({ slug: spec.venue.slug, name: spec.venue.name, type: spec.venue.type, city: spec.venue.city, country: spec.venue.country, actorId });
      steps.push({ entity: "Venue", slug: venue.slug, outcome: "CREATED" });
    }
    const existingPerformance = await d.findPerformanceByProgrammeAndVenue(programme.id, venue.id);
    if (existingPerformance) {
      performanceId = existingPerformance.id;
      steps.push({ entity: "Performance", slug: spec.programme.slug, outcome: "EXISTING" });
    } else {
      const performance = await d.createPerformance({ programmeId: programme.id, venueId: venue.id, actorId });
      performanceId = performance.id;
      steps.push({ entity: "Performance", slug: performance.slug, outcome: "CREATED" });
    }
  }

  // 5. the Recording
  let linked = await d.findRecordingLinkedToYouTubeVideo(internalVideoId);
  if (linked) {
    steps.push({ entity: "Recording", slug: linked.slug, outcome: "EXISTING" });
  } else {
    const result = await d.createRecordingFromYouTubeVideo({ youtubeVideoId: internalVideoId, actorId });
    if (result.ok) {
      linked = { recordingId: result.recording.id, slug: result.recording.slug, status: result.recording.status, title: null };
      steps.push({ entity: "Recording", slug: result.recording.slug, outcome: "CREATED", detail: "DRAFT" });
    } else if (result.reason === "ALREADY_LINKED") {
      // another run (or an editor) linked the video between the lookup above and the intake's own locked check: adopt that Recording, never a second one
      linked = result.existing;
      steps.push({ entity: "Recording", slug: linked.slug, outcome: "EXISTING", detail: "linked while this run was in progress" });
    } else {
      throw new StagingContentRefused([`the Recording could not be started: ${result.reason}.`]);
    }
  }

  let state = await d.getDraftFillState(linked.recordingId);
  if (!state || state.status !== "DRAFT" || !state.revisionId || !state.revisionUpdatedAt) {
    steps.push({ entity: "RecordingRevision", slug: linked.slug, outcome: "SKIPPED", detail: `the Recording is ${state?.status ?? "missing"} or has no open draft; left untouched` });
  } else {
    if (state.title === null) {
      await d.updateDraftRevisionContent(linked.recordingId, state.revisionUpdatedAt, actorId, { title: spec.recording.title });
      steps.push({ entity: "RecordingRevision.title", slug: linked.slug, outcome: "FILLED" });
      state = (await d.getDraftFillState(linked.recordingId)) ?? state;
    } else {
      steps.push({ entity: "RecordingRevision.title", slug: linked.slug, outcome: "EXISTING" });
    }
    if (state.workCount === 0) {
      await d.attachWorkToRevision(state.revisionId!, work.id, actorId);
      steps.push({ entity: "RecordingRevision.work", slug: linked.slug, outcome: "FILLED" });
    } else {
      steps.push({ entity: "RecordingRevision.work", slug: linked.slug, outcome: "EXISTING" });
    }
    if (performanceId !== null) {
      state = (await d.getDraftFillState(linked.recordingId)) ?? state;
      if (state.performanceId === null && state.revisionUpdatedAt) {
        await d.updateDraftRevisionContent(linked.recordingId, state.revisionUpdatedAt, actorId, { performanceId });
        steps.push({ entity: "RecordingRevision.performance", slug: linked.slug, outcome: "FILLED" });
      } else {
        steps.push({ entity: "RecordingRevision.performance", slug: linked.slug, outcome: "EXISTING" });
      }
    }
  }

  return {
    mirrorMode,
    mirror: { videosCreated: mirror.videosCreated, videosExisting: mirror.videosExisting, playlistsCreated: mirror.playlistsCreated, playlistsExisting: mirror.playlistsExisting, membershipsCreated: mirror.membershipsCreated },
    actorCreated: actor.created,
    steps,
    omissions: spec.omissions,
  };
}
