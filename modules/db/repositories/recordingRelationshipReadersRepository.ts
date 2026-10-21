import { prisma } from "../client";
import type { Occasion, Prisma, RightsInformation, Source } from "@prisma/client";

// Phase 6L — the READERS of a Recording's revision-scoped Source, RightsInformation and Occasion links (tables recording_revision_sources /
// _rights / _occasions; the writers are recordingRevisionRelationshipsRepository.ts). Every reader of a Recording's links goes through this module:
//
//   loadPublishedRecordingRelationships   the PUBLISHED revision's links, for public pages (the Organisation page aggregation). A draft edit can never
//                                         appear in it: a published revision is immutable (withEditableDraftRevision refuses it), and which revision
//                                         is "the published one" is read from the Recording's own pointer, so a publication swaps the visible set
//                                         atomically with the pointer.
//   loadRecordingRelationshipWorkspace    the Studio view of one Recording: the published set and the open draft's set side by side, with each link
//                                         marked published / draft-only / removed-in-draft.
//
// There is NO fallback to the legacy Recording-level rows (entity_sources / entity_rights / entity_occasions, entityType "RECORDING"), and these
// functions never read them. A Recording whose published revision has no link rows shows none: backfilling legacy rows is a one-off, guarded
// operation done BEFORE the cutover (docs/recording-publication-safety.md §11–§13), never something a reader papers over.
//
// Inconsistent revision data is an explicit error, never a silently incomplete set: a pointer that names a revision that does not exist, belongs to
// another Recording, or is not in the status the pointer implies throws RevisionRelationshipDataError (internal; its message carries no secret).
// A Recording with NO published pointer is not an error — it is simply not published (for example unpublished or restored a moment ago), and is
// reported in `notPublished`.
//
// Consistency under concurrent publication: the pointer and the revision's status are read, verified, and re-read (up to three attempts) if a
// publication moved the pointer between the two reads; the links are then read for exactly the revisions that were verified. Those revisions are
// immutable, so the set read is one coherent published version (the one that was current when the pointer was read), never a mixture of two.

export class RevisionRelationshipDataError extends Error {
  constructor(
    readonly recordingId: string,
    readonly reason:
      | "PUBLISHED_REVISION_MISSING"
      | "PUBLISHED_REVISION_OF_OTHER_RECORDING"
      | "PUBLISHED_REVISION_NOT_PUBLISHED"
      | "DRAFT_REVISION_MISSING"
      | "DRAFT_REVISION_OF_OTHER_RECORDING"
      | "DRAFT_REVISION_NOT_A_DRAFT"
  ) {
    super(`The recording's relationship data is inconsistent (${reason}). Nothing was shown rather than an incomplete or wrong set.`);
    this.name = "RevisionRelationshipDataError";
  }
}

type Client = Prisma.TransactionClient | typeof prisma;

export interface RevisionRelationshipSets {
  revisionId: string;
  sources: Array<{ sourceId: string; createdAt: Date; source: Source }>;
  rights: Array<{ rightsInformationId: string; createdAt: Date; rightsInformation: RightsInformation }>;
  occasions: Array<{ occasionId: string; createdAt: Date; occasion: Occasion }>;
}

async function loadSets(client: Client, revisionIds: string[]): Promise<Map<string, RevisionRelationshipSets>> {
  const out = new Map<string, RevisionRelationshipSets>(revisionIds.map((revisionId) => [revisionId, { revisionId, sources: [], rights: [], occasions: [] }]));
  if (revisionIds.length === 0) return out;
  const where = { revisionId: { in: revisionIds } };
  const orderBy = [{ createdAt: "asc" as const }];
  const [sources, rights, occasions] = await Promise.all([
    client.recordingRevisionSource.findMany({ where, include: { source: true }, orderBy: [...orderBy, { sourceId: "asc" }] }),
    client.recordingRevisionRights.findMany({ where, include: { rightsInformation: true }, orderBy: [...orderBy, { rightsInformationId: "asc" }] }),
    client.recordingRevisionOccasion.findMany({ where, include: { occasion: true }, orderBy: [...orderBy, { occasionId: "asc" }] }),
  ]);
  for (const row of sources) out.get(row.revisionId)!.sources.push(row);
  for (const row of rights) out.get(row.revisionId)!.rights.push(row);
  for (const row of occasions) out.get(row.revisionId)!.occasions.push(row);
  return out;
}

