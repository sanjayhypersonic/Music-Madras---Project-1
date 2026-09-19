# modules/mmke/entities — deliberately not centralized yet

The canonical entity *shapes* live in `prisma/schema.prisma` — that is the one source of truth (see the schema file's header comment). Pure domain functions that need a framework-agnostic view of an entity (e.g. `modules/mmke/completeness/checkRecordingRevisionCompleteness.ts`, `modules/publishing/revisionTransitions.ts`) currently declare their own minimal input types inline, mapped from Prisma results by their caller in `modules/db`.

A shared `entities/` layer of plain domain types is a reasonable future step once enough pure-domain modules exist to show what's actually common between them — introducing it now, with only two such modules written, would be speculative abstraction ahead of a real need.
