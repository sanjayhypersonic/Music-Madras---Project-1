import { writeAuditLog } from "../../audit/writeAuditLog";
import { resolveSettings, type ResolvedSettings } from "../../settings/resolveSettings";
import { SettingConflictError, SettingNotFoundError, SettingValidationError } from "../../settings/settingErrors";
import { findSettingDefinition } from "../../settings/settingsRegistry";
import { prisma } from "../client";
import { isUniqueConstraintViolation } from "../isUniqueConstraintViolation";
import type { Prisma } from "@prisma/client";

// Phase 6K-1 — persistence for typed site settings (table `site_settings`). The registry (modules/settings/settingsRegistry.ts) decides
// which keys exist and what a valid value is; this module only ever writes a value that validated, in one transaction with its audit
// entry, under an optimistic-concurrency check (`expectedVersion`; 0 means "no stored row yet"). Authorization is NOT decided here:
// callers go through modules/settings/siteSettingsService.ts, which checks the setting's required action.

type Client = Prisma.TransactionClient | typeof prisma;

export async function loadResolvedSettings(client: Client = prisma): Promise<ResolvedSettings> {
  const rows = await client.siteSetting.findMany();
  return resolveSettings(
    rows.map((row) => ({ key: row.key, valueJson: row.valueJson, schemaVersion: row.schemaVersion, version: row.version, updatedAt: row.updatedAt, updatedById: row.updatedById }))
  );
}

export interface UpdateSiteSettingInput {
  key: string;
  value: unknown;
  /** The version the editor saw: 0 when no value had been stored yet. */
  expectedVersion: number;
  actorId: string;
}

export interface UpdateSiteSettingResult {
  changed: boolean;
  version: number;
}

export async function updateSiteSetting(input: UpdateSiteSettingInput): Promise<UpdateSiteSettingResult> {
  const definition = findSettingDefinition(input.key);
  if (!definition) throw new SettingNotFoundError(input.key);
  const validation = definition.validate(input.value);
  if (!validation.ok) throw new SettingValidationError(input.key, validation.reason);
  const value = validation.value;

  return prisma.$transaction(async (tx) => {
    const existing = await tx.siteSetting.findUnique({ where: { key: input.key } });
    const resolved = (await loadResolvedSettings(tx)).describe(input.key);
    const before = resolved ? resolved.value : definition.default;

    if (!existing) {
      if (input.expectedVersion !== 0) throw new SettingConflictError(input.key);
      try {
        await tx.siteSetting.create({ data: { key: input.key, valueJson: value as Prisma.InputJsonValue, schemaVersion: definition.version, version: 1, updatedById: input.actorId } });
      } catch (err) {
        if (isUniqueConstraintViolation(err)) throw new SettingConflictError(input.key);
        throw err;
      }
      await writeAuditLog({ actorId: input.actorId, action: "SITE_SETTING_CHANGED", entityType: "SiteSetting", entityId: input.key, beforeSnapshot: { value: before, source: "default" }, afterSnapshot: { value, version: 1 } }, tx);
      return { changed: true, version: 1 };
    }

    if (existing.version !== input.expectedVersion) throw new SettingConflictError(input.key);
    const moved = await tx.siteSetting.updateMany({
      where: { key: input.key, version: input.expectedVersion },
      data: { valueJson: value as Prisma.InputJsonValue, schemaVersion: definition.version, version: { increment: 1 }, updatedById: input.actorId },
    });
    if (moved.count !== 1) throw new SettingConflictError(input.key);
    await writeAuditLog(
      { actorId: input.actorId, action: "SITE_SETTING_CHANGED", entityType: "SiteSetting", entityId: input.key, beforeSnapshot: { value: before, source: "stored", version: existing.version }, afterSnapshot: { value, version: existing.version + 1 } },
      tx
    );
    return { changed: true, version: existing.version + 1 };
  });
}

/** Removes the stored row so the definition's default applies again. */
export async function resetSiteSetting(input: { key: string; expectedVersion: number; actorId: string }): Promise<void> {
  const definition = findSettingDefinition(input.key);
  if (!definition) throw new SettingNotFoundError(input.key);
  await prisma.$transaction(async (tx) => {
    const existing = await tx.siteSetting.findUnique({ where: { key: input.key } });
    if (!existing) return; // already the default
    if (existing.version !== input.expectedVersion) throw new SettingConflictError(input.key);
    const gone = await tx.siteSetting.deleteMany({ where: { key: input.key, version: input.expectedVersion } });
    if (gone.count !== 1) throw new SettingConflictError(input.key);
    const resolved = (await loadResolvedSettings(tx)).describe(input.key);
    await writeAuditLog(
      { actorId: input.actorId, action: "SITE_SETTING_RESET", entityType: "SiteSetting", entityId: input.key, beforeSnapshot: { value: existing.valueJson, version: existing.version }, afterSnapshot: { value: resolved?.value ?? definition.default, source: "default" } },
      tx
    );
  });
}
