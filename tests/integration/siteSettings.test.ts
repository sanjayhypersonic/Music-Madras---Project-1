import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { can } from "../../modules/auth/policy";
import { prisma } from "../../modules/db/client";
import { loadResolvedSettings } from "../../modules/db/repositories/siteSettingRepository";
import { SettingConflictError, SettingForbiddenError, SettingNotFoundError, SettingValidationError } from "../../modules/settings/settingErrors";
import { changeSiteSetting, listSettingsForActor, resetSiteSettingToDefault } from "../../modules/settings/siteSettingsService";
import { SETTING_DEFINITIONS } from "../../modules/settings/settingsRegistry";

// Phase 6K-1 — typed settings against the isolated test database: authorization, validation, atomicity, concurrency, audit, fallback.

const KEY = SETTING_DEFINITIONS[0].key; // notifications.email.enabled (boolean, SETTINGS_MANAGE)
const TOKEN = randomUUID().slice(0, 8);
const T = 60000;
const users = {} as Record<"founder" | "editor" | "contributor", { id: string }>;

const actor = (who: keyof typeof users, role: "FOUNDER" | "EDITOR" | "CONTRIBUTOR") => ({ id: users[who].id, role });
const stored = () => prisma.siteSetting.findUnique({ where: { key: KEY } });
const audits = (action: string) => prisma.auditLogEntry.findMany({ where: { action, entityId: KEY }, orderBy: { timestamp: "asc" } });

beforeAll(async () => {
  for (const [who, role] of [["founder", "FOUNDER"], ["editor", "EDITOR"], ["contributor", "CONTRIBUTOR"]] as const) {
    users[who] = await prisma.studioUser.create({ data: { id: randomUUID(), email: `s6k1-${who}-${TOKEN}@musicmadras.test`, name: `Settings ${who}`, role, status: "ACTIVE" } });
  }
  await prisma.siteSetting.deleteMany({});
}, T);

afterAll(async () => {
  await prisma.siteSetting.deleteMany({});
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityType: "SiteSetting" }, { actorId: { in: Object.values(users).map((u) => u.id) } }] } });
  await prisma.studioUser.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
}, T);

describe("defaults and reads", () => {
  it("with nothing stored, every setting resolves to its definition's default", async () => {
    const resolved = await loadResolvedSettings();
    for (const def of SETTING_DEFINITIONS) expect(resolved.describe(def.key)).toMatchObject({ value: def.default, source: "default", version: 0 });
  });

  it("lists only what the actor's role may view (deny by default)", async () => {
    const founder = await listSettingsForActor("FOUNDER");
    expect(founder.map((s) => s.key)).toContain(KEY);
    expect(founder.find((s) => s.key === KEY)?.canChange).toBe(true);
    const editor = await listSettingsForActor("EDITOR");
    expect(editor.map((s) => s.key)).not.toContain(KEY); // SETTINGS_MANAGE is required to even see it
    expect(editor.map((s) => s.key).sort()).toEqual(SETTING_DEFINITIONS.filter((d) => can("EDITOR", d.viewAction)).map((d) => d.key).sort()); // exactly what the role may view
    expect(editor.every((s) => !s.canChange)).toBe(true); // an editor may view the review settings but not change them
    expect((await listSettingsForActor("CONTRIBUTOR")).map((s) => s.key).sort()).toEqual(SETTING_DEFINITIONS.filter((d) => can("CONTRIBUTOR", d.viewAction)).map((d) => d.key).sort());
  }, T);
});

