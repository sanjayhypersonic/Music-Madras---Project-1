import {
  PLAYLIST_DRAFT_OUTPUT_SCHEMA_V2,
  PLAYLIST_DRAFT_PROMPT_V2,
  PLAYLIST_DRAFT_SYSTEM_INSTRUCTIONS_V2,
  PLAYLIST_INTERVIEW_OUTPUT_SCHEMA_V1,
  PLAYLIST_INTERVIEW_SYSTEM_INSTRUCTIONS_V1,
  PLAYLIST_PAGE_PROMPT_V1,
} from "../prompts/playlistPage/playlistPagePromptV1";
import { PlaylistAiOutputError, validateDraftOutput, validateInterviewOutput } from "../structuredOutput/validatePlaylistOutput";
import { getConfiguredAIProvider } from "../provider/aiProviderRegistry";
import type { AIGenerationResult, AIProvider } from "../provider/aiProvider";
import { loadResolvedSettings } from "../../db/repositories/siteSettingRepository";
import {
  ContextInputError,
  createDraftProposal,
  listAskedQuestions,
  listContextInputs,
  loadPlaylistEvidence,
  recordInterviewQuestion,
} from "../../db/repositories/playlistContextRepository";
import { prisma } from "../../db/client";
import type { PlaylistContextInput, PlaylistDraftProposal, PlaylistDraftTarget } from "@prisma/client";

// Phase 6K-5 — the playlist assistant's gateway: the one place the interview and the drafting are wired to an AI provider.
//
// Hard limits, enforced here and by the output validators, not by trusting the model:
//  - it ASKS one question at a time and PROPOSES text; it cannot answer for the editor, publish, approve rights, or approve an unlisted video
//    (there is no code path from this module to any of those);
//  - it sees only the evidence built in code (playlistEvidence.ts) and may state only what that evidence supports;
//  - every reply is validated as untrusted output, and a draft is only stored as a proposal, never applied. A draft that passes is marked "needs
//    human verification" — the checks are mechanical (modules/ai/structuredOutput/validatePlaylistOutput.ts says exactly what they do and do not
//    establish) — and it can be accepted only after a person confirms they checked each statement against its evidence;
//  - when it cannot proceed (switched off, no provider configured, nothing to draft from) it says so plainly instead of guessing.
// Dependency direction matches the recording gateway: this imports repositories and the provider interface; nothing imports it back.

export type AssistantRefusal = "DISABLED" | "NOT_CONFIGURED" | "QUESTION_PENDING" | "LIMIT_REACHED" | "NEEDS_CONTEXT" | "NO_VISIBLE_VIDEOS" | "ARCHIVED" | "NOT_FOUND" | "PROVIDER_ERROR" | "INVALID_OUTPUT";

export type QuestionResult =
  | { ok: true; kind: "QUESTION"; input: PlaylistContextInput }
  | { ok: true; kind: "ENOUGH_CONTEXT"; reason: string }
  | { ok: false; reason: AssistantRefusal; message: string };

export type DraftResult =
  | { ok: true; kind: "DRAFT"; proposal: PlaylistDraftProposal }
  | { ok: true; kind: "INFORMATION_GAP"; missing: string }
  | { ok: false; reason: AssistantRefusal; message: string };

interface BaseInput {
  playlistPageId: string;
  requestedById: string;
  /** Injectable for tests; defaults to the deployment's configured provider. */
  provider?: AIProvider;
}

const refuse = (reason: AssistantRefusal, message: string) => ({ ok: false as const, reason, message });

function describeProviderFailure(result: Extract<AIGenerationResult, { ok: false }>): string {
  switch (result.error.type) {
    case "CONFIGURATION":
    case "AUTHENTICATION":
      return "The AI assistant is not set up correctly on this deployment. An administrator needs to check its configuration.";
    case "RATE_LIMIT":
      return "The AI assistant is busy right now. Please try again in a minute.";
    case "TIMEOUT":
    case "NETWORK":
      return "The AI assistant did not respond in time. Please try again.";
    default:
      return "The AI assistant could not complete that request. Please try again, or add your own notes instead.";
  }
}

async function prepare(input: BaseInput): Promise<{ ok: true; provider: AIProvider; maxQuestions: number } | ReturnType<typeof refuse>> {
  const settings = await loadResolvedSettings();
  if (!settings.get("playlistAssistant.enabled")) return refuse("DISABLED", "The AI assistant is switched off in settings.");
  let provider: AIProvider;
  try {
    provider = input.provider ?? getConfiguredAIProvider();
  } catch {
    return refuse("NOT_CONFIGURED", "No AI provider is configured for this deployment, so the assistant is unavailable. You can still add your own notes.");
  }
  const status = provider.validateConfiguration();
  if (!status.configured) return refuse("NOT_CONFIGURED", "No AI provider is configured for this deployment, so the assistant is unavailable. You can still add your own notes.");
  const page = await prisma.playlistPage.findUnique({ where: { id: input.playlistPageId }, select: { archivedAt: true } });
  if (!page) return refuse("NOT_FOUND", "That playlist page does not exist.");
  if (page.archivedAt) return refuse("ARCHIVED", "An archived playlist page cannot be changed.");
  return { ok: true, provider, maxQuestions: settings.get("playlistAssistant.maxQuestions") };
}

