import { Inter, Playfair_Display } from "next/font/google";

// The typography pairing shared by the Museum and Studio (Phase 6G-2B; moved to app/
// in 6J-3B so Studio can use Inter): Playfair Display for Museum editorial headings,
// Inter for navigation, metadata, forms, tables and all of Studio. Self-hosted via
// next/font (no external request, no layout shift). Each shell applies the
// `.variable` classes to its own root element, so a route only loads what it uses.
export const serifFont = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--mm-font-serif",
  display: "swap",
});

export const sansFont = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--mm-font-sans",
  display: "swap",
});
