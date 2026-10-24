// The `?error=` text a Studio action leaves in the URL for the page to show. The framework has already decoded the query once; the pages decode it again (the
// actions encode with encodeURIComponent), which throws `URIError: URI malformed` for any text that is not valid escape syntax (for example a bare "%"), turning a
// crafted or odd URL into an HTTP 500. This keeps the existing decoding and falls back to the text as given when it cannot be decoded. PURE.
export function decodeMessage(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
