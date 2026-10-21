// Phase 6K-1 — typed refusals for the settings capability. Messages never echo a stored value.

export class SettingNotFoundError extends Error {
  constructor(readonly key: string) {
    super("That setting does not exist.");
    this.name = "SettingNotFoundError";
  }
}

export class SettingValidationError extends Error {
  constructor(readonly key: string, readonly reason: string) {
    super(`The value for this setting ${reason}`);
    this.name = "SettingValidationError";
  }
}

/** The setting changed since the editor loaded the form (or the form was loaded before the first value existed). */
export class SettingConflictError extends Error {
  constructor(readonly key: string) {
    super("This setting was changed by someone else. Reload the page and try again.");
    this.name = "SettingConflictError";
  }
}

export class SettingForbiddenError extends Error {
  constructor(readonly key: string) {
    super("You do not have permission to change this setting.");
    this.name = "SettingForbiddenError";
  }
}
