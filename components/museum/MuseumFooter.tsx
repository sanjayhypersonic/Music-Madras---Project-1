import Link from "next/link";
import { MUSEUM_NAV_LINKS, type MuseumNavLink } from "./museumNavigation";

// Phase 6J-1 — the Museum footer: the same real destinations as the header,
// plus the tagline (an editorial block, 6K-3 — not hard-coded). No About/Contact/Privacy PAGES are linked that do not
// exist (see museumNavigation.ts — Contact and Privacy wait on real copy).
export function MuseumFooter({ tagline, links = MUSEUM_NAV_LINKS }: { tagline: string | null; links?: readonly MuseumNavLink[] }) {
  return (
    <footer className="museum-footer">
      <nav aria-label="Footer">
        <ul className="museum-footer__nav">
          {links.map((link) => (
            <li key={link.href}>
              <Link href={link.href}>{link.label}</Link>
            </li>
          ))}
        </ul>
      </nav>
      {tagline && <p>{tagline}</p>}
    </footer>
  );
}
