-- Manual, entity-first pipeline mode (project register R-34, docs/upload-pipeline.md section 9). WRITTEN, NOT APPLIED (2026-11-20).
-- Additive and relaxing only: pipeline_claims.pipelineVideoId becomes nullable (an entity-first research claim belongs to an entity, not to
-- one video), and both tables gain a provenance column with a default. No column is dropped, no row is rewritten, and
-- 20261118100000_upload_pipeline is left exactly as committed. Generated with `prisma migrate diff` from the committed schema to the new one.
-- Apply only through the guarded procedure (docs/runbooks/upload-pipeline-staging-checklist.md, Part A).

-- AlterTable
ALTER TABLE "pipeline_claims" ADD COLUMN     "provenance" TEXT NOT NULL DEFAULT 'api',
ALTER COLUMN "pipelineVideoId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "entity_page_copies" ADD COLUMN     "provenance" TEXT NOT NULL DEFAULT 'template';
