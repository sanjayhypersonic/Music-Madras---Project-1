import type { Metadata } from "next";

const SITE_ORIGIN = process.env.AUTH_URL ?? "http://localhost:3000";

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
  metadataBase: new URL(SITE_ORIGIN),
  title: "Music Madras — Production Foundation",
  description: "Production application foundation, including the Studio content-management app. Not the public Museum site.",
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
