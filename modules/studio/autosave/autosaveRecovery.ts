import type { AutosaveValues } from "./autosaveTypes";
import { valuesEqual } from "./autosaveTypes";

// Phase 6J-10E — local recovery of UNSAVED autosave text across a reload or a failed save.
//
// What is stored: only the editor's own unsaved form text (titles, descriptions, SEO and educational copy — the same
// editorial text the form shows), the concurrency token the edits were based on (a timestamp, not a credential) and a
// save time. Never a session, a password, an API key or any server secret.
//
// Scope: one entry per (user, Recording, form, revision) — the key carries all four, so one user's recovery data is
// never offered to another account, another Recording, another step or another draft revision by key lookup. Entries
// for OTHER revisions of the same user/Recording/form are discoverable only by that exact prefix, so unsaved text from
// a draft that was since published or replaced is not silently lost; it is offered back, never applied automatically.
//
// Lifecycle: written whenever unsaved text exists; removed only after the server confirmed those exact values, or when
// the editor explicitly discards or restores them. There is no time-based expiry: an unresolved entry stays in that
// browser until the editor resolves it (documented limitation in docs/studio-autosave.md).
//
// Pure: storage is injected (`StorageLike`), so this is unit-tested without a browser.

export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface RecoveryScope {
  userId: string;
  recordingId: string;
  /** The step ("source" | "seo" | "educational"). */
  formId: string;
  revisionId: string;
}

export interface RecoveryEntry {
  /** The server token the unsaved edits were made against. */
  baseToken: string;
  values: AutosaveValues;
  savedAt: string;
}

const PREFIX = "mm.autosave.v1";

function prefixFor(scope: Pick<RecoveryScope, "userId" | "recordingId" | "formId">) {
  return `${PREFIX}:${encodeURIComponent(scope.userId)}:${encodeURIComponent(scope.recordingId)}:${encodeURIComponent(scope.formId)}:`;
}

export function recoveryKey(scope: RecoveryScope): string {
  return `${prefixFor(scope)}${encodeURIComponent(scope.revisionId)}`;
}

function parseEntry(raw: string | null, allowedFields: readonly string[]): RecoveryEntry | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { v?: unknown; baseToken?: unknown; values?: unknown; savedAt?: unknown };
    if (parsed.v !== 1 || typeof parsed.baseToken !== "string" || typeof parsed.savedAt !== "string") return null;
    if (!parsed.values || typeof parsed.values !== "object" || Array.isArray(parsed.values)) return null;
    const values: AutosaveValues = {};
    for (const [name, value] of Object.entries(parsed.values as Record<string, unknown>)) {
      if (!allowedFields.includes(name) || typeof value !== "string") return null; // a malformed/foreign entry is ignored, never half-applied
      values[name] = value;
    }
    return { baseToken: parsed.baseToken, values, savedAt: parsed.savedAt };
  } catch {
    return null;
  }
}

export function writeRecovery(storage: StorageLike, scope: RecoveryScope, entry: RecoveryEntry): boolean {
  try {
    storage.setItem(recoveryKey(scope), JSON.stringify({ v: 1, ...entry }));
    return true;
  } catch {
    return false; // storage full / blocked: autosave still works; only reload recovery is unavailable
  }
}

export function clearRecovery(storage: StorageLike, scope: RecoveryScope): void {
  try {
    storage.removeItem(recoveryKey(scope));
  } catch {
    /* nothing to do */
  }
}

export function readRecovery(storage: StorageLike, scope: RecoveryScope, allowedFields: readonly string[]): RecoveryEntry | null {
  try {
    return parseEntry(storage.getItem(recoveryKey(scope)), allowedFields);
  } catch {
    return null;
  }
}

/** How a recoverable entry relates to what the server shows now — drives the wording of the prompt. */
export type RecoveryRelation = "same-version" | "newer-saved-version" | "other-revision";

export interface Recoverable {
  scope: RecoveryScope;
  entry: RecoveryEntry;
  relation: RecoveryRelation;
}

/**
 * Finds unsaved text to offer back for this user/Recording/form: the entry for THIS revision and any entries for other
 * revisions of the same user/Recording/form. An entry whose values already equal what the server holds is stale (the
 * save succeeded, or its response was lost): it is removed and not offered — that is confirmed persistence.
 */
export function findRecoverable(
  storage: StorageLike,
  scope: RecoveryScope,
  allowedFields: readonly string[],
  server: { values: AutosaveValues; token: string }
): Recoverable[] {
  const found: Recoverable[] = [];
  const prefix = prefixFor(scope);
  const ownKey = recoveryKey(scope);
  const keys: string[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && key.startsWith(prefix)) keys.push(key);
    }
  } catch {
    return [];
  }
  for (const key of keys) {
    const revisionId = decodeURIComponent(key.slice(prefix.length));
    const entryScope: RecoveryScope = { ...scope, revisionId };
    const entry = parseEntry(safeGet(storage, key), allowedFields);
    if (!entry) continue; // unreadable entries are left alone (never deleted without the editor's decision)
    if (key === ownKey && valuesEqual(entry.values, server.values)) {
      clearRecovery(storage, entryScope);
      continue;
    }
    if (key !== ownKey && valuesEqual(entry.values, server.values)) continue; // identical text is already in this draft; nothing to recover
    const relation: RecoveryRelation = key !== ownKey ? "other-revision" : entry.baseToken === server.token ? "same-version" : "newer-saved-version";
    found.push({ scope: entryScope, entry, relation });
  }
  return found.sort((a, b) => b.entry.savedAt.localeCompare(a.entry.savedAt));
}

function safeGet(storage: StorageLike, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}
