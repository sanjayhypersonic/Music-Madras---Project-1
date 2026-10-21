// Phase 6K-1 — the safe renderer model for editorial bodies. The repository has no Markdown renderer (the learning-guide page splits
// stored text into paragraphs), so this stays deliberately smaller than Markdown: blank-line-separated paragraphs and, optionally, "##" /
// "###" headings on their own line. Nothing else is interpreted — no HTML, links, images or inline markup — and the output is a
// plain data structure that components render as React text, so stored content can never inject markup.

export type EditorialBodyBlock = { type: "heading"; level: 2 | 3; text: string } | { type: "paragraph"; text: string };

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function parseEditorialBody(body: string | null | undefined): EditorialBodyBlock[] {
  if (!body) return [];
  const normalised = body.replace(/\r\n?/g, "\n").replace(CONTROL_CHARS, "");
  const blocks: EditorialBodyBlock[] = [];
  for (const chunk of normalised.split(/\n{2,}/)) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const heading = /^(#{2,3})[ \t]+(.+)$/.exec(trimmed);
    if (heading && !trimmed.includes("\n")) {
      blocks.push({ type: "heading", level: heading[1].length === 2 ? 2 : 3, text: heading[2].trim() });
      continue;
    }
    blocks.push({ type: "paragraph", text: trimmed.split("\n").map((line) => line.trim()).filter(Boolean).join(" ") });
  }
  return blocks;
}
