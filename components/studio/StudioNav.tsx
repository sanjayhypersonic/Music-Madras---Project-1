"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Phase 6J-3B — Studio's primary navigation. On wide screens it is a sticky
// sidebar; below 48rem (studio.css) the list collapses into a disclosure at the
// top of the content, so the navigation never consumes the viewport and the page
// content is always on screen (the old fixed two-column layout pushed it
// off-screen at 375px).
//
// Same pattern as the Museum's mobile menu: a real <button> with aria-expanded and
// aria-controls, a plain list of links after it in the DOM, a closed initial state
// that is identical on the server and the client, and it closes on Escape (focus
// returns to the button), on choosing a link, and on any navigation. The current
// page is marked with aria-current="page". The account block (name, role, sign-out
// form — a Server Action) is passed in as children so it stays a server component.

export interface StudioNavLink {
  href: string;
  label: string;
}

function isCurrent(pathname: string, href: string): boolean {
  // "/studio/catalogue" must not light up for "/studio/catalogue/videos" (it has its own entry).
  if (href === "/studio/catalogue") return pathname === href || (pathname.startsWith(`${href}/`) && !pathname.startsWith("/studio/catalogue/videos"));
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function StudioNav({ links, children }: { links: StudioNavLink[]; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);

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
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <aside className="studio-sidebar">
      <nav aria-label="Studio">
        <button
          ref={buttonRef}
          type="button"
          className="studio-nav__toggle"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
        >
          <span>Menu</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
        <div id={panelId} className="studio-nav__panel" data-open={open}>
          <ul className="studio-nav__list">
            {links.map((link) => (
              <li key={link.href}>
                <Link href={link.href} aria-current={isCurrent(pathname, link.href) ? "page" : undefined}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          {children}
        </div>
      </nav>
    </aside>
  );
}
