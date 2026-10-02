import type { ReactNode } from "react";
import "./museum.css";
import { MuseumShell } from "../../components/museum/MuseumShell";

// Phase 6G-2B — the Museum-wide design-system root. Dark is the default;
// museum.css is only ever loaded by routes that render this layout (or the
// site-wide not-found page), and Studio never does.
//
// Phase 6J-1 — the frame itself (theme script, header, <main>, footer) now lives
// in components/museum/MuseumShell so the not-found page can share it.

export default function MuseumLayout({ children }: { children: ReactNode }) {
  return <MuseumShell>{children}</MuseumShell>;
}