describe("changing a setting", () => {
  it("an unauthorised role is refused, nothing is stored, and the refusal is audited", async () => {
    await expect(changeSiteSetting({ actor: actor("editor", "EDITOR"), key: KEY, value: true, expectedVersion: 0 })).rejects.toBeInstanceOf(SettingForbiddenError);
    await expect(changeSiteSetting({ actor: actor("contributor", "CONTRIBUTOR"), key: KEY, value: true, expectedVersion: 0 })).rejects.toBeInstanceOf(SettingForbiddenError);
    expect(await stored()).toBeNull();
    const denied = await audits("SITE_SETTING_CHANGE_DENIED");
    expect(denied.length).toBeGreaterThanOrEqual(2);
    expect(denied.map((d) => d.actorId)).toEqual(expect.arrayContaining([users.editor.id, users.contributor.id]));
  }, T);

  it("rejects an unknown key and an invalid value, storing nothing", async () => {
    await expect(changeSiteSetting({ actor: actor("founder", "FOUNDER"), key: "ghost.setting", value: true, expectedVersion: 0 })).rejects.toBeInstanceOf(SettingNotFoundError);
    for (const bad of ["yes", 1, null, {}]) {
      await expect(changeSiteSetting({ actor: actor("founder", "FOUNDER"), key: KEY, value: bad, expectedVersion: 0 })).rejects.toBeInstanceOf(SettingValidationError);
    }
    expect(await stored()).toBeNull();
  }, T);

  it("an authorised change is stored with its version and audited (who, what, when, before and after)", async () => {
    const result = await changeSiteSetting({ actor: actor("founder", "FOUNDER"), key: KEY, value: true, expectedVersion: 0 });
    expect(result).toEqual({ changed: true, version: 1 });
    expect(await stored()).toMatchObject({ valueJson: true, version: 1, updatedById: users.founder.id });
    const [entry] = await audits("SITE_SETTING_CHANGED");
    expect(entry.actorId).toBe(users.founder.id);
    expect(entry.beforeSnapshot).toMatchObject({ value: false, source: "default" });
    expect(entry.afterSnapshot).toMatchObject({ value: true, version: 1 });
    expect((await loadResolvedSettings()).get(KEY)).toBe(true);
  }, T);

  it("a stale or wrong expected version is a conflict and changes nothing", async () => {
    await expect(changeSiteSetting({ actor: actor("founder", "FOUNDER"), key: KEY, value: false, expectedVersion: 0 })).rejects.toBeInstanceOf(SettingConflictError); // already stored
    await expect(changeSiteSetting({ actor: actor("founder", "FOUNDER"), key: KEY, value: false, expectedVersion: 99 })).rejects.toBeInstanceOf(SettingConflictError);
    expect(await stored()).toMatchObject({ valueJson: true, version: 1 });
  }, T);

  it("two simultaneous changes from the same version: exactly one wins, the other is a conflict (atomic compare-and-set)", async () => {
    const [a, b] = await Promise.allSettled([
      changeSiteSetting({ actor: actor("founder", "FOUNDER"), key: KEY, value: false, expectedVersion: 1 }),
      changeSiteSetting({ actor: actor("founder", "FOUNDER"), key: KEY, value: false, expectedVersion: 1 }),
    ]);
    const outcomes = [a, b].map((r) => r.status);
    expect(outcomes.filter((s) => s === "fulfilled")).toHaveLength(1);
    const rejected = [a, b].find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(SettingConflictError);
    expect(await stored()).toMatchObject({ valueJson: false, version: 2 });
  }, T);

  it("audit records hold only validated values — no free text or credential can reach them", async () => {
    const entries = await prisma.auditLogEntry.findMany({ where: { entityType: "SiteSetting", entityId: KEY } });
    for (const entry of entries) expect(JSON.stringify([entry.beforeSnapshot, entry.afterSnapshot])).not.toMatch(/postgres(ql)?:\/\/|smtp|password|secret|token/i);
  }, T);
});

describe("invalid stored data and reset", () => {
  it("a stored value that no longer validates falls back to the default and is reported — it never breaks a reader", async () => {
    await prisma.siteSetting.update({ where: { key: KEY }, data: { valueJson: "banana" } });
    const resolved = await loadResolvedSettings();
    expect(resolved.get(KEY)).toBe(false);
    expect(resolved.describe(KEY)).toMatchObject({ source: "default", problem: expect.stringContaining("invalid") });
    const view = (await listSettingsForActor("FOUNDER")).find((s) => s.key === KEY)!;
    expect(view.problem).toMatch(/invalid/);
  }, T);

  it("a row for an undefined key is ignored on read", async () => {
    await prisma.siteSetting.create({ data: { key: "ghost.setting", valueJson: true, updatedById: users.founder.id } });
    const resolved = await loadResolvedSettings();
    expect(resolved.describe("ghost.setting")).toBeUndefined();
    await prisma.siteSetting.delete({ where: { key: "ghost.setting" } });
  }, T);

  it("reset needs permission and the current version, removes the stored row, and is audited", async () => {
    const row = (await stored())!;
    await expect(resetSiteSettingToDefault({ actor: actor("editor", "EDITOR"), key: KEY, expectedVersion: row.version })).rejects.toBeInstanceOf(SettingForbiddenError);
    await expect(resetSiteSettingToDefault({ actor: actor("founder", "FOUNDER"), key: KEY, expectedVersion: row.version + 5 })).rejects.toBeInstanceOf(SettingConflictError);
    expect(await stored()).not.toBeNull();
    await resetSiteSettingToDefault({ actor: actor("founder", "FOUNDER"), key: KEY, expectedVersion: row.version });
    expect(await stored()).toBeNull();
    expect((await audits("SITE_SETTING_RESET")).length).toBe(1);
    expect((await loadResolvedSettings()).get(KEY)).toBe(false);
  }, T);
});
