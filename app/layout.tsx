import type { Metadata } from "next";
import "./tokens.css"; // shared semantic design tokens (Phase 6J-3A): the Museum consumes them today; Studio adopts them in a later phase
import { getSiteOrigin } from "../modules/config/siteOrigin";

// Phase 6G-11 — site-wide favicon/OpenGraph fallback using the existing
// official logo asset (no new branding asset created). Applies everywhere
// via the root layout; every Museum page already sets its own
// `openGraph` object (which shallow-replaces this one per Next's metadata
// merge rules), so this image is the fallback for any route — chiefly
// Studio — that doesn't define its own. metadataBase is required here too
// (same AUTH_URL convention every Museum page's own generateMetadata
// already uses) so the relative image path resolves to a real production
// URL instead of silently defaulting to localhost.
export const metadata: Metadata = {
  metadataBase: new URL(getSiteOrigin()),
  // Phase 6J-1: the default for any page that sets no title of its own is simply the brand
  // (the old "Production Foundation" text leaked into every Studio tab and into link previews).
  // Museum pages set their own; Studio sets its own in app/(studio)/studio/layout.tsx.
  title: "Music Madras",
  description: "Music Madras is a digital archive of Western Classical music in Chennai — its composers, performers, choirs, conductors, venues and recordings.",
  icons: {
    icon: "/music-madras-logo.webp",
  },
  openGraph: {
    images: ["/music-madras-logo.webp"],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: the Museum layout's pre-paint script
    // (app/(museum)/layout.tsx) sets data-theme on this element before
    // React hydrates, for a returning light-mode visitor. That's an
    // intentional, expected mismatch — Studio never reads or sets this
    // attribute, so this has no effect on Studio's own rendering.
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
