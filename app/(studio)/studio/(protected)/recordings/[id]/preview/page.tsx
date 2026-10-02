import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { findRecordingById, getCanonicalContextForRevision } from "../../../../../../../modules/db/repositories/recordingRepository";

// A Studio preview of a recording's current draft — deliberately styled
// nothing like the editing screens around it (brief §7: "visually distinct
// from public... no Museum rebuild"). The public Museum itself is a later
// phase (ADR §3, §9), so this cannot render the actual public template;
// it renders the same canonical data the Museum will eventually read
// (getCanonicalContextForRevision — the same function the public
// findPublishedRecordingBySlug path will use), in a plain reading layout,
// clearly labeled as a Studio preview rather than the real site.
export default async function PreviewStepPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");

  const recording = await findRecordingById(id);
  if (!recording) redirect("/studio/recordings");

  const openRevisionId = recording.currentDraftRevisionId ?? recording.currentPublishedRevisionId;
  const context = openRevisionId ? await getCanonicalContextForRevision(openRevisionId) : null;

  if (!context) {
    return <p>Nothing to preview yet.</p>;
  }

  const primaryVideo = context.mediaResources.find((m) => m.role === "PRIMARY_VIDEO");

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #ccc",
        borderRadius: "0.5rem",
        padding: "2rem",
        maxWidth: "40rem",
        fontFamily: "Georgia, serif",
      }}
    >
      <p style={{ fontFamily: "system-ui, sans-serif", fontSize: "0.8rem", color: "#888" }}>
        Studio preview — a working view of this revision, not the live public page. The published page can look different.
      </p>
      <h1>{context.revision.title ?? "Untitled recording"}</h1>
      {context.composers.length > 0 && <p>{context.composers.map((c) => c.name).join(", ")}</p>}
      {context.revision.description && <p>{context.revision.description}</p>}
      {primaryVideo?.url && <p>Video: {primaryVideo.url}</p>}
      {context.programme && <p>Programme: {context.programme.title}</p>}
      {context.venue && (
        <p>
          Venue: {context.venue.name}
          {context.venue.city ? `, ${context.venue.city}` : ""}
        </p>
      )}
      {(context.performers.length > 0 || context.choirs.length > 0 || context.conductors.length > 0) && (
        <p>
          Performers:{" "}
          {[...context.performers.map((p) => p.name), ...context.choirs.map((c) => c.name), ...context.conductors.map((c) => c.name)].join(
            ", "
          )}
        </p>
      )}
      {context.revision.educationalListeningGuide && (
        <>
          <h2>Listening guide</h2>
          <p>{context.revision.educationalListeningGuide}</p>
        </>
      )}
    </div>
  );
}
