import type { AutosaveFailureKind, AutosaveSaveResult, AutosaveSnapshot, AutosaveStatus, AutosaveValues } from "./autosaveTypes";
import { valuesEqual } from "./autosaveTypes";

// Phase 6J-10E — the autosave lifecycle for one Studio step form, independent of React.
//
// Guarantees (each is covered by tests/unit/autosaveController.test.ts):
//  - At most ONE save request is in flight. An edit made meanwhile is kept and saved by the next request, which uses
//    the token returned by the previous one. A response is applied to the values that were SENT, never to what the
//    editor has typed since: "saved" is only ever reported when the current values equal the confirmed values.
//  - The token is only ever the one the server returned (or the initial one). A stale-token / replaced-revision /
//    archived / forbidden refusal STOPS saving; it is never retried with a refreshed token, and the editor's text is
//    kept (and persisted to the recovery store). Resolving it is an explicit editor action, outside this class.
//  - Transient failures and server "busy" refusals are retried automatically a bounded number of times with growing
//    delays; after that the editor retries manually. No timer loop exists beyond those bounds, and an edit or a manual
//    retry resets only what the editor asked for.
//  - Unsaved text is written to the recovery store whenever it differs from the confirmed values, and removed only when
//    the server confirmed exactly those values.
//  - After `dispose`, no timers are scheduled and no notifications are delivered; with `flush` one last save attempt
//    is made (best effort — a failure leaves the text in the recovery store).

export interface AutosaveRecoveryPort {
  /** Persist unsaved text and the token it was based on. */
  write(entry: { baseToken: string; values: AutosaveValues }): void;
  /** The server confirmed the text; drop the entry. */
  clear(): void;
}

export interface AutosaveControllerOptions {
  initialValues: AutosaveValues;
  initialToken: string;
  /** Persists `values` against `token`. Must resolve with the server's result; a rejection is a transient failure. */
  save: (token: string, values: AutosaveValues) => Promise<AutosaveSaveResult>;
  onChange?: (snapshot: AutosaveSnapshot) => void;
  recovery?: AutosaveRecoveryPort;
  debounceMs?: number;
  /** Delays before each automatic retry of a transient failure; its length is the retry budget. */
  retryDelaysMs?: readonly number[];
  /** Same for server-busy refusals. */
  busyRetryDelaysMs?: readonly number[];
  /** Used for the "saved at" bookkeeping only. */
  now?: () => number;
}

export const DEFAULT_DEBOUNCE_MS = 1200;
export const DEFAULT_RETRY_DELAYS_MS = [2000, 5000, 15000] as const;
export const DEFAULT_BUSY_RETRY_DELAYS_MS = [3000, 8000] as const;

const BLOCKING: Record<Exclude<AutosaveFailureKind, "BUSY">, AutosaveStatus> = {
  CONFLICT: "conflict",
  NOT_EDITABLE: "not-editable",
  FORBIDDEN: "forbidden",
};

export class AutosaveController {
  private values: AutosaveValues;
  private savedValues: AutosaveValues;
  private token: string;
  private status: AutosaveStatus = "saved";
  private message: string | null = null;
  private attempt = 0;
  private blocked = false;
  private inFlight = false;
  private queued = false;
  private stopped = false;
  private listenerDetached = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;
  private readonly retryDelays: readonly number[];
  private readonly busyDelays: readonly number[];
  private cycle: Promise<void> = Promise.resolve();

  constructor(private readonly options: AutosaveControllerOptions) {
    this.values = { ...options.initialValues };
    this.savedValues = { ...options.initialValues };
    this.token = options.initialToken;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.retryDelays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    this.busyDelays = options.busyRetryDelaysMs ?? DEFAULT_BUSY_RETRY_DELAYS_MS;
  }

  getSnapshot(): AutosaveSnapshot {
    return {
      status: this.status,
      values: { ...this.values },
      savedValues: { ...this.savedValues },
      token: this.token,
      hasUnsaved: this.hasUnsaved(),
      message: this.message,
      attempt: this.attempt,
      retryScheduled: this.retryTimer !== null,
      blocked: this.blocked,
    };
  }

  /** The editor changed the form. `values` is the complete current set of field values. */
  edit(values: AutosaveValues): void {
    if (this.stopped) return;
    const next = { ...values };
    if (valuesEqual(next, this.values)) return;
    this.values = next;
    this.persistRecovery();

    if (this.blocked) {
      this.notify(); // text is kept and recoverable; nothing is sent until the editor resolves the conflict
      return;
    }
    this.clearRetryTimer(); // a new edit supersedes a pending backoff; the retry budget (`attempt`) is kept
    if (!this.hasUnsaved()) {
      this.clearDebounce();
      if (!this.inFlight) {
        this.status = "saved";
        this.message = null;
      }
      this.notify();
      return;
    }
    this.scheduleDebounce();
    if (!this.inFlight) this.status = "dirty";
    this.notify();
  }

