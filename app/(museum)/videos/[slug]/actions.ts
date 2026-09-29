"use server";

import { trackEvent } from "../../../../modules/analytics/trackEvent";
import { createYouTubeClickEvent } from "../../../../modules/analytics/events/factories";
import { createEphemeralSessionId } from "../../../../modules/analytics/createEphemeralSessionId";

// Phase 6G-18 — the server-side half of the outbound "Watch on YouTube"
// click (brief §17: "outbound_video_click"). Reuses the existing
// youtube_click event (Phase 3) rather than adding a duplicate event name
// — same purpose, already-established vocabulary. Fire-and-forget from
// the client (components/museum/OutboundYouTubeLink.tsx never awaits
// this), so it can never delay or block the user's actual outbound
// navigation.
export async function trackYouTubeClickAction(youtubeVideoId: string): Promise<void> {
  await trackEvent(createYouTubeClickEvent(youtubeVideoId, createEphemeralSessionId()));
}
