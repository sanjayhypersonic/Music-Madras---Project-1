import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { findComposerById } from "../../../../../../../modules/db/repositories/composerRepository";
import { getComposerRelatedContent } from "../../../../../../../modules/db/repositories/entityRelationshipsRepository";
import { listSources, listSourcesForEntity } from "../../../../../../../modules/db/repositories/sourceRepository";
import { listRightsForEntity, listRightsInformation } from "../../../../../../../modules/db/repositories/rightsInformationRepository";
import EntityActivity from "../../../../../../../components/studio/EntityActivity";
import {
  archiveComposerAction,
  attachRightsAction,
  attachSourceAction,
  detachRightsAction,
  detachSourceAction,
  restoreComposerAction,
  updateComposerAction,
} from "./actions";

// Phase 6G-4C — the Composer editorial management view. Distinct from
// the public /composers/[slug] page (brief §11: "do not reproduce the
// entire public Museum page inside Studio") — this shows the same
// canonical relationships for editorial context, but as a plain
// operational list, not the Museum's archive/media presentation.

export default async function ComposerDetailPage({
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

  const composer = await findComposerById(id);
  if (!composer) {
    notFound();
  }

  const canWrite = can(session.user.role, "CATALOGUE_WRITE");
  const related = await getComposerRelatedContent(composer.id);
  const [allSources, attachedSources, allRights, attachedRights] = await Promise.all([
    listSources(),
    listSourcesForEntity("COMPOSER", composer.id),
    listRightsInformation(),
    listRightsForEntity("COMPOSER", composer.id),
  ]);
  const attachableSources = allSources.filter((s) => !attachedSources.some((l) => l.sourceId === s.id));
  const attachableRights = allRights.filter((r) => !attachedRights.some((l) => l.rightsInformationId === r.id));

  return (
    <div>
      <p>
        <Link href="/studio/catalogue/composers">← Composers</Link>
      </p>
      <h1>{composer.name}</h1>
      {error && <p style={{ color: "#b00020" }}>{decodeURIComponent(error)}</p>}

      <p>
        Status: <strong>{composer.archivedAt ? "Archived" : "Active"}</strong>
        <br />
        Slug: <code>{composer.slug}</code>
        {!composer.archivedAt && (
          <>
            {" — "}
            <Link href={`/composers/${composer.slug}`} target="_blank" rel="noopener noreferrer">
              View public page
            </Link>
          </>
        )}
      </p>

      <h2>Edit</h2>
      {canWrite ? (
        <form
          action={updateComposerAction.bind(null, composer.id)}
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}
        >
          <label>
            Name
            <input name="name" required defaultValue={composer.name} style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            Born (free text, e.g. &quot;1685&quot;)
            <input name="bornDate" defaultValue={composer.bornDate ?? ""} style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            Died (free text)
            <input name="diedDate" defaultValue={composer.diedDate ?? ""} style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            Era
            <input name="era" defaultValue={composer.era ?? ""} style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            Biography
            <textarea name="biography" defaultValue={composer.biography ?? ""} style={{ display: "block", width: "100%" }} />
          </label>
          <button type="submit">Save</button>
        </form>
      ) : (
        <p>You do not have permission to edit this composer.</p>
      )}

      {canWrite && (
        <div style={{ marginTop: "1rem" }}>
          {!composer.archivedAt ? (
            <form action={archiveComposerAction.bind(null, composer.id)}>
              <button type="submit">Archive</button>
            </form>
          ) : (
            <form action={restoreComposerAction.bind(null, composer.id)}>
              <button type="submit">Restore</button>
            </form>
          )}
        </div>
      )}

      <h2>Sources ({attachedSources.length})</h2>
      {attachedSources.length === 0 ? (
        <p>No sources have been attached to this composer yet.</p>
      ) : (
        <ul>
          {attachedSources.map((link) => (
            <li key={link.sourceId}>
              {link.source.title ?? link.source.url ?? "Untitled Source"}
              {canWrite && (
                <form action={detachSourceAction.bind(null, composer.id, link.sourceId)} style={{ display: "inline" }}>
                  <button type="submit">Remove</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && attachableSources.length > 0 && (
        <form action={attachSourceAction.bind(null, composer.id)} style={{ display: "flex", gap: "0.5rem", maxWidth: "28rem" }}>
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

      <h2>Rights Information ({attachedRights.length})</h2>
      {attachedRights.length === 0 ? (
        <p>No rights information has been attached to this composer yet.</p>
      ) : (
        <ul>
          {attachedRights.map((link) => (
            <li key={link.rightsInformationId}>
              {link.rightsInformation.holder ?? link.rightsInformation.licenseType ?? "Untitled Rights Information"}
              {canWrite && (
                <form action={detachRightsAction.bind(null, composer.id, link.rightsInformationId)} style={{ display: "inline" }}>
                  <button type="submit">Remove</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && attachableRights.length > 0 && (
        <form action={attachRightsAction.bind(null, composer.id)} style={{ display: "flex", gap: "0.5rem", maxWidth: "28rem" }}>
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

      <h2>Relationships</h2>
      <p>
        <strong>Musical Works ({related.works.length})</strong>
      </p>
      {related.works.length > 0 ? (
        <ul>
          {related.works.map((work) => (
            <li key={work.id}>
              <Link href={`/studio/catalogue/works/${work.id}`}>{work.title}</Link>
            </li>
          ))}
        </ul>
      ) : (
        <p>No musical works linked yet.</p>
      )}

      <p>
        <strong>Performances ({related.performances.length})</strong>
      </p>
      {related.performances.length > 0 ? (
        <ul>
          {related.performances.map((performance) => (
            <li key={performance.id}>
              {performance.performanceDate ? new Date(performance.performanceDate).toLocaleDateString() : "Date unknown"} —{" "}
              {performance.venue.name}
            </li>
          ))}
        </ul>
      ) : (
        <p>No performances linked yet.</p>
      )}

      <p>
        <strong>Recordings ({related.recordings.length})</strong>
      </p>
      {related.recordings.length > 0 ? (
        <ul>
          {related.recordings.map((recording) => (
            <li key={recording.id}>{recording.currentPublishedRevision.title ?? "Untitled recording"}</li>
          ))}
        </ul>
      ) : (
        <p>No published recordings yet.</p>
      )}

      <p>
        <strong>Public Music Madras Videos ({related.videos.length})</strong>
      </p>
      {related.videos.length > 0 ? (
        <ul>
          {related.videos.map((video) => (
            <li key={video.id}>
              <Link href={`/videos/${video.page.slug}`} target="_blank" rel="noopener noreferrer">
                {video.youtubeVideo.title ?? "Untitled video"}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p>No publicly visible videos yet.</p>
      )}

      <p>
        <strong>Collections ({related.collections.length})</strong>
      </p>
      {related.collections.length > 0 ? (
        <ul>
          {related.collections.map((collection) => (
            <li key={collection.id}>{collection.title}</li>
          ))}
        </ul>
      ) : (
        <p>Not part of any published collection yet.</p>
      )}

      <EntityActivity entityType="Composer" entityId={composer.id} role={session.user.role} />
    </div>
  );
}
