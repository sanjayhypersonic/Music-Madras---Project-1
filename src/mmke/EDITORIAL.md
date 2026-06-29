# Music Madras Editorial Standards
## Knowledge Engine Architecture & Cataloging Guidelines

This document outlines the strict organizational, linguistic, and code standards used to build and expand the **Music Madras Knowledge Engine (MMKE)**. 

To ensure the archive remains highly cohesive, editorial, and scientifically accurate, all future developers, music historians, and curators must align with this manual.

---

## 1. Naming Conventions

### 1.1 Composers
* **Full Legal Name:** Use the composer's full classical name (e.g., *Johann Sebastian Bach*, *Dietrich Buxtehude*). Avoid shortenings unless internationally standardized (e.g., *J.S. Bach* is acceptable for visual tags but internal identifiers must use `composer-bach` or `Johann Sebastian Bach`).
* **Anglicization vs. Native Spelling:** Default to the internationally recognized standard spelling on classical cataloging indices like IMSLP. When diacritics are crucial, preserve them (e.g., *François Couperin*, *Antonín Dvořák*).

### 1.2 Musical Works
* **Original Titles:** Use original language titles followed by English translation when relevant (e.g., *Passacaglia and Fugue in C minor*, not *Passacaglia and Fugue in C-moll*).
* **Work Catalog Numbers:** Every work should feature its scientific catalogue ID immediately following the title in parenthetical formats:
  * J.S. Bach: **BWV** (Bach-Werke-Verzeichnis) -> e.g., *Toccata and Fugue in D minor (BWV 565)*
  * D. Buxtehude: **BuxWV** (Buxtehude-Werke-Verzeichnis)
  * Felix Mendelssohn: **Op.** (Opus Number)
* **Capitalization:** Always capitalize keys (e.g., *C minor*, *G major*). Use a lowercase "m" for minor, uppercase "M" for major when writing shorthand, but prefer full words: `D minor`.

### 1.3 Venues & Churches
* **Dedicated Names:** Use official names, including dedicated saint names where applicable.
* **Chennai Heritage Reference:** Highlight historical local names alongside physical addresses (e.g., *St. Andrew's Church (The Kirk), Egmore*).

---

## 2. Metadata Standards

To maintain an clean, professional aesthetic (and avoid "AI slop" or clutter), all metadata must remain accurate, complete, and descriptive.

| Field Name | Format | Example | Description |
| :--- | :--- | :--- | :--- |
| **Date** | ISO-8601 | `2026-03-15T18:30:00Z` | Standard UTC timeline for concert logging. |
| **Acoustic Profile** | Qualitative | `Reverberant (3.2s RT60)` | Echo profile measured in seconds at 1kHz. |
| **Organ Actions** | Enumeration | `'TRACKER'` | Physical build style of key linkages. |
| **Key Signatures** | Plain Text | `D minor` | Flat or sharp keys specifying structural base. |

---

## 3. Entity Standards

Every index record must be a strongly typed, singular object. 
* Do **not** compress biographical elements or program notes into multi-purpose strings.
* Biography must be purely historical, highlighting the composer's structural accomplishments, keyboard registration, and lasting legacy on choral/instrumental pedagogy.
* Place references to physical scores or manuscripts under an `externalUrls` property block rather than polluting narrative bodies.

---

## 4. Relationship Standards

A primary value of MMKE is its **graph-relational schema**. 

To maintain clean relational maps:
1. **Unidirectional ID Arrays:** Prefer listing relation IDs inside the parent node (`Composer.worksIds` or `MusicalWork.performanceIds`) to prevent deep cyclic JSON serialization during API transfers.
2. **Referential Integrity:** Always verify that every element in an ID reference array corresponds to an existing record inside the `MusicMadrasKnowledgeLayer` maps.
3. **Double-Ended Traversal helpers:** Use dedicated getters (e.g., `getComposerOfWork(workId)`) to handle reverse relationships in memory cleanly.

---

## 5. Coding Standards (TypeScript)

* **Strong Typing:** Never use `any`. Use strict custom unions or enum structures for formats, difficulties, and platform specifications.
* **Single Source of Truth:** Direct access to raw database maps is forbidden. Always route data queries through the singleton `MusicMadrasKnowledgeLayer.getInstance()` class.
* **Functional Purity:** Getter functions inside the database layer must return clones or readonly references to avoid accidental mutation of archival master data by client-side components.
