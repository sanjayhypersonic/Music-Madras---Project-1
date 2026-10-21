import { createHash } from "crypto";

// Phase 6K-5 — the EVIDENCE the playlist assistant may draw on, and nothing else.
//
// The assistant never browses, never recalls "what it knows" about a piece or a choir, and never sees a YouTube description (those are written
// by uploaders and may contain promotion or instructions). It is given exactly this set, built in code from rows the Museum already holds:
//   - the playlist page's own title;
//   - for each video the Museum may currently show on this playlist: its title, its publication date, and the editor's own curator note (if any);
//   - every ACTIVE piece of context a person has supplied (answers to earlier interview questions, editor notes).
// Each item has a stable id. A draft may only state what these items support and must cite their ids (see validatePlaylistOutput.ts). The
// fingerprint identifies the exact set, so a draft written from evidence that has since changed can be recognised and refused.

export type EvidenceKind = "PLAYLIST" | "VIDEO" | "CONTEXT";

export interface EvidenceItem {
  id: string;
  kind: EvidenceKind;
  text: string;
}

export interface EvidenceFacts {
  playlistTitle: string;
  /** Members visible on this playlist, in playlist order. */
  members: Array<{ title: string | null; publishedAt: Date | null; curatorNote: string | null }>;
  /** ACTIVE human-supplied inputs, oldest first. */
  inputs: Array<{ question: string | null; body: string }>;
}

export interface EvidenceSet {
  items: EvidenceItem[];
  fingerprint: string;
  /** All evidence text, lower-cased, for grounding checks. */
  corpus: string;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

export function buildEvidence(facts: EvidenceFacts): EvidenceSet {
  const items: EvidenceItem[] = [{ id: "playlist", kind: "PLAYLIST", text: `Playlist title: ${facts.playlistTitle}` }];
  facts.members.forEach((member, index) => {
    const parts = [`Video: “${member.title ?? "untitled"}”`];
    if (member.publishedAt) parts.push(`published ${day(member.publishedAt)}`);
    items.push({ id: `video-${index + 1}`, kind: "VIDEO", text: `${parts.join(", ")}.${member.curatorNote ? ` Editor’s note: ${member.curatorNote}` : ""}` });
  });
  facts.inputs.forEach((input, index) => {
    items.push({ id: `context-${index + 1}`, kind: "CONTEXT", text: input.question ? `Question: ${input.question} Answer: ${input.body}` : `Editor’s note: ${input.body}` });
  });
  const fingerprint = createHash("sha256").update(JSON.stringify(items)).digest("hex").slice(0, 32);
  return { items, fingerprint, corpus: items.map((i) => i.text).join("\n").toLowerCase() };
}
