import type { Metadata } from "next";
import "./(museum)/museum.css";
import { MuseumShell } from "../components/museum/MuseumShell";
import { MuseumNotFound } from "../components/museum/MuseumNotFound";

// Phase 6J-1 — the site-wide 404 for any address that matches NO route at all
// (a mistyped path). Next renders this outside the (museum) route group, so it
// carries the Museum frame itself rather than showing the framework default.
export const metadata: Metadata = {
  title: "Page not found — Music Madras",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <MuseumShell>
      <MuseumNotFound />
    </MuseumShell>
  );
}
