import type { ReactNode } from "react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import "./studio.css";
import { sansFont } from "../../fonts";
import { ThemeToggle } from "../../../components/shared/ThemeToggle";
import { THEME_INIT_SCRIPT } from "../../../components/shared/themeScript";

// Phase 6J-1: Studio pages used to inherit the root's placeholder title
// ("Production Foundation") and were indexable in principle. They now carry the
// Studio's own title and a noindex/nofollow instruction (robots.txt already
// disallows /studio; this is the page-level second layer).
export const metadata: Metadata = {
  title: { default: "Music Madras Studio", template: "%s · Music Madras Studio" },
  description: "Music Madras Studio — the editorial workspace for the Music Madras archive.",
  robots: { index: false, follow: false },
};

// Shared shell for every Studio route, authenticated or not (sign-in,
// invite acceptance, and password reset all render inside this too). The
// authentication + account-status gate itself lives one level deeper, in
// (protected)/layout.tsx — this file must NOT redirect, since it also
// wraps the sign-in page a logged-out user is trying to reach.
//
// Phase 6J-3B: the shell carries the official logo (unmodified), the shared
// semantic tokens (dark default, light via the same stored preference as the
// public site), Inter, and a header that works at any width. The sidebar and its
// mobile disclosure live in the protected layout (StudioNav).
export default function StudioLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`studio-root ${sansFont.variable}`}>
      <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      <header className="studio-header">
        <Link href="/studio/dashboard" className="studio-header__brand" aria-label="Music Madras Studio — dashboard">
          <Image src="/music-madras-logo.webp" alt="Music Madras" width={36} height={36} className="studio-header__logo" priority />
          <span className="studio-header__label">Studio</span>
        </Link>
        <span className="studio-header__spacer" />
        <ThemeToggle className="studio-icon-button" />
      </header>
      <main className="studio-main">{children}</main>
    </div>
  );
}