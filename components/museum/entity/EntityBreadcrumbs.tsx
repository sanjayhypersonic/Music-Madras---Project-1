import Link from "next/link";

// Phase 6G-4B — reusable breadcrumb trail for every future public entity
// page (brief §8). Only ever links to routes that actually exist; a crumb
// with no `href` (e.g. "Composers", since there is no /composers index
// route yet) renders as plain text, never a fake link.

export interface EntityBreadcrumbItem {
  label: string;
  href?: string;
}

export function EntityBreadcrumbs({ items }: { items: EntityBreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" className="museum-breadcrumbs">
      <ol>
        {items.map((item, index) => {
          const isCurrent = index === items.length - 1;
          return (
            <li key={item.label}>
              {item.href && !isCurrent ? (
                <Link href={item.href}>{item.label}</Link>
              ) : (
                <span aria-current={isCurrent ? "page" : undefined}>{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
