import { parseEditorialBody } from "../../modules/mmke/editorial/editorialBody";

// Phase 6K-1 — renders a published editorial body. The text is parsed into paragraphs and "##"/"###" headings and rendered as React
// text only, so stored content can never inject markup. Pure and server-renderable; it renders nothing for an empty body.

export function EditorialBlockBody({ body, headingOffset = 0 }: { body: string | null | undefined; headingOffset?: number }) {
  const blocks = parseEditorialBody(body);
  if (blocks.length === 0) return null;
  return (
    <>
      {blocks.map((block, index) => {
        if (block.type === "paragraph") return <p key={index}>{block.text}</p>;
        const level = Math.min(6, block.level + headingOffset);
        const Tag = `h${level}` as "h2" | "h3" | "h4" | "h5" | "h6";
        return <Tag key={index}>{block.text}</Tag>;
      })}
    </>
  );
}
