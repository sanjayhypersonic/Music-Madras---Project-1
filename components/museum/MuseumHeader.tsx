import Image from "next/image";
import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";

// Phase 6G-2B — the Museum-wide header. The supplied official logo
// artwork is used as-is (no recolouring/redesign/cropping); it already
// carries the Music Madras wordmark, so no separate text label is added
// alongside it.
//
// Phase 6G-3 — now that app/(museum)/page.tsx is the real homepage, the
// brand is wrapped in a link to "/". Nav links point at anchors on that
// homepage (not separate routes) — those sections are real and always
// present; there is no browsable index/entity route to link to yet.
//
// Phase 6G-7 — "Archive" now points to the real /archive search/discovery
// route instead of the homepage's #archive taxonomy preview, giving every
// page a persistent path into the archive without adding a link to each
// page individually (brief §19: "do not clutter every page with
// duplicate Archive links").

const NAV_LINKS = [
  { href: "/archive", label: "Archive" },
  { href: "/#discover", label: "Discover" },
  { href: "/#story", label: "About" },
];

export function MuseumHeader() {
  return (
    <header className="museum-header">
      <Link href="/" className="museum-header__brand" aria-label="Music Madras — home">
        <Image
          src="/music-madras-logo.webp"
          alt="Music Madras — Live Classical Concerts, Chennai"
          width={44}
          height={44}
          className="museum-header__logo"
          priority
        />
      </Link>
      <nav className="museum-nav" aria-label="Primary">
        {NAV_LINKS.map((link) => (
          <Link key={link.href} href={link.href}>
            {link.label}
          </Link>
        ))}
      </nav>
      <ThemeToggle />
    </header>
  );
}
