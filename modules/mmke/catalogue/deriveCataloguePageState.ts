// Phase 6G-1C — the four-state label the Studio video catalogue list and
// manage page both show ("No Page" / "Draft" / "Published" / "Archived").
// Pure and separately testable so the Studio list's own rendering logic
// doesn't have to be exercised just to prove this mapping is correct.
// This is a display-label helper only — it is not, and must not become,
// a second copy of modules/mmke/catalogue/isYouTubeVideoPagePublic's
// public-visibility gate.

export type CataloguePageState = "No Page" | "Draft" | "Published" | "Archived";

export function deriveCataloguePageState(
  videoPage: { status: "DRAFT" | "PUBLISHED"; archivedAt: Date | null } | null
): CataloguePageState {
  if (!videoPage) return "No Page";
  if (videoPage.archivedAt) return "Archived";
  return videoPage.status === "PUBLISHED" ? "Published" : "Draft";
}
