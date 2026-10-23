import { prisma } from "../client";
import { compareRevisions, type RevisionComparison, type RevisionSnapshot, type SnapshotItem } from "../../mmke/recordingPreview/revisionComparison";
import { RevisionRelationshipDataError } from "./recordingRelationshipReadersRepository";
import { getCanonicalContextForRevision } from "./recordingRepository";
import { listOccasionsForRevision, listRightsForRevision, listSourcesForRevision } from "./recordingRevisionRelationshipsRepository";
import type { Prisma } from "@prisma/client";

// Recording draft-versus-published comparison — the READ-ONLY loader behind the Studio "Review & Publish" preview.
//
// It only reads. It never creates a draft (no draft means nothing to compare), never writes either revision, never writes an audit entry, and is
// not used by any public reader. Which revision is "published" and which is "the draft" comes from the Recording's own pointers, verified the same way
// the relationship readers verify them (a pointer to another Recording's revision, or to a revision in the wrong status, is RevisionRelationshipDataError:
// an explicit refusal to compare, never a guess). A revision's Sources, Rights information and Occasions are read from the REVISION-SCOPED tables
// (recording_revision_*) for BOTH sides; the frozen legacy Recording-level rows are never read.
//
// What is compared is what the existing model represents: the revision's own fields, its works (with order), its performance's programme, venue, date and
// participants, its media resources, and its three relationship kinds. Nothing is inferred from titles or descriptions.

type Client = Prisma.TransactionClient | typeof prisma;

function describeMedia(media: { role: string; provider: string; providerResourceId: string | null; url: string | null; youtubeVideoId: string | null; youtubeVideo: { title: string | null; privacyStatus: string | null; observabilityState: string } | null; id: string }): SnapshotItem {
  const identity = media.youtubeVideoId ?? media.providerResourceId ?? media.url ?? media.id;
  const role = media.role.toLowerCase().replace(/_/g, " ");
  const title = media.youtubeVideo?.title ?? media.url ?? media.providerResourceId ?? "resource";
  let note: string | null = null;
  if (media.youtubeVideo) {
    const { privacyStatus, observabilityState } = media.youtubeVideo;
    if (privacyStatus === "private") note = "This YouTube video is currently private.";
    else if (observabilityState !== "OBSERVED") note = "This YouTube video is not currently observed on YouTube.";
  }
  return { id: `${media.role}:${media.provider}:${identity}`, label: `${role} — ${title}`, detail: media.url, note };
}

/** One revision as comparable plain data. Read-only. Returns null when the revision does not exist. */
export async function loadRevisionSnapshot(revisionId: string, client: Client = prisma): Promise<RevisionSnapshot | null> {
  const context = await getCanonicalContextForRevision(revisionId, client);
  if (!context) return null;
  const { revision } = context;
  const [sources, rights, occasions] = await Promise.all([listSourcesForRevision(revisionId, client), listRightsForRevision(revisionId, client), listOccasionsForRevision(revisionId, client)]);

  const named = (rows: Array<{ id: string; name: string }>): SnapshotItem[] => rows.map((r) => ({ id: r.id, label: r.name }));
  const date = context.performance?.performanceDate ?? null;

  return {
    revisionId,
    title: revision.title,
    description: revision.description,
    seoMetaTitle: revision.seoMetaTitle,
    seoMetaDescription: revision.seoMetaDescription,
    seoCanonicalPath: revision.seoCanonicalPath,
    difficultyLevel: revision.educationalDifficultyLevel,
    listeningGuide: revision.educationalListeningGuide,
    analysis: revision.educationalAnalysis,
    programme: context.programme?.title ?? null,
    venue: context.venue?.name ?? null,
    performanceDate: date ? date.toISOString().slice(0, 10) : null,
    works: revision.works.map((link) => ({ id: link.musicalWorkId, label: `${link.musicalWork.title} — ${link.musicalWork.composer.name}` })),
    performers: named(context.performers),
    choirs: named(context.choirs),
    conductors: named(context.conductors),
    media: context.mediaResources.map(describeMedia),
    sources: sources.map((l) => ({
      id: l.sourceId,
      label: l.source.title ?? l.source.url ?? "Untitled source",
      note: l.source.approvalState === "APPROVED" ? null : "Not approved: public pages will not show this source.",
    })),
    rights: rights.map((l) => ({ id: l.rightsInformationId, label: l.rightsInformation.holder ?? l.rightsInformation.licenseType ?? "Untitled rights information" })),
    occasions: occasions.map((l) => ({ id: l.occasionId, label: l.occasion.name, note: l.occasion.archivedAt ? "Archived occasion: public pages will not show it." : null })),
  };
}

