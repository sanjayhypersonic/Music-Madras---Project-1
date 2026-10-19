import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutosaveController, DEFAULT_BUSY_RETRY_DELAYS_MS, DEFAULT_DEBOUNCE_MS, DEFAULT_RETRY_DELAYS_MS } from "../../modules/studio/autosave/autosaveController";
import { shouldWarnBeforeUnload, type AutosaveSaveResult, type AutosaveSnapshot, type AutosaveValues } from "../../modules/studio/autosave/autosaveTypes";

// Phase 6J-10E — the autosave lifecycle, driven with fake timers and hand-resolved promises (no real time, no network).

interface Call {
  token: string;
  values: AutosaveValues;
  resolve: (result: AutosaveSaveResult) => void;
  reject: (error: unknown) => void;
}

function harness(options: { initial?: AutosaveValues; token?: string } = {}) {
  const calls: Call[] = [];
  const snapshots: AutosaveSnapshot[] = [];
  const recoveryWrites: Array<{ baseToken: string; values: AutosaveValues }> = [];
  let recoveryClears = 0;
  const controller = new AutosaveController({
    initialValues: options.initial ?? { title: "A" },
    initialToken: options.token ?? "t0",
    save: (token, values) =>
      new Promise<AutosaveSaveResult>((resolve, reject) => {
        calls.push({ token, values, resolve, reject });
      }),
    onChange: (snapshot) => snapshots.push(snapshot),
    recovery: {
      write: (entry) => recoveryWrites.push(entry),
      clear: () => {
        recoveryClears++;
      },
    },
  });
  return {
    controller,
    calls,
    snapshots,
    recoveryWrites,
    recoveryClears: () => recoveryClears,
    last: () => calls[calls.length - 1],
  };
}

const ok = (updatedAt: string): AutosaveSaveResult => ({ ok: true, updatedAt });
const settleMicrotasks = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("serialized saves", () => {
  it("never sends a second request while one is in flight; the edit made meanwhile is saved next, with the NEW token", async () => {
    const h = harness();
    h.controller.edit({ title: "B" });
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({ token: "t0", values: { title: "B" } });

    h.controller.edit({ title: "C" }); // typed while request 1 is in flight
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS * 3); // its debounce elapses — still only ONE request
    expect(h.calls).toHaveLength(1);
    expect(h.controller.getSnapshot()).toMatchObject({ status: "saving", hasUnsaved: true });

    h.calls[0].resolve(ok("t1"));
    await settleMicrotasks();
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]).toMatchObject({ token: "t1", values: { title: "C" } }); // refreshed token, newest values

    h.calls[1].resolve(ok("t2"));
    await settleMicrotasks();
    expect(h.controller.getSnapshot()).toMatchObject({ status: "saved", hasUnsaved: false, token: "t2", savedValues: { title: "C" } });
  });

  it("a response for an older edit never marks newer edits as saved", async () => {
    const h = harness();
    h.controller.edit({ title: "B" });
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);
    h.controller.edit({ title: "C" });
    h.calls[0].resolve(ok("t1"));
    await settleMicrotasks();
    const snapshot = h.controller.getSnapshot();
    expect(snapshot.savedValues).toEqual({ title: "B" }); // what the server confirmed
    expect(snapshot.values).toEqual({ title: "C" });
    expect(snapshot.hasUnsaved).toBe(true);
    expect(snapshot.status).not.toBe("saved");
    expect(h.snapshots.some((s) => s.status === "saved" && s.values.title === "C")).toBe(false);
  });

  it("rapid edits inside the debounce window produce ONE request carrying the latest values", async () => {
    const h = harness();
    for (const text of ["B", "Bi", "Bir", "Birth", "Birthday"]) {
      h.controller.edit({ title: text });
      await vi.advanceTimersByTimeAsync(300);
    }
    expect(h.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].values).toEqual({ title: "Birthday" });
    h.calls[0].resolve(ok("t1"));
    await settleMicrotasks();
    expect(h.controller.getSnapshot().status).toBe("saved");
  });

  it("editing back to the confirmed text sends nothing and reports saved", async () => {
    const h = harness();
    h.controller.edit({ title: "B" });
    h.controller.edit({ title: "A" });
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS * 2);
    expect(h.calls).toHaveLength(0);
    expect(h.controller.getSnapshot()).toMatchObject({ status: "saved", hasUnsaved: false });
  });
});

