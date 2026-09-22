import { Inter, Playfair_Display } from "next/font/google";

// Phase 6G-2B — the Museum's editorial typography pairing (design
// direction: Playfair Display for headings, Inter for body text),
// self-hosted via next/font so there is no external Google Fonts request
// and no layout shift. Scoped to app/(museum)/** only — Studio keeps its
// own plain system-font styling untouched.

export const museumSerif = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--mm-font-serif",
  display: "swap",
});

export const museumSans = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--mm-font-sans",
  display: "swap",
});
