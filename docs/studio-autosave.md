# Studio autosave: reliability and recovery (Phase 6J-10E)

Applies to the three autosave steps of the Recording workflow — **Source**, **Educational Content** and **SEO** —
which all use `app/(studio)/studio/_components/AutosaveStepForm.tsx`. The other steps (works, media, performance,
participants, relationships, review) are ordinary form posts and are not autosaved.

The server side (compare-and-swap, edit lock, typed refusals) is described in
[`recording-publication-safety.md`](recording-publication-safety.md) and is unchanged by this phase except for the
result shape below. Autosave never weakens it: a save is only ever a CAS write against the token the server last returned.

## Structure

| Piece | File | Notes |
|---|---|---|
| Lifecycle (serialization, token, retries, conflicts) | `modules/studio/autosave/autosaveController.ts` | framework-free; unit-tested with fake timers |
| Recovery store (scoping, parsing) | `modules/studio/autosave/autosaveRecovery.ts` | storage injected; unit-tested |
| Contract (result kinds, statuses, warning rule) | `modules/studio/autosave/autosaveTypes.ts` | shared by client and server |
| Server mapping of typed refusals | `app/(studio)/studio/_components/autosaveServer.ts` | used by the three step actions |
| React binding | `AutosaveStepForm.tsx` | renders the controller's snapshot; wires the browser |

Each page passes the form the draft it was rendered for: `recordingId`, `revisionId` (also bound into the action as
`expectedRevisionId`), the draft's `updatedAt` token, the signed-in user's id, and the step name.

## Server result

A step action returns `{ ok: true, updatedAt }` (the draft's new token, the only token the next save may use) or
`{ ok: false, kind, error }` with `kind` one of:

| kind | Cause | Client behavior |
|---|---|---|
| `CONFLICT` | stale token, or the page's revision is no longer the current draft (published / replaced) | stop; keep text; no automatic retry |
| `NOT_EDITABLE` | archived Recording, no open draft, not found | stop; keep text |
| `FORBIDDEN` | no session / no permission | stop; keep text |
| `BUSY` | the Recording's edit lock was not available within 5 s | automatic retry, then manual |

An exception thrown by the action (network failure, unexpected server error) is treated by the client as a transient
failure whose outcome is unknown. The messages never include database error text.

## Client behavior

- **One request in flight per form.** Edits made meanwhile are kept; when the response arrives, the next request
  carries the newest values and the token **returned by the previous response**. A response is applied to the values
  that were *sent*: the form reports "Saved" only when the current text equals the confirmed text.
- **Debounce** 1.2 s after the last keystroke. Rapid edits produce one request.
- **Transient failure** (thrown): automatic retries after 2 s, 5 s and 15 s with the *same* token and the newest
  values, then "Not saved … Retry now". Server **busy**: retries after 3 s and 8 s, then "Retry now". There is no
  further timer; a manual retry resets the budget. An edit during a backoff cancels the wait and is sent with the normal
  debounce (the retry budget is kept).
- **Never refreshed on a guess.** After a failure the token is not changed. If the failed request had actually been
  applied, the retry meets a stale token and the form shows the conflict state; on reload the stored text equals the
  server's and is discarded silently (it is confirmed).
- **Conflict / not editable / forbidden.** Saving stops. The fields stay editable, the text is kept and stored locally,
  and nothing is retried or overwritten. The form offers "Reload the latest version"; after the reload the stored text
  is offered back (below). The server's newer draft is never replaced automatically.
- **Status line:** *Unsaved changes…*, *Saving…*, *Saved*, *Could not save — retrying (attempt n of 3)*, *Not saved …
  Retry now*, busy (with the server's message), conflict, not editable, forbidden.
- **Leaving the page.** In-app navigation unmounts the form, which sends any pending edits (the request outlives the
  component). When the tab is hidden or the page is being hidden, a flush is attempted. The browser's "leave site?"
  prompt is registered **only while edits remain unconfirmed** (including while a request is in flight and in
  conflict states) and removed once everything is confirmed. A browser that is closing may cancel an in-flight request;
  delivery during browser termination is **not guaranteed** — the local recovery store is the safety net.

## Recovery after reload

Unsaved text is stored in `localStorage` whenever it differs from what the server confirmed, under the key
`mm.autosave.v1:<userId>:<recordingId>:<step>:<revisionId>` (parts URL-encoded). The entry holds only the text of the
step's own fields, the token it was based on and a time — no session, credentials or server data.

- It is removed only when the server confirms exactly that text, or when the editor chooses *Discard it* or
  *Restore my text* (which re-stores it under the current draft).
- On opening the step, entries for this user/Recording/step are looked up: the one for this revision, and any for
  *other* revisions of the same Recording and step. Entries identical to what the server holds are removed as
  confirmed. Anything else is **offered, never applied**: "same version", "typed against an older version (restoring
  replaces the saved text in these fields)", or "from a previous draft (since published or replaced)". The offer shows
  the stored text; while an offer for the current draft is unanswered the fields are read-only so typing cannot overwrite it.
- Another user, Recording or step never sees an entry.

## Limitations

- **Recovery is per browser.** `localStorage` is blocked in some privacy modes (autosave still works; reload recovery
  does not), is not shared across devices, and an entry for a draft that has no form to show (the Recording has no open
  draft, or is archived) stays stored until the editor next opens that step with a draft and resolves it. There is no
  time-based expiry by design. Shared computers: entries are scoped to the user id but not cleared on sign-out.
- **Browser close / crash** may lose an in-flight request; text typed after the last confirmed save is recovered from
  the local store only if the browser wrote it (it is written on every edit, synchronously).
- **No merge.** Conflicts are resolved by the editor choosing to restore their text over the saved version or to
  discard it; there is no field-level merge or diff.
- **Only these three steps** autosave; other steps remain ordinary posts (their stale-form refusals are covered in
  `recording-publication-safety.md`).
- **Props are read once per mount.** If a router refresh re-renders the page with a newer token while the form stays
  mounted, the form keeps its own token (the safe direction: its next save would be a conflict, not an overwrite).
- The React binding (effects, `localStorage`, event wiring) is covered by a server-render test and by typecheck/lint,
  not by an automated browser test; the lifecycle logic it delegates to is covered by deterministic unit tests.
