import type { ReactNode } from "react";
import { sansFont, serifFont } from "../../app/fonts";
import { THEME_INIT_SCRIPT } from "../shared/themeScript";
import { MuseumHeader } from "./MuseumHeader";
import { MuseumFooter } from "./MuseumFooter";
import { MUSEUM_NAV_LINKS, visibleNavLinks } from "./museumNavigation";
import { STATIC_CHROME, getMuseumChrome } from "../../modules/mmke/chrome/museumChrome";

// Phase 6J-1 — the Museum page frame (theme script, header, <main>, footer),
// extracted from app/(museum)/layout.tsx so the same frame also wraps the
// site-wide not-found page (app/not-found.tsx), which Next renders OUTSIDE the
// (museum) route group for URLs that match no route at all. The stylesheet is
// still imported by each file that renders this (layout and not-found), so
// Studio never loads it.
//
// Dark is the default: tokens.css's :root already holds the dark values. The
// inline script only CORRECTS that for a returning visitor who chose light,
// synchronously and before this content paints (see ThemeToggle).

// Phase 6K-3 — a "Skip to content" link as the first focusable element (WCAG 2.2 SC 2.4.1, technique G1) and a focusable <main>.
//
// Phase 6K fix (F8) — the optional parts of the frame (the footer tagline, and the About / Playlists links that appear only while their destination
// exists) come from modules/mmke/chrome/museumChrome.ts: at most two small queries, remembered briefly and shared between concurrent requests, never
// breaking the page if they fail. `chrome="static"` renders the frame with NO database access at all; the site-wide 404 for addresses that match no
// route uses it, so scanning for random URLs cannot make the database work.
export async function MuseumShell({ children, chrome = "dynamic" }: { children: ReactNode; chrome?: "dynamic" | "static" }) {
  const { tagline, availableContent } = chrome === "static" ? STATIC_CHROME : await getMuseumChrome();
  const links = visibleNavLinks(MUSEUM_NAV_LINKS, availableContent);
  return (
    <div className={`museum-root ${serifFont.variable} ${sansFont.variable}`}>
      <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      <a href="#main-content" className="museum-skip-link">
        Skip to content
      </a>
      <MuseumHeader links={links} />
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
      <MuseumFooter tagline={tagline} links={links} />
    </div>
  );
}
