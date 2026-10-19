import { describe, expect, it } from "vitest";
import {
  clearRecovery,
  findRecoverable,
  readRecovery,
  recoveryKey,
  writeRecovery,
  type RecoveryScope,
  type StorageLike,
} from "../../modules/studio/autosave/autosaveRecovery";

// Phase 6J-10E — recovery data is scoped to user + Recording + form + revision, never leaks across them, and is removed
// only after confirmed persistence or an explicit decision.

class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  keys() {
    return [...this.map.keys()];
  }
}

const FIELDS = ["title", "description"];
const scope: RecoveryScope = { userId: "user-1", recordingId: "rec-1", formId: "source", revisionId: "rev-1" };
const entry = (values: Record<string, string>, baseToken = "t0", savedAt = "2026-10-19T10:00:00.000Z") => ({ baseToken, values, savedAt });
const server = (values: Record<string, string>, token = "t0") => ({ values, token });

describe("recovery key scoping", () => {
  it("differs for every part of the scope", () => {
    const keys = new Set([
      recoveryKey(scope),
      recoveryKey({ ...scope, userId: "user-2" }),
      recoveryKey({ ...scope, recordingId: "rec-2" }),
      recoveryKey({ ...scope, formId: "seo" }),
      recoveryKey({ ...scope, revisionId: "rev-2" }),
    ]);
    expect(keys.size).toBe(5);
  });

  it("separator characters in ids cannot make two scopes collide or match another's prefix", () => {
    expect(recoveryKey({ ...scope, userId: "a:b", recordingId: "c" })).not.toBe(recoveryKey({ ...scope, userId: "a", recordingId: "b:c" }));
    const storage = new MemoryStorage();
    writeRecovery(storage, { ...scope, userId: "user-1:x" }, entry({ title: "other user" }));
    expect(findRecoverable(storage, scope, FIELDS, server({ title: "" }))).toEqual([]);
  });
});

describe("isolation", () => {
  it("another user, Recording or form never sees the entry", () => {
    const storage = new MemoryStorage();
    writeRecovery(storage, scope, entry({ title: "mine" }));
    for (const other of [{ ...scope, userId: "user-2" }, { ...scope, recordingId: "rec-2" }, { ...scope, formId: "seo" }]) {
      expect(findRecoverable(storage, other, FIELDS, server({ title: "" }))).toEqual([]);
      expect(readRecovery(storage, other, FIELDS)).toBeNull();
    }
    expect(findRecoverable(storage, scope, FIELDS, server({ title: "" }))).toHaveLength(1);
  });

  it("clearing one scope leaves every other entry untouched", () => {
    const storage = new MemoryStorage();
    writeRecovery(storage, scope, entry({ title: "a" }));
    writeRecovery(storage, { ...scope, revisionId: "rev-2" }, entry({ title: "b" }));
    writeRecovery(storage, { ...scope, userId: "user-2" }, entry({ title: "c" }));
    clearRecovery(storage, scope);
    expect(storage.keys()).toHaveLength(2);
    expect(readRecovery(storage, scope, FIELDS)).toBeNull();
    expect(readRecovery(storage, { ...scope, revisionId: "rev-2" }, FIELDS)?.values).toEqual({ title: "b" });
  });
});

