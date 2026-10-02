// Phase 6J-1 — the Museum's public navigation, in ONE place so the desktop
// header, the mobile menu and the footer can never disagree, and no link can
// point at a page that does not exist. Every destination here is a real route
// or a real section of the homepage (#discover and #story are sections of
// app/(museum)/page.tsx). Contact and Privacy are deliberately absent: they
// are launch-content dependencies (the copy has to come from Music Madras),
// and a link to a page that does not exist is worse than no link.

export interface MuseumNavLink {
  href: string;
  label: string;
}

export const MUSEUM_NAV_LINKS: MuseumNavLink[] = [
  { href: "/archive", label: "Archive" },
  { href: "/collections", label: "Collections" },
  { href: "/learning", label: "Learning" },
  { href: "/#discover", label: "Discover" },
  { href: "/#story", label: "About" },
];
