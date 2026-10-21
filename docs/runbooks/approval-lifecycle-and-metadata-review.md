# Approval lifecycle and metadata review — what Studio does and why

For editors and administrators. The rules below are enforced in code (`modules/mmke/catalogue/videoLifecycle.ts`, `metadataFingerprint.ts`) and described for decision-makers in ADR-0002 §11. Nothing here changes anything on YouTube.

## Why an approval can end by itself

An approval says "this unlisted video's Music Madras page may be public." It was given for the video *as it was*. Two things change that, and one thing does not:

| What happens | What happens to the approval | Why |
|---|---|---|
| The video **stays unlisted** (its title, description or thumbnail change, views change) | **Nothing.** It stays approved and public. | Unlisted is the situation the approval was given for. |
| The video becomes **private** on YouTube | **Ends** (page, listing and playlist approvals), the moment the change is saved. It does not come back when the video is unlisted again: a person must approve it afresh. | A private video is one its owner withdrew from sharing. Re-exposing it automatically because it later flips back would override that. |
| The page is **archived** | **Ends.** Restoring the page does not bring it back; approve it afresh after restoring. An archived page cannot be approved. | Archiving is a decision to take the page out of service. |
| The video **cannot be seen** by a sync (an incomplete sync, a failed sync, a video missing from one pass) | **Nothing.** The page is hidden while the video is unobserved (the normal visibility rule), and comes back with the same approval when the video is seen again. | Not being seen is not the same as being private; a failed or partial sync must never take a page down permanently. |
| YouTube reports the video **unavailable or deleted** | **Nothing is revoked.** The page is hidden for as long as the video is unavailable (public and unlisted videos alike), so it never appears as available content. If the video is seen again, the page returns only if everything else still allows it: not private, page not archived, still approved, published, and no hold. | Only *private* and *archived* are authorised to end an approval permanently. Unavailable or deleted is a fact about YouTube, not a decision about the page; if the page should come down, unpublish or archive it (archiving does end the approval). |
| The page is **unpublished** | **Nothing.** | That is your own act and is reversible by publishing. |

Every ending is recorded: who or what ended it (a person, or the platform), why (`private`, `archived`, a decision, a hold…), and when. (Older history may show a retired reason, "unavailable"; no new ending uses it.) The history on the video's Studio page shows it, and the audit log has an entry.

## The four things Studio can say about a page's approval

- **Approved** — public, and nothing waits for review.
- **Approved — metadata review pending** — public, but the video's details changed after they were reviewed (see below). Look at the change and confirm it.
- **Approval revoked — video private or page archived** — it ended automatically and is still in that situation. Not public.
- **Awaiting fresh approval** — it ended automatically, the video is unlisted / the page restored again, and nothing is public until someone approves. The video is back in the *Unlisted videos* queue.

(A video whose approval a person withdrew, or that was never approved, is just *not approved*.)

## Metadata review: what counts as a change

An approved page stays public while its video's details change, but you are asked to look. These count:

- the **title**, the **description** (line endings, extra spaces and trailing spaces are ignored)
- the **thumbnail** (its address; a changed "?v=123" tail on the same picture is ignored)
- the **length** (a different cut of the recording), the **published date**, whether the video can be **embedded**, and the **channel**

These never count: view, like and comment numbers, technical identifiers, playlist order.

What happens: the change is recorded once per page (further changes while it waits update the same entry; a change back to what you reviewed clears it), a notification appears, and the page's panel shows what changed. Press **"I have reviewed this change"** to record that you looked. That marks the *new* details as reviewed. It does not edit anything and does not alter the approval. If the video goes private or the page is archived while a review is waiting, the review is closed with the approval.

For pages approved before this existed, the first time the system looks it records the current details as the starting point. That is logged as a baseline, not as a reviewed change.

## Holds, and what clearing one does

A rights, copyright or privacy hold hides a video everywhere, whatever else is approved. **Clearing a hold approves nothing.** An unlisted video stays off the public site until someone approves it afresh; a public video whose page is published is visible again immediately (public videos need no approval). The history records "Hold recorded" and "Hold cleared" as their own events.

## Who can do what

Approving, revoking, holding, reviewing metadata and deciding the queue need the publishing permission: Administrators, Super Administrators and Founders. Editors and Reviewers can see the queue and prepare pages.

## What approving actually exposes

Approving an unlisted video's page makes the **Music Madras page** public. That page shows the video's embedded player and a link to its YouTube address, so anyone who can open the page can find the unlisted video. The video stays unlisted on YouTube and nothing is changed there. Listing (catalogue, search, sitemap, homepage, featured, related videos) and inclusion in a playlist page are separate approvals.
