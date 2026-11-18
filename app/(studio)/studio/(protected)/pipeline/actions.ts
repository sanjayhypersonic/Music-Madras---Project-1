"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../modules/auth/authService";
import { can } from "../../../../../modules/auth/policy";
import { approveBundle, rejectBundle, type ApprovalEdits } from "../../../../../modules/pipeline/approve";
import { buildApprovalDeps } from "../../../../../modules/db/repositories/pipelineRepository";
import { readPipelineConfig } from "../../../../../modules/pipeline/config";

// R-34: the owner's decisions on pipeline bundles. Approval CHANGES WHAT VISITORS SEE (it publishes through the existing publish flow), so every
// action requires RECORDING_PUBLISH, checked here on the server whatever the page showed. Bulk approval refuses any bundle with a flag.

async function requirePublisher(back: string) {
  const session = await getCurrentStudioSession();
  if (!session || session.user.status !== "ACTIVE" || !can(session.user.role, "RECORDING_PUBLISH")) redirect(`${back}?error=${encodeURIComponent("You do not have permission to approve pipeline bundles.")}`);
  return session!.user.id;
}

const text = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" && v.trim() ? v : undefined;
};

export async function approveBundleAction(form: FormData) {
  const id = String(form.get("id") ?? "");
  const back = `/studio/pipeline/${encodeURIComponent(id)}`;
  const actorId = await requirePublisher(back);
  const claimDecisions: Record<string, "accept" | "reject"> = {};
  for (const [key, value] of form.entries()) {
    if (key.startsWith("claim:") && (value === "accept" || value === "reject")) claimDecisions[key.slice("claim:".length)] = value;
  }
  const edits: ApprovalEdits = { seoTitle: text(form, "seoTitle"), metaDescription: text(form, "metaDescription"), summary: text(form, "summary"), note: text(form, "note"), claimDecisions };
  const result = await approveBundle({ id, actorId, edits, now: new Date(), approvePublicVideoPage: readPipelineConfig(process.env).approvePublicVideoPage }, buildApprovalDeps());
  revalidatePath("/studio/pipeline");
  if (!result.ok) redirect(`${back}?error=${encodeURIComponent(`Not approved (${result.reason}): ${result.detail.join("; ")}`.slice(0, 900))}`);
  redirect(`${back}?done=${encodeURIComponent(`${result.status === "PUBLISHED" ? "Approved and published." : "Approved; not published yet."} ${result.notes.join("; ")}`.slice(0, 900))}`);
}

export async function rejectBundleAction(form: FormData) {
  const id = String(form.get("id") ?? "");
  const back = `/studio/pipeline/${encodeURIComponent(id)}`;
  const actorId = await requirePublisher(back);
  const result = await rejectBundle({ id, actorId, note: text(form, "note") ?? "", now: new Date() }, buildApprovalDeps());
  revalidatePath("/studio/pipeline");
  if (!result.ok) redirect(`${back}?error=${encodeURIComponent(`Not rejected: ${result.reason}`)}`);
  redirect(`/studio/pipeline?done=${encodeURIComponent("Bundle rejected. Nothing was created.")}`);
}

export async function bulkApproveAction(form: FormData) {
  const actorId = await requirePublisher("/studio/pipeline");
  const ids = form.getAll("ids").filter((v): v is string => typeof v === "string").slice(0, 25);
  const deps = buildApprovalDeps();
  const outcomes: string[] = [];
  for (const id of ids) {
    const result = await approveBundle({ id, actorId, bulk: true, now: new Date(), approvePublicVideoPage: readPipelineConfig(process.env).approvePublicVideoPage }, deps);
    outcomes.push(result.ok ? `${result.status.toLowerCase()}` : `refused (${result.reason})`);
  }
  revalidatePath("/studio/pipeline");
  const summary = Object.entries(outcomes.reduce<Record<string, number>>((acc, o) => ({ ...acc, [o]: (acc[o] ?? 0) + 1 }), {}))
    .map(([k, n]) => `${n} ${k}`)
    .join(", ");
  redirect(`/studio/pipeline?done=${encodeURIComponent(ids.length ? `Bulk approval: ${summary}.` : "Nothing was selected.")}`);
}
