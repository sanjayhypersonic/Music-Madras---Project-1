import Link from "next/link";

// Phase 6J-1 — what a visitor sees when a page does not exist, is not public
// (a draft, archived or unpublished entity returns 404 by design, and must not
// say which), or the address was mistyped. Plain, warm, and free of any
// technical or internal wording.
export function MuseumNotFound() {
  return (
    <section className="museum-state" aria-labelledby="not-found-heading">
      <p className="museum-eyebrow">Page not found</p>
      <h1 id="not-found-heading">We couldn&rsquo;t find that page</h1>
      <p>The address may have been typed incorrectly, or the page is no longer available.</p>
      <div className="museum-state__actions">
        <Link href="/" className="museum-button">
          Return to the homepage
        </Link>
        <Link href="/archive" className="museum-button museum-button--secondary">
          Explore the archive
        </Link>
      </div>
    </section>
  );
}
