import Link from "next/link";

const ENTITY_LINKS = [
  { href: "/studio/catalogue/composers", label: "Composers" },
  { href: "/studio/catalogue/works", label: "Musical Works" },
  { href: "/studio/catalogue/artists", label: "Artists" },
  { href: "/studio/catalogue/choirs", label: "Choirs" },
  { href: "/studio/catalogue/conductors", label: "Conductors" },
  { href: "/studio/catalogue/programmes", label: "Programmes" },
  { href: "/studio/catalogue/venues", label: "Venues / Churches" },
  { href: "/studio/catalogue/organisations", label: "Organisations" },
  { href: "/studio/catalogue/performances", label: "Performances" },
  { href: "/studio/catalogue/collections", label: "Collections" },
  { href: "/studio/catalogue/occasions", label: "Occasions" },
  { href: "/studio/catalogue/learning-guides", label: "Learning Guides" },
  { href: "/studio/catalogue/sources", label: "Sources" },
  { href: "/studio/catalogue/rights", label: "Rights Information" },
  { href: "/studio/catalogue/site-content", label: "Site content (homepage, footer, SEO)" },
  { href: "/studio/catalogue/unlisted-review", label: "Unlisted videos awaiting a decision" },
  { href: "/studio/catalogue/featured", label: "Featured videos" },
  { href: "/studio/catalogue/playlists", label: "Playlist pages" },
];

export default function CataloguePage() {
  return (
    <div>
      <h1>Catalogue</h1>
      <ul>
        {ENTITY_LINKS.map((link) => (
          <li key={link.href}>
            <Link href={link.href}>{link.label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
