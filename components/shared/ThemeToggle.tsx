"use client";

import { useEffect, useState } from "react";
import { THEME_STORAGE_KEY } from "./themeScript";

// Phase 6G-2B — persisted dark/light toggle (Museum; Phase 6J-3B: shared with Studio, which\n// reads the same preference, so a visitor/editor chooses a theme once). Reads/writes
// document.documentElement's data-theme attribute directly (set once,
// before paint, by the inline script in the Museum layout) rather than
// owning its own separate state source — this component only ever
// reflects and flips that single source of truth.

const STORAGE_KEY = THEME_STORAGE_KEY;

export function ThemeToggle({ className }: { className: string }) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  // Intentional exception to react-hooks/set-state-in-effect: the actual
  // theme is set on <html> by an inline script that runs before this
  // component hydrates (see components/shared/themeScript.ts), specifically so a
  // returning light-mode visitor never sees a flash of dark. That value
  // is only readable from the DOM, not knowable during SSR, so a
  // one-time post-mount read-and-correct is exactly what this case is
  // for — not a subscription to continuously-changing external state.
  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(current === "light" ? "light" : "dark");
  }, []);

  function toggle() {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private browsing / storage disabled — the toggle still works for this page view.
    }
    setTheme(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={className}
      aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
      title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
    >
      {theme === "light" ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      )}
    </button>
  );
}
