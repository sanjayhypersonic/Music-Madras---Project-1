import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { findRecordingById, getCanonicalContextForRevision } from "../../../../../../../modules/db/repositories/recordingRepository";
import { listCollections } from "../../../../../../../modules/db/repositories/collectionRepository";
import { listActiveOccasions } from "../../../../../../../modules/db/repositories/occasionRepository";
import { listSources } from "../../../../../../../modules/db/repositories/sourceRepository";
import { listRightsInformation } from "../../../../../../../modules/db/repositories/rightsInformationRepository";
import {
  RevisionRelationshipDataError,
  loadRecordingRelationshipWorkspace,
  type RecordingRelationshipWorkspace,
  type RelationshipState,
} from "../../../../../../../modules/db/repositories/recordingRelationshipReadersRepository";
import { startNewDraftAction } from "../draftActions";
import {
  addToCollectionAction,
  attachOccasionAction,
  attachRightsAction,
  attachSourceAction,
  detachOccasionAction,
  detachRightsAction,
  detachSourceAction,
} from "./actions";

// Phase 6L — Sources, Rights information and Occasions are part of a REVISION. This page shows the published version and the open draft side by side:
// every link is marked "In the published version", "Added in this draft" (public only once the draft is published) or "Removed in this draft" (still
// public until the draft is published). With no open draft nothing here can be edited: the published links are shown read-only and the editor starts a
// draft explicitly. Collection membership is not versioned and works as before.

const STATE_LABEL: Record<RelationshipState, { text: string; hint: string }> = {
  PUBLISHED: { text: "In the published version", hint: "Visitors see it." },
  DRAFT_ONLY: { text: "Added in this draft", hint: "Not public yet: it becomes public when this draft is published." },
  REMOVED_IN_DRAFT: { text: "Removed in this draft", hint: "Still public until this draft is published." },
};

const READ_ONLY_TEXT: Record<NonNullable<RecordingRelationshipWorkspace["readOnlyReason"]>, string> = {
  NO_DRAFT: "This recording has no open draft, so its published sources, rights information and occasions are shown read-only. Start a new draft to change them.",
  ARCHIVED: "This recording is archived. Restore it from the Review & Publish step before making changes.",
  NO_REVISION: "This recording has no revision yet.",
};

function Badge({ state }: { state: RelationshipState }) {
  const label = STATE_LABEL[state];
  return (
    <span className="studio-muted" title={label.hint}>
      {" "}
      — {label.text}
    </span>
  );
}

