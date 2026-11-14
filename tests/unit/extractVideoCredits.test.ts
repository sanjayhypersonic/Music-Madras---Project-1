import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import {
  buildVideoCreditsRequest,
  extractVideoCredits,
  videoCreditsFingerprint,
  videoSkipReason,
  type VideoCreditsSource,
} from "../../modules/ai/gateway/extractVideoCredits";
import { FakeAIProvider } from "../../modules/ai/providers/fake/fakeAIProvider";
import type { AIProvider } from "../../modules/ai/provider/aiProvider";
import { VIDEO_CREDITS_PROMPT_V1, VIDEO_CREDITS_SYSTEM_INSTRUCTIONS_V1 } from "../../modules/ai/prompts/videoCredits/videoCreditsPromptV1";

// Credits extraction, milestone 1: one video through the gateway with the deterministic fake provider. No network, no database.

const root = path.resolve(__dirname, "../..");
const fixtures = JSON.parse(readFileSync(path.join(root, "tests/fixtures/realYouTubeVideos.json"), "utf8")) as { videos: VideoCreditsSource[] };
const canned = JSON.parse(readFileSync(path.join(root, "tests/fixtures/videoCreditsFakeResponses.json"), "utf8")) as Record<string, unknown>;
const video = (id: string) => fixtures.videos.find((v) => v.youtubeVideoId === id) as VideoCreditsSource;
const dingiri = video("zEQmnmwr5UE");

/** A provider that fails the test if it is ever called. */
const neverCalled = (): AIProvider => ({
  providerName: "never",
  generate: vi.fn(async () => {
    throw new Error("the provider must not be called for a skipped video");
  }),
  validateConfiguration: () => ({ configured: true }),
  capabilities: () => ({ structuredOutput: true, vision: false, toolCalling: false, streaming: false, usageMetrics: false }),
});

describe("which videos are sent", () => {
  it("skips a video that is not public, not observed, or has no description — without calling the provider", async () => {
    expect(videoSkipReason(video("pcksu7PtG8Y"))).toBe("NOT_PUBLIC");
    expect(videoSkipReason(video("0RQXxX1J79I"))).toBe("NO_DESCRIPTION");
    expect(videoSkipReason({ ...dingiri, observabilityState: "NOT_OBSERVED" })).toBe("NOT_OBSERVED");
    expect(videoSkipReason(dingiri)).toBeNull();

    const provider = neverCalled();
    const outcome = await extractVideoCredits(video("pcksu7PtG8Y"), provider);
    expect(outcome).toEqual({ youtubeVideoId: "pcksu7PtG8Y", title: video("pcksu7PtG8Y").title, status: "SKIPPED", skipReason: "NOT_PUBLIC" });
    expect(provider.generate).not.toHaveBeenCalled();
  });
});

describe("the request", () => {
  it("keeps the instructions apart from the video's text, which travels only as context data", () => {
    const request = buildVideoCreditsRequest(dingiri, "claude-opus-5-5");
    expect(request.systemInstructions).toBe(VIDEO_CREDITS_SYSTEM_INSTRUCTIONS_V1);
    expect(request.systemInstructions).not.toContain("Dingiri");
    expect(request.contextPayload).toEqual({ video: { youtubeVideoId: "zEQmnmwr5UE", title: dingiri.title, description: dingiri.description, publishedAt: dingiri.publishedAt } });
    expect(request).toMatchObject({
      promptVersion: VIDEO_CREDITS_PROMPT_V1,
      targetEntityType: "YOUTUBE_VIDEO",
      targetEntityId: "zEQmnmwr5UE",
      suggestionType: "CANONICAL_RELATIONSHIP_CANDIDATE",
      model: "claude-opus-5-5",
    });
  });

  it("fingerprints exactly the text the model reads", () => {
    expect(videoCreditsFingerprint(dingiri)).toMatch(/^[0-9a-f]{64}$/);
    expect(videoCreditsFingerprint(dingiri)).toBe(videoCreditsFingerprint({ ...dingiri }));
    expect(videoCreditsFingerprint({ ...dingiri, description: `${dingiri.description} ` })).not.toBe(videoCreditsFingerprint(dingiri));
  });
});

describe("outcomes", () => {
  it("returns the checked credits when the provider answers", async () => {
    const outcome = await extractVideoCredits(dingiri, new FakeAIProvider({ respond: (r) => canned[r.targetEntityId] }));
    expect(outcome.status).toBe("EXTRACTED");
    if (outcome.status !== "EXTRACTED") return;
    expect(outcome.provider).toBe("fake");
    expect(outcome.result.accepted).toHaveLength(6);
    expect(outcome.result.rejected).toHaveLength(3);
    expect(outcome.contextFingerprint).toBe(videoCreditsFingerprint(dingiri));
  });

  it("reports a refusal and a cut-off as provider failures, with their types", async () => {
    for (const mode of ["REFUSAL", "OUTPUT_TRUNCATED"] as const) {
      const outcome = await extractVideoCredits(dingiri, new FakeAIProvider({ mode }));
      expect(outcome).toMatchObject({ status: "PROVIDER_FAILED", errorType: mode });
    }
  });

  it("reports a malformed answer as INVALID_OUTPUT with the problems, never as credits", async () => {
    const outcome = await extractVideoCredits(dingiri, new FakeAIProvider({ mode: "MALFORMED_OUTPUT" }));
    expect(outcome.status).toBe("INVALID_OUTPUT");
    if (outcome.status !== "INVALID_OUTPUT") return;
    expect(outcome.problems.length).toBeGreaterThan(0);
  });
});

describe("FakeAIProvider additions", () => {
  it("answers per request with `respond`, falling back to `output` when it returns undefined", async () => {
    const provider = new FakeAIProvider({ output: { fallback: true }, respond: (r) => (r.targetEntityId === "a" ? { forA: true } : undefined) });
    const request = buildVideoCreditsRequest(dingiri);
    expect(await provider.generate({ ...request, targetEntityId: "a" })).toMatchObject({ ok: true, output: { forA: true } });
    expect(await provider.generate({ ...request, targetEntityId: "b" })).toMatchObject({ ok: true, output: { fallback: true } });
  });

  it("simulates a refusal and a cut-off as non-retryable failures", async () => {
    const request = buildVideoCreditsRequest(dingiri);
    expect(await new FakeAIProvider({ mode: "REFUSAL" }).generate(request)).toMatchObject({ ok: false, error: { type: "REFUSAL", retryable: false } });
    expect(await new FakeAIProvider({ mode: "OUTPUT_TRUNCATED" }).generate(request)).toMatchObject({ ok: false, error: { type: "OUTPUT_TRUNCATED", retryable: false } });
  });
});
