"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import {
  archiveLearningGuide,
  attachRecordingToLearningGuide,
  attachWorkToLearningGuide,
  detachRecordingFromLearningGuide,
  detachWorkFromLearningGuide,
  restoreLearningGuide,
  updateLearningGuide,
} from "../../../../../../../modules/db/repositories/learningGuideRepository";

function errorRedirect(learningGuideId: string, message: string): never {
  redirect(`/studio/catalogue/learning-guides/${learningGuideId}?error=${encodeURIComponent(message)}`);
}

export async function updateLearningGuideAction(learningGuideId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(learningGuideId, "You do not have permission to edit this learning guide.");
  }

  const title = String(formData.get("title") ?? "").trim();
  if (!title) {
    errorRedirect(learningGuideId, "Title is required.");
  }

  const difficultyLevel = String(formData.get("difficultyLevel") ?? "").trim() || null;
  const contentMarkdown = String(formData.get("contentMarkdown") ?? "").trim() || null;
  const readingTimeRaw = String(formData.get("estimatedReadingTimeMinutes") ?? "").trim();
  const estimatedReadingTimeMinutes = readingTimeRaw ? Number.parseInt(readingTimeRaw, 10) : null;

  await updateLearningGuide(learningGuideId, {
    title,
    difficultyLevel,
    contentMarkdown,
    estimatedReadingTimeMinutes,
    actorId: session!.user.id,
  });

  redirect(`/studio/catalogue/learning-guides/${learningGuideId}`);
}

export async function archiveLearningGuideAction(learningGuideId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(learningGuideId, "You do not have permission to archive this learning guide.");
  }

  await archiveLearningGuide(learningGuideId, session!.user.id);
  redirect(`/studio/catalogue/learning-guides/${learningGuideId}`);
}

export async function restoreLearningGuideAction(learningGuideId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(learningGuideId, "You do not have permission to restore this learning guide.");
  }

  await restoreLearningGuide(learningGuideId, session!.user.id);
  redirect(`/studio/catalogue/learning-guides/${learningGuideId}`);
}

export async function attachWorkAction(learningGuideId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(learningGuideId, "You do not have permission to edit this learning guide.");
  }

  const musicalWorkId = String(formData.get("musicalWorkId") ?? "");
  if (!musicalWorkId) {
    errorRedirect(learningGuideId, "Select a musical work to attach.");
  }

  await attachWorkToLearningGuide(learningGuideId, musicalWorkId, session!.user.id);
  redirect(`/studio/catalogue/learning-guides/${learningGuideId}`);
}

export async function detachWorkAction(learningGuideId: string, musicalWorkId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(learningGuideId, "You do not have permission to edit this learning guide.");
  }

  await detachWorkFromLearningGuide(learningGuideId, musicalWorkId, session!.user.id);
  redirect(`/studio/catalogue/learning-guides/${learningGuideId}`);
}

export async function attachRecordingAction(learningGuideId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(learningGuideId, "You do not have permission to edit this learning guide.");
  }

  const recordingId = String(formData.get("recordingId") ?? "");
  if (!recordingId) {
    errorRedirect(learningGuideId, "Select a recording to attach.");
  }

  await attachRecordingToLearningGuide(learningGuideId, recordingId, session!.user.id);
  redirect(`/studio/catalogue/learning-guides/${learningGuideId}`);
}

export async function detachRecordingAction(learningGuideId: string, recordingId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(learningGuideId, "You do not have permission to edit this learning guide.");
  }

  await detachRecordingFromLearningGuide(learningGuideId, recordingId, session!.user.id);
  redirect(`/studio/catalogue/learning-guides/${learningGuideId}`);
}
