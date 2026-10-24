-- Monitoring (project register R-15, unhandled server errors): a second operational-incident kind, recorded by the framework's error hook.
-- Additive only: one new value on an existing enum. No existing row changes; the previous release never writes the value, so it keeps working on this schema.
-- Applied only to the isolated loopback test database; never to production by anything in this repository.

-- AlterEnum
ALTER TYPE "OperationalIncidentKind" ADD VALUE 'UNHANDLED_SERVER_ERROR';