describe("transient failures and controlled retry", () => {
  it("a failed save keeps the edit and the OLD token, retries after the backoff, and succeeds without data loss", async () => {
    const h = harness();
    h.controller.edit({ title: "B" });
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);
    h.calls[0].reject(new Error("network down"));
    await settleMicrotasks();
    expect(h.controller.getSnapshot()).toMatchObject({ status: "retrying", attempt: 1, retryScheduled: true, hasUnsaved: true, token: "t0" });

    await vi.advanceTimersByTimeAsync(DEFAULT_RETRY_DELAYS_MS[0]);
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]).toMatchObject({ token: "t0", values: { title: "B" } }); // the same token: the outcome of attempt 1 is unknown
    h.calls[1].resolve(ok("t1"));
    await settleMicrotasks();
    expect(h.controller.getSnapshot()).toMatchObject({ status: "saved", attempt: 0, token: "t1" });
  });

  it("automatic retries are bounded; after the budget the editor must retry, and there is no request loop", async () => {
    const h = harness();
    h.controller.edit({ title: "B" });
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);
    for (let attempt = 0; attempt <= DEFAULT_RETRY_DELAYS_MS.length; attempt++) {
      h.last().reject(new Error("down"));
      await settleMicrotasks();
      if (attempt < DEFAULT_RETRY_DELAYS_MS.length) await vi.advanceTimersByTimeAsync(DEFAULT_RETRY_DELAYS_MS[attempt]);
    }
    expect(h.calls).toHaveLength(1 + DEFAULT_RETRY_DELAYS_MS.length);
    expect(h.controller.getSnapshot()).toMatchObject({ status: "failed", retryScheduled: false, hasUnsaved: true, values: { title: "B" } });

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000); // ten minutes: nothing more is sent
    expect(h.calls).toHaveLength(1 + DEFAULT_RETRY_DELAYS_MS.length);
    expect(vi.getTimerCount()).toBe(0);

    void h.controller.retry(); // manual retry: exactly one new request, budget reset
    expect(h.calls).toHaveLength(2 + DEFAULT_RETRY_DELAYS_MS.length);
    expect(h.controller.getSnapshot().attempt).toBe(0);
    h.last().resolve(ok("t1"));
    await settleMicrotasks();
    expect(h.controller.getSnapshot().status).toBe("saved");
  });

  it("an edit during the backoff is sent with the debounce and the same (unchanged) token, never a refreshed one", async () => {
    const h = harness();
    h.controller.edit({ title: "B" });
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);
    h.calls[0].reject(new Error("down"));
    await settleMicrotasks();
    h.controller.edit({ title: "C" });
    expect(h.controller.getSnapshot().retryScheduled).toBe(false); // the new edit superseded the pending retry timer
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]).toMatchObject({ token: "t0", values: { title: "C" } });
  });

  it("an unknown-outcome failure followed by a stale-token refusal is a conflict, and the text is kept", async () => {
    const h = harness();
    h.controller.edit({ title: "B" });
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);
    h.calls[0].reject(new Error("response lost")); // the server may have saved B and advanced the token
    await settleMicrotasks();
    await vi.advanceTimersByTimeAsync(DEFAULT_RETRY_DELAYS_MS[0]);
    h.calls[1].resolve({ ok: false, kind: "CONFLICT", error: "stale" });
    await settleMicrotasks();
    expect(h.controller.getSnapshot()).toMatchObject({ status: "conflict", blocked: true, values: { title: "B" }, token: "t0" });
  });
});

describe("busy refusals", () => {
  const busy: AutosaveSaveResult = { ok: false, kind: "BUSY", error: "This recording is being changed by someone else right now." };

  it("keeps the pending edit, shows the server's message, retries on its own schedule, then hands over to the editor", async () => {
    const h = harness();
    h.controller.edit({ title: "B" });
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);
    h.calls[0].resolve(busy);
    await settleMicrotasks();
    expect(h.controller.getSnapshot()).toMatchObject({ status: "busy", retryScheduled: true, hasUnsaved: true, message: busy.ok ? null : busy.error, values: { title: "B" } });

    for (let i = 0; i < DEFAULT_BUSY_RETRY_DELAYS_MS.length; i++) {
      await vi.advanceTimersByTimeAsync(DEFAULT_BUSY_RETRY_DELAYS_MS[i]);
      h.last().resolve(busy);
      await settleMicrotasks();
    }
    expect(h.calls).toHaveLength(1 + DEFAULT_BUSY_RETRY_DELAYS_MS.length);
    expect(h.controller.getSnapshot()).toMatchObject({ status: "busy", retryScheduled: false, hasUnsaved: true, values: { title: "B" } });
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(h.calls).toHaveLength(1 + DEFAULT_BUSY_RETRY_DELAYS_MS.length); // no loop

    void h.controller.retry();
    h.last().resolve(ok("t1"));
    await settleMicrotasks();
    expect(h.controller.getSnapshot()).toMatchObject({ status: "saved", token: "t1" });
  });

  it("a busy refusal with newer edits typed meanwhile loses nothing", async () => {
    const h = harness();
    h.controller.edit({ title: "B" });
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);
    h.controller.edit({ title: "C" });
    h.calls[0].resolve(busy);
    await settleMicrotasks();
    expect(h.controller.getSnapshot().values).toEqual({ title: "C" });
    await vi.advanceTimersByTimeAsync(DEFAULT_BUSY_RETRY_DELAYS_MS[0]);
    expect(h.last().values).toEqual({ title: "C" });
    expect(h.last().token).toBe("t0");
  });
});

