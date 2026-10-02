"use client";

import { useEffect } from "react";
import Link from "next/link";

// Phase 6J-1 — shown inside the Museum frame if a page fails while loading
// (a database or network problem). It never shows the error message or stack:
// those can contain internal detail, and a visitor cannot act on them. The
// digest is logged so an operator can find the matching server-side entry.
export default function MuseumError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Museum page error", error.digest ?? "(no digest)");
  }, [error]);

  return (
    <section className="museum-state" role="alert" aria-labelledby="error-heading">
      <p className="museum-eyebrow">Something went wrong</p>
      <h1 id="error-heading">We couldn&rsquo;t load this page</h1>
      <p>This is a temporary problem on our side. Please try again in a moment.</p>
      <div className="museum-state__actions">
        <button type="button" className="museum-button" onClick={() => reset()}>
          Try again
        </button>
        <Link href="/" className="museum-button museum-button--secondary">
          Return to the homepage
        </Link>
      </div>
    </section>
  );
}
