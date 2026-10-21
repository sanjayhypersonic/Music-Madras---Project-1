// Phase 6K-3 — typed refusals for featuring a video.

export class FeaturedNotFoundError extends Error {
  constructor() {
    super("That video page is not in the featured list.");
    this.name = "FeaturedNotFoundError";
  }
}

/** Only a video the Museum currently lists can be featured; a pin never overrides eligibility. */
export class FeaturedNotEligibleError extends Error {
  constructor() {
    super("Only a video the Museum currently lists can be featured. Publish the page (and, for an unlisted video, approve its listing) first.");
    this.name = "FeaturedNotEligibleError";
  }
}
