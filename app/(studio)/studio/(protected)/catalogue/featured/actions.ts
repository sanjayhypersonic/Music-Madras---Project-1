"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { can } from "../../../../../../modules/auth/policy";
import { moveFeaturedVideo, pinFeaturedVideo, unpinFeaturedVideo } from "../../../../../../modules/db/repositories/featuredVideoRepository";

// Phase 6K-3 — Server Actions for featured videos. Featuring changes what visitors see, so each re-checks the session and RECORDING_PUBLISH itself.
// A pin never overrides eligibility (the repository refuses a video the Museum does not currently list).

const BASE = "/studio/catalogue/featured";

function back(message: string, kind: "error" | "notice" = "error"): never {
  redirect(`${BASE}?${kind}=${encodeURIComponent(message)}`);
}

async function requirePublisher() {
  const session = await getCurrentStudioSession();
  if (!session || session.user.status !== "ACTIVE" || !can(session.user.role, "RECORDING_PUBLISH")) back("You do not have permission to change the featured videos.");
  return session!.user;
}

export async function pinAction(formData: FormData) {
  const user = await requirePublisher();
  const videoPageId = String(formData.get("videoPageId") ?? "");
  if (!videoPageId) back("Choose a video to feature.");
  let pinned = false;
  try {
    pinned = (await pinFeaturedVideo({ videoPageId, actorId: user.id, note: String(formData.get("note") ?? "") || null })).pinned;
  } catch (err) {
    back(err instanceof Error ? err.message : "The video could not be pinned.");
  }
  back(pinned ? "The video is now pinned." : "That video was already pinned.", "notice");
}

export async function unpinAction(formData: FormData) {
  const user = await requirePublisher();
  const videoPageId = String(formData.get("videoPageId") ?? "");
  if (!videoPageId) back("That request was incomplete.");
  try {
    await unpinFeaturedVideo({ videoPageId, actorId: user.id });
  } catch (err) {
    back(err instanceof Error ? err.message : "The video could not be unpinned.");
  }
  back("The video is no longer pinned.", "notice");
}

export async function moveAction(formData: FormData) {
  const user = await requirePublisher();
  const videoPageId = String(formData.get("videoPageId") ?? "");
  const direction = String(formData.get("direction") ?? "");
  if (!videoPageId || (direction !== "up" && direction !== "down")) back("That request was incomplete.");
  try {
    await moveFeaturedVideo({ videoPageId, direction: direction as "up" | "down", actorId: user.id });
  } catch (err) {
    back(err instanceof Error ? err.message : "The video could not be moved.");
  }
  back("Order updated.", "notice");
}
