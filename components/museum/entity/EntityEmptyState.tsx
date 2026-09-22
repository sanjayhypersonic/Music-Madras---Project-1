// Phase 6G-4B — the reusable "nothing here yet" message for a section
// with a genuinely empty relationship set (brief §8). Deliberately just
// text, never a fabricated placeholder card.

export function EntityEmptyState({ children }: { children: string }) {
  return <p className="museum-empty-state">{children}</p>;
}
