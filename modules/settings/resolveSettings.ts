import { findSettingDefinition, listSettingDefinitions, type SettingKey, type SettingValueOf } from "./settingsRegistry";

// Phase 6K-1 — resolving stored values against the registry (pure). Rules:
//  - a key with no stored row uses the definition's default;
//  - a stored value that no longer validates, or that was written under a different definition version, is IGNORED in favour of the
//    default and reported in `problem` (never thrown at a reader: a public page must not fail because a setting row is stale);
//  - a stored row whose key is not in the registry is ignored entirely.

export interface StoredSettingRow {
  key: string;
  valueJson: unknown;
  schemaVersion: number;
  version: number;
  updatedAt: Date;
  updatedById: string;
}

export interface ResolvedSetting {
  key: string;
  value: unknown;
  source: "default" | "stored";
  /** The row's concurrency counter (0 when there is no stored row). */
  version: number;
  updatedAt: Date | null;
  updatedById: string | null;
  /** Set when a stored row exists but could not be used. */
  problem: string | null;
}

export class ResolvedSettings {
  constructor(private readonly byKey: ReadonlyMap<string, ResolvedSetting>) {}

  get<K extends SettingKey>(key: K): SettingValueOf<K> {
    const resolved = this.byKey.get(key);
    if (!resolved) throw new Error(`Setting "${key}" is not defined.`);
    return resolved.value as SettingValueOf<K>;
  }

  describe(key: string): ResolvedSetting | undefined {
    return this.byKey.get(key);
  }

  all(): ResolvedSetting[] {
    return [...this.byKey.values()];
  }
}

export function resolveSettings(rows: readonly StoredSettingRow[]): ResolvedSettings {
  const stored = new Map(rows.map((row) => [row.key, row]));
  const out = new Map<string, ResolvedSetting>();
  for (const definition of listSettingDefinitions()) {
    const row = stored.get(definition.key);
    if (!row) {
      out.set(definition.key, { key: definition.key, value: definition.default, source: "default", version: 0, updatedAt: null, updatedById: null, problem: null });
      continue;
    }
    const validation = definition.validate(row.valueJson);
    const versionOk = row.schemaVersion === definition.version;
    if (validation.ok && versionOk) {
      out.set(definition.key, { key: definition.key, value: validation.value, source: "stored", version: row.version, updatedAt: row.updatedAt, updatedById: row.updatedById, problem: null });
    } else {
      out.set(definition.key, {
        key: definition.key,
        value: definition.default,
        source: "default",
        version: row.version,
        updatedAt: row.updatedAt,
        updatedById: row.updatedById,
        problem: versionOk ? `the stored value is invalid (${validation.ok ? "" : validation.reason}); the default is in use.` : "the stored value was written for an older definition; the default is in use.",
      });
    }
  }
  return new ResolvedSettings(out);
}

/** Convenience for callers that only hold a key string (the Studio form). */
export function isDefinedSettingKey(key: string): boolean {
  return findSettingDefinition(key) !== undefined;
}
