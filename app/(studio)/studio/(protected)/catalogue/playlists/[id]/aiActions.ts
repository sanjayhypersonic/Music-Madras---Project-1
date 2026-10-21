"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { proposeDraft, proposeNextInterviewQuestion } from "../../../../../../../modules/ai/gateway/playlistAssistant";
import {
  acceptDraftProposal,
  addContextNote,
  answerInterviewQuestion,
  rejectDraftProposal,
  skipInterviewQuestion,
  withdrawContextInput,
} from "../../../../../../../modules/db/repositories/playlistContextRepository";

// Phase 6K-5 — Server Actions for the playlist assistant and the context a person supplies. Every one needs CATALOGUE_WRITE (it only ever edits a
// DRAFT) and re-checks the session itself. None of them can publish, approve rights or approve an unlisted video: publishing stays
// RECORDING_PUBLISH in ./actions.ts, and approvals in the Studio's approval actions.

const target = (id: string, query = "") => `/studio/catalogue/playlists/${id}${query}`;
const fail = (id: string, message: string): never => redirect(target(id, `?error=${encodeURIComponent(message)}`));
const ok = (id: string, message: string): never => redirect(target(id, `?notice=${encodeURIComponent(message)}`));

async function editor(id: string) {
  const session = await getCurrentStudioSession();
  if (!session || session.user.status !== "ACTIVE") redirect("/studio/signin");
  if (!can(session.user.role, "CATALOGUE_WRITE")) fail(id, "You do not have permission to do that.");
  return session.user;
}

const message = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

export async function askQuestionAction(id: string) {
  const user = await editor(id);
  const result = await proposeNextInterviewQuestion({ playlistPageId: id, requestedById: user.id });
  if (!result.ok) fail(id, result.message);
  else if (result.kind === "ENOUGH_CONTEXT") ok(id, "The assistant thinks there is already enough context to describe this playlist. You can ask for a draft.");
  ok(id, "The assistant has asked a question.");
}

export async function answerAction(id: string, inputId: string, formData: FormData) {
  const user = await editor(id);
  try {
    await answerInterviewQuestion({ inputId, body: String(formData.get("answer") ?? ""), actorId: user.id });
  } catch (err) {
    fail(id, message(err, "The answer could not be saved."));
  }
  ok(id, "Answer recorded.");
}

export async function skipAction(id: string, inputId: string) {
  const user = await editor(id);
  try {
    await skipInterviewQuestion({ inputId, actorId: user.id });
  } catch (err) {
    fail(id, message(err, "The question could not be skipped."));
  }
  ok(id, "Question skipped.");
}

export async function addNoteAction(id: string, formData: FormData) {
  const user = await editor(id);
  try {
    await addContextNote({ playlistPageId: id, body: String(formData.get("note") ?? ""), actorId: user.id });
  } catch (err) {
    fail(id, message(err, "The note could not be saved."));
  }
  ok(id, "Note recorded.");
}

export async function withdrawAction(id: string, inputId: string) {
  const user = await editor(id);
  try {
    await withdrawContextInput({ inputId, actorId: user.id });
  } catch (err) {
    fail(id, message(err, "That item could not be withdrawn."));
  }
  ok(id, "Withdrawn. It no longer counts as evidence.");
}

export async function proposeDraftAction(id: string, target_: "SUMMARY" | "BODY") {
  const user = await editor(id);
  const result = await proposeDraft({ playlistPageId: id, target: target_, requestedById: user.id });
  if (!result.ok) fail(id, result.message);
  else if (result.kind === "INFORMATION_GAP") fail(id, `The assistant cannot write this without guessing. ${result.missing}`);
  ok(id, "A draft has been proposed below. It passed the automatic checks but is NOT verified: read each statement against the evidence beside it before you accept. Nothing changes until you do.");
}

export async function acceptProposalAction(id: string, proposalId: string, formData: FormData) {
  const user = await editor(id);
  try {
    await acceptDraftProposal({ proposalId, expectedVersion: Number(formData.get("expectedVersion") ?? "-1"), actorId: user.id, humanVerified: formData.get("verified") === "on" });
  } catch (err) {
    fail(id, message(err, "The draft could not be accepted."));
  }
  ok(id, "Accepted into the draft. It is not live: check it, make sure the page passes the publication checks, then publish.");
}

export async function rejectProposalAction(id: string, proposalId: string) {
  const user = await editor(id);
  try {
    await rejectDraftProposal({ proposalId, actorId: user.id });
  } catch (err) {
    fail(id, message(err, "The draft could not be dismissed."));
  }
  ok(id, "Draft dismissed.");
}
