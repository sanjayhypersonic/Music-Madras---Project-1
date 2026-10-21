import { can } from "../auth/policy";
import type { StudioRoleName } from "../auth/types";
import { writeAuditLog } from "../audit/writeAuditLog";
import { loadResolvedSettings, resetSiteSetting, updateSiteSetting } from "../db/repositories/siteSettingRepository";
import { SettingForbiddenError, SettingNotFoundError } from "./settingErrors";
import { findSettingDefinition, listSettingDefinitions, type SettingKind, type SettingSensitivity } from "./settingsRegistry";

// Phase 6K-1 — the authorised entry point for settings. Every read for a person and every change goes through here, so the
// per-setting `viewAction` / `changeAction` is enforced in ONE place (OWASP: centralised, deny-by-default, server-side), in addition to
// each Server Action's own session check. A refused attempt is recorded in the audit trail.

export interface Actor {
  id: string;
  role: StudioRoleName;
}

/** What the Studio form needs: plain data only (no validators), never a secret. */
export interface SettingView {
  key: string;
  group: string;
  label: string;
  description: string;
  effect: string;
  owner: string;
  kind: SettingKind;
  sensitivity: SettingSensitivity;
  min?: number;
  max?: number;
  step?: number;
  options?: readonly { value: string; label: string }[];
  recordKeys?: readonly string[];
  value: unknown;
  defaultValue: unknown;
  source: "default" | "stored";
  version: number;
  problem: string | null;
  updatedAt: Date | null;
  canChange: boolean;
}

export async function listSettingsForActor(role: StudioRoleName): Promise<SettingView[]> {
  const resolved = await loadResolvedSettings();
  const views: SettingView[] = [];
  for (const definition of listSettingDefinitions()) {
    if (!can(role, definition.viewAction)) continue; // deny by default: what you may not view is not even listed
    const current = resolved.describe(definition.key);
    views.push({
      key: definition.key,
      group: definition.group,
      label: definition.label,
      description: definition.description,
      effect: definition.effect,
      owner: definition.owner,
      kind: definition.kind,
      sensitivity: definition.sensitivity,
      min: definition.min,
      max: definition.max,
      step: definition.step,
      options: definition.options,
      recordKeys: definition.recordKeys,
      value: current?.value ?? definition.default,
      defaultValue: definition.default,
      source: current?.source ?? "default",
      version: current?.version ?? 0,
      problem: current?.problem ?? null,
      updatedAt: current?.updatedAt ?? null,
      canChange: can(role, definition.changeAction),
    });
  }
  return views;
}

async function authorise(actor: Actor, key: string) {
  const definition = findSettingDefinition(key);
  if (!definition) throw new SettingNotFoundError(key);
  if (!can(actor.role, definition.changeAction)) {
    await writeAuditLog({ actorId: actor.id, action: "SITE_SETTING_CHANGE_DENIED", entityType: "SiteSetting", entityId: key, afterSnapshot: { requiredAction: definition.changeAction } });
    throw new SettingForbiddenError(key);
  }
  return definition;
}

export async function changeSiteSetting(input: { actor: Actor; key: string; value: unknown; expectedVersion: number }) {
  await authorise(input.actor, input.key);
  return updateSiteSetting({ key: input.key, value: input.value, expectedVersion: input.expectedVersion, actorId: input.actor.id });
}

export async function resetSiteSettingToDefault(input: { actor: Actor; key: string; expectedVersion: number }) {
  await authorise(input.actor, input.key);
  return resetSiteSetting({ key: input.key, expectedVersion: input.expectedVersion, actorId: input.actor.id });
}
