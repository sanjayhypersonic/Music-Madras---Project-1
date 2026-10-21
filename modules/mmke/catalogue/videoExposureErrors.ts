// Phase 6K-2 — typed refusals for exposure approvals and the unlisted review. Messages never echo YouTube data or credentials.

export class ExposurePageNotFoundError extends Error {
  constructor() {
    super("That video page does not exist.");
    this.name = "ExposurePageNotFoundError";
  }
}

/** Approvals exist only for UNLISTED videos: a public video needs none, and a private one can never be approved. */
export class ApprovalNotApplicableError extends Error {
  constructor(readonly privacyStatus: string | null) {
    super(
      privacyStatus === "public"
        ? "This video is public on YouTube; it needs no exception."
        : `Only an unlisted video can be approved for public exposure; this video is ${privacyStatus ?? "of unknown visibility"}.`
    );
    this.name = "ApprovalNotApplicableError";
  }
}

export class VideoNotAvailableError extends Error {
  constructor() {
    super("The video is not currently available on YouTube, so it cannot be approved.");
    this.name = "VideoNotAvailableError";
  }
}

/** An archived page cannot hold an approval: restore the page first, then approve it afresh (archiving revokes approvals; restoring never brings them back). */
export class ApprovalPageArchivedError extends Error {
  constructor() {
    super("This page is archived. Restore it first, then approve it: an archived page cannot hold an approval, and restoring a page never brings an earlier approval back.");
    this.name = "ApprovalPageArchivedError";
  }
}

/** A rights, copyright, privacy or other hold recorded for this video blocks approval until a person clears it. */
export class ApprovalBlockedByHoldError extends Error {
  constructor(readonly hold: string) {
    super(`Approval is blocked by a recorded ${hold.toLowerCase()} hold. Clear the hold first.`);
    this.name = "ApprovalBlockedByHoldError";
  }
}

/** Discovery and playlist exposure need the page to be approved first. */
export class ApprovalPrerequisiteError extends Error {
  constructor() {
    super("Approve the public page first: listing or playlist inclusion needs an approved page.");
    this.name = "ApprovalPrerequisiteError";
  }
}

export class ApprovalInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalInvalidError";
  }
}
