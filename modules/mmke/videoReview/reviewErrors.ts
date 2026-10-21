// Phase 6K-2 — typed refusals for the unlisted-video review.

export class ReviewNotFoundError extends Error {
  constructor() {
    super("That unlisted video is not in the review queue.");
    this.name = "ReviewNotFoundError";
  }
}

/** The decision was made against facts that have since changed. Nothing was recorded. */
export class ReviewChangedError extends Error {
  constructor() {
    super("This video changed since you opened it. Reload the queue and review the current version.");
    this.name = "ReviewChangedError";
  }
}

export class ReviewDecisionInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewDecisionInvalidError";
  }
}
