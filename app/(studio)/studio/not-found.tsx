import Link from "next/link";

// Phase 6J-3B — Studio's own not-found state (a record that does not exist, or a mistyped address).

export default function StudioNotFound() {
  return (
    <div className="studio-state">
      <h1>We couldn’t find that</h1>
      <p>The page or record you asked for does not exist, or it was removed.</p>
      <div className="studio-state__actions">
        <Link href="/studio/dashboard">Dashboard</Link>
        <Link href="/studio/catalogue">Catalogue</Link>
      </div>
    </div>
  );
}