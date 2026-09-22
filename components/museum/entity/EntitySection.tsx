import type { ReactNode } from "react";

// Phase 6G-4B — the reusable heading+landmark wrapper every entity-page
// section uses (brief §8), matching the exact <section>/<h2 id=...>
// pattern already established on the homepage (Phase 6G-3), just
// extracted once it needed to repeat across entity pages too.

export interface EntitySectionProps {
  id: string;
  heading: string;
  intro?: string;
  children: ReactNode;
}

export function EntitySection({ id, heading, intro, children }: EntitySectionProps) {
  const headingId = `${id}-heading`;
  return (
    <section id={id} className="museum-section" aria-labelledby={headingId}>
      <h2 id={headingId}>{heading}</h2>
      {intro && <p className="museum-section__intro">{intro}</p>}
      {children}
    </section>
  );
}