  /** Load text the editor explicitly chose to restore from recovery. Same as an edit, but works when nothing differs yet. */
  restore(values: AutosaveValues): void {
    this.edit(values);
  }

  /** The editor asked to retry now (after "failed", "busy" or a manual choice). Resets the retry budget. */
  retry(): Promise<void> {
    if (this.blocked || this.stopped) return Promise.resolve();
    this.attempt = 0;
    this.clearRetryTimer();
    this.clearDebounce();
    return this.attemptSave();
  }

  /** Save pending edits now (navigation away, tab hidden). Resolves when saved, blocked or a save failed. */
  async flush(): Promise<void> {
    this.clearDebounce();
    this.clearRetryTimer();
    // bounded: each round is one request; stop on any non-success.
    for (let round = 0; round < 4; round++) {
      if (this.blocked) return;
      if (this.inFlight) {
        await this.cycle;
        continue;
      }
      if (!this.hasUnsaved()) return;
      await this.attemptSave();
      if (this.status !== "saved" && this.status !== "dirty" && this.status !== "saving") return;
    }
  }

  /** Stop timers and notifications. With `flush`, make one last best-effort save of pending edits first. */
  dispose(options: { flush?: boolean } = {}): Promise<void> {
    this.listenerDetached = true;
    this.clearDebounce();
    this.clearRetryTimer();
    this.stopped = true;
    if (options.flush && !this.blocked && (this.hasUnsaved() || this.inFlight)) return this.flushAfterStop();
    return Promise.resolve();
  }

  private async flushAfterStop(): Promise<void> {
    if (this.inFlight) await this.cycle;
    if (!this.blocked && this.hasUnsaved()) await this.attemptSave();
  }

  private hasUnsaved(): boolean {
    return !valuesEqual(this.values, this.savedValues);
  }

  private notify(): void {
    if (this.listenerDetached) return;
    this.options.onChange?.(this.getSnapshot());
  }

  private persistRecovery(): void {
    const recovery = this.options.recovery;
    if (!recovery) return;
    if (this.hasUnsaved()) recovery.write({ baseToken: this.token, values: { ...this.values } });
    else recovery.clear();
  }

  private clearDebounce(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private scheduleDebounce(): void {
    if (this.stopped) return;
    this.clearDebounce();
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.attemptSave();
    }, this.debounceMs);
  }

  private scheduleRetry(delay: number): void {
    if (this.stopped) return;
    this.clearRetryTimer();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.attemptSave();
    }, delay);
  }

  private attemptSave(): Promise<void> {
    if (this.blocked) return Promise.resolve();
    if (this.inFlight) {
      this.queued = true; // the in-flight request finishes first; the follow-up carries the newest values and token
      return this.cycle;
    }
    if (!this.hasUnsaved()) {
      this.status = "saved";
      this.message = null;
      this.notify();
      return Promise.resolve();
    }
    this.clearDebounce();
    this.clearRetryTimer();
    this.cycle = this.runSave();
    return this.cycle;
  }

  private async runSave(): Promise<void> {
    this.inFlight = true;
    this.queued = false;
    const sent = { ...this.values };
    const tokenUsed = this.token;
    this.status = "saving";
    this.message = null;
    this.notify();

    let result: AutosaveSaveResult | null;
    try {
      result = await this.options.save(tokenUsed, sent);
    } catch {
      result = null; // network error / thrown server error: the outcome is unknown, so the token is NOT advanced
    }
    this.inFlight = false;

    if (result && result.ok) {
      // The response confirms `sent` — and only `sent`.
      this.token = result.updatedAt;
      this.savedValues = sent;
      this.attempt = 0;
      this.message = null;
      if (!this.hasUnsaved()) {
        this.options.recovery?.clear();
        this.status = "saved";
        this.notify();
        return;
      }
      // The editor typed more while this request was in flight: those edits are NOT saved. Keep them recoverable
      // against the NEW token and continue with it — never with the old one.
      this.persistRecovery();
      this.status = "dirty";
      this.notify();
      if (this.queued || this.debounceTimer === null) {
        this.queued = false;
        await this.attemptSave();
      }
      return;
    }

    if (result && !result.ok && result.kind !== "BUSY") {
      this.blocked = true;
      this.clearDebounce();
      this.clearRetryTimer();
      this.queued = false;
      this.status = BLOCKING[result.kind];
      this.message = result.error;
      this.persistRecovery();
      this.notify();
      return;
    }

    this.attempt += 1;
    const busy = result !== null;
    const delays = busy ? this.busyDelays : this.retryDelays;
    this.message = busy ? (result as { error: string }).error : "Could not save — check your connection.";
    this.persistRecovery();
    if (this.attempt <= delays.length) {
      this.status = busy ? "busy" : "retrying";
      this.scheduleRetry(delays[this.attempt - 1]);
    } else {
      this.status = busy ? "busy" : "failed";
    }
    this.notify();
    if (this.queued && !this.stopped) {
      // an edit arrived during the failed request: its debounce timer (or the queued flag) already covers it
      this.queued = false;
    }
  }
}
