import type { ReactNode } from "react";
import { sansFont, serifFont } from "../../app/fonts";
import { THEME_INIT_SCRIPT } from "../shared/themeScript";
import { MuseumHeader } from "./MuseumHeader";
import { MuseumFooter } from "./MuseumFooter";

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

export function MuseumShell({ children }: { children: ReactNode }) {
  return (
    <div className={`museum-root ${serifFont.variable} ${sansFont.variable}`}>
      <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      <MuseumHeader />
      <main>{children}</main>
      <MuseumFooter />
    </div>
  );
}
