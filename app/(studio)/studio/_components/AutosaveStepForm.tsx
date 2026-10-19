"use client";

import { useEffect, useRef, useState } from "react";
import { AutosaveController, DEFAULT_RETRY_DELAYS_MS } from "../../../../modules/studio/autosave/autosaveController";
import {
  clearRecovery,
  findRecoverable,
  writeRecovery,
  type Recoverable,
  type RecoveryScope,
  type StorageLike,
} from "../../../../modules/studio/autosave/autosaveRecovery";
import {
  shouldWarnBeforeUnload,
  type AutosaveSaveResult,
  type AutosaveSnapshot,
  type AutosaveValues,
} from "../../../../modules/studio/autosave/autosaveTypes";

export type { AutosaveSaveResult } from "../../../../modules/studio/autosave/autosaveTypes";

// Shared autosave editor for the Recording workflow's free-text content steps (Source, Educational Content, SEO —
// brief §4: "debounced ... safe ... idempotent ... failure-aware autosave and visible save status").
//
// The lifecycle itself (serialized saves, token tracking, retries, conflict handling, recovery bookkeeping) lives in
// modules/studio/autosave/autosaveController.ts, which is framework-free and unit-tested with fake timers. This
// component only renders its snapshot and wires the browser: unmount / tab-hidden flush, the "leave site?" warning
// (only while unsaved edits remain) and the local recovery store (localStorage, scoped to user + Recording + step +
// draft revision; see modules/studio/autosave/autosaveRecovery.ts and docs/studio-autosave.md).

export interface AutosaveFieldConfig {
  name: string;
  label: string;
  type: "text" | "textarea";
}

interface AutosaveStepFormProps {
  recordingId: string;
  /** The draft revision this page was rendered for. Together with the token it identifies WHAT is being edited. */
  revisionId: string;
  /** The signed-in Studio user's id (not a secret); scopes the local recovery data to this account. */
  userId: string;
  /** The step ("source" | "seo" | "educational"); scopes the local recovery data to this form. */
  formId: string;
  initialUpdatedAt: string;
  initialValues: Record<string, string>;
  fields: AutosaveFieldConfig[];
  saveAction: (recordingId: string, expectedUpdatedAt: string, patch: Record<string, string>) => Promise<AutosaveSaveResult>;
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null; // blocked (private mode / policy): autosave still works, reload recovery is unavailable
  }
}

const RELATION_TEXT: Record<Recoverable["relation"], string> = {
  "same-version": "Unsaved text from an earlier visit to this step was found.",
  "newer-saved-version":
    "Unsaved text was found that was typed against an OLDER version of this draft. The draft has been saved since; restoring replaces the saved text in these fields.",
  "other-revision":
    "Unsaved text was found from a PREVIOUS draft of this recording (it has since been published or replaced). Restoring copies it into this draft's fields.",
};

