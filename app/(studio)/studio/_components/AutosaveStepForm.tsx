"use client";

import { useEffect, useRef, useState } from "react";

// Shared debounced-autosave editor for the Recording workflow's free-text
// content steps (Source, Educational Content, SEO — brief §4: "debounced
// ... safe ... idempotent ... failure-aware autosave and visible save
// status"). All three steps edit fields directly on the current draft
// RecordingRevision via updateDraftRevisionContent's optimistic-concurrency
// guard, so this component saves the whole set of fields together on one
// timer rather than one save call per keystroke per field — that keeps
// the `expectedRevisionUpdatedAt` check correct without a race between two
// fields' independent save calls (see recordingRepository.ts).

export interface AutosaveFieldConfig {
  name: string;
  label: string;
  type: "text" | "textarea";
}

export type AutosaveSaveResult = { ok: true; updatedAt: string } | { ok: false; error: string };

interface AutosaveStepFormProps {
  recordingId: string;
  initialUpdatedAt: string;
  initialValues: Record<string, string>;
  fields: AutosaveFieldConfig[];
  saveAction: (recordingId: string, expectedUpdatedAt: string, patch: Record<string, string>) => Promise<AutosaveSaveResult>;
}

type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

const DEBOUNCE_MS = 1200;

export function AutosaveStepForm({ recordingId, initialUpdatedAt, initialValues, fields, saveAction }: AutosaveStepFormProps) {
  const [values, setValues] = useState(initialValues);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const updatedAtRef = useRef(initialUpdatedAt);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    setStatus("pending");
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      setStatus("saving");
      try {
        const result = await saveAction(recordingId, updatedAtRef.current, values);
        if (result.ok) {
          updatedAtRef.current = result.updatedAt;
          setStatus("saved");
          setError(null);
        } else {
          setStatus("error");
          setError(result.error);
        }
      } catch {
        setStatus("error");
        setError("Could not save — check your connection and try again.");
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);

  const statusLabel: Record<SaveStatus, string> = {
    idle: "",
    pending: "Unsaved changes…",
    saving: "Saving…",
    saved: "Saved",
    error: `Not saved: ${error ?? "unknown error"}`,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxWidth: "36rem" }}>
      {fields.map((field) => (
        <label key={field.name}>
          {field.label}
          {field.type === "textarea" ? (
            <textarea
              rows={5}
              value={values[field.name] ?? ""}
              onChange={(e) => setValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
              style={{ display: "block", width: "100%" }}
            />
          ) : (
            <input
              value={values[field.name] ?? ""}
              onChange={(e) => setValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
              style={{ display: "block", width: "100%" }}
            />
          )}
        </label>
      ))}
      <p role="status" style={{ color: status === "error" ? "#b00020" : "#555", fontSize: "0.85rem" }}>
        {statusLabel[status]}
      </p>
    </div>
  );
}
