"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { CollectionMembershipPublishRequiredError, addRecordingToCollection } from "../../../../../../../modules/db/repositories/collectionRepository";
import { RecordingBusyError, RevisionNotEditableError } from "../../../../../../../modules/db/repositories/recordingRepository";
import {
  DuplicateRevisionRelationshipError,
  RevisionRelationshipNotFoundError,
  attachOccasionToRevision,
  attachRightsToRevision,
  attachSourceToRevision,
  detachOccasionFromRevision,
  detachRightsFromRevision,
  detachSourceFromRevision,
} from "../../../../../../../modules/db/repositories/recordingRevisionRelationshipsRepository";

// Phase 6L — the Relationships step edits a DRAFT REVISION's Sources, Rights information and Occasions (recording_revision_* tables). Nothing here
// touches the legacy Recording-level rows (the generic writers now refuse entityType "RECORDING"), and nothing here can change a published version:
// the repository only writes to the Recording's current, editable draft and refuses a published, superseded or archived-Recording revision.
//
//   - Permission is unchanged: CATALOGUE_WRITE, checked here before the repository (the repository performs no role check). Starting a draft is the
//     separate, existing RECORDING_WRITE action (../draftActions.ts).
//   - Each action is bound to the revision id the editor was LOOKING AT. If that draft was published or replaced meanwhile, the write is refused as stale
//     instead of landing on a different draft than the one on screen.
//   - Collection membership is not versioned and keeps its own guard (RECORDING_PUBLISH for a live change, Phase 6J-12A).

const back = (recordingId: string, error?: string): never => redirect(`/studio/recordings/${recordingId}/relationships${error ? `?error=${encodeURIComponent(error)}` : ""}`);

async function requireCatalogueWrite(recordingId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) back(recordingId, "You do not have permission.");
  return session!;
}

function messageFor(err: unknown, fallback: string): string {
  if (err instanceof RevisionNotEditableError || err instanceof RecordingBusyError || err instanceof DuplicateRevisionRelationshipError || err instanceof RevisionRelationshipNotFoundError) return err.message;
  return err instanceof Error ? err.message : fallback;
}

export async function addToCollectionAction(recordingId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    redirect(`/studio/recordings/${recordingId}/relationships?error=You+do+not+have+permission.`);
  }

  const collectionId = String(formData.get("collectionId") ?? "");
  if (!collectionId) {
    redirect(`/studio/recordings/${recordingId}/relationships?error=Select+a+collection.`);
  }

  // Phase 6J-12A: a change that is visible to visitors at once (published Collection + published Recording) needs RECORDING_PUBLISH.
  try {
    await addRecordingToCollection(collectionId, recordingId, session!.user.id, { canPublish: can(session!.user.role, "RECORDING_PUBLISH") });
  } catch (err) {
    if (err instanceof CollectionMembershipPublishRequiredError) {
      redirect(`/studio/recordings/${recordingId}/relationships?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  redirect(`/studio/recordings/${recordingId}/relationships`);
}

export async function attachOccasionAction(recordingId: string, revisionId: string, formData: FormData) {
  const session = await requireCatalogueWrite(recordingId);
  const occasionId = String(formData.get("occasionId") ?? "");
  if (!occasionId) back(recordingId, "Select an occasion.");
  try {
    await attachOccasionToRevision(revisionId, occasionId, session.user.id);
  } catch (err) {
    back(recordingId, messageFor(err, "Could not attach the occasion."));
  }
  back(recordingId);
}

export async function detachOccasionAction(recordingId: string, revisionId: string, occasionId: string) {
  const session = await requireCatalogueWrite(recordingId);
  try {
    await detachOccasionFromRevision(revisionId, occasionId, session.user.id);
  } catch (err) {
    back(recordingId, messageFor(err, "Could not remove the occasion."));
  }
  back(recordingId);
}

export async function attachSourceAction(recordingId: string, revisionId: string, formData: FormData) {
  const session = await requireCatalogueWrite(recordingId);
  const sourceId = String(formData.get("sourceId") ?? "");
  if (!sourceId) back(recordingId, "Select a source.");
  try {
    await attachSourceToRevision(revisionId, sourceId, session.user.id);
  } catch (err) {
    back(recordingId, messageFor(err, "Could not attach the source."));
  }
  back(recordingId);
}

export async function detachSourceAction(recordingId: string, revisionId: string, sourceId: string) {
  const session = await requireCatalogueWrite(recordingId);
  try {
    await detachSourceFromRevision(revisionId, sourceId, session.user.id);
  } catch (err) {
    back(recordingId, messageFor(err, "Could not remove the source."));
  }
  back(recordingId);
}

export async function attachRightsAction(recordingId: string, revisionId: string, formData: FormData) {
  const session = await requireCatalogueWrite(recordingId);
  const rightsInformationId = String(formData.get("rightsInformationId") ?? "");
  if (!rightsInformationId) back(recordingId, "Select rights information.");
  try {
    await attachRightsToRevision(revisionId, rightsInformationId, session.user.id);
  } catch (err) {
    back(recordingId, messageFor(err, "Could not attach the rights information."));
  }
  back(recordingId);
}

export async function detachRightsAction(recordingId: string, revisionId: string, rightsInformationId: string) {
  const session = await requireCatalogueWrite(recordingId);
  try {
    await detachRightsFromRevision(revisionId, rightsInformationId, session.user.id);
  } catch (err) {
    back(recordingId, messageFor(err, "Could not remove the rights information."));
  }
  back(recordingId);
}
