// Phase 6G-4C — thrown by a repository's create function when the
// generated slug collides with an existing row's @unique slug column
// (brief §8/§16: "slug collisions must be handled safely; do not
// silently overwrite another record"). Distinct from DuplicateEntityError
// (same normalized name) — two different names can still slugify to the
// same URL segment.

export class SlugConflictError extends Error {
  constructor(slug: string) {
    super(`The URL "${slug}" is already used by another record. Try a different name, or edit the existing record instead.`);
    this.name = "SlugConflictError";
  }
}
