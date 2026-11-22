# Content editorial standard (credits, titles, descriptions)

Status: Phase B0 (editorial learning), 2026-11-17. This standard describes how Music Madras names, credits and describes a recording, so that people, the credit checker (`npm run ai:video-credits-check`) and any later AI assistance follow the same rules. It was written from the editor's decisions on five videos (recorded in `tests/fixtures/videoCreditsReference.json`) and from reading their rewritten YouTube descriptions. It does not change the catalogue. Since Phase B2, `npm run ai:video-credits-describe` drafts descriptions from approved facts with a fixed template in the structure of section 7; the drafts go to an editor and never replace YouTube text (`docs/video-credits-review-and-approval.md` section 7).

## 1. Titles

One recording can carry several titles. Keep them apart; never let one overwrite another.

| Title | What it is | Example | Where it lives today |
|---|---|---|---|
| YouTube title | The video's title on YouTube. Written for search, often packed with names separated by `\|`. Evidence for nothing but itself; may contain errors. | "Come Now, Child of Promise \| Nicole Elsey \| BHC Choir \| … \| Bishop Heber Capel" | `YouTubeVideo.title` (synced, YouTube-controlled) |
| Recording title | Music Madras' own name for the recording. Normally the work's title; for a medley, the medley's name. | "Christmas Carol Medley" | `RecordingRevision.title` |
| Performance title | The title the performers used on the day. Usually the same as the work title. | "Come Now, Child of Promise" | no separate field (see section 8) |
| Work title | The musical work's canonical title. | "Ding Dong! Merrily on High" | `MusicalWork.title` |
| Published / catalogue title | The title under which the work is published or catalogued, when it differs. | "Long-Awaited One" | no field |
| Subtitle | A second title of the **same** work, shown with it. Never a second work. | "Magnificat" for *Blagoslovi Dushe Moya Gospoda* | no field (`alternateTitles` would lose the meaning) |
| Alternate title | Another established name or spelling of the work. | "Dingiri Dingale", "Dingiri Dingaale" | `MusicalWork.alternateTitles` |
| Original-language title | The title in its own script. When it exists, it **is** the title. | "பாலன் பிறந்த ராவில்" | `MusicalWork.title` + `MusicalWork.language` |
| Transliteration | The original-language title written in Latin letters. Always an addition, never a replacement. | "Paalan Pirandha Raavil" | `MusicalWork.alternateTitles` (no way to mark it as the transliteration) |

## 2. Roles

| Role | Who | Not to be confused with |
|---|---|---|
| Composer | Wrote the music of a work. "Words and music by X" makes X both composer and lyricist. | The original performer of a song, or an arranger. |
| Lyricist | Wrote the words. "Words:", "Text:", "Lyrics:". | A translator (see below) or the source of a text ("based on John 1"). |
| Translator | Translated an existing text ("English translation: Gerard Moultrie"). | Lyricist. No role in the catalogue yet. |
| Arranger | Arranged an existing work for these forces ("Arrangement:", "Arranged by"). | Composer. When the text says "Composition & Choral Arrangement: X", X is both. |
| Conductor | Led the performance: "Conductor:", "conducted by", "under the direction of", or (editor-supplied) "the choir was led by". | Anyone the title merely lists. |
| Choir | A vocal ensemble. | The church or college it belongs to. |
| Ensemble | An orchestra or instrumental group. | A choir. A group labelled "Ensemble" but described as choral is a choir. |
| Performer | A named individual soloist, organist, pianist or singer. | A "Lead" (a role the catalogue does not have yet). |
| Original performer | The artist a cover is associated with ("Moving Up to Gloryland by Gaither Vocal Band", title "… Cover"). | Composer. A cover's original artist is **never** its composer. |
| Presenter | Who recorded and presented the video ("Recorded and presented by: Music Madras"). | Any musical credit. |

A name in a YouTube title with no stated role gets **no** credit. Hashtags are never evidence.

## 3. Labelled lines versus prose

The same fact often appears twice: in a sentence ("Performed by the Bishop Heber Chapel Choir, Madras Christian College, on 12 December 2025 … conducted by Jacob George.") and in a labelled line ("Conductor: Jacob George"). Both are evidence; read both. When they disagree, neither wins automatically: record a conflict for the editor (for example, a prose "arranged by Samuel Joseph" against a labelled "Arrangement: Dr. Faith Ragland Song"). When the title and the description disagree, the description is preferred as the more careful text, but the disagreement is still recorded.

## 4. Performance context: venue versus institution

