import type { ReactNode } from "react";

// Phase 6G-2A — the minimum Museum route-group root required for
// app/(museum)/videos/[slug] to exist. Deliberately no navigation, no
// design system, no homepage — those remain later increments (ADR §3/§9).
// No authentication gate here at all: this route group is the public
// site, unlike app/(studio)/studio/(protected)/layout.tsx.

export default function MuseumLayout({ children }: { children: ReactNode }) {
  return (
    <div>
      <header style={{ padding: "1rem", borderBottom: "1px solid #ccc" }}>
        <strong>Music Madras</strong>
      </header>
      <main>{children}</main>
    </div>
  );
}
