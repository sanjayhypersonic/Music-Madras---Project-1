import { describe, expect, it } from "vitest";
import { can } from "../../modules/auth/policy";
import type { StudioRoleName } from "../../modules/auth/types";
import { resolveSettings, type StoredSettingRow } from "../../modules/settings/resolveSettings";
import {
  SETTING_DEFINITIONS,
  booleanSetting,
  enumSetting,
  findSettingDefinition,
  integerSetting,
  listSettingDefinitions,
  numberSetting,
  recordSetting,
} from "../../modules/settings/settingsRegistry";

// Phase 6K-1 — the settings registry's rules. Builders are exercised with synthetic definitions (the rule under test is the builder);
// the real registry is checked for the invariants every definition must satisfy.

const base = {
  version: 1,
  group: "notifications" as const,
  label: "A label",
  description: "A description",
  effect: "An effect",
  owner: "An owner",
  sensitivity: "EDITORIAL" as const,
  viewAction: "CATALOGUE_WRITE" as const,
  changeAction: "RECORDING_PUBLISH" as const,
};

describe("setting builders validate their own values", () => {
  it("boolean accepts only booleans", () => {
    const def = booleanSetting({ ...base, key: "test.flag", default: false });
    expect(def.validate(true)).toEqual({ ok: true, value: true });
    for (const bad of ["true", 1, null, undefined, {}]) expect(def.validate(bad).ok).toBe(false);
  });

  it("integer enforces whole numbers within bounds", () => {
    const def = integerSetting({ ...base, key: "test.count", default: 5, min: 1, max: 10 });
    expect(def.validate(1).ok && def.validate(10).ok).toBe(true);
    for (const bad of [0, 11, 2.5, "3", NaN, Infinity, null]) expect(def.validate(bad).ok, String(bad)).toBe(false);
  });

  it("number enforces finite values within bounds", () => {
    const def = numberSetting({ ...base, key: "test.weight", default: 0.5, min: 0, max: 1, step: 0.05 });
    expect(def.validate(0).ok && def.validate(1).ok && def.validate(0.35).ok).toBe(true);
    for (const bad of [-0.1, 1.1, NaN, Infinity, "0.5", null]) expect(def.validate(bad).ok, String(bad)).toBe(false);
  });

  it("enum accepts only its options", () => {
    const def = enumSetting({ ...base, key: "test.mode", default: "a", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] });
    expect(def.validate("b")).toEqual({ ok: true, value: "b" });
    for (const bad of ["c", "", 1, null]) expect(def.validate(bad).ok).toBe(false);
  });

  it("record accepts only its keys and choices, and a locked entry cannot be weakened", () => {
    const def = recordSetting({
      ...base,
      key: "test.rules",
      default: { a: "REQUIRED", b: "RECOMMENDED" },
      keys: ["a", "b"],
      choices: ["REQUIRED", "RECOMMENDED", "OFF"],
      lockedKeys: ["a"],
    });
    expect(def.validate({ b: "OFF" })).toEqual({ ok: true, value: { a: "REQUIRED", b: "OFF" } }); // omitted entries keep their default
    expect(def.validate({ a: "REQUIRED" }).ok).toBe(true);
    expect(def.validate({ a: "OFF" }).ok).toBe(false); // locked
    expect(def.validate({ zzz: "OFF" }).ok).toBe(false); // unknown entry
    expect(def.validate({ b: "MAYBE" }).ok).toBe(false);
    for (const bad of [null, [], "x", 3]) expect(def.validate(bad).ok).toBe(false);
  });

  it("builders refuse an invalid key, a missing owner/effect, or an out-of-range default", () => {
    expect(() => booleanSetting({ ...base, key: "Bad Key", default: true })).toThrow(/Invalid setting key/);
    expect(() => booleanSetting({ ...base, key: "nodots", default: true })).toThrow(/Invalid setting key/);
    expect(() => booleanSetting({ ...base, key: "test.x", owner: " ", default: true })).toThrow(/owner/);
    expect(() => integerSetting({ ...base, key: "test.y", default: 99, min: 1, max: 10 })).toThrow(/out of range/);
  });
});

