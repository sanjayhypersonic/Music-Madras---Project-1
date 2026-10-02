import Link from "next/link";
import { MUSEUM_NAV_LINKS } from "./museumNavigation";

// Phase 6J-1 — the Museum footer: the same real destinations as the header,
// plus the brand line. No About/Contact/Privacy PAGES are linked that do not
// exist (see museumNavigation.ts — Contact and Privacy wait on real copy).
export function MuseumFooter() {
  return (
    <footer className="museum-footer">
      <nav aria-label="Footer">
        <ul className="museum-footer__nav">
          {MUSEUM_NAV_LINKS.map((link) => (
            <li key={link.href}>
              <Link href={link.href}>{link.label}</Link>
            </li>
          ))}
        </ul>
      </nav>
      <p>Music Madras — Music. People. Heritage. Chennai.</p>
    </footer>
  );
}