describe("what is offered back", () => {
  it("same revision, same token: 'same-version'", () => {
    const storage = new MemoryStorage();
    writeRecovery(storage, scope, entry({ title: "unsaved" }, "t0"));
    expect(findRecoverable(storage, scope, FIELDS, server({ title: "saved" }, "t0"))).toMatchObject([{ relation: "same-version", entry: { values: { title: "unsaved" } } }]);
  });

  it("same revision, server has moved on: 'newer-saved-version' — offered, never applied", () => {
    const storage = new MemoryStorage();
    writeRecovery(storage, scope, entry({ title: "unsaved" }, "t0"));
    expect(findRecoverable(storage, scope, FIELDS, server({ title: "someone else's" }, "t7"))).toMatchObject([{ relation: "newer-saved-version" }]);
    expect(readRecovery(storage, scope, FIELDS)).not.toBeNull(); // still stored
  });

  it("a different revision of the same user/Recording/form is offered as 'other-revision' and kept", () => {
    const storage = new MemoryStorage();
    writeRecovery(storage, { ...scope, revisionId: "rev-old" }, entry({ title: "from the old draft" }));
    const found = findRecoverable(storage, scope, FIELDS, server({ title: "new draft text" }));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ relation: "other-revision", scope: { revisionId: "rev-old" } });
    expect(readRecovery(storage, { ...scope, revisionId: "rev-old" }, FIELDS)).not.toBeNull();
  });

  it("an entry the server already holds (the save succeeded, or its response was lost) is cleared, not offered", () => {
    const storage = new MemoryStorage();
    writeRecovery(storage, scope, entry({ title: "B", description: "" }));
    expect(findRecoverable(storage, scope, FIELDS, server({ title: "B", description: "" }, "t5"))).toEqual([]);
    expect(storage.keys()).toHaveLength(0); // confirmed persistence: removed
  });

  it("an identical entry from another revision is simply not offered (and not deleted)", () => {
    const storage = new MemoryStorage();
    writeRecovery(storage, { ...scope, revisionId: "rev-old" }, entry({ title: "same" }));
    expect(findRecoverable(storage, scope, FIELDS, server({ title: "same" }))).toEqual([]);
    expect(storage.keys()).toHaveLength(1);
  });

  it("offers the newest first", () => {
    const storage = new MemoryStorage();
    writeRecovery(storage, { ...scope, revisionId: "rev-a" }, entry({ title: "older" }, "t0", "2026-10-01T00:00:00.000Z"));
    writeRecovery(storage, { ...scope, revisionId: "rev-b" }, entry({ title: "newer" }, "t0", "2026-10-02T00:00:00.000Z"));
    expect(findRecoverable(storage, scope, FIELDS, server({ title: "x" })).map((r) => r.entry.values.title)).toEqual(["newer", "older"]);
  });
});

describe("robustness", () => {
  it("ignores malformed, foreign-version or unknown-field entries without deleting them", () => {
    const storage = new MemoryStorage();
    const key = recoveryKey(scope);
    for (const raw of ["not json", JSON.stringify({ v: 2, baseToken: "t", values: {}, savedAt: "x" }), JSON.stringify({ v: 1, baseToken: "t", values: { password: "x" }, savedAt: "x" }), JSON.stringify({ v: 1, baseToken: "t", values: { title: 5 }, savedAt: "x" })]) {
      storage.setItem(key, raw);
      expect(readRecovery(storage, scope, FIELDS)).toBeNull();
      expect(findRecoverable(storage, scope, FIELDS, server({ title: "" }))).toEqual([]);
      expect(storage.getItem(key)).toBe(raw);
    }
  });

  it("a storage that throws never breaks autosave (write reports false, reads return nothing)", () => {
    const broken: StorageLike = {
      length: 1,
      key: () => {
        throw new Error("blocked");
      },
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(writeRecovery(broken, scope, entry({ title: "x" }))).toBe(false);
    expect(readRecovery(broken, scope, FIELDS)).toBeNull();
    expect(findRecoverable(broken, scope, FIELDS, server({ title: "" }))).toEqual([]);
    expect(() => clearRecovery(broken, scope)).not.toThrow();
  });

  it("stores only the editor's text, the base token and a save time — nothing else", () => {
    const storage = new MemoryStorage();
    writeRecovery(storage, scope, entry({ title: "B" }));
    const stored = JSON.parse(storage.getItem(recoveryKey(scope))!);
    expect(Object.keys(stored).sort()).toEqual(["baseToken", "savedAt", "v", "values"]);
  });
});
