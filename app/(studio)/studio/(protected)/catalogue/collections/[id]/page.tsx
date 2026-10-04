import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { findCollectionById } from "../../../../../../../modules/db/repositories/collectionRepository";
import { listRecordingsForStudio } from "../../../../../../../modules/db/repositories/recordingRepository";
import { listActiveComposers } from "../../../../../../../modules/db/repositories/composerRepository";
import { listMusicalWorksByComposer } from "../../../../../../../modules/db/repositories/musicalWorkRepository";
import { listActiveOccasions, listOccasionsForEntity } from "../../../../../../../modules/db/repositories/occasionRepository";
import { ConfirmSubmitButton } from "../../../../../../../components/studio/ConfirmSubmitButton";
import { StatusBadge } from "../../../../../../../components/studio/StatusBadge";
import {
  addRecordingAction,
  addWorkAction,
  archiveCollectionAction,
  attachOccasionAction,
  detachOccasionAction,
  moveRecordingAction,
  moveWorkAction,
  publishCollectionAction,
  removeRecordingAction,
  removeWorkAction,
  restoreCollectionAction,
  unpublishCollectionAction,
  updateCollectionAction,
} from "./actions";

// Phase 6G-4I — the Collection editorial management view, following the
// established Programme/Performance detail-page pattern. Replaces the
// Phase-4-era stub (brief §5/§6): Collections were previously creatable
// but not openable, editable, publishable, or manageable in any way
// through the Studio UI, despite the repository already supporting all
// of it.

function recordingTitle(recording: {
  slug: string;
  currentPublishedRevision: { title: string | null } | null;
  currentDraftRevision: { title: string | null } | null;
}): string {
  return recording.currentPublishedRevision?.title ?? recording.currentDraftRevision?.title ?? recording.slug;
}

