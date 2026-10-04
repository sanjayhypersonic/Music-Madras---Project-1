"use client";

import Link from "next/link";

// Phase 6J-3B — Studio's own error state (it used to fall back to the framework's
// default page). Restrained and useful: it says what happened in plain words, offers
// a retry and a way back, and never prints the error message or stack (those can
// carry internals). The digest is shown so an operator can find the server log entry.

export default function StudioError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="studio-state" role="alert">
      <h1>Something went wrong</h1>
      <p>This page could not be shown. Nothing has been changed. You can try again, or go back to the dashboard.</p>
      {error.digest && <p className="studio-muted">Reference: {error.digest}</p>}
      <div className="studio-state__actions">
        <button type="button" className="studio-button--primary" onClick={() => reset()}>
          Try again
        </button>
        <Link href="/studio/dashboard">Dashboard</Link>
      </div>
    </div>
  );
}