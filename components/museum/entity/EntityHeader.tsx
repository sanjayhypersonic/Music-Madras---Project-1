// Phase 6G-4B — reusable identity header for every future public entity
// page (brief §8): eyebrow (entity type), name, an optional lifespan
// subtitle, and an optional description. Renders gracefully with only a
// name — never invents a subtitle or description when the source model
// has none.

export interface EntityHeaderProps {
  eyebrow: string;
  name: string;
  /** A pre-formatted display string, e.g. "1685–1750" or "Baroque era" — formatting stays in the page, not here. */
  subtitle?: string | null;
  description?: string | null;
}

export function EntityHeader({ eyebrow, name, subtitle, description }: EntityHeaderProps) {
  return (
    <header className="museum-entity-header">
      <p className="museum-eyebrow">{eyebrow}</p>
      <h1>{name}</h1>
      {subtitle && <p className="museum-entity-header__subtitle">{subtitle}</p>}
      {description && <p className="museum-entity-header__description">{description}</p>}
    </header>
  );
}
