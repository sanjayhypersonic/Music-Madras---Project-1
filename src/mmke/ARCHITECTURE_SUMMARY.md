# Music Madras Knowledge Engine (MMKE)
## Architecture Summary & Future Roadmaps

This document serves as the Technical Architecture Map for **Music Madras**. It details the structural roles of the newly established sub-modules and outlines how future development phases will build upon this foundation.

---

## 1. Architectural Blueprint Overview

The architecture introduces a unidirectional, strongly-typed, and modular structure to safely transform Music Madras from a static media site into a digital archival powerhouse and knowledge engine.

```
                  +-----------------------------------+
                  |      User Interaction (UI)        |
                  | (Header, VideoGallery, Playlists) |
                  +-----------------------------------+
                                    |
                                    v
                  +-----------------------------------+
                  |          Knowledge Layer          |
                  |  (Single Source of Truth - SSOT)  |
                  +-----------------------------------+
                                    |
       +----------------------------+----------------------------+
       |                            |                            |
       v                            v                            v
+--------------+             +--------------+             +--------------+
|   Search     |             |  Education   |             |  Recommend   |
|  Engine API  |             |  Syllabuses  |             |  Engine API  |
+--------------+             +--------------+             +--------------+
       |                            |                            |
       +----------------------------+----------------------------+
                                    |
                                    v
                  +-----------------------------------+
                  |       Future AI Assistant         |
                  |   (Librarian, Research Agent)     |
                  +-----------------------------------+
```

---

## 2. Directory & Module Analysis

### 2.1 Core Types (`/src/mmke/types/`)
* **`entities.ts`**:
  * *Why it exists*: Formulates the exact structural "DNA" of archival nodes (Composers, Musical Works, Performances, Recordings, Venues, Instruments, and Organizations).
  * *Future Build-up*: Serves as the database schema mappings for PostgreSQL/Cloud SQL or Firestore collections.
* **`recommendations.ts`**:
  * *Why it exists*: Standardizes recommendation parameters, contextual weighting (e.g., matching historical era or acoustic properties), and unified result payloads.
  * *Future Build-up*: Directly maps to the future Recommendation Engine microservice, feeding inputs into embedding matchers.
* **`education.ts`**:
  * *Why it exists*: Designs the framework for interactive lessons, guided step structures, listening focus indices, and curriculum syllabus outlines.
  * *Future Build-up*: Powers user-progress interfaces, letting students track their curriculum milestones.
* **`media.ts`**:
  * *Why it exists*: Abstractly decouples YouTube, Spotify, and Apple Music from the core metadata maps.
  * *Future Build-up*: Minimizes refactoring when adding streaming providers. Providers are simply registered as interchangeable connectors.
* **`search.ts`**:
  * *Why it exists*: Models standard keywords, semantic search, vector search payloads, and AI-driven multi-hop search responses.
  * *Future Build-up*: Connects directly to a vector indexing database (such as Pinecone or pgvector).
* **`ai.ts`**:
  * *Why it exists*: Lays down the conversational history structures, agent personas (Music Librarian, Music Educator), and RAG grounding context parameters.
  * *Future Build-up*: Feeds clean, structured facts into the Gemini API without hallucination risks.

---

## 3. Core Engine Layer (`/src/mmke/knowledge-layer.ts`)
* *Why it exists*: Acts as the **Single Source of Truth (SSOT)**. All views, plugins, and helper widgets read metadata directly from this singleton instance.
* *Future Build-up*: It handles caching, relational traversal resolution (such as finding the specific tracker organ action used in an active video performance), and query optimization.

---

## 4. UI Specification Standards (`/src/mmke/templates/cards.ts`)
* *Why it exists*: Formalizes the visual information hierarchy and design tokens (Minimal Serif, Tech Mono, Cinematic, Sacred Gold) of cards.
* *Future Build-up*: Ensures unified aesthetic parameters are mapped during React card generation.

---

## 5. Phase Transition Guide (Moving to Phase 0.7 & Beyond)

With this zero-impact, high-fidelity internal architecture in place:
1. **API Integration**: Connect the `IMediaConnector` adapters to actual Google API SDK endpoints.
2. **Interactive AI Hub**: Deploy the `IMMKEAiCoordinator` engine with a beautiful custom-styled console, utilizing the RAG grounding filters to answer music queries accurately.
3. **Curriculum Pages**: Map the `EducationalCollection` records to live routes, turning static playlists into immersive learning pathways.
