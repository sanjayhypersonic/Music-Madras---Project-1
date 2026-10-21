import { writeAuditLog } from "../../audit/writeAuditLog";
import { exposedVideoPageWhere } from "../../mmke/catalogue/videoExposureQuery";
import { buildEvidence, type EvidenceSet } from "../../mmke/playlists/playlistEvidence";
import { PLAYLIST_LIMITS } from "../../mmke/playlists/playlistFields";
import { PlaylistArchivedError, PlaylistConflictError, PlaylistInvalidError, PlaylistNotFoundError } from "../../mmke/playlists/playlistErrors";
import { prisma } from "../client";
import { syncPlaylistQualityNotificationSafely } from "./playlistPageRepository";
import { PlaylistAiOutputError, validateDraftOutput, type DraftSentence } from "../../ai/structuredOutput/validatePlaylistOutput";
import type { PlaylistContextInput, PlaylistDraftProposal, PlaylistDraftTarget, Prisma } from "@prisma/client";

// Phase 6K-5 — the human-supplied context for a playlist page, and the AI's draft proposals.
//
//  - A CONTEXT INPUT is something a PERSON said about the playlist: the answer to an interview question or a note an editor wrote. The assistant
//    proposes questions; it can never supply an answer. Only ACTIVE inputs are evidence (for the quality rubric and for drafting). At most one
//    question awaits an answer at a time.
//  - A DRAFT PROPOSAL is text the assistant wrote from the evidence. It changes nothing by itself: a person accepts it into the page's DRAFT
//    (which then still has to pass the quality rubric and be published by someone who may publish), and acceptance is refused if the evidence it
//    was written from has changed since.
// Authorization is decided by the calling Server Action (CATALOGUE_WRITE). Nothing here can publish, approve rights or approve a video.

type Client = Prisma.TransactionClient | typeof prisma;

const MAX_ANSWER = 2000;

async function lockPlaylist(tx: Prisma.TransactionClient, id: string): Promise<void> {
  await tx.$queryRaw`select id from playlist_pages where id = ${id} for update`;
}

/** Locks the page and refuses a missing or ARCHIVED one: nothing about an archived playlist page's context or drafts can change until it is restored. */
async function lockEditable(tx: Prisma.TransactionClient, id: string): Promise<void> {
  await lockPlaylist(tx, id);
  const page = await tx.playlistPage.findUnique({ where: { id }, select: { archivedAt: true } });
  if (!page) throw new PlaylistNotFoundError();
  if (page.archivedAt) throw new PlaylistArchivedError();
}

export class ContextInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextInputError";
  }
}

