-- Phase 6K lifecycle hardening, migration 5 of 5: the context a playlist page was published with.
--
-- The quality sweep re-checks a PUBLISHED page against its PUBLISHED snapshot, not against whatever is in the editable draft now. The snapshot already
-- carries the title, summary, body, search fields, members and (migration 3) member notes; this adds the texts of the human-supplied context that
-- stood behind the page when it was published, so "someone supplied real context" is judged on what was true at publication.
--
-- Additive: one nullable column, no existing row changes. A page published before this existed has NULL here; the sweep then does not judge its context
-- (it cannot know what stood behind it) rather than comparing it with a draft that may have moved on. Republishing records it.

-- AlterTable
ALTER TABLE "playlist_pages" ADD COLUMN     "publishedContextTexts" JSONB;
