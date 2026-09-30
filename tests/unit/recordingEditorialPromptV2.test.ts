import { describe, expect, it } from "vitest";
import {
  RECORDING_EDITORIAL_OUTPUT_SCHEMA_V2,
  RECORDING_EDITORIAL_PROMPT_V2,
  RECORDING_EDITORIAL_SYSTEM_INSTRUCTIONS_V2,
} from "../../modules/ai/prompts/recordingEditorial/recordingEditorialPromptV2";
import { RECORDING_EDITORIAL_OUTPUT_SCHEMA_V1, RECORDING_EDITORIAL_PROMPT_V1 } from "../../modules/ai/prompts/recordingEditorial/recordingEditorialPromptV1";

// Phase 6H-7 — sanity tests for the strengthened prompt. These do not (and
// cannot) prove a live model obeys the instructions — only a real
// Anthropic call could — but they do prove the required guardrail language
// is actually present, is a genuinely new version (not v1 renamed), and
// that the output contract itself is unchanged (the schema, not the
// prompt, is what structurally prevents an out-of-contract suggestion type).

describe("recording-editorial-v2 prompt", () => {
  it("is a distinct version id from v1", () => {
    expect(RECORDING_EDITORIAL_PROMPT_V2).toBe("recording-editorial-v2");
    expect(RECORDING_EDITORIAL_PROMPT_V2).not.toBe(RECORDING_EDITORIAL_PROMPT_V1);
  });

  it("reuses the v1 output schema unchanged — only instructions are strengthened, not the output contract", () => {
    expect(RECORDING_EDITORIAL_OUTPUT_SCHEMA_V2).toBe(RECORDING_EDITORIAL_OUTPUT_SCHEMA_V1);
  });

  it("still constrains outputType to exactly SUGGESTION and INFORMATION_GAP — the structural EDITORIAL_PROSE-only contract", () => {
    const schema = RECORDING_EDITORIAL_OUTPUT_SCHEMA_V2 as { properties: { outputType: { enum: string[] } } };
    expect(schema.properties.outputType.enum).toEqual(["SUGGESTION", "INFORMATION_GAP"]);
  });

  it("explicitly instructs closed-world generation (no pretrained/general knowledge)", () => {
    expect(RECORDING_EDITORIAL_SYSTEM_INSTRUCTIONS_V2).toMatch(/CLOSED-WORLD/i);
    expect(RECORDING_EDITORIAL_SYSTEM_INSTRUCTIONS_V2).toMatch(/pretrained/i);
  });

  it("explicitly names the four-tier source hierarchy", () => {
    for (const tier of ["CANONICAL_MMKE", "YOUTUBE_METADATA", "APPROVED_EDITORIAL", "APPROVED_EXTERNAL_SOURCE"]) {
      expect(RECORDING_EDITORIAL_SYSTEM_INSTRUCTIONS_V2).toContain(tier);
    }
  });

  it("explicitly forbids hedging language as a loophole around unsupported claims", () => {
    expect(RECORDING_EDITORIAL_SYSTEM_INSTRUCTIONS_V2).toMatch(/hedging/i);
    expect(RECORDING_EDITORIAL_SYSTEM_INSTRUCTIONS_V2.toLowerCase()).toContain("it is believed");
  });

  it("explicitly instructs never resolving a conflict between YouTube text and canonical facts", () => {
    expect(RECORDING_EDITORIAL_SYSTEM_INSTRUCTIONS_V2).toMatch(/do not decide which is correct/i);
  });

  it("explicitly reframes information gaps as a good outcome, not a failure", () => {
    expect(RECORDING_EDITORIAL_SYSTEM_INSTRUCTIONS_V2).toMatch(/good outcome/i);
  });

  it("never instructs the model to research the web", () => {
    expect(RECORDING_EDITORIAL_SYSTEM_INSTRUCTIONS_V2.toLowerCase()).not.toContain("search the web");
    expect(RECORDING_EDITORIAL_SYSTEM_INSTRUCTIONS_V2.toLowerCase()).not.toContain("browse the internet");
  });
});