export type PublicationPreview =
  /** There is no open draft: nothing is proposed, so there is nothing to compare (and none is created). */
  | { state: "NO_DRAFT"; publishedRevisionId: string | null }
  | { state: "PREVIEW"; comparison: RevisionComparison; proposedRevisionNumber: number; publishedRevisionNumber: number | null };

/**
 * What publishing the Recording's open draft would change. Returns null when the Recording does not exist. Throws RevisionRelationshipDataError when a
 * pointer is inconsistent (the preview refuses rather than compare the wrong revisions).
 */
export async function loadPublicationPreview(recordingId: string, client: Client = prisma): Promise<PublicationPreview | null> {
  const readPointers = () => client.recording.findUnique({ where: { id: recordingId }, select: { id: true, currentDraftRevisionId: true, currentPublishedRevisionId: true } });
  const recording = await readPointers();
  if (!recording) return null;
  if (!recording.currentDraftRevisionId) return { state: "NO_DRAFT", publishedRevisionId: recording.currentPublishedRevisionId };

  const draft = await client.recordingRevision.findUnique({ where: { id: recording.currentDraftRevisionId }, select: { id: true, recordingId: true, revisionStatus: true, revisionNumber: true } });
  if (!draft) throw new RevisionRelationshipDataError(recording.id, "DRAFT_REVISION_MISSING");
  if (draft.recordingId !== recording.id) throw new RevisionRelationshipDataError(recording.id, "DRAFT_REVISION_OF_OTHER_RECORDING");
  if (draft.revisionStatus !== "DRAFT") throw new RevisionRelationshipDataError(recording.id, "DRAFT_REVISION_NOT_A_DRAFT");

  let published: { id: string; revisionNumber: number } | null = null;
  let publishedPointer = recording.currentPublishedRevisionId;
  for (let attempt = 1; publishedPointer; attempt += 1) {
    const revision = await client.recordingRevision.findUnique({ where: { id: publishedPointer }, select: { id: true, recordingId: true, revisionStatus: true, revisionNumber: true } });
    if (!revision) throw new RevisionRelationshipDataError(recording.id, "PUBLISHED_REVISION_MISSING");
    if (revision.recordingId !== recording.id) throw new RevisionRelationshipDataError(recording.id, "PUBLISHED_REVISION_OF_OTHER_RECORDING");
    if (revision.revisionStatus === "PUBLISHED") {
      published = { id: revision.id, revisionNumber: revision.revisionNumber };
      break;
    }
    // A publication may have moved the pointer since we read it (the revision we looked at is now SUPERSEDED): look once more before refusing.
    const again = attempt === 1 ? (await readPointers())?.currentPublishedRevisionId ?? null : publishedPointer;
    if (attempt >= 2 || again === publishedPointer) throw new RevisionRelationshipDataError(recording.id, "PUBLISHED_REVISION_NOT_PUBLISHED");
    publishedPointer = again;
  }

  const [proposedSnapshot, publishedSnapshot] = await Promise.all([loadRevisionSnapshot(draft.id, client), published ? loadRevisionSnapshot(published.id, client) : Promise.resolve(null)]);
  if (!proposedSnapshot) throw new RevisionRelationshipDataError(recording.id, "DRAFT_REVISION_MISSING");
  if (published && !publishedSnapshot) throw new RevisionRelationshipDataError(recording.id, "PUBLISHED_REVISION_MISSING");

  return {
    state: "PREVIEW",
    comparison: compareRevisions(publishedSnapshot, proposedSnapshot),
    proposedRevisionNumber: draft.revisionNumber,
    publishedRevisionNumber: published?.revisionNumber ?? null,
  };
}
