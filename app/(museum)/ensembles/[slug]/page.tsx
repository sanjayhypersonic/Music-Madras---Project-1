import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSiteOrigin } from "../../../../modules/config/siteOrigin";
import { getEnsemblePageData } from "../../../../modules/db/repositories/personPageRepository";
import { findPublishedEntityPageCopy } from "../../../../modules/db/repositories/pipelineRepository";
import { PersonOrEnsemblePage } from "../../../../components/museum/entity/PersonOrEnsemblePage";

// R-34: the public /ensembles/[slug] page (orchestras and instrumental groups; choirs keep /choirs). Public only while a published Recording
// reaches the ensemble (personPageRepository.ts).

const SITE_ORIGIN = getSiteOrigin();

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const ensemble = await getEnsemblePageData(slug);
  if (!ensemble) return {};
  const copy = await findPublishedEntityPageCopy("ENSEMBLE", ensemble.id);
  const title = copy?.seoTitle ?? `${ensemble.name} — Music Madras`;
  const description = copy?.metaDescription ?? ensemble.description ?? `${ensemble.name} in the Music Madras archive.`;
  return { metadataBase: new URL(SITE_ORIGIN), title, description, alternates: { canonical: `/ensembles/${ensemble.slug}` }, openGraph: { title, description } };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ensemble = await getEnsemblePageData(slug);
  if (!ensemble) notFound();
  return <PersonOrEnsemblePage kind="ENSEMBLE" eyebrow="Ensemble" section="Ensembles" id={ensemble.id} name={ensemble.name} description={ensemble.description} related={ensemble.related} />;
}