- **Venue** is the place the performance happened: "Bishop Heber Chapel", "TELC Arulnathar Lutheran Church" (city Chennai).
- **Institution** is the body a venue or choir belongs to: "Madras Christian College (MCC)". It is not the venue and not a performer.
- **Venue type** comes from the text: a label ("Church: …") or the venue's own name ("… Chapel", "… Church"), flagged as coming from the name. Never from a choir's name ("ECI Hope Cathedral Choir" says nothing about where it sang) and never from what we happen to know about a place.
- **Performance date** must be stated as the performance date ("Date: 12 December 2025", "performed … on 7 December 2025"). A bare date at the end of a YouTube title, a publication date, or an event name ("Carols by Candlelight 2025") is not a performance date.

## 5. Multilingual identity

- The original-script title is the title of record. The transliteration is kept beside it, never instead of it (*பாலன் பிறந்த ராவில்* / *Paalan Pirandha Raavil*).
- Spellings of transliterations vary ("Magizhvom" / "Makilvom", "Onrum" / "Ondrum"). Choose one for the record and keep the others as alternate titles; do not silently merge.
- A title already in Latin letters (*Blagoslovi Dushe Moya Gospoda*) is kept as written; a translation of its meaning ("Bless the Lord, O my soul") is a note, not a title.
- Public pages load Noto Sans Tamil and Noto Serif Tamil after the Latin fonts (2026-11-17), so Tamil titles render in a matching face.
- Slugs keep only Latin letters. Records made by `npm run ai:video-credits-create` get their slug from the transliteration when the title is non-Latin, so *பாலன் பிறந்த ராவில்* becomes `paalan-pirandha-raavil` (rule in `modules/mmke/slug/canonicalSlug.ts`; project register R-31). Studio's create forms still slug a Tamil-only name to an empty string.
- Archive search finds a work, and a published Recording of it, by any part of an alternate title, ignoring letter case ("pirandha", "dingiri dingale").
- **Editing them (R-37, 2026-11-22).** Studio → Musical Works → new or edit: the "Alternate titles" box takes one title per line. Each line is trimmed, blank lines are dropped, and a title already listed (ignoring letter case) is dropped, keeping the first spelling typed; original-script titles and Latin transliterations are kept exactly as typed. Saving rewrites the whole list, and the audit log records it before and after (MUSICAL_WORK_UPDATED). At most 30 titles of at most 300 characters each. The work's Studio page lists them above the Edit form.
- **Where they appear.** The public work page lists them as "Also known as", and its JSON-LD carries them as `alternateName` (an array, only when there are any).

## 6. Medleys

A medley is **one Recording** containing several works, each with its own credits: "Christmas Carol Medley" holds *Ding Dong! Merrily on High* (words G. R. Woodward, arrangement Mack Wilberg, **no composer stated**), *In the Beginning, God Created the Heavens and the Earth* (words and music Steven Lalsangliana Ralte) and *Love Came Gently, Soft as a Baby* (words and music Marty Funderburk, arrangement Bruce Greer). Credits are attached to the work they belong to, never to the medley as a whole. A work with no stated composer stays without one; it is never given the arranger or "Traditional" by default.

## 7. Description structure and tone

Learned by reading the rewritten descriptions of Vl8Xe2COp2c, zRjM7rP7hpM, jiNrP52imwg and rxGfBGWLnTI (S4aemnTWODM has not been rewritten; it is still a single sentence and a numbered line).

**Structure, in order:**
1. **Opening line:** the work's title, an em dash, and a one-clause characterisation of the piece ("an Advent carol …", "a sacred choral work …"). For a medley: "A joyful Christmas Carol Medley performed by …".
2. **Performance sentence:** who performed, the institution, the date, then the creators and the conductor ("The words and music are by …, with a choral arrangement by …, conducted by …").
3. **Optional context paragraph:** only what is needed to identify the work, such as its published title, the meaning of a non-English title, or the source of its text.
4. **Archive sentence:** that the performance is part of the Music Madras archive.
5. **"Performance Details" block:** one labelled line per fact, each led by an emoji: work (Carol / Hymn / Work), Words, Music, Arrangement or Tune, Choir (with the institution), Conductor, Venue, Date, and "Recorded and presented by: Music Madras". A medley lists its works as a numbered list with credit lines under each, then the shared details.
6. **Invitation:** to explore more and subscribe.
7. **Hashtags.**

The older rewritten form (rxGfBGWLnTI, Njb-5-iZMsg) uses an "About the Carol" heading, "Performance date:", "Presented by:" and a "Transliteration:" line. Its information is the same.

