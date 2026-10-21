// Phase 6J-1 (Videos added in 6K-3) — the Museum's public navigation, in ONE place so the desktop
// header, the mobile menu and the footer can never disagree, and no link can
// point at a page that does not exist. Every destination here is a real route
// or a real section of the homepage (#discover and #story are sections of
// app/(museum)/page.tsx). Contact and Privacy are deliberately absent: they
// are launch-content dependencies (the copy has to come from Music Madras),
// and a link to a page that does not exist is worse than no link.

export interface MuseumNavLink {
  href: string;
  label: string;
  /** What must exist for this link to have a destination: an editorial block that renders (an anchor on the homepage) or published content ("playlists"). The link is shown only while it does (no dead links or anchors). */
  requiresContent?: string;
}

export const MUSEUM_NAV_LINKS: MuseumNavLink[] = [
  { href: "/archive", label: "Archive" },
  { href: "/videos", label: "Videos" },
  { href: "/playlists", label: "Playlists", requiresContent: "playlists" },
  { href: "/collections", label: "Collections" },
  { href: "/learning", label: "Learning" },
  { href: "/#discover", label: "Discover" },
  { href: "/#story", label: "About", requiresContent: "museum-home-story" },
];

/** The links whose targets exist right now: a link that needs content is dropped while that content is not on the site. */
export function visibleNavLinks(links: readonly MuseumNavLink[], availableContent: ReadonlySet<string>): MuseumNavLink[] {
  return links.filter((link) => !link.requiresContent || availableContent.has(link.requiresContent));
}