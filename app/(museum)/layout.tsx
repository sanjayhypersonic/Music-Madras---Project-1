import type { ReactNode } from "react";
import "./museum.css";
import { museumSans, museumSerif } from "./fonts";
import { MuseumHeader } from "../../components/museum/MuseumHeader";

// Phase 6G-2B — the Museum-wide design-system root. Dark is the default:
// the CSS's :root (no [data-theme] attribute) already holds the dark
// values, so a first-time visitor gets dark with zero client-side logic
// required. The inline script below only ever has to CORRECT that
// default for a returning visitor who previously chose light — it reads
// localStorage and sets data-theme on <html> synchronously, before this
// layout's own styled content paints, which is what avoids a
// flash-of-wrong-theme for that one case. It cannot run any earlier than
// this (Studio's shared root layout must stay theme-agnostic), which is
// an accepted, standard trade-off for a nested route group.
//
// No Studio file is touched by this — museum.css is only ever loaded by
// routes that render this layout, and Studio never does.

const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = window.localStorage.getItem("musicmadras-theme");
    if (stored === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    }
  } catch (e) {}
})();
`;

export default function MuseumLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`museum-root ${museumSerif.variable} ${museumSans.variable}`}>
      <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      <MuseumHeader />
      <main>{children}</main>
      <footer className="museum-footer">Music Madras — Music. People. Heritage. Chennai.</footer>
    </div>
  );
}
