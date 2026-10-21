-- Phase 6K lifecycle hardening, migration 6 of 6: a stewardship step that completed only part of its work.
--
-- A step that processed some batches and failed others did real work and must not be reported as either a success or a total failure. The step status
-- gains PARTIAL for exactly that. Additive: one enum value, no data change. (PostgreSQL does not allow using a new enum value in the transaction that adds
-- it, so nothing here uses it.)

-- AlterEnum
ALTER TYPE "StewardshipStepStatus" ADD VALUE IF NOT EXISTS 'PARTIAL';
