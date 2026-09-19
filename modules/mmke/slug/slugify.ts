// Shared slug derivation (Phase 4) — every Studio create-form for a
// slugged entity (Composer, MusicalWork, Programme, Venue, Collection,
// Recording) needs the same "turn a title into a URL segment" logic; this
// is that one pure function, not duplicated per form.

export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics, e.g. "Dvořák" -> "dvorak"
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
