import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { findRecordingById, getCanonicalContextForRevision } from "../../../../../../../modules/db/repositories/recordingRepository";
import { listCollections } from "../../../../../../../modules/db/repositories/collectionRepository";
import { addToCollectionAction } from "./actions";

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

  return (
    <div>
      <h2>Relationships</h2>
      <p>The canonical relationships this recording resolves through — derived, not re-entered.</p>
      {error && <p style={{ color: "#b00020" }}>{decodeURIComponent(error)}</p>}

      {!context ? (
        <p>No revision to inspect yet.</p>
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
          <button type="submit">Add to collection</button>
        </form>
      )}
      {collections.length === 0 && <p>No collections exist yet.</p>}
    </div>
  );
}
