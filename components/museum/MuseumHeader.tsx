import Image from "next/image";
import { ThemeToggle } from "./ThemeToggle";

// Phase 6G-2B — the Museum-wide header. The supplied official logo
// artwork is used as-is (no recolouring/redesign/cropping); it already
// carries the Music Madras wordmark, so no separate text label is added
// alongside it. Not wrapped in a link to "/" yet — the real homepage
// does not exist in this increment (explicitly out of scope), and
// linking to the unrelated Phase 1 placeholder root would be misleading.

export function MuseumHeader() {
  return (
    <header className="museum-header">
      <div className="museum-header__brand">
        <Image
          src="/music-madras-logo.webp"
          alt="Music Madras — Live Classical Concerts, Chennai"
          width={44}
          height={44}
          className="museum-header__logo"
          priority
        />
      </div>
      <ThemeToggle />
    </header>
  );
}