**Tone:** warm, reverent and factual. Present tense for the performance ("performs"), past tense for the recording ("was recorded"). One adjective at most for the music ("joyful", "reverent"). No superlatives about performers. Every fact in the prose is repeated in the Details block.

**Consistency to settle** (seen across these descriptions):
- one presenter label ("Recorded and presented by", not also "Presented by" or "Captured by");
- one date label ("Date:" or "Performance date:");
- the institution always written the same way ("Madras Christian College (MCC)");
- hashtags never naming someone the text does not credit. zRjM7rP7hpM's hashtags name Jacob George, while the text says Daniel Evans conducted.

## 8. Provenance tiers

Every credit and title records how we know it, from strongest to weakest:

| Tier | Meaning | Example |
|---|---|---|
| Stated in title | The YouTube title states it with its role. Weak: titles are often abbreviated or wrong. | (rare; most title names have no role) |
| Stated in description | The description states it, in a labelled line or prose, quotable verbatim. | "Arrangement: Douglas Nolan" |
| Supported by another source | An approved Source (publisher, programme, score) confirms it. | a publisher's catalogue entry for *Long-Awaited One* |
| Editor-supplied | The editor knows it; no public text states it yet. | Jim Billy led the ECI Hope Cathedral Men's Choir (S4aemnTWODM) |
| AI-suggested | Proposed by the credits assistant, checked by the validators, not yet reviewed. | any accepted proposal before review |
| Unresolved | Known to be missing or contested; flagged for research. | the composer of *Moving Up to Gloryland* |

A credit moves up a tier only through a human decision or an approved source. A text error never becomes a credit.

"Supported by another source" is refined for researched claims by the source tiers (A, B, C, X) and the minimum evidence per claim type in `docs/content-guardrails.md` section 2. A claim below its minimum is written only with attribution ("…, according to …"), never as plain fact.

## 9. Editor decisions on the five reference videos

| Video | Decisions |
|---|---|
| Vl8Xe2COp2c | Performance title *Come Now, Child of Promise*; published title *Long-Awaited One*. Words and music Nicole Elsey; arranger Douglas Nolan (the title's "Douglas Elsey" is a title error: no credit). Bishop Heber Chapel Choir; Madras Christian College; conductor Jacob George; venue Bishop Heber Chapel; 2025-12-12; recorded and presented by Music Madras. |
| zRjM7rP7hpM | One work, *Blagoslovi Dushe Moya Gospoda*, with the subtitle *Magnificat* (the same work, never a second one). Composer and conductor Daniel Evans; Bishop Heber Chapel Choir; Madras Christian College; Bishop Heber Chapel; 2025-12-12; recorded and presented by Music Madras. |
| S4aemnTWODM | *Moving Up to Gloryland*. ECI Hope Cathedral Men's Choir. Original performance association Gaither Vocal Band (a cover, never composer). Conductor Jim Billy (editor-supplied: the choir was led by him; not in the YouTube text). Venue TELC Arulnathar Lutheran Church, Chennai; 2025-12-07. Composer unassigned: flag for research. |
| jiNrP52imwg | One Recording, "Christmas Carol Medley", with three works and their own credits (section 6). Bishop Heber Chapel Choir; Madras Christian College; conductor Jacob George; Bishop Heber Chapel; 2025-12-12. |
| rxGfBGWLnTI | Tamil title *பாலன் பிறந்த ராவில்* with transliteration *Paalan Pirandha Raavil*; the Tamil is never replaced. Composer and conductor Finley Abraham; Bishop Heber Chapel Choir; Madras Christian College; Bishop Heber Chapel; 2025-12-12; presented by Music Madras. |

## 10. What the catalogue cannot hold yet

Recorded here so the gaps are decided deliberately, not worked around:
- **Lyricist, arranger, translator.** A `MusicalWork` has exactly one `composerId` and no other contributor relation.
- **A work with no stated composer.** `MusicalWork.composerId` is required, so *Ding Dong! Merrily on High* cannot be stored without inventing a composer.
- **Published title and subtitle.** There is no field for either.
- **Original-language title versus transliteration.** Both would sit in `title` / `alternateTitles`, with nothing marking which is which.
- **Institution of a choir.** `Choir` has no organisation relation. A venue's institution does have a home: `Venue.organisationId`.
- **Original performer** of a cover. No field.
- **Presenter credit.** No field.
- **Per-credit provenance tier** (section 8) and research flags. No field.
- **Recording-level performance title**, as distinct from the work title. No field.