export default async function CollectionDetailPage({
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

  const collection = await findCollectionById(id);
  if (!collection) {
    notFound();
  }

  const canWrite = can(session.user.role, "CATALOGUE_WRITE");
  const canPublish = can(session.user.role, "RECORDING_PUBLISH");
  const allRecordings = await listRecordingsForStudio();
  // Only non-archived Recordings are normally offered for adding — an
  // already-linked Recording keeps displaying regardless of its current
  // status, since the list above is driven by findCollectionById's own
  // recordingLinks, not by this picker.
  const pickableRecordings = allRecordings.filter((recording) => recording.status !== "ARCHIVED");

  const composers = await listActiveComposers();
  const worksByComposer = await Promise.all(
    composers.map(async (composer) => ({ composer, works: await listMusicalWorksByComposer(composer.id) }))
  );
  const [activeOccasions, attachedOccasions] = await Promise.all([
    listActiveOccasions(),
    listOccasionsForEntity("COLLECTION", collection.id),
  ]);
  const attachableOccasions = activeOccasions.filter(
    (occasion) => !attachedOccasions.some((link) => link.occasionId === occasion.id)
  );

  return (
    <div>
      <p>
        <Link href="/studio/catalogue/collections">← Collections</Link>
      </p>
      <h1>{collection.title}</h1>
      {error && <p role="alert" className="studio-alert studio-alert--error">{decodeURIComponent(error)}</p>}

      <p>
        Publication: <strong>{collection.status}</strong>
        <br />
        Status: <strong><StatusBadge status={collection.archivedAt ? "Archived" : "Active"} /></strong>
        <br />
        Slug: <code>{collection.slug}</code>
      </p>

      <h2>Edit</h2>
      {canWrite ? (
        <form
          action={updateCollectionAction.bind(null, collection.id)}
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}
        >
          <label>
            Title
            <input name="title" required defaultValue={collection.title} style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            Description
            <textarea name="description" defaultValue={collection.description ?? ""} style={{ display: "block", width: "100%" }} />
          </label>
          <button type="submit" className="studio-button--primary">Save</button>
        </form>
      ) : (
        <p>You do not have permission to edit this collection.</p>
      )}

      {canWrite && (
        <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
          {/* Publishing changes what visitors see, so it needs RECORDING_PUBLISH (the action re-checks). */}
          {canPublish &&
            (collection.status === "DRAFT" ? (
              <form action={publishCollectionAction.bind(null, collection.id)}>
                <ConfirmSubmitButton confirmMessage="Publish this collection? It will appear on the public Museum." pendingLabel="Publishing…" tone="primary">
                  Publish
                </ConfirmSubmitButton>
              </form>
            ) : (
              <form action={unpublishCollectionAction.bind(null, collection.id)}>
                <ConfirmSubmitButton confirmMessage="Unpublish this collection? It will disappear from the public Museum." pendingLabel="Unpublishing…" tone="danger">
                  Unpublish
                </ConfirmSubmitButton>
              </form>
            ))}
          {!collection.archivedAt ? (
            <form action={archiveCollectionAction.bind(null, collection.id)}>
              <ConfirmSubmitButton confirmMessage="Archive this collection? It will be removed from the public Museum." pendingLabel="Archiving…" tone="danger">
                Archive
              </ConfirmSubmitButton>
            </form>
          ) : (
            <form action={restoreCollectionAction.bind(null, collection.id)}>
              <ConfirmSubmitButton pendingLabel="Restoring…">Restore</ConfirmSubmitButton>
            </form>
          )}
        </div>
      )}

      <h2>Occasions ({attachedOccasions.length})</h2>
      {attachedOccasions.length === 0 ? (
        <p className="studio-empty">No occasions have been attached to this collection yet.</p>
      ) : (
        <ul>
          {attachedOccasions.map((link) => (
            <li key={link.occasionId}>
              {link.occasion.name}
              {link.occasion.archivedAt ? " (archived)" : ""}
              {canWrite && (
                <form action={detachOccasionAction.bind(null, collection.id, link.occasionId)} style={{ display: "inline" }}>
                  <button type="submit" className="studio-button--danger">Remove</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && attachableOccasions.length > 0 && (
        <form action={attachOccasionAction.bind(null, collection.id)} style={{ display: "flex", gap: "0.5rem", maxWidth: "28rem" }}>
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

      <h2>Recordings ({collection.recordingLinks.length})</h2>
      {collection.recordingLinks.length === 0 ? (
        <p className="studio-empty">No recordings have been added to this collection yet.</p>
      ) : (
        <ol>
          {collection.recordingLinks.map((link, index) => (
            <li key={link.recordingId}>
              {recordingTitle(link.recording)}
              {canWrite && (
                <>
                  {index > 0 && (
                    <form action={moveRecordingAction.bind(null, collection.id, link.recordingId, index - 1)} style={{ display: "inline" }}>
                      <button type="submit" aria-label={`Move ${recordingTitle(link.recording)} up`}>
                        ▲
                      </button>
                    </form>
                  )}
                  {index < collection.recordingLinks.length - 1 && (
                    <form action={moveRecordingAction.bind(null, collection.id, link.recordingId, index + 1)} style={{ display: "inline" }}>
                      <button type="submit" aria-label={`Move ${recordingTitle(link.recording)} down`}>
                        ▼
                      </button>
                    </form>
                  )}
                  <form action={removeRecordingAction.bind(null, collection.id, link.recordingId)} style={{ display: "inline" }}>
                    <button type="submit" className="studio-button--danger">Remove</button>
                  </form>
                </>
              )}
            </li>
          ))}
        </ol>
      )}
      {canWrite && (
        <form
          action={addRecordingAction.bind(null, collection.id)}
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}
        >
          <label>
            Recording
            <select name="recordingId" required style={{ display: "block", width: "100%" }}>
              {pickableRecordings.map((recording) => (
                <option key={recording.id} value={recording.id}>
                  {recordingTitle(recording)}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="studio-button--primary">Add recording</button>
        </form>
      )}

      <h2>Musical Works ({collection.workLinks.length})</h2>
      {collection.workLinks.length === 0 ? (
        <p className="studio-empty">No musical works have been added to this collection yet.</p>
      ) : (
        <ol>
          {collection.workLinks.map((link, index) => (
            <li key={link.musicalWorkId}>
              {link.musicalWork.title}
              {canWrite && (
                <>
                  {index > 0 && (
                    <form action={moveWorkAction.bind(null, collection.id, link.musicalWorkId, index - 1)} style={{ display: "inline" }}>
                      <button type="submit" aria-label={`Move ${link.musicalWork.title} up`}>
                        ▲
                      </button>
                    </form>
                  )}
                  {index < collection.workLinks.length - 1 && (
                    <form action={moveWorkAction.bind(null, collection.id, link.musicalWorkId, index + 1)} style={{ display: "inline" }}>
                      <button type="submit" aria-label={`Move ${link.musicalWork.title} down`}>
                        ▼
                      </button>
                    </form>
                  )}
                  <form action={removeWorkAction.bind(null, collection.id, link.musicalWorkId)} style={{ display: "inline" }}>
                    <button type="submit" className="studio-button--danger">Remove</button>
                  </form>
                </>
              )}
            </li>
          ))}
        </ol>
      )}
      {canWrite && (
        <form
          action={addWorkAction.bind(null, collection.id)}
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}
        >
          <label>
            Musical Work
            <select name="musicalWorkId" required style={{ display: "block", width: "100%" }}>
              {worksByComposer.map(({ composer, works }) =>
                works.length > 0 ? (
                  <optgroup key={composer.id} label={composer.name}>
                    {works.map((work) => (
                      <option key={work.id} value={work.id}>
                        {work.title}
                      </option>
                    ))}
                  </optgroup>
                ) : null
              )}
            </select>
          </label>
          <button type="submit" className="studio-button--primary">Add work</button>
        </form>
      )}
    </div>
  );
}
