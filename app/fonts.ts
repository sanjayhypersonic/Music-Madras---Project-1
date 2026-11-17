import { Inter, Noto_Sans_Tamil, Noto_Serif_Tamil, Playfair_Display } from "next/font/google";

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

// Tamil (credits pipeline, 2026-11-17): original-script titles such as "பாலன் பிறந்த ராவில்" are the title of record
// (docs/content-editorial-standard.md section 5), and Playfair Display and Inter have no Tamil glyphs. These faces are
// listed AFTER the Latin ones in museum.css, so Latin text renders exactly as before and the browser falls back to them
// only for Tamil characters. Tamil subset only, and not preloaded: the @font-face unicode-range means a page downloads
// them only when it actually shows Tamil text.
export const tamilSerifFont = Noto_Serif_Tamil({
  subsets: ["tamil"],
  weight: ["400", "600", "700"],
  variable: "--mm-font-tamil-serif",
  display: "swap",
  preload: false,
});

export const tamilSansFont = Noto_Sans_Tamil({
  subsets: ["tamil"],
  weight: ["400", "500", "600", "700"],
  variable: "--mm-font-tamil-sans",
  display: "swap",
  preload: false,
});
