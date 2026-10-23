import Image from "next/image";
import Link from "next/link";
import { ThemeToggle } from "../shared/ThemeToggle";
import { MobileNav } from "./MobileNav";
import { MUSEUM_NAV_LINKS, type MuseumNavLink } from "./museumNavigation";
import { SEARCH_MAX_LENGTH } from "../../modules/mmke/search/searchText";

// Phase 6G-2B — the Museum-wide header. The supplied official logo
// artwork is used as-is (no recolouring/redesign/cropping); it already
// carries the Music Madras wordmark, so no separate text label is added
// alongside it.
//
// Phase 6G-3 — the brand is wrapped in a link to "/". Phase 6G-7 — "Archive"
// points to the real /archive search/discovery route.
//
// Phase 6J-1 — the navigation list lives in museumNavigation.ts (shared with the
// mobile menu and the footer), now includes Collections and Learning, and on
// narrow screens the desktop nav is replaced by MobileNav instead of vanishing.

export function MuseumHeader({ links = MUSEUM_NAV_LINKS }: { links?: readonly MuseumNavLink[] }) {
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
        {links.map((link) => (
          <Link key={link.href} href={link.href}>
            {link.label}
          </Link>
        ))}
      </nav>
      {/* The Museum-wide search entry: a plain GET form to /archive (no client script), so it works everywhere, is keyboard- and screen-reader-friendly,
          and never queries on a keystroke. The input is bounded to the same length the server enforces. */}
      <form method="get" action="/archive" role="search" className="museum-header__search">
        <label htmlFor="museum-header-search" className="museum-visually-hidden">
          Search the archive
        </label>
        <input
          id="museum-header-search"
          className="museum-search-input"
          type="search"
          name="q"
          placeholder="Search archive"
          maxLength={SEARCH_MAX_LENGTH}
          autoComplete="off"
          enterKeyHint="search"
        />
        <button type="submit" className="museum-button museum-header__search-button">
          Search
        </button>
      </form>
      <div className="museum-header__actions">
        <MobileNav links={links} />
        <ThemeToggle className="museum-theme-toggle" />
      </div>
    </header>
  );
}
