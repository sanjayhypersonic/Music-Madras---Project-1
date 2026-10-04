import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { findRecordingById } from "../../../../../../../modules/db/repositories/recordingRepository";
import { listMediaForRevision } from "../../../../../../../modules/db/repositories/mediaResourceRepository";
import { attachMediaAction } from "./actions";
import type { MediaProvider, MediaRole } from "@prisma/client";

const PROVIDERS: MediaProvider[] = ["YOUTUBE", "UPLOAD"];
const ROLES: MediaRole[] = ["PRIMARY_VIDEO", "THUMBNAIL", "POSTER", "PROGRAMME_PDF", "SHEET_MUSIC", "AUDIO_MASTER"];

export default async function MediaStepPage({
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

  if (!recording.currentDraftRevisionId) {
    return (
      <div>
        <h2>Media Assets</h2>
        <p>Open a draft from the Source step before attaching media.</p>
      </div>
    );
  }

  const canWrite = can(session.user.role, "RECORDING_WRITE");
  const media = await listMediaForRevision(recording.currentDraftRevisionId);

  return (
    <div>
      <h2>Media Assets</h2>
      <p>
        A published recording requires a Primary Video (see the completeness check on the Review step). There is
        no file-upload infrastructure in this environment yet — provide a hosted URL (e.g. a YouTube link) rather
        than uploading a file.
      </p>
      {error && <p role="alert" className="studio-alert studio-alert--error">{decodeURIComponent(error)}</p>}

      {media.length === 0 ? (
        <p className="studio-empty">No media attached yet.</p>
      ) : (
        <ul>
          {media.map((m) => (
            <li key={m.id}>
              {m.role} ({m.provider}) — {m.url}
              {m.youtubeVideo && <> — linked to synced YouTube video “{m.youtubeVideo.title ?? m.youtubeVideo.youtubeVideoId}”</>}
            </li>
          ))}
        </ul>
      )}

      {canWrite && (
        <form
          action={attachMediaAction.bind(null, id, recording.currentDraftRevisionId)}
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}
        >
          <label>
            Provider
            <select name="provider" required style={{ display: "block", width: "100%" }}>
              {PROVIDERS.map((provider) => (
                <option key={provider} value={provider}>
                  {provider}
                </option>
              ))}
            </select>
          </label>
          <label>
            Role
            <select name="role" required style={{ display: "block", width: "100%" }}>
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>
          <label>
            URL
            <input name="url" type="url" required style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            Provider resource ID (e.g. YouTube video ID, optional)
            <input name="providerResourceId" style={{ display: "block", width: "100%" }} />
          </label>
          <button type="submit" className="studio-button--primary">Attach media</button>
        </form>
      )}
    </div>
  );
}