describe("conflicts and non-editable drafts keep the editor's text and never overwrite", () => {
  const cases: Array<[string, AutosaveSaveResult, string]> = [
    ["a stale token", { ok: false, kind: "CONFLICT", error: "edited by someone else" }, "conflict"],
    ["a draft that was published or replaced while the form was open", { ok: false, kind: "CONFLICT", error: "out of date" }, "conflict"],
    ["an archived Recording / missing draft", { ok: false, kind: "NOT_EDITABLE", error: "archived" }, "not-editable"],
    ["a permission/session refusal", { ok: false, kind: "FORBIDDEN", error: "no permission" }, "forbidden"],
  ];

  for (const [name, result, status] of cases) {
    it(`${name}: saving stops, the text is kept and recoverable, nothing is retried or re-sent with a refreshed token`, async () => {
      const h = harness();
      h.controller.edit({ title: "B" });
      await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);
      h.calls[0].resolve(result);
      await settleMicrotasks();
      expect(h.controller.getSnapshot()).toMatchObject({ status, blocked: true, hasUnsaved: true, values: { title: "B" }, token: "t0" });
      expect(h.recoveryWrites[h.recoveryWrites.length - 1]).toEqual({ baseToken: "t0", values: { title: "B" } });

      h.controller.edit({ title: "B and more" }); // the editor keeps typing; nothing is sent, everything is kept
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      void h.controller.retry();
      await h.controller.flush();
      expect(h.calls).toHaveLength(1);
      expect(h.controller.getSnapshot()).toMatchObject({ status, values: { title: "B and more" }, token: "t0" });
      expect(h.recoveryWrites[h.recoveryWrites.length - 1]).toEqual({ baseToken: "t0", values: { title: "B and more" } });
      expect(h.recoveryClears()).toBe(0); // never cleared: the server did not confirm these edits
      expect(vi.getTimerCount()).toBe(0);
    });
  }

  it("a revision that becomes non-editable while the form is open: edits typed afterwards are kept, not redirected into another revision", async () => {
    const h = harness();
    h.controller.edit({ title: "B" });
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);
    h.calls[0].resolve({ ok: false, kind: "NOT_EDITABLE", error: "This Recording is archived. Restore it before making changes." });
    await settleMicrotasks();
    h.controller.edit({ title: "B2" });
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS * 5);
    expect(h.calls).toHaveLength(1);
    expect(h.controller.getSnapshot()).toMatchObject({ status: "not-editable", values: { title: "B2" }, message: expect.stringMatching(/archived/) });
  });
});

describe("recovery bookkeeping", () => {
  it("writes unsaved text with the token it was based on, and clears it only when the server confirmed exactly that text", async () => {
    const h = harness();
    h.controller.edit({ title: "B" });
    expect(h.recoveryWrites[0]).toEqual({ baseToken: "t0", values: { title: "B" } });
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);
    h.controller.edit({ title: "C" }); // while in flight
    h.calls[0].resolve(ok("t1"));
    await settleMicrotasks();
    expect(h.recoveryClears()).toBe(0); // "B" is confirmed, but "C" is not
    expect(h.recoveryWrites[h.recoveryWrites.length - 1]).toEqual({ baseToken: "t1", values: { title: "C" } });
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS); // "C" was typed recently: its own debounce still has to elapse
    h.calls[1].resolve(ok("t2"));
    await settleMicrotasks();
    expect(h.recoveryClears()).toBe(1);
  });

  it("a failed save leaves the recovery text in place", async () => {
    const h = harness();
    h.controller.edit({ title: "B" });
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);
    h.calls[0].reject(new Error("down"));
    await settleMicrotasks();
    expect(h.recoveryClears()).toBe(0);
    expect(h.recoveryWrites[h.recoveryWrites.length - 1].values).toEqual({ title: "B" });
  });

  it("editing back to the confirmed text clears the recovery entry (nothing unsaved remains)", () => {
    const h = harness();
    h.controller.edit({ title: "B" });
    h.controller.edit({ title: "A" });
    expect(h.recoveryClears()).toBe(1);
  });

  it("restoring recovered text behaves as an ordinary edit: it is persisted and then saved against the current token", async () => {
    const h = harness({ token: "t9" });
    h.controller.restore({ title: "Recovered" });
    expect(h.recoveryWrites[0]).toEqual({ baseToken: "t9", values: { title: "Recovered" } });
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);
    expect(h.calls[0]).toMatchObject({ token: "t9", values: { title: "Recovered" } });
  });
});