describe("the real registry", () => {
  const roles: StudioRoleName[] = ["FOUNDER", "SUPER_ADMINISTRATOR", "ADMINISTRATOR", "EDITOR", "REVIEWER", "CONTRIBUTOR"];

  it("has unique, well-formed keys and every definition declares its purpose, owner and effect", () => {
    const keys = SETTING_DEFINITIONS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const def of listSettingDefinitions()) {
      expect(def.key).toMatch(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/);
      expect(def.label.length).toBeGreaterThan(3);
      expect(def.description.length).toBeGreaterThan(20);
      expect(def.effect.length).toBeGreaterThan(10);
      expect(def.owner.length).toBeGreaterThan(3);
      expect(def.version).toBeGreaterThanOrEqual(1);
    }
  });

  it("every default validates against its own definition", () => {
    for (const def of listSettingDefinitions()) expect(def.validate(def.default), def.key).toEqual({ ok: true, value: def.default });
  });

  it("can hold no secret by construction: only boolean, bounded numeric, enum and record-of-enum kinds exist, and no key names a credential", () => {
    for (const def of listSettingDefinitions()) {
      expect(["boolean", "integer", "number", "enum", "record"]).toContain(def.kind);
      expect(def.key).not.toMatch(/secret|password|token|apikey|credential|connection|url/i);
    }
  });

  it("is deny-by-default: someone who may change a setting may also view it, and at least one role may change each setting", () => {
    for (const def of listSettingDefinitions()) {
      for (const role of roles) if (can(role, def.changeAction)) expect(can(role, def.viewAction), `${def.key} ${role}`).toBe(true);
      expect(roles.some((role) => can(role, def.changeAction)), def.key).toBe(true);
      expect(can("CONTRIBUTOR", def.changeAction), `${def.key} must not be contributor-editable`).toBe(false);
    }
  });

  it("an unknown key has no definition", () => {
    expect(findSettingDefinition("does.not.exist")).toBeUndefined();
  });
});

describe("resolving stored values", () => {
  const key = SETTING_DEFINITIONS[0].key;
  const def = findSettingDefinition(key)!;
  const row = (over: Partial<StoredSettingRow> = {}): StoredSettingRow => ({ key, valueJson: !def.default, schemaVersion: def.version, version: 3, updatedAt: new Date("2026-01-01"), updatedById: "u1", ...over });

  it("uses the default when nothing is stored", () => {
    const resolved = resolveSettings([]).describe(key)!;
    expect(resolved).toMatchObject({ value: def.default, source: "default", version: 0, problem: null });
  });

  it("uses a valid stored value", () => {
    expect(resolveSettings([row()]).describe(key)).toMatchObject({ value: !def.default, source: "stored", version: 3, problem: null });
  });

  it("falls back to the default, with a reported problem, for an invalid stored value or an older definition version — never throwing", () => {
    const invalid = resolveSettings([row({ valueJson: "banana" })]).describe(key)!;
    expect(invalid.value).toBe(def.default);
    expect(invalid.source).toBe("default");
    expect(invalid.problem).toMatch(/invalid/);
    const old = resolveSettings([row({ schemaVersion: def.version + 1 })]).describe(key)!;
    expect(old.value).toBe(def.default);
    expect(old.problem).toMatch(/older definition/);
  });

  it("ignores a row whose key is not in the registry", () => {
    const resolved = resolveSettings([row({ key: "ghost.setting" })]);
    expect(resolved.describe("ghost.setting")).toBeUndefined();
    expect(resolved.all().map((r) => r.key)).toEqual(listSettingDefinitions().map((d) => d.key));
  });

  it("refuses to read a key that is not defined", () => {
    expect(() => resolveSettings([]).get("ghost.setting" as never)).toThrow(/not defined/);
  });
});
