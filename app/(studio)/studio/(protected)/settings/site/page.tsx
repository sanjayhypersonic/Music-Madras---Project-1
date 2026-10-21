import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { listSettingsForActor, type SettingView } from "../../../../../../modules/settings/siteSettingsService";
import { SETTING_GROUP_LABELS } from "../../../../../../modules/settings/settingsRegistry";
import { resetSettingAction, saveSettingAction } from "./actions";

// Phase 6K-1 — the site and editorial settings screen. Every control is generated from the setting's registry definition (type,
// bounds, options), so nothing here is hand-written per setting. A person only sees the settings their role may view and can only
// change those their role may change; the server enforces both (this page merely reflects it). No secret or deployment value
// appears here: those are environment configuration and are not settings.

function Control({ setting }: { setting: SettingView }) {
  const disabled = !setting.canChange;
  switch (setting.kind) {
    case "boolean":
      return (
        <select name="value" defaultValue={String(setting.value)} disabled={disabled} aria-label={setting.label}>
          <option value="true">On</option>
          <option value="false">Off</option>
        </select>
      );
    case "integer":
    case "number":
      return <input type="number" name="value" defaultValue={String(setting.value)} min={setting.min} max={setting.max} step={setting.step} disabled={disabled} aria-label={setting.label} />;
    case "enum":
      return (
        <select name="value" defaultValue={String(setting.value)} disabled={disabled} aria-label={setting.label}>
          {setting.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    case "record": {
      const record = setting.value as Record<string, string>;
      return (
        <div>
          {setting.recordKeys?.map((entry) => (
            <label key={entry} style={{ display: "block", margin: "0.25rem 0" }}>
              <span style={{ display: "inline-block", minWidth: "16rem" }}>{entry}</span>
              <select name={`entry:${entry}`} defaultValue={record[entry]} disabled={disabled}>
                {setting.options?.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      );
    }
  }
}

export default async function SiteSettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string; reset?: string; error?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session || session.user.status !== "ACTIVE") redirect("/studio/signin");
  const { saved, reset, error } = await searchParams;
  const settings = await listSettingsForActor(session.user.role);
  const groups = [...new Set(settings.map((s) => s.group))];

  return (
    <div>
      <p>
        <Link href="/studio/settings">← Settings</Link>
      </p>
      <h1>Site and editorial settings</h1>
      <p>
        Preferences with a defined owner and effect. Credentials, deployment configuration and the rules that protect visibility, rights and security are not settings and
        cannot be changed here. Every change is recorded in the audit log.
      </p>
      {error && (
        <p role="alert" className="studio-alert studio-alert--error">
          {error}
        </p>
      )}
      {saved && <p role="status">Saved.</p>}
      {reset && <p role="status">Restored to the default.</p>}

      {settings.length === 0 ? (
        <p className="studio-empty">Your role does not have access to any site settings.</p>
      ) : (
        groups.map((group) => (
          <section key={group} style={{ margin: "1.5rem 0" }}>
            <h2>{SETTING_GROUP_LABELS[group as keyof typeof SETTING_GROUP_LABELS] ?? group}</h2>
            {settings
              .filter((s) => s.group === group)
              .map((setting) => (
                <form key={setting.key} action={saveSettingAction} style={{ borderTop: "1px solid var(--mm-border)", padding: "1rem 0" }}>
                  <input type="hidden" name="key" value={setting.key} />
                  <input type="hidden" name="expectedVersion" value={setting.version} />
                  <h3 style={{ margin: 0 }}>{setting.label}</h3>
                  <p style={{ margin: "0.25rem 0" }}>{setting.description}</p>
                  <p style={{ margin: "0.25rem 0" }}>
                    <strong>Effect:</strong> {setting.effect}
                  </p>
                  <p style={{ margin: "0.25rem 0" }}>
                    <strong>Owner:</strong> {setting.owner} · <strong>Source:</strong> {setting.source === "stored" ? "set in Studio" : "default"}
                    {setting.updatedAt ? ` · last changed ${setting.updatedAt.toLocaleString()}` : ""}
                  </p>
                  {setting.problem && (
                    <p role="alert" className="studio-alert studio-alert--error">
                      The stored value cannot be used: {setting.problem}
                    </p>
                  )}
                  <Control setting={setting} />
                  {setting.canChange ? (
                    <p>
                      <button type="submit" className="studio-button--primary">
                        Save
                      </button>
                      {setting.source === "stored" && (
                        <button type="submit" formAction={resetSettingAction} style={{ marginLeft: "0.5rem" }}>
                          Restore default
                        </button>
                      )}
                    </p>
                  ) : (
                    <p>
                      <em>You can view this setting but not change it.</em>
                    </p>
                  )}
                </form>
              ))}
          </section>
        ))
      )}
    </div>
  );
}
