import type { ReactNode } from "react";
import type { Metadata } from "next";

// Phase 6J-1: Studio pages used to inherit the root's placeholder title
// ("Production Foundation") and were indexable in principle. They now carry the
// Studio's own title and a noindex/nofollow instruction (robots.txt already
// disallows /studio; this is the page-level second layer).
export const metadata: Metadata = {
  title: { default: "Music Madras Studio", template: "%s · Music Madras Studio" },
  description: "Music Madras Studio — the editorial workspace for the Music Madras archive.",
  robots: { index: false, follow: false },
};

// Shared shell for every Studio route, authenticated or not (sign-in,
// invite acceptance, and password reset all render inside this too). The
// authentication + account-status gate itself lives one level deeper, in
// (protected)/layout.tsx — this file must NOT redirect, since it also
// wraps the sign-in page a logged-out user is trying to reach.
export default function StudioLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", minHeight: "100vh", background: "#f7f5f2" }}>
      <header
        style={{
          padding: "0.75rem 1.5rem",
          background: "#1a1330",
          color: "#f7f5f2",
          fontWeight: 600,
          letterSpacing: "0.02em",
        }}
      >
        Music Madras Studio
      </header>
      <main style={{ padding: "2rem" }}>{children}</main>
    </div>
  );
}
