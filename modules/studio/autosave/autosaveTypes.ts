// Phase 6J-10E — the contract between the Studio autosave client and the Server Actions that persist a step.
// Pure types (no Prisma, no React) so both sides can share them.

/** Why the server refused a save. Everything except CONFLICT / NOT_EDITABLE / FORBIDDEN / BUSY is a thrown (transient) failure. */
export type AutosaveFailureKind =
  /** The token/revision the editor loaded is stale (someone else saved, or the draft was replaced). Retrying with a refreshed token would overwrite. */
  | "CONFLICT"
  /** The Recording is archived, has no open draft, or no longer exists: nothing to save into. */
  | "NOT_EDITABLE"
  /** The editor may not edit (permission or session). */
  | "FORBIDDEN"
  /** The Recording's edit lock was not available within its bounded wait. Safe to retry later. */
  | "BUSY";

export type AutosaveSaveResult =
  | { ok: true; /** The draft's new concurrency token (its `updatedAt`, ISO). The ONLY token the next save may use. */ updatedAt: string }
  | { ok: false; kind: AutosaveFailureKind; error: string };

export type AutosaveValues = Record<string, string>;

export type AutosaveStatus =
  /** Everything the editor typed is persisted. */
  | "saved"
  /** Edits exist that are not saved yet (waiting for the debounce). */
  | "dirty"
  /** A save request is in flight. */
  | "saving"
  /** A transient failure; an automatic retry is scheduled. */
  | "retrying"
  /** Automatic retries are exhausted; the editor must retry. Edits are kept. */
  | "failed"
  /** The server is busy. Either an automatic retry is scheduled (`retryScheduled`) or the editor must retry. */
  | "busy"
  /** Stale token or replaced revision. Saving is stopped; edits are kept and never overwrite automatically. */
  | "conflict"
  /** Archived / no draft / not found. Saving is stopped; edits are kept. */
  | "not-editable"
  /** Not permitted. Saving is stopped; edits are kept. */
  | "forbidden";

export interface AutosaveSnapshot {
  status: AutosaveStatus;
  /** What the editor currently sees. */
  values: AutosaveValues;
  /** The last values the server confirmed (the initial values until the first successful save). */
  savedValues: AutosaveValues;
  /** The token the next save will use: the server's last returned token. */
  token: string;
  /** True while `values` differ from `savedValues`: edits exist that the server has NOT confirmed. */
  hasUnsaved: boolean;
  message: string | null;
  /** Consecutive failed attempts since the last success or manual retry. */
  attempt: number;
  /** True when an automatic retry is waiting on a timer. */
  retryScheduled: boolean;
  /** True when saving is stopped until the editor resolves the situation (conflict / not-editable / forbidden). */
  blocked: boolean;
}

/** A browser may show its "leave site?" prompt only while edits genuinely remain unconfirmed. */
export function shouldWarnBeforeUnload(snapshot: Pick<AutosaveSnapshot, "hasUnsaved">): boolean {
  return snapshot.hasUnsaved;
}

export function valuesEqual(a: AutosaveValues, b: AutosaveValues): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if ((a[key] ?? "") !== (b[key] ?? "")) return false;
  return true;
}
