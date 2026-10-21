// Phase 6K-1 — typed refusals for the editorial content lifecycle.

export class EditorialBlockUnknownError extends Error {
  constructor(readonly slug: string) {
    super("That is not a content block the site uses.");
    this.name = "EditorialBlockUnknownError";
  }
}

export class EditorialBlockExistsError extends Error {
  constructor() {
    super("This block already has a draft.");
    this.name = "EditorialBlockExistsError";
  }
}

export class EditorialContentNotFoundError extends Error {
  constructor() {
    super("That content block does not exist.");
    this.name = "EditorialContentNotFoundError";
  }
}

/** The draft changed since the editor loaded it (or since the version they previewed): nothing was written. */
export class EditorialConflictError extends Error {
  constructor() {
    super("This content was changed by someone else, or after you previewed it. Reload the page and review it again.");
    this.name = "EditorialConflictError";
  }
}

export class EditorialInvalidError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join(" "));
    this.name = "EditorialInvalidError";
  }
}
