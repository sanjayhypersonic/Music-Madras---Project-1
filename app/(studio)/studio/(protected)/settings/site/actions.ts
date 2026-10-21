"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { SettingConflictError, SettingForbiddenError, SettingNotFoundError, SettingValidationError } from "../../../../../../modules/settings/settingErrors";
import { changeSiteSetting, resetSiteSettingToDefault } from "../../../../../../modules/settings/siteSettingsService";
import { findSettingDefinition } from "../../../../../../modules/settings/settingsRegistry";

// Phase 6K-1 — Server Actions for the site-settings screen. Each re-checks the session itself (Server Actions are callable
// independently of the page); the per-setting permission is enforced inside changeSiteSetting (modules/settings/siteSettingsService.ts).

const BASE = "/studio/settings/site";

function back(query: string): never {
  redirect(`${BASE}?${query}`);
}

/** Reads the posted control for a setting in the shape its definition expects. Anything unparseable is passed on as-is and refused by validation. */
function readValue(key: string, formData: FormData): unknown {
  const definition = findSettingDefinition(key);
  if (!definition) return undefined;
  switch (definition.kind) {
    case "boolean": {
      const raw = String(formData.get("value") ?? "");
      return raw === "true" ? true : raw === "false" ? false : raw;
    }
    case "integer":
    case "number": {
      const raw = String(formData.get("value") ?? "").trim();
      return raw === "" ? raw : Number(raw);
    }
    case "record": {
      const record: Record<string, string> = {};
      for (const entry of definition.recordKeys ?? []) record[entry] = String(formData.get(`entry:${entry}`) ?? "");
      return record;
    }
    default:
      return String(formData.get("value") ?? "");
  }
}

function describe(err: unknown): string {
  if (
    err instanceof SettingForbiddenError ||
    err instanceof SettingValidationError ||
    err instanceof SettingConflictError ||
    err instanceof SettingNotFoundError
  ) {
    return err.message;
  }
  return "The setting could not be saved. Please try again.";
}

export async function saveSettingAction(formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || session.user.status !== "ACTIVE") redirect("/studio/signin");
  const key = String(formData.get("key") ?? "");
  const expectedVersion = Number(formData.get("expectedVersion") ?? "0");
  try {
    await changeSiteSetting({ actor: { id: session.user.id, role: session.user.role }, key, value: readValue(key, formData), expectedVersion: Number.isInteger(expectedVersion) ? expectedVersion : -1 });
  } catch (err) {
    back(`error=${encodeURIComponent(describe(err))}`);
  }
  back(`saved=${encodeURIComponent(key)}`);
}

export async function resetSettingAction(formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || session.user.status !== "ACTIVE") redirect("/studio/signin");
  const key = String(formData.get("key") ?? "");
  const expectedVersion = Number(formData.get("expectedVersion") ?? "0");
  try {
    await resetSiteSettingToDefault({ actor: { id: session.user.id, role: session.user.role }, key, expectedVersion: Number.isInteger(expectedVersion) ? expectedVersion : -1 });
  } catch (err) {
    back(`error=${encodeURIComponent(describe(err))}`);
  }
  back(`reset=${encodeURIComponent(key)}`);
}
