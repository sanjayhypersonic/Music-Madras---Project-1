import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { findSourceById } from "../../../../../../../modules/db/repositories/sourceRepository";
import { canApproveSource, canDisableSource, canRejectSource } from "../../../../../../../modules/publishing/sourceApprovalTransitions";
import { listCitationsForSource } from "../../../../../../../modules/db/repositories/citationRepository";
import {
  addCitationAction,
  approveSourceAction,
  disableSourceAction,
  rejectSourceAction,
  updateCitationAction,
  updateSourceAction,
} from "./actions";

// Phase 6G-13 — the Source editorial management view. Citations are
// managed here, as children of their Source (the existing schema's only
// relationship for Citation — see citationRepository.ts), never as a
// separate top-level catalogue.

export default async function SourceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");

  const { id } = await params;
  const { error } = await searchParams;

  const source = await findSourceById(id);
  if (!source) {
    notFound();
  }

  const canWrite = can(session.user.role, "CATALOGUE_WRITE");
  const citations = await listCitationsForSource(source.id);

  return (
    <div>
      <p>
        <Link href="/studio/catalogue/sources">← Sources</Link>
      </p>
      <h1>{source.title ?? source.url ?? "Untitled Source"}</h1>
      {error && <p style={{ color: "#b00020" }}>{decodeURIComponent(error)}</p>}

      <h2>AI evidence approval</h2>
      <p>
        Current state: <strong>{source.approvalState}</strong>
        {source.approvalState === "APPROVED" && source.approvedAt && (
          <> — approved {source.approvedAt.toLocaleDateString()}</>
        )}
      </p>
      <p>
        Only an <strong>APPROVED</strong> Source&apos;s Citations may automatically enter Content Intelligence&apos;s evidence
        context. This never changes what Studio editors can see here — only what Content Intelligence may use.
      </p>
      {canWrite ? (
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {canApproveSource(source.approvalState) && (
            <form action={approveSourceAction.bind(null, source.id)}>
              <button type="submit">Approve</button>
            </form>
          )}
          {canRejectSource(source.approvalState) && (
            <form action={rejectSourceAction.bind(null, source.id)}>
              <button type="submit">Reject</button>
            </form>
          )}
          {canDisableSource(source.approvalState) && (
            <form action={disableSourceAction.bind(null, source.id)}>
              <button type="submit">Disable</button>
            </form>
          )}
        </div>
      ) : (
        <p>You do not have permission to change this source&apos;s approval state.</p>
      )}

      <h2>Edit</h2>
      {canWrite ? (
        <form
          action={updateSourceAction.bind(null, source.id)}
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}
        >
          <label>
            Title
            <input name="title" defaultValue={source.title ?? ""} style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            URL
            <input name="url" type="url" defaultValue={source.url ?? ""} style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            Publisher
            <input name="publisher" defaultValue={source.publisher ?? ""} style={{ display: "block", width: "100%" }} />
          </label>
          <button type="submit">Save</button>
        </form>
      ) : (
        <p>You do not have permission to edit this source.</p>
      )}

      <h2>Citations ({citations.length})</h2>
      {citations.length === 0 ? (
        <p>No citations have been added for this source yet.</p>
      ) : (
        <ul>
          {citations.map((citation) => (
            <li key={citation.id} style={{ marginBottom: "0.5rem" }}>
              {canWrite ? (
                <form
                  action={updateCitationAction.bind(null, source.id, citation.id)}
                  style={{ display: "flex", gap: "0.5rem", maxWidth: "32rem" }}
                >
                  <textarea name="text" defaultValue={citation.text ?? ""} style={{ flex: 1 }} />
                  <button type="submit">Save</button>
                </form>
              ) : (
                <p>{citation.text}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <form action={addCitationAction.bind(null, source.id)} style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}>
          <label>
            New citation text
            <textarea name="text" required style={{ display: "block", width: "100%" }} />
          </label>
          <button type="submit">Add citation</button>
        </form>
      )}
    </div>
  );
}
