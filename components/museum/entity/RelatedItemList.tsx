// Phase 6G-4B — a reusable, non-clickable presentation of a list of
// canonically related archive items (Works, Recordings, Collections)
// that don't have a public detail route yet (brief §4D: "do not create
// fake URLs... use non-clickable presentation"). Once a given entity type
// ships its own /[type]/[slug] route, its section switches to real
// <Link>s instead of reusing this component — this is a deliberately
// temporary, honest placeholder, not a permanent design decision.

export interface RelatedItem {
  id: string;
  title: string;
}

export function RelatedItemList({ items, asCards = false }: { items: RelatedItem[]; asCards?: boolean }) {
  return (
    <ul className={asCards ? "museum-category-grid" : "museum-related-list"}>
      {items.map((item) =>
        asCards ? (
          <li key={item.id} className="museum-category-card">
            <h3>{item.title}</h3>
          </li>
        ) : (
          <li key={item.id}>{item.title}</li>
        )
      )}
    </ul>
  );
}
