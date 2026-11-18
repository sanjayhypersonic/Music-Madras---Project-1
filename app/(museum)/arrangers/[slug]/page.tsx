import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSiteOrigin } from "../../../../modules/config/siteOrigin";
import { getPersonPageData } from "../../../../modules/db/repositories/personPageRepository";
import { findPublishedEntityPageCopy } from "../../../../modules/db/repositories/pipelineRepository";
import { PersonOrEnsemblePage } from "../../../../components/museum/entity/PersonOrEnsemblePage";

// R-34: the public /arrangers/[slug] page. A person seen through one role (arranger): only a person with an arranger credit on a public work has this page; their full page is /people/[slug]. Public only while a published Recording reaches the person (personPageRepository.ts).

const SITE_ORIGIN = getSiteOrigin();

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const person = await getPersonPageData(slug, "ARRANGER");
  if (!person) return {};
  const copy = await findPublishedEntityPageCopy("PERSON", person.id);
  const title = copy?.seoTitle ?? `${person.name} — Music Madras`;
  const description = copy?.metaDescription ?? person.biography ?? `${person.name} in the Music Madras archive.`;
  return { metadataBase: new URL(SITE_ORIGIN), title, description, alternates: { canonical: `/people/${person.slug}` }, openGraph: { title, description, type: "profile" } };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const person = await getPersonPageData(slug, "ARRANGER");
  if (!person) notFound();
  return <PersonOrEnsemblePage kind="PERSON" eyebrow="Arranger" section="Arrangers" id={person.id} name={person.name} description={person.biography} roles={person.roles} contributions={person.contributions} related={person.related} />;
}
