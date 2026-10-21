"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MUSEUM_NAV_LINKS, type MuseumNavLink } from "./museumNavigation";

// Phase 6J-1 — the primary navigation on narrow screens. Below 40rem the
// desktop nav is hidden (museum.css); without this the header was only a logo
// and a theme toggle, leaving Archive/Collections/Learning/Discover/About
// unreachable on a phone.
//
// A disclosure pattern (not a modal): a real <button> with aria-expanded and
// aria-controls, a plain list of links after it in the DOM (so Tab walks into
// them naturally), and a closed initial state that is identical on the server
// and the client (no hydration mismatch). It closes on Escape (returning focus
// to the button), on choosing a link, on a navigation, and on a click outside.

export function MobileNav({ links = MUSEUM_NAV_LINKS }: { links?: readonly MuseumNavLink[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close whenever the route changes (e.g. after following a link).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting UI state in response to a navigation, not deriving it
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  return (
    <div ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="museum-mobile-nav-button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((value) => !value)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      <nav id={panelId} className="museum-mobile-nav" data-open={open} aria-label="Primary (mobile)">
        <ul>
          {links.map((link) => (
            <li key={link.href}>
              <Link href={link.href} onClick={() => setOpen(false)}>
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
