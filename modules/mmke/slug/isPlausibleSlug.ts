// A slug that arrives from a PUBLIC URL (/recordings/<slug>, /works/<slug>, ...) is visitor-controlled text. Before it reaches the database it must at least be the kind of
// string a slug can be: non-empty, bounded, and free of control characters. A NUL byte (%00) in particular is rejected by PostgreSQL as an invalid text value, which
// surfaces as an UNHANDLED database error and an HTTP 500, so anyone could make any public page fail (and, since launch monitoring, raise incidents) with one request.
// A string that fails this test cannot be the slug of anything, so the public readers treat it exactly as they treat an unknown slug: "not found" (a 404), never an error.
// Pure and Prisma-free (ADR §3 boundary rule). This is NOT the slug GENERATOR's alphabet (generated slugs are narrower); it only refuses what could never be valid.

/** A bound on the work one request can ask of the database, well above any generated slug. Not editorial policy. */
export const SLUG_MAX_LENGTH = 200;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function isPlausibleSlug(slug: unknown): slug is string {
  return typeof slug === "string" && slug.length > 0 && slug.length <= SLUG_MAX_LENGTH && !CONTROL_CHARACTERS.test(slug);
}
