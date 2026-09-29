"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { createLearningGuide } from "../../../../../../../modules/db/repositories/learningGuideRepository";
import { SlugConflictError } from "../../../../../../../modules/mmke/slug/SlugConflictError";
import { slugify } from "../../../../../../../modules/mmke/slug/slugify";

function errorRedirect(message: string): never {
  redirect(`/studio/catalogue/learning-guides/new?error=${encodeURIComponent(message)}`);
}

export async function createLearningGuideAction(formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect("You do not have permission to add learning guides.");
  }

  const title = String(formData.get("title") ?? "").trim();
  if (!title) {
    errorRedirect("Title is required.");
  }

  const difficultyLevel = String(formData.get("difficultyLevel") ?? "").trim() || undefined;
  const contentMarkdown = String(formData.get("contentMarkdown") ?? "").trim() || undefined;
  const readingTimeRaw = String(formData.get("estimatedReadingTimeMinutes") ?? "").trim();
  const estimatedReadingTimeMinutes = readingTimeRaw ? Number.parseInt(readingTimeRaw, 10) : undefined;

  let guide;
  try {
    guide = await createLearningGuide({
      slug: slugify(title),
      title,
      difficultyLevel,
      contentMarkdown,
      estimatedReadingTimeMinutes,
      actorId: session!.user.id,
    });
  } catch (err) {
    if (err instanceof SlugConflictError) {
      errorRedirect(err.message);
    }
    throw err;
  }

  redirect(`/studio/catalogue/learning-guides/${guide.id}`);
}