export class StaleProposalError extends Error {
  constructor() {
    super("The evidence this draft was written from has changed (videos or context were added, removed or edited). Ask for a new draft.");
    this.name = "StaleProposalError";
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------------------------------------------------------------

/** The exact evidence the assistant may use for this playlist right now (see modules/mmke/playlists/playlistEvidence.ts). */
export async function loadPlaylistEvidence(playlistPageId: string, client: Client = prisma): Promise<{ evidence: EvidenceSet; contextCount: number; visibleMemberCount: number; title: string }> {
  const page = await client.playlistPage.findUnique({ where: { id: playlistPageId }, include: { items: { orderBy: [{ position: "asc" }, { id: "asc" }], select: { videoPageId: true } } } });
  if (!page) throw new PlaylistNotFoundError();
  const memberIds = page.items.map((i) => i.videoPageId);
  const visible =
    memberIds.length === 0
      ? []
      : await client.youTubeVideoPage.findMany({
          where: { AND: [{ id: { in: memberIds } }, exposedVideoPageWhere({ kind: "PLAYLIST", playlistPageId })] },
          select: { id: true, curatorNote: true, youtubeVideo: { select: { title: true, publishedAt: true } } },
        });
  const byId = new Map(visible.map((v) => [v.id, v]));
  const members = memberIds.flatMap((id) => {
    const v = byId.get(id);
    return v ? [{ title: v.youtubeVideo.title, publishedAt: v.youtubeVideo.publishedAt, curatorNote: v.curatorNote }] : [];
  });
  const inputs = await client.playlistContextInput.findMany({ where: { playlistPageId, status: "ACTIVE" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { question: true, body: true } });
  const evidence = buildEvidence({ playlistTitle: page.title, members, inputs: inputs.map((i) => ({ question: i.question, body: i.body ?? "" })) });
  return { evidence, contextCount: inputs.length, visibleMemberCount: members.length, title: page.title };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Context inputs
// ---------------------------------------------------------------------------------------------------------------------------------

export function listContextInputs(playlistPageId: string) {
  return prisma.playlistContextInput.findMany({ where: { playlistPageId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { createdBy: { select: { name: true } }, answeredBy: { select: { name: true } } } });
}

/** Questions already asked of this page (any status), oldest first — so the assistant is never asked to repeat one. */
export async function listAskedQuestions(playlistPageId: string): Promise<string[]> {
  const rows = await prisma.playlistContextInput.findMany({ where: { playlistPageId, source: "AI_QUESTION" }, orderBy: { createdAt: "asc" }, select: { question: true } });
  return rows.flatMap((r) => (r.question ? [r.question] : []));
}

export async function recordInterviewQuestion(input: { playlistPageId: string; question: string; provider: string; model: string; promptVersion: string; requestedById: string; maxQuestions: number }): Promise<PlaylistContextInput> {
  return prisma.$transaction(async (tx) => {
    await lockEditable(tx, input.playlistPageId);
    if (await tx.playlistContextInput.findFirst({ where: { playlistPageId: input.playlistPageId, status: "AWAITING_ANSWER" }, select: { id: true } })) {
      throw new ContextInputError("A question is already waiting for an answer. Answer or skip it first.");
    }
    const asked = await tx.playlistContextInput.count({ where: { playlistPageId: input.playlistPageId, source: "AI_QUESTION" } });
    if (asked >= input.maxQuestions) throw new ContextInputError(`The most questions allowed for one playlist page (${input.maxQuestions}) have been asked. Add your own notes instead.`);
    const row = await tx.playlistContextInput.create({
      data: { playlistPageId: input.playlistPageId, source: "AI_QUESTION", status: "AWAITING_ANSWER", question: input.question, provider: input.provider, model: input.model, promptVersion: input.promptVersion, createdById: input.requestedById },
    });
    await writeAuditLog({ actorId: input.requestedById, action: "PLAYLIST_QUESTION_ASKED", entityType: "PlaylistPage", entityId: input.playlistPageId, afterSnapshot: { inputId: row.id, provider: input.provider, model: input.model } }, tx);
    return row;
  });
}

function cleanBody(raw: string): string {
  const body = raw.replace(/\r\n/g, "\n").trim();
  if (!body) throw new ContextInputError("Write something first.");
  if (body.length > MAX_ANSWER) throw new ContextInputError(`That is longer than ${MAX_ANSWER} characters; please shorten it.`);
  return body;
}

export async function answerInterviewQuestion(input: { inputId: string; body: string; actorId: string }): Promise<void> {
  const body = cleanBody(input.body);
  let playlistPageId = "";
  await prisma.$transaction(async (tx) => {
    const row = await tx.playlistContextInput.findUnique({ where: { id: input.inputId } });
    if (!row) throw new ContextInputError("That question no longer exists.");
    playlistPageId = row.playlistPageId;
    await lockEditable(tx, row.playlistPageId);
    const moved = await tx.playlistContextInput.updateMany({ where: { id: row.id, status: "AWAITING_ANSWER" }, data: { status: "ACTIVE", body, answeredById: input.actorId, answeredAt: new Date() } });
    if (moved.count !== 1) throw new ContextInputError("That question is no longer waiting for an answer.");
    await tx.playlistPage.update({ where: { id: row.playlistPageId }, data: { updatedById: input.actorId } });
    await writeAuditLog({ actorId: input.actorId, action: "PLAYLIST_QUESTION_ANSWERED", entityType: "PlaylistPage", entityId: row.playlistPageId, afterSnapshot: { inputId: row.id } }, tx);
  });
  await syncPlaylistQualityNotificationSafely(playlistPageId);
}

export async function skipInterviewQuestion(input: { inputId: string; actorId: string }): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const row = await tx.playlistContextInput.findUnique({ where: { id: input.inputId } });
    if (!row) throw new ContextInputError("That question no longer exists.");
    await lockEditable(tx, row.playlistPageId);
    const moved = await tx.playlistContextInput.updateMany({ where: { id: row.id, status: "AWAITING_ANSWER" }, data: { status: "SKIPPED", answeredById: input.actorId, answeredAt: new Date() } });
    if (moved.count !== 1) throw new ContextInputError("That question is no longer waiting for an answer.");
    await writeAuditLog({ actorId: input.actorId, action: "PLAYLIST_QUESTION_SKIPPED", entityType: "PlaylistPage", entityId: row.playlistPageId, afterSnapshot: { inputId: row.id } }, tx);
  });
}

export async function addContextNote(input: { playlistPageId: string; body: string; actorId: string }): Promise<PlaylistContextInput> {
  const body = cleanBody(input.body);
  const created = await prisma.$transaction(async (tx) => {
    await lockEditable(tx, input.playlistPageId);
    const row = await tx.playlistContextInput.create({ data: { playlistPageId: input.playlistPageId, source: "EDITOR_NOTE", status: "ACTIVE", body, createdById: input.actorId, answeredById: input.actorId, answeredAt: new Date() } });
    await tx.playlistPage.update({ where: { id: input.playlistPageId }, data: { updatedById: input.actorId } });
    await writeAuditLog({ actorId: input.actorId, action: "PLAYLIST_NOTE_ADDED", entityType: "PlaylistPage", entityId: input.playlistPageId, afterSnapshot: { inputId: row.id } }, tx);
    return row;
  });
  await syncPlaylistQualityNotificationSafely(input.playlistPageId);
  return created;
}

/** Withdraws an input so it is no longer evidence. It is kept for the record. */
export async function withdrawContextInput(input: { inputId: string; actorId: string }): Promise<void> {
  let playlistPageId: string | null = null;
  await prisma.$transaction(async (tx) => {
    const row = await tx.playlistContextInput.findUnique({ where: { id: input.inputId } });
    if (!row) throw new ContextInputError("That item no longer exists.");
    await lockEditable(tx, row.playlistPageId);
    const moved = await tx.playlistContextInput.updateMany({ where: { id: row.id, status: { in: ["ACTIVE", "AWAITING_ANSWER"] } }, data: { status: "WITHDRAWN", withdrawnById: input.actorId, withdrawnAt: new Date() } });
    if (moved.count !== 1) return;
    playlistPageId = row.playlistPageId;
    await writeAuditLog({ actorId: input.actorId, action: "PLAYLIST_CONTEXT_WITHDRAWN", entityType: "PlaylistPage", entityId: row.playlistPageId, beforeSnapshot: { inputId: row.id, status: row.status } }, tx);
  });
  if (playlistPageId) await syncPlaylistQualityNotificationSafely(playlistPageId);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Draft proposals
// ---------------------------------------------------------------------------------------------------------------------------------

export async function createDraftProposal(input: {
  playlistPageId: string;
  target: PlaylistDraftTarget;
  text: string;
  sentences: DraftSentence[];
  evidenceFingerprint: string;
  provider: string;
  model: string;
  promptVersion: string;
  requestedById: string;
}): Promise<PlaylistDraftProposal> {
  return prisma.$transaction(async (tx) => {
    await lockEditable(tx, input.playlistPageId);
    const row = await tx.playlistDraftProposal.create({
      data: {
        playlistPageId: input.playlistPageId,
        target: input.target,
        proposedContent: input.text,
        claims: { schema: STORED_DRAFT_SCHEMA, sentences: input.sentences } as unknown as Prisma.InputJsonValue,
        evidenceFingerprint: input.evidenceFingerprint,
        provider: input.provider,
        model: input.model,
        promptVersion: input.promptVersion,
        requestedById: input.requestedById,
      },
    });
    // A newer proposal for the same field supersedes older undecided ones.
    await tx.playlistDraftProposal.updateMany({ where: { playlistPageId: input.playlistPageId, target: input.target, status: "PROPOSED", id: { not: row.id } }, data: { status: "REJECTED", decidedById: input.requestedById, decidedAt: new Date() } });
    await writeAuditLog({ actorId: input.requestedById, action: "PLAYLIST_DRAFT_PROPOSED", entityType: "PlaylistPage", entityId: input.playlistPageId, afterSnapshot: { proposalId: row.id, target: input.target, provider: input.provider, model: input.model } }, tx);
    return row;
  });
}

/** The shape stored in `claims`: the checked sentences, each with the evidence it cites and the verbatim quotations. Earlier proposals stored something weaker. */
const STORED_DRAFT_SCHEMA = 2;

export interface ProposalView {
  proposal: PlaylistDraftProposal;
  /** The checked sentences, or null for a proposal created by an earlier, weaker version of the checks (it cannot be accepted). */
  sentences: DraftSentence[] | null;
  /** The text of every evidence item, for showing each sentence beside what it rests on. */
  evidenceText: Record<string, string>;
  /** The evidence has changed since this was written, so it can no longer be accepted. */
  stale: boolean;
}

function readStoredSentences(claims: unknown): DraftSentence[] | null {
  if (typeof claims !== "object" || claims === null || Array.isArray(claims)) return null;
  const record = claims as { schema?: unknown; sentences?: unknown };
  return record.schema === STORED_DRAFT_SCHEMA && Array.isArray(record.sentences) ? (record.sentences as DraftSentence[]) : null;
}

export async function listDraftProposals(playlistPageId: string): Promise<ProposalView[]> {
  const rows = await prisma.playlistDraftProposal.findMany({ where: { playlistPageId }, orderBy: { createdAt: "desc" }, take: 20 });
  if (rows.length === 0) return [];
  const { evidence } = await loadPlaylistEvidence(playlistPageId);
  const evidenceText = Object.fromEntries(evidence.items.map((i) => [i.id, i.text]));
  return rows.map((proposal) => ({ proposal, sentences: readStoredSentences(proposal.claims), evidenceText, stale: proposal.status === "PROPOSED" && proposal.evidenceFingerprint !== evidence.fingerprint }));
}

/**
 * Accepts a proposal INTO THE PAGE'S DRAFT (not the live page). Refused if the evidence has changed since it was written, or if the page was
 * edited since the editor looked (`expectedVersion`). The page then still needs to pass the quality rubric and be published by a person.
 */
export class VerificationRequiredError extends Error {
  constructor() {
    super("Read each statement against the evidence it cites, then confirm that you have checked them. A draft that passed the automatic checks is not verified until you have.");
    this.name = "VerificationRequiredError";
  }
}

export async function acceptDraftProposal(input: { proposalId: string; expectedVersion: number; actorId: string; /** The person confirms they read every statement against its cited evidence. Required. */ humanVerified: boolean }): Promise<{ version: number }> {
  if (input.humanVerified !== true) throw new VerificationRequiredError();
  let playlistPageId = "";
  const result = await prisma.$transaction(async (tx) => {
    const proposal = await tx.playlistDraftProposal.findUnique({ where: { id: input.proposalId } });
    if (!proposal) throw new PlaylistInvalidError(["That draft no longer exists."]);
    await lockPlaylist(tx, proposal.playlistPageId);
    const fresh = await tx.playlistDraftProposal.findUnique({ where: { id: input.proposalId } });
    if (!fresh || fresh.status !== "PROPOSED") throw new PlaylistInvalidError(["That draft has already been decided."]);
    const page = await tx.playlistPage.findUnique({ where: { id: fresh.playlistPageId } });
    if (!page) throw new PlaylistNotFoundError();
    if (page.archivedAt) throw new PlaylistArchivedError();
    if (page.version !== input.expectedVersion) throw new PlaylistConflictError();
    const { evidence } = await loadPlaylistEvidence(fresh.playlistPageId, tx);
    if (evidence.fingerprint !== fresh.evidenceFingerprint) throw new StaleProposalError();
    // The stored sentences are checked AGAIN, against the evidence as it is now, and the text that is applied is what those checked sentences
    // assemble to — never a separately stored string. A proposal from an earlier, weaker version of the checks cannot be accepted at all.
    const sentences = readStoredSentences(fresh.claims);
    if (!sentences) throw new PlaylistInvalidError(["This draft was created by an earlier version of the checks and cannot be accepted. Ask for a new draft."]);
    let applied: string;
    try {
      const rechecked = validateDraftOutput({ outputType: "DRAFT", sentences, missing: null }, evidence, fresh.target);
      if (rechecked.kind !== "DRAFT") throw new PlaylistAiOutputError("The stored draft is not a draft.");
      applied = rechecked.text;
    } catch (err) {
      if (err instanceof PlaylistAiOutputError) throw new PlaylistInvalidError([`This draft no longer passes the checks, so it cannot be accepted: ${err.message}`]);
      throw err;
    }
    if (applied !== fresh.proposedContent) throw new PlaylistInvalidError(["The stored draft text does not match its checked sentences, so it cannot be accepted."]);
    const limit = fresh.target === "SUMMARY" ? PLAYLIST_LIMITS.summary : PLAYLIST_LIMITS.body;
    if (applied.length > limit) throw new PlaylistInvalidError([`The draft is longer than the ${limit}-character limit.`]);

    await tx.playlistPage.update({
      where: { id: page.id },
      data: { ...(fresh.target === "SUMMARY" ? { summary: applied } : { body: applied }), version: { increment: 1 }, updatedById: input.actorId },
    });
    await tx.playlistDraftProposal.update({ where: { id: fresh.id }, data: { status: "ACCEPTED", decidedById: input.actorId, decidedAt: new Date() } });
    playlistPageId = page.id;
    await writeAuditLog({ actorId: input.actorId, action: "PLAYLIST_DRAFT_ACCEPTED", entityType: "PlaylistPage", entityId: page.id, afterSnapshot: { proposalId: fresh.id, target: fresh.target, version: page.version + 1, humanVerified: true, checks: "mechanical-v2 + human verification", sentences: sentences.length } }, tx);
    return { version: page.version + 1 };
  });
  await syncPlaylistQualityNotificationSafely(playlistPageId);
  return result;
}

export async function rejectDraftProposal(input: { proposalId: string; actorId: string }): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const moved = await tx.playlistDraftProposal.updateMany({ where: { id: input.proposalId, status: "PROPOSED" }, data: { status: "REJECTED", decidedById: input.actorId, decidedAt: new Date() } });
    if (moved.count !== 1) return;
    const row = await tx.playlistDraftProposal.findUniqueOrThrow({ where: { id: input.proposalId } });
    await writeAuditLog({ actorId: input.actorId, action: "PLAYLIST_DRAFT_REJECTED", entityType: "PlaylistPage", entityId: row.playlistPageId, afterSnapshot: { proposalId: row.id } }, tx);
  });
}
