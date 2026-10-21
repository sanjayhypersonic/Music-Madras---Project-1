import type { PlaylistQualityResult } from "./playlistQuality";

// Phase 6K-4 — typed refusals for playlist pages. Messages are written for editors and never echo YouTube data or credentials.

export class PlaylistNotFoundError extends Error {
  constructor() {
    super("That playlist page does not exist.");
    this.name = "PlaylistNotFoundError";
  }
}

export class PlaylistConflictError extends Error {
  constructor() {
    super("This playlist page was changed since you opened it. Reload it and review the current version before continuing.");
    this.name = "PlaylistConflictError";
  }
}

export class PlaylistInvalidError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join(" "));
    this.name = "PlaylistInvalidError";
  }
}

/** Publication refused: the CURRENT draft does not pass the quality rubric. The page stays a draft; `result` says exactly what is missing. */
export class PlaylistQualityError extends Error {
  constructor(readonly result: PlaylistQualityResult) {
    super(`This playlist page cannot be published yet: ${result.failing.map((c) => c.detail).join(" ")}`);
    this.name = "PlaylistQualityError";
  }
}

export class PlaylistMemberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlaylistMemberError";
  }
}

/** The page is archived: it cannot be edited, have members changed, take context, be proposed drafts or be published. Unarchive it first. */
export class PlaylistArchivedError extends PlaylistMemberError {
  constructor() {
    super("An archived playlist page cannot be changed. Restore it first.");
    this.name = "PlaylistArchivedError";
  }
}
