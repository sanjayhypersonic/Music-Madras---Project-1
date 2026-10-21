import type { Metadata } from "next";
import "./(museum)/museum.css";
import { MuseumShell } from "../components/museum/MuseumShell";
import { MuseumNotFound } from "../components/museum/MuseumNotFound";

// Phase 6J-1 — the site-wide 404 for any address that matches NO route at all
// (a mistyped path). Next renders this outside the (museum) route group, so it
// carries the Museum frame itself rather than showing the framework default.
//
// Phase 6K fix (F8): it uses the STATIC frame, which touches no database. Anything on the internet can request an address that does not exist, so
// answering that must cost the database nothing.
export const metadata: Metadata = {
  title: "Page not found — Music Madras",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <MuseumShell chrome="static">
      <MuseumNotFound />
    </MuseumShell>
  );
}