export function AutosaveStepForm({ recordingId, revisionId, userId, formId, initialUpdatedAt, initialValues, fields, saveAction }: AutosaveStepFormProps) {
  const [snapshot, setSnapshot] = useState<AutosaveSnapshot>(() => ({
    status: "saved",
    values: initialValues,
    savedValues: initialValues,
    token: initialUpdatedAt,
    hasUnsaved: false,
    message: null,
    attempt: 0,
    retryScheduled: false,
    blocked: false,
  }));
  const [recoverables, setRecoverables] = useState<Recoverable[]>([]);
  const controllerRef = useRef<AutosaveController | null>(null);
  const storageRef = useRef<StorageLike | null>(null);
  const reloadingRef = useRef(false);
  const saveActionRef = useRef(saveAction);
  useEffect(() => {
    saveActionRef.current = saveAction; // the controller always calls the latest action, without re-creating itself
  });

  useEffect(() => {
    const storage = browserStorage();
    storageRef.current = storage;
    const scope: RecoveryScope = { userId, recordingId, formId, revisionId };
    const controller = new AutosaveController({
      initialValues,
      initialToken: initialUpdatedAt,
      save: (token, values) => saveActionRef.current(recordingId, token, values),
      onChange: setSnapshot,
      recovery: storage
        ? {
            write: (entry) => {
              writeRecovery(storage, scope, { ...entry, savedAt: new Date().toISOString() });
            },
            clear: () => clearRecovery(storage, scope),
          }
        : undefined,
    });
    controllerRef.current = controller;
    setSnapshot(controller.getSnapshot());
    setRecoverables(
      storage
        ? findRecoverable(storage, scope, fields.map((f) => f.name), { values: initialValues, token: initialUpdatedAt })
        : []
    );

    // Best-effort delivery when the editor leaves: the tab is hidden or the page is going away. Browsers do not
    // guarantee that a request started while a page is closing completes; the recovery store is the safety net.
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void controller.flush();
    };
    const onPageHide = () => void controller.flush();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      controllerRef.current = null;
      // In-app navigation unmounts this form: send what is pending (the request outlives the component).
      void controller.dispose({ flush: true });
    };
    // The form is keyed by the draft it was rendered for; a different draft renders a different page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingId, revisionId, userId, formId]);

  // The browser's "leave this site?" prompt exists only while edits genuinely remain unconfirmed.
  const warn = shouldWarnBeforeUnload(snapshot);
  useEffect(() => {
    if (!warn) return;
    const handler = (event: BeforeUnloadEvent) => {
      if (reloadingRef.current) return; // the editor chose "Reload": their text stays in the recovery store and is offered back
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [warn]);

  const pending = recoverables[0] ?? null;
  // Typing while a recovery offer for THIS draft is unanswered would overwrite the stored text; answer it first.
  const lockedByOffer = pending !== null && pending.scope.revisionId === revisionId;

  function setField(name: string, value: string) {
    const controller = controllerRef.current;
    if (controller) controller.edit({ ...controller.getSnapshot().values, [name]: value }); // always from the controller, never a stale render
  }

  function restore(item: Recoverable) {
    const merged: AutosaveValues = { ...snapshot.values, ...item.entry.values };
    controllerRef.current?.restore(merged); // now persisted under THIS draft's key
    if (item.scope.revisionId !== revisionId && storageRef.current) clearRecovery(storageRef.current, item.scope);
    setRecoverables((list) => list.filter((entry) => entry !== item));
  }

  function discard(item: Recoverable) {
    if (storageRef.current) clearRecovery(storageRef.current, item.scope);
    setRecoverables((list) => list.filter((entry) => entry !== item));
  }

  const { status } = snapshot;
  const isAlert = status === "conflict" || status === "not-editable" || status === "forbidden" || status === "failed" || (status === "busy" && !snapshot.retryScheduled);
  const savedOnce = snapshot.token !== initialUpdatedAt;

  let statusText = "";
  if (status === "dirty") statusText = "Unsaved changes…";
  else if (status === "saving") statusText = "Saving…";
  else if (status === "saved") statusText = savedOnce ? "Saved" : "";
  else if (status === "retrying") statusText = `Could not save — retrying (attempt ${snapshot.attempt} of ${DEFAULT_RETRY_DELAYS_MS.length}). Your changes are kept.`;
  else if (status === "failed") statusText = "Not saved: the server could not be reached. Your changes are kept in this browser.";
  else if (status === "busy") statusText = snapshot.retryScheduled ? `${snapshot.message ?? "This recording is busy."} Retrying shortly…` : `Not saved: ${snapshot.message ?? "this recording is busy."}`;
  else if (status === "conflict")
    statusText = "Not saved: this draft changed since you opened this page (someone else saved, or it was replaced). Your edits are NOT saved, but they are kept in this browser and nothing was overwritten.";
  else if (status === "not-editable")
    statusText = `Not saved: ${snapshot.message ?? "this recording can no longer be edited."} Your edits are kept in this browser.`;
  else statusText = `Not saved: ${snapshot.message ?? "you cannot edit this recording."} Your edits are kept in this browser.`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxWidth: "36rem" }}>
      {pending && (
        <div className="studio-alert studio-alert--warning" role="alert">
          <p>
            <strong>Recover unsaved text?</strong> {RELATION_TEXT[pending.relation]}
          </p>
          {fields
            .filter((field) => pending.entry.values[field.name] !== undefined && pending.entry.values[field.name] !== (snapshot.values[field.name] ?? ""))
            .map((field) => (
              <details key={field.name} open>
                <summary>{field.label} — your unsaved text</summary>
                <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{pending.entry.values[field.name]}</pre>
              </details>
            ))}
          <p>
            <button type="button" className="studio-button--primary" onClick={() => restore(pending)}>
              Restore my text
            </button>{" "}
            <button type="button" onClick={() => discard(pending)}>
              Discard it
            </button>
          </p>
        </div>
      )}
      {fields.map((field) => (
        <label key={field.name}>
          {field.label}
          {field.type === "textarea" ? (
            <textarea
              rows={5}
              value={snapshot.values[field.name] ?? ""}
              readOnly={lockedByOffer}
              onChange={(e) => setField(field.name, e.target.value)}
              style={{ display: "block", width: "100%" }}
            />
          ) : (
            <input
              value={snapshot.values[field.name] ?? ""}
              readOnly={lockedByOffer}
              onChange={(e) => setField(field.name, e.target.value)}
              style={{ display: "block", width: "100%" }}
            />
          )}
        </label>
      ))}
      <div role={isAlert ? "alert" : "status"} style={{ color: isAlert ? "var(--mm-error)" : "var(--mm-text-secondary)", fontSize: "0.85rem" }}>
        {statusText}
        {(status === "failed" || (status === "busy" && !snapshot.retryScheduled)) && (
          <>
            {" "}
            <button type="button" onClick={() => void controllerRef.current?.retry()}>
              Retry now
            </button>
          </>
        )}
        {(status === "conflict" || status === "not-editable") && (
          <>
            {" "}
            <button
              type="button"
              onClick={() => {
                reloadingRef.current = true;
                window.location.reload();
              }}
            >
              Reload the latest version
            </button>
            <span className="studio-muted"> You will then be offered your unsaved text back to compare, restore or discard.</span>
          </>
        )}
      </div>
    </div>
  );
}