describe("flush and dispose (navigation)", () => {
  it("flush sends pending edits immediately, without waiting for the debounce", async () => {
    const h = harness();
    h.controller.edit({ title: "B" });
    const flushed = h.controller.flush();
    expect(h.calls).toHaveLength(1);
    h.calls[0].resolve(ok("t1"));
    await flushed;
    expect(h.controller.getSnapshot().status).toBe("saved");
  });

  it("flush while a request is in flight waits for it, then sends the newer edits with the new token", async () => {
    const h = harness();
    h.controller.edit({ title: "B" });
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);
    h.controller.edit({ title: "C" });
    const flushed = h.controller.flush();
    h.calls[0].resolve(ok("t1"));
    await settleMicrotasks();
    expect(h.calls[1]).toMatchObject({ token: "t1", values: { title: "C" } });
    h.calls[1].resolve(ok("t2"));
    await flushed;
    expect(h.controller.getSnapshot()).toMatchObject({ status: "saved", token: "t2" });
  });

  it("dispose({flush}) makes one last attempt and then stays silent: no timers, no notifications; a failure keeps the text recoverable", async () => {
    const h = harness();
    h.controller.edit({ title: "B" });
    const notificationsBefore = h.snapshots.length;
    const disposed = h.controller.dispose({ flush: true });
    expect(h.calls).toHaveLength(1);
    h.calls[0].reject(new Error("page is going away"));
    await disposed;
    expect(h.snapshots.length).toBe(notificationsBefore); // detached
    expect(vi.getTimerCount()).toBe(0); // no retry scheduled after dispose
    h.controller.edit({ title: "ignored" });
    expect(h.calls).toHaveLength(1);
    expect(h.recoveryWrites[h.recoveryWrites.length - 1].values).toEqual({ title: "B" });
    expect(h.recoveryClears()).toBe(0);
  });

  it("dispose with a successful last flush clears the recovery entry", async () => {
    const h = harness();
    h.controller.edit({ title: "B" });
    const disposed = h.controller.dispose({ flush: true });
    h.calls[0].resolve(ok("t1"));
    await disposed;
    expect(h.recoveryClears()).toBe(1);
  });

  it("dispose with nothing pending sends nothing", async () => {
    const h = harness();
    await h.controller.dispose({ flush: true });
    expect(h.calls).toHaveLength(0);
  });

  it("a blocked form is not flushed on dispose (it would overwrite)", async () => {
    const h = harness();
    h.controller.edit({ title: "B" });
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);
    h.calls[0].resolve({ ok: false, kind: "CONFLICT", error: "stale" });
    await settleMicrotasks();
    await h.controller.dispose({ flush: true });
    expect(h.calls).toHaveLength(1);
  });
});

describe("leave-site warning", () => {
  it("applies only while edits genuinely remain unconfirmed", async () => {
    const h = harness();
    expect(shouldWarnBeforeUnload(h.controller.getSnapshot())).toBe(false);
    h.controller.edit({ title: "B" });
    expect(shouldWarnBeforeUnload(h.controller.getSnapshot())).toBe(true); // dirty
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);
    expect(shouldWarnBeforeUnload(h.controller.getSnapshot())).toBe(true); // in flight, not yet confirmed
    h.calls[0].resolve(ok("t1"));
    await settleMicrotasks();
    expect(shouldWarnBeforeUnload(h.controller.getSnapshot())).toBe(false); // confirmed: the warning is removed

    h.controller.edit({ title: "C" });
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS);
    h.last().resolve({ ok: false, kind: "CONFLICT", error: "stale" });
    await settleMicrotasks();
    expect(shouldWarnBeforeUnload(h.controller.getSnapshot())).toBe(true); // conflict: edits remain unsaved
    h.controller.edit({ title: "B" }); // editing back to the confirmed text
    expect(shouldWarnBeforeUnload(h.controller.getSnapshot())).toBe(false);
  });
});
