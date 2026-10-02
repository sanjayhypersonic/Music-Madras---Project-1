import type { Metadata } from "next";
import { MuseumNotFound } from "../../components/museum/MuseumNotFound";

// Phase 6J-1 — rendered inside the Museum frame (header and footer) whenever a
// Museum page calls notFound(): an unknown slug, or an entity that is not
// public. noindex so a soft-404 can never be indexed.
export const metadata: Metadata = {
  title: "Page not found — Music Madras",
  robots: { index: false, follow: true },
};

export default function MuseumNotFoundPage() {
  return <MuseumNotFound />;
}