/** Asks the assistant for the next single interview question (or to say there is already enough context). */
export async function proposeNextInterviewQuestion(input: BaseInput): Promise<QuestionResult> {
  const prepared = await prepare(input);
  if (!prepared.ok) return prepared;

  const existing = await listContextInputs(input.playlistPageId);
  if (existing.some((i) => i.status === "AWAITING_ANSWER")) return refuse("QUESTION_PENDING", "A question is already waiting for an answer. Answer or skip it first.");
  const asked = existing.filter((i) => i.source === "AI_QUESTION").length;
  if (asked >= prepared.maxQuestions) return refuse("LIMIT_REACHED", `The most questions allowed for one playlist page (${prepared.maxQuestions}) have been asked. Add your own notes instead.`);

  const { evidence } = await loadPlaylistEvidence(input.playlistPageId);
  const alreadyAsked = await listAskedQuestions(input.playlistPageId);
  const result = await prepared.provider.generate({
    systemInstructions: PLAYLIST_INTERVIEW_SYSTEM_INSTRUCTIONS_V1,
    contextPayload: { evidence: evidence.items, questionsAlreadyAsked: alreadyAsked },
    outputSchema: PLAYLIST_INTERVIEW_OUTPUT_SCHEMA_V1,
    promptVersion: PLAYLIST_PAGE_PROMPT_V1,
    targetEntityType: "PLAYLIST_PAGE",
    targetEntityId: input.playlistPageId,
    suggestionType: "INTERVIEW_QUESTION",
    contextFingerprint: evidence.fingerprint,
    maxOutputTokens: 400,
  });
  if (!result.ok) return refuse("PROVIDER_ERROR", describeProviderFailure(result));

  try {
    const validated = validateInterviewOutput(result.output, alreadyAsked);
    if (validated.kind === "ENOUGH_CONTEXT") return { ok: true, kind: "ENOUGH_CONTEXT", reason: validated.reason };
    const row = await recordInterviewQuestion({
      playlistPageId: input.playlistPageId,
      question: validated.question,
      provider: result.provider,
      model: result.model,
      promptVersion: result.promptVersion,
      requestedById: input.requestedById,
      maxQuestions: prepared.maxQuestions,
    });
    return { ok: true, kind: "QUESTION", input: row };
  } catch (err) {
    if (err instanceof PlaylistAiOutputError) return refuse("INVALID_OUTPUT", `The assistant's reply was discarded: ${err.message}`);
    if (err instanceof ContextInputError) return refuse("QUESTION_PENDING", err.message);
    throw err;
  }
}

/** Asks the assistant to draft a summary or body from the supplied evidence only. The result is a PROPOSAL; nothing is applied. */
export async function proposeDraft(input: BaseInput & { target: PlaylistDraftTarget }): Promise<DraftResult> {
  const prepared = await prepare(input);
  if (!prepared.ok) return prepared;

  const { evidence, contextCount, visibleMemberCount } = await loadPlaylistEvidence(input.playlistPageId);
  if (visibleMemberCount === 0) return refuse("NO_VISIBLE_VIDEOS", "There are no videos the Museum can show on this playlist yet, so there is nothing to describe.");
  if (contextCount === 0) return refuse("NEEDS_CONTEXT", "Answer at least one interview question or add a note first: a draft is written only from what you have told the Museum, never from guesses.");

  const result = await prepared.provider.generate({
    systemInstructions: PLAYLIST_DRAFT_SYSTEM_INSTRUCTIONS_V2,
    contextPayload: { target: input.target, evidence: evidence.items },
    outputSchema: PLAYLIST_DRAFT_OUTPUT_SCHEMA_V2,
    promptVersion: PLAYLIST_DRAFT_PROMPT_V2,
    targetEntityType: "PLAYLIST_PAGE",
    targetEntityId: input.playlistPageId,
    suggestionType: input.target === "SUMMARY" ? "PLAYLIST_SUMMARY" : "PLAYLIST_BODY",
    contextFingerprint: evidence.fingerprint,
    maxOutputTokens: 1500,
  });
  if (!result.ok) return refuse("PROVIDER_ERROR", describeProviderFailure(result));

  try {
    const validated = validateDraftOutput(result.output, evidence, input.target);
    if (validated.kind === "INFORMATION_GAP") return { ok: true, kind: "INFORMATION_GAP", missing: validated.missing };
    const proposal = await createDraftProposal({
      playlistPageId: input.playlistPageId,
      target: input.target,
      text: validated.text,
      sentences: validated.sentences,
      evidenceFingerprint: evidence.fingerprint,
      provider: result.provider,
      model: result.model,
      promptVersion: result.promptVersion,
      requestedById: input.requestedById,
    });
    return { ok: true, kind: "DRAFT", proposal };
  } catch (err) {
    if (err instanceof PlaylistAiOutputError) return refuse("INVALID_OUTPUT", `The assistant's draft was discarded: ${err.message}`);
    throw err;
  }
}
