import type { ReactNode } from "react";
import { ConfirmSubmitButton } from "./ConfirmSubmitButton";

// The Recording-level hold controls on Review & Publish (project register R-20). A hold withholds ONE Recording from the public Museum; it is independent of
// publication state and of any hold on the Recording's videos. The forms post to server actions that check the permission again on the server; the
// `canManage` flag only decides whether the controls are shown.

const KINDS: Array<{ value: string; label: string }> = [
  { value: "RIGHTS", label: "Rights" },
  { value: "COPYRIGHT", label: "Copyright" },
  { value: "PRIVACY", label: "Privacy" },
  { value: "OTHER", label: "Other" },
];

export function RecordingHoldPanel({
  hold,
  isLive,
  canManage,
  publishers,
  impose,
  lift,
}: {
  hold: { reason: string; note: string | null; setAt: Date } | null;
  /** The Recording is currently PUBLISHED (so a hold changes what visitors see now). */
  isLive: boolean;
  canManage: boolean;
  /** "Administrators, Super Administrators and Founders" — derived from the policy. */
  publishers: ReactNode;
  impose: (formData: FormData) => Promise<void>;
  lift: () => Promise<void>;
}) {
  return (
    <section className="studio-panel" aria-labelledby="recording-hold">
      <h3 id="recording-hold">Recording hold</h3>
      {hold ? (
        <>
          <p role="status">
            <strong>On hold: {hold.reason.toLowerCase()}.</strong> {hold.note ?? ""} <span className="studio-muted">Recorded {hold.setAt.toISOString().slice(0, 10)}.</span>
          </p>
          <p className="studio-muted">
            While the hold stands this recording is withheld from every public page: its own page, archive search, the sitemap, and the lists, collections, guides, occasions and video pages that would link to it. Its
            publication state and revisions are untouched, and its videos are not affected.
          </p>
          {canManage ? (
            <form action={lift}>
              <ConfirmSubmitButton
                confirmMessage={
                  isLive
                    ? "Lift this hold? This recording is published, so it becomes visible on the public Museum again straight away. Lifting a hold publishes nothing."
                    : "Lift this hold? This recording is not published, so it stays off the public Museum until it is published. Lifting a hold publishes nothing."
                }
                pendingLabel="Lifting…"
                tone="primary"
              >
                Lift the hold
              </ConfirmSubmitButton>
            </form>
          ) : (
            <p className="studio-muted">Only {publishers} can lift a hold.</p>
          )}
        </>
      ) : (
        <>
          <p className="studio-muted">
            No hold is recorded. A hold removes this one recording from the public Museum without unpublishing, archiving or changing it, and without affecting its videos.
          </p>
          {canManage ? (
            <details>
              <summary>Put this recording on hold{isLive ? " (removes it from the public Museum at once)" : ""}</summary>
              <form action={impose} style={{ display: "grid", gap: "0.5rem", maxWidth: "32rem", marginTop: "0.5rem" }}>
                <label>
                  Kind of hold
                  <select name="reason" required defaultValue="">
                    <option value="" disabled>
                      Choose…
                    </option>
                    {KINDS.map((kind) => (
                      <option key={kind.value} value={kind.value}>
                        {kind.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Note (optional; only people who can manage holds can read it)
                  <textarea name="note" rows={2} maxLength={500} />
                </label>
                <ConfirmSubmitButton
                  confirmMessage={
                    isLive
                      ? "Put this recording on hold? It disappears from the public Museum now. Nothing about it is changed, and you can lift the hold later."
                      : "Put this recording on hold? It is not public today; the hold keeps it off the public Museum even after it is published, until you lift it."
                  }
                  pendingLabel="Recording…"
                  tone="danger"
                >
                  Record hold
                </ConfirmSubmitButton>
              </form>
            </details>
          ) : (
            <p className="studio-muted">Only {publishers} can put a recording on hold.</p>
          )}
        </>
      )}
    </section>
  );
}
