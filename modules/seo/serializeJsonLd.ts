// Phase 6J-1 — the one way JSON-LD is serialised into a <script type="application/ld+json">.
//
// JSON.stringify output placed inside a <script> element is only safe if it
// can never contain a sequence that ends or reopens the element. Editor- and
// YouTube-supplied text (a composer's name, a description) is interpolated into
// these documents, so a value containing `</script>` (or `<!--`) would
// otherwise terminate the script and inject markup into a public page.
//
// Escaping `<`, `>` and `&` as \uXXXX leaves the JSON semantically IDENTICAL —
// every JSON parser (and Google's structured-data reader) decodes them back —
// while making the HTML parser unable to see a tag. The two Unicode line
// separators are escaped too (valid in JSON, historically illegal inside a
// JavaScript string literal).

const LINE_SEPARATOR = new RegExp(String.fromCharCode(0x2028), "g");
const PARAGRAPH_SEPARATOR = new RegExp(String.fromCharCode(0x2029), "g");

export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(LINE_SEPARATOR, "\\u2028")
    .replace(PARAGRAPH_SEPARATOR, "\\u2029");
}
