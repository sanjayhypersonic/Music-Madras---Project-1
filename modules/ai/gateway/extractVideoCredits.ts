import { createHash } from "crypto";
import type { AIGenerationRequest, AIProvider } from "../provider/aiProvider";
import { VIDEO_CREDITS_OUTPUT_SCHEMA_V1, VIDEO_CREDITS_PROMPT_V1, VIDEO_CREDITS_SYSTEM_INSTRUCTIONS_V1 } from "../prompts/videoCredits/videoCreditsPromptV1";
import { validateVideoCreditsOutput, type CheckedVideoCredits } from "../structuredOutput/validateVideoCreditsOutput";
import type { VideoText } from "../../mmke/provenance/verbatimEvidence";

// Credits extraction, milestone 1: one video in, checked proposals out. No database, no file system, no catalogue write: the caller supplies the
// video's text and an AIProvider, and receives the outcome to report. Persisting proposals as ContentSuggestions and the review queue are later
// milestones (see the design in the session notes); nothing here may grow a write.

/** The video fields this extraction reads. Matches the YouTube fixture export (tests/fixtures/realYouTubeVideos.json). */
export interface VideoCreditsSource extends VideoText {
  privacyStatus: string | null;
  observabilityState?: string | null;
  publishedAt?: string | null;
}

export type VideoSkipReason = "NOT_PUBLIC" | "NOT_OBSERVED" | "NO_DESCRIPTION";

/** Only public, currently observed videos with a description are sent; the rest are skipped without a provider call. */
export function videoSkipReason(video: VideoCreditsSource): VideoSkipReason | null {
  if (video.privacyStatus !== "public") return "NOT_PUBLIC";
  if (video.observabilityState !== undefined && video.observabilityState !== null && video.observabilityState !== "OBSERVED") return "NOT_OBSERVED";
  if ((video.description ?? "").trim().length === 0) return "NO_DESCRIPTION";
  return null;
}

/** The data the model receives for one video: its title and description (untrusted, uploader-written text) and its publication date. */
export function buildVideoCreditsContext(video: VideoCreditsSource): Record<string, unknown> {
  return {
    video: {
      youtubeVideoId: video.youtubeVideoId,
      title: video.title ?? "",
      description: video.description ?? "",
      publishedAt: video.publishedAt ?? null,
    },
  };
}

/** A fingerprint of exactly the text the model reads, so a later run can tell whether a video's text changed since it was extracted. */
export function videoCreditsFingerprint(video: VideoText): string {
  return createHash("sha256").update(JSON.stringify([video.title ?? "", video.description ?? ""])).digest("hex");
}

export function buildVideoCreditsRequest(video: VideoCreditsSource, model?: string): AIGenerationRequest {
  return {
    systemInstructions: VIDEO_CREDITS_SYSTEM_INSTRUCTIONS_V1,
    contextPayload: buildVideoCreditsContext(video),
    outputSchema: VIDEO_CREDITS_OUTPUT_SCHEMA_V1,
    promptVersion: VIDEO_CREDITS_PROMPT_V1,
    targetEntityType: "YOUTUBE_VIDEO",
    targetEntityId: video.youtubeVideoId,
    suggestionType: "CANONICAL_RELATIONSHIP_CANDIDATE",
    contextFingerprint: videoCreditsFingerprint(video),
    model,
  };
}

export type VideoCreditsOutcome =
  | { youtubeVideoId: string; title: string | null; status: "SKIPPED"; skipReason: VideoSkipReason }
  | { youtubeVideoId: string; title: string | null; status: "PROVIDER_FAILED"; provider: string; model?: string; errorType: string; errorMessage: string }
  | { youtubeVideoId: string; title: string | null; status: "INVALID_OUTPUT"; provider: string; model: string; problems: string[] }
  | {
      youtubeVideoId: string;
      title: string | null;
      status: "EXTRACTED";
      provider: string;
      model: string;
      contextFingerprint: string;
      usage?: { inputTokens?: number; outputTokens?: number };
      result: CheckedVideoCredits;
    };

export async function extractVideoCredits(video: VideoCreditsSource, provider: AIProvider, options: { model?: string } = {}): Promise<VideoCreditsOutcome> {
  const base = { youtubeVideoId: video.youtubeVideoId, title: video.title };
  const skip = videoSkipReason(video);
  if (skip) return { ...base, status: "SKIPPED", skipReason: skip };

  const request = buildVideoCreditsRequest(video, options.model);
  const generated = await provider.generate(request);
  if (!generated.ok) {
    return { ...base, status: "PROVIDER_FAILED", provider: generated.provider, model: generated.model, errorType: generated.error.type, errorMessage: generated.error.message };
  }

  const checked = validateVideoCreditsOutput(generated.output, video);
  if (!checked.ok) return { ...base, status: "INVALID_OUTPUT", provider: generated.provider, model: generated.model, problems: checked.problems };

  return {
    ...base,
    status: "EXTRACTED",
    provider: generated.provider,
    model: generated.model,
    contextFingerprint: request.contextFingerprint,
    usage: generated.usage,
    result: checked,
  };
}