export default async function RelationshipsStepPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");

  const recording = await findRecordingById(id);
  if (!recording) redirect("/studio/recordings");

  const openRevisionId = recording.currentDraftRevisionId ?? recording.currentPublishedRevisionId;
  const context = openRevisionId ? await getCanonicalContextForRevision(openRevisionId) : null;
  const canWrite = can(session.user.role, "CATALOGUE_WRITE");
  const collections = await listCollections();

  // Inconsistent revision data is shown as itself, and nothing editable is offered: never an incomplete set presented as the truth.
  let workspace: RecordingRelationshipWorkspace | null = null;
  let dataProblem: string | null = null;
  try {
    workspace = await loadRecordingRelationshipWorkspace(id);
  } catch (err) {
    if (!(err instanceof RevisionRelationshipDataError)) throw err;
    dataProblem = err.message;
  }

  const draftRevisionId = workspace?.draftRevisionId ?? null;
  const editable = canWrite && workspace?.editable === true && draftRevisionId !== null;
  const canStartDraft = workspace?.readOnlyReason === "NO_DRAFT" && can(session.user.role, "RECORDING_WRITE") && recording.currentPublishedRevisionId !== null;

  const [activeOccasions, allSources, allRights] = editable ? await Promise.all([listActiveOccasions(), listSources(), listRightsInformation()]) : [[], [], []];
  const inDraft = <T extends { id: string; state: RelationshipState }>(items: T[]) => new Set(items.filter((i) => i.state !== "REMOVED_IN_DRAFT").map((i) => i.id));
  const attachableOccasions = workspace ? activeOccasions.filter((o) => !inDraft(workspace.occasions).has(o.id)) : [];
  const attachableSources = workspace ? allSources.filter((s) => !inDraft(workspace.sources).has(s.id)) : [];
  const attachableRights = workspace ? allRights.filter((r) => !inDraft(workspace.rights).has(r.id)) : [];

  return (
    <div>
      <h2>Relationships</h2>
      <p>The canonical relationships this recording resolves through — derived, not re-entered.</p>
      {error && <p role="alert" className="studio-alert studio-alert--error">{decodeURIComponent(error)}</p>}

      {!context ? (
        <p className="studio-empty">No revision to inspect yet.</p>
      ) : (
        <ul>
          <li>Composers: {context.composers.map((c) => c.name).join(", ") || "none yet"}</li>
          <li>Works: {context.directWorks.map((w) => w.title).join(", ") || "none yet"}</li>
          <li>Programme: {context.programme?.title ?? "none yet"}</li>
          <li>Venue: {context.venue?.name ?? "none yet"}</li>
          <li>
            Performers:{" "}
            {[...context.performers.map((p) => p.name), ...context.choirs.map((c) => c.name), ...context.conductors.map((c) => c.name)].join(
              ", "
            ) || "none yet"}
          </li>
        </ul>
      )}

      <h3>Collections</h3>
      {canWrite && collections.length > 0 && (
        <form action={addToCollectionAction.bind(null, id)} style={{ display: "flex", gap: "0.5rem", maxWidth: "28rem" }}>
          <select name="collectionId" required style={{ flex: 1 }}>
            {collections.map((collection) => (
              <option key={collection.id} value={collection.id}>
                {collection.title}
              </option>
            ))}
          </select>
          <button type="submit" className="studio-button--primary">Add to collection</button>
        </form>
      )}
      {collections.length === 0 && <p className="studio-empty">No collections exist yet.</p>}

      {dataProblem && (
        <p role="alert" className="studio-alert studio-alert--error">
          {dataProblem} Sources, rights information and occasions cannot be shown or changed until this is looked at.
        </p>
      )}

      {workspace && (
        <>
          {editable ? (
            <div className="studio-panel">
              <p>
                <strong>You are editing a draft.</strong> Changes to sources, rights information and occasions do not appear to visitors until this draft is published.
                {workspace.draftOnly + workspace.removedInDraft === 0
                  ? " This draft has no relationship changes yet."
                  : ` ${workspace.draftOnly} added and ${workspace.removedInDraft} removed in this draft.`}
              </p>
            </div>
          ) : (
            <div className="studio-panel">
              <p>{workspace.readOnlyReason ? READ_ONLY_TEXT[workspace.readOnlyReason] : "You do not have permission to change these."}</p>
              {canStartDraft && (
                <form action={startNewDraftAction.bind(null, id, "relationships")}>
                  <button type="submit" className="studio-button--primary">Start a new draft to make changes</button>
                </form>
              )}
            </div>
          )}

          <h3>Occasions</h3>
          {workspace.occasions.length === 0 ? (
            <p className="studio-empty">No occasions are attached to this recording.</p>
          ) : (
            <ul>
              {workspace.occasions.map((item) => (
                <li key={item.id}>
                  {item.record.name}
                  {item.record.archivedAt ? " (archived)" : ""}
                  <Badge state={item.state} />
                  {editable && item.state !== "REMOVED_IN_DRAFT" && (
                    <form action={detachOccasionAction.bind(null, id, draftRevisionId!, item.id)} style={{ display: "inline" }}>
                      <button type="submit" className="studio-button--danger">Remove</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
          {editable && attachableOccasions.length > 0 && (
            <form action={attachOccasionAction.bind(null, id, draftRevisionId!)} style={{ display: "flex", gap: "0.5rem", maxWidth: "28rem" }}>
              <select name="occasionId" required style={{ flex: 1 }}>
                {attachableOccasions.map((occasion) => (
                  <option key={occasion.id} value={occasion.id}>
                    {occasion.name}
                  </option>
                ))}
              </select>
              <button type="submit" className="studio-button--primary">Attach occasion</button>
            </form>
          )}
          {editable && activeOccasions.length === 0 && <p className="studio-empty">No occasions exist yet.</p>}

          <h3>Sources</h3>
          {workspace.sources.length === 0 ? (
            <p className="studio-empty">No sources are attached to this recording.</p>
          ) : (
            <ul>
              {workspace.sources.map((item) => (
                <li key={item.id}>
                  {item.record.title ?? item.record.url ?? "Untitled Source"}
                  <Badge state={item.state} />
                  {editable && item.state !== "REMOVED_IN_DRAFT" && (
                    <form action={detachSourceAction.bind(null, id, draftRevisionId!, item.id)} style={{ display: "inline" }}>
                      <button type="submit" className="studio-button--danger">Remove</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
          {editable && attachableSources.length > 0 && (
            <form action={attachSourceAction.bind(null, id, draftRevisionId!)} style={{ display: "flex", gap: "0.5rem", maxWidth: "28rem" }}>
              <select name="sourceId" required style={{ flex: 1 }}>
                {attachableSources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.title ?? source.url ?? "Untitled Source"}
                  </option>
                ))}
              </select>
              <button type="submit" className="studio-button--primary">Attach source</button>
            </form>
          )}

          <h3>Rights Information</h3>
          {workspace.rights.length === 0 ? (
            <p className="studio-empty">No rights information is attached to this recording.</p>
          ) : (
            <ul>
              {workspace.rights.map((item) => (
                <li key={item.id}>
                  {item.record.holder ?? item.record.licenseType ?? "Untitled Rights Information"}
                  <Badge state={item.state} />
                  {editable && item.state !== "REMOVED_IN_DRAFT" && (
                    <form action={detachRightsAction.bind(null, id, draftRevisionId!, item.id)} style={{ display: "inline" }}>
                      <button type="submit" className="studio-button--danger">Remove</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
          {editable && attachableRights.length > 0 && (
            <form action={attachRightsAction.bind(null, id, draftRevisionId!)} style={{ display: "flex", gap: "0.5rem", maxWidth: "28rem" }}>
              <select name="rightsInformationId" required style={{ flex: 1 }}>
                {attachableRights.map((rights) => (
                  <option key={rights.id} value={rights.id}>
                    {rights.holder ?? rights.licenseType ?? "Untitled Rights Information"}
                  </option>
                ))}
              </select>
              <button type="submit" className="studio-button--primary">Attach rights information</button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