export interface PublishedRecordingRelationships {
  /** Per Recording that has a verified published revision. */
  byRecording: Map<string, RevisionRelationshipSets>;
  /** Requested Recordings with no published pointer (not published, or unknown): nothing to show, not an error. */
  notPublished: string[];
  /**
   * Recordings whose revision data is inconsistent. ONLY ever non-empty in `onInconsistent: "omit"` mode: their links are absent from `byRecording` (never
   * shown unverified, never replaced by legacy rows) and the caller is expected to report them.
   */
  inconsistent: Array<{ recordingId: string; reason: RevisionRelationshipDataError["reason"] }>;
}

export interface LoadPublishedOptions {
  /**
   * `"throw"` (default): the first inconsistent Recording throws RevisionRelationshipDataError (Studio and the AI context: an editor must see the problem).
   * `"omit"`: inconsistent Recordings are left out of the result and listed in `inconsistent`, so one bad Recording cannot take down a public page that
   * aggregates many (the Organisation page). Either way the data is never shown unverified and there is no legacy fallback.
   */
  onInconsistent?: "throw" | "omit";
}

const MAX_POINTER_ATTEMPTS = 3;

/** The published revisions' links for the given Recordings. See `LoadPublishedOptions` for how inconsistent pointer data is reported. */
export async function loadPublishedRecordingRelationships(recordingIds: readonly string[], client: Client = prisma, options: LoadPublishedOptions = {}): Promise<PublishedRecordingRelationships> {
  const ids = [...new Set(recordingIds)];
  const result: PublishedRecordingRelationships = { byRecording: new Map(), notPublished: [], inconsistent: [] };
  if (ids.length === 0) return result;

  let verified = new Map<string, string>(); // recordingId -> verified published revision id
  let notPublished: string[] = [];
  let problems: RevisionRelationshipDataError[] = [];
  for (let attempt = 1; ; attempt += 1) {
    const recordings = await client.recording.findMany({ where: { id: { in: ids } }, select: { id: true, currentPublishedRevisionId: true } });
    const pointed = recordings.flatMap((r) => (r.currentPublishedRevisionId ? [r.currentPublishedRevisionId] : []));
    const revisions = pointed.length > 0 ? await client.recordingRevision.findMany({ where: { id: { in: pointed } }, select: { id: true, recordingId: true, revisionStatus: true } }) : [];
    const revisionById = new Map(revisions.map((r) => [r.id, r]));

    verified = new Map();
    notPublished = ids.filter((id) => !recordings.some((r) => r.id === id));
    const found: RevisionRelationshipDataError[] = [];
    for (const recording of recordings) {
      if (!recording.currentPublishedRevisionId) {
        notPublished.push(recording.id);
        continue;
      }
      const revision = revisionById.get(recording.currentPublishedRevisionId);
      if (!revision) found.push(new RevisionRelationshipDataError(recording.id, "PUBLISHED_REVISION_MISSING"));
      else if (revision.recordingId !== recording.id) found.push(new RevisionRelationshipDataError(recording.id, "PUBLISHED_REVISION_OF_OTHER_RECORDING"));
      else if (revision.revisionStatus !== "PUBLISHED") found.push(new RevisionRelationshipDataError(recording.id, "PUBLISHED_REVISION_NOT_PUBLISHED"));
      else verified.set(recording.id, revision.id);
    }
    problems = found;
    if (found.length === 0) break;
    // A publication may have moved the pointer between the two reads (the revision we looked at is now SUPERSEDED): look again. A problem that
    // survives every attempt is real.
    if (attempt >= MAX_POINTER_ATTEMPTS) {
      if (options.onInconsistent !== "omit") throw found[0];
      break; // omit mode: keep what verified; the problems are reported below
    }
  }

  const sets = await loadSets(client, [...verified.values()]);
  for (const [recordingId, revisionId] of verified) result.byRecording.set(recordingId, sets.get(revisionId)!);
  result.notPublished = notPublished;
  result.inconsistent = problems.map((p) => ({ recordingId: p.recordingId, reason: p.reason }));
  return result;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Studio workspace
// ---------------------------------------------------------------------------------------------------------------------------------

/** How a link relates to the published version and the open draft. */
export type RelationshipState =
  /** In the published version (and, when a draft is open, still in it). With no open draft, every link is this. */
  | "PUBLISHED"
  /** In the open draft only: it becomes public when the draft is published. */
  | "DRAFT_ONLY"
  /** In the published version but removed in the open draft: it stays public until the draft is published. */
  | "REMOVED_IN_DRAFT";

export interface WorkspaceItem<T> {
  id: string;
  record: T;
  state: RelationshipState;
}

export interface RecordingRelationshipWorkspace {
  recordingId: string;
  recordingStatus: string;
  draftRevisionId: string | null;
  publishedRevisionId: string | null;
  /** True when the open draft can be edited: there is a current draft and the Recording is not archived. */
  editable: boolean;
  /** Why it cannot be edited (null when it can). */
  readOnlyReason: "NO_DRAFT" | "ARCHIVED" | "NO_REVISION" | null;
  sources: WorkspaceItem<Source>[];
  rights: WorkspaceItem<RightsInformation>[];
  occasions: WorkspaceItem<Occasion>[];
  /** Counts for the draft banner. */
  draftOnly: number;
  removedInDraft: number;
}

function mark<T>(published: Array<{ id: string; record: T }>, draft: Array<{ id: string; record: T }> | null): WorkspaceItem<T>[] {
  if (draft === null) return published.map((p) => ({ ...p, state: "PUBLISHED" as const }));
  const publishedIds = new Set(published.map((p) => p.id));
  const draftIds = new Set(draft.map((d) => d.id));
  const out: WorkspaceItem<T>[] = draft.map((d) => ({ ...d, state: publishedIds.has(d.id) ? ("PUBLISHED" as const) : ("DRAFT_ONLY" as const) }));
  for (const p of published) if (!draftIds.has(p.id)) out.push({ ...p, state: "REMOVED_IN_DRAFT" });
  return out;
}

/** The Studio view of one Recording's relationships. Returns null when the Recording does not exist. */
export async function loadRecordingRelationshipWorkspace(recordingId: string, client: Client = prisma): Promise<RecordingRelationshipWorkspace | null> {
  const recording = await client.recording.findUnique({ where: { id: recordingId }, select: { id: true, status: true, currentDraftRevisionId: true, currentPublishedRevisionId: true } });
  if (!recording) return null;

  const published = recording.currentPublishedRevisionId ? (await loadPublishedRecordingRelationships([recording.id], client)).byRecording.get(recording.id) ?? null : null;

  let draft: RevisionRelationshipSets | null = null;
  if (recording.currentDraftRevisionId) {
    const revision = await client.recordingRevision.findUnique({ where: { id: recording.currentDraftRevisionId }, select: { id: true, recordingId: true, revisionStatus: true } });
    if (!revision) throw new RevisionRelationshipDataError(recording.id, "DRAFT_REVISION_MISSING");
    if (revision.recordingId !== recording.id) throw new RevisionRelationshipDataError(recording.id, "DRAFT_REVISION_OF_OTHER_RECORDING");
    if (revision.revisionStatus !== "DRAFT") throw new RevisionRelationshipDataError(recording.id, "DRAFT_REVISION_NOT_A_DRAFT");
    draft = (await loadSets(client, [revision.id])).get(revision.id)!;
  }

  const archived = recording.status === "ARCHIVED";
  const editable = draft !== null && !archived;
  const readOnlyReason: RecordingRelationshipWorkspace["readOnlyReason"] = editable ? null : archived ? "ARCHIVED" : draft === null && published === null ? "NO_REVISION" : "NO_DRAFT";

  const sources = mark(
    (published?.sources ?? []).map((l) => ({ id: l.sourceId, record: l.source })),
    draft ? draft.sources.map((l) => ({ id: l.sourceId, record: l.source })) : null
  );
  const rights = mark(
    (published?.rights ?? []).map((l) => ({ id: l.rightsInformationId, record: l.rightsInformation })),
    draft ? draft.rights.map((l) => ({ id: l.rightsInformationId, record: l.rightsInformation })) : null
  );
  const occasions = mark(
    (published?.occasions ?? []).map((l) => ({ id: l.occasionId, record: l.occasion })),
    draft ? draft.occasions.map((l) => ({ id: l.occasionId, record: l.occasion })) : null
  );
  const all = [...sources, ...rights, ...occasions];

  return {
    recordingId: recording.id,
    recordingStatus: recording.status,
    draftRevisionId: draft?.revisionId ?? null,
    publishedRevisionId: published?.revisionId ?? null,
    editable,
    readOnlyReason,
    sources,
    rights,
    occasions,
    draftOnly: all.filter((i) => i.state === "DRAFT_ONLY").length,
    removedInDraft: all.filter((i) => i.state === "REMOVED_IN_DRAFT").length,
  };
}
