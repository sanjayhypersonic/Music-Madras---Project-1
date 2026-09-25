import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { findRecordingById, getCanonicalContextForRevision } from "../../../../../../../modules/db/repositories/recordingRepository";
import { listCollections } from "../../../../../../../modules/db/repositories/collectionRepository";
import { listActiveOccasions, listOccasionsForEntity } from "../../../../../../../modules/db/repositories/occasionRepository";
import { listSources, listSourcesForEntity } from "../../../../../../../modules/db/repositories/sourceRepository";
import { listRightsForEntity, listRightsInformation } from "../../../../../../../modules/db/repositories/rightsInformationRepository";
import {
  addToCollectionAction,
  attachOccasionAction,
  attachRightsAction,
  attachSourceAction,
  detachOccasionAction,
  detachRightsAction,
  detachSourceAction,
} from "./actions";

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
  const [activeOccasions, attachedOccasions] = await Promise.all([
    listActiveOccasions(),
    listOccasionsForEntity("RECORDING", recording.id),
  ]);
  const attachableOccasions = activeOccasions.filter(
    (occasion) => !attachedOccasions.some((link) => link.occasionId === occasion.id)
  );
  const [allSources, attachedSources, allRights, attachedRights] = await Promise.all([
    listSources(),
    listSourcesForEntity("RECORDING", recording.id),
    listRightsInformation(),
    listRightsForEntity("RECORDING", recording.id),
  ]);
  const attachableSources = allSources.filter((s) => !attachedSources.some((l) => l.sourceId === s.id));
  const attachableRights = allRights.filter((r) => !attachedRights.some((l) => l.rightsInformationId === r.id));

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

      <h3>Occasions</h3>
      {attachedOccasions.length === 0 ? (
        <p>No occasions have been attached to this recording yet.</p>
      ) : (
        <ul>
          {attachedOccasions.map((link) => (
            <li key={link.occasionId}>
              {link.occasion.name}
              {link.occasion.archivedAt ? " (archived)" : ""}
              {canWrite && (
                <form action={detachOccasionAction.bind(null, id, link.occasionId)} style={{ display: "inline" }}>
                  <button type="submit">Remove</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && attachableOccasions.length > 0 && (
        <form action={attachOccasionAction.bind(null, id)} style={{ display: "flex", gap: "0.5rem", maxWidth: "28rem" }}>
          <select name="occasionId" required style={{ flex: 1 }}>
            {attachableOccasions.map((occasion) => (
              <option key={occasion.id} value={occasion.id}>
                {occasion.name}
              </option>
            ))}
          </select>
          <button type="submit">Attach occasion</button>
        </form>
      )}
      {activeOccasions.length === 0 && <p>No occasions exist yet.</p>}

      <h3>Sources</h3>
      {attachedSources.length === 0 ? (
        <p>No sources have been attached to this recording yet.</p>
      ) : (
        <ul>
          {attachedSources.map((link) => (
            <li key={link.sourceId}>
              {link.source.title ?? link.source.url ?? "Untitled Source"}
              {canWrite && (
                <form action={detachSourceAction.bind(null, id, link.sourceId)} style={{ display: "inline" }}>
                  <button type="submit">Remove</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && attachableSources.length > 0 && (
        <form action={attachSourceAction.bind(null, id)} style={{ display: "flex", gap: "0.5rem", maxWidth: "28rem" }}>
          <select name="sourceId" required style={{ flex: 1 }}>
            {attachableSources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.title ?? source.url ?? "Untitled Source"}
              </option>
            ))}
          </select>
          <button type="submit">Attach source</button>
        </form>
      )}

      <h3>Rights Information</h3>
      {attachedRights.length === 0 ? (
        <p>No rights information has been attached to this recording yet.</p>
      ) : (
        <ul>
          {attachedRights.map((link) => (
            <li key={link.rightsInformationId}>
              {link.rightsInformation.holder ?? link.rightsInformation.licenseType ?? "Untitled Rights Information"}
              {canWrite && (
                <form action={detachRightsAction.bind(null, id, link.rightsInformationId)} style={{ display: "inline" }}>
                  <button type="submit">Remove</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && attachableRights.length > 0 && (
        <form action={attachRightsAction.bind(null, id)} style={{ display: "flex", gap: "0.5rem", maxWidth: "28rem" }}>
          <select name="rightsInformationId" required style={{ flex: 1 }}>
            {attachableRights.map((rights) => (
              <option key={rights.id} value={rights.id}>
                {rights.holder ?? rights.licenseType ?? "Untitled Rights Information"}
              </option>
            ))}
          </select>
          <button type="submit">Attach rights information</button>
        </form>
      )}
    </div>
  );
}
