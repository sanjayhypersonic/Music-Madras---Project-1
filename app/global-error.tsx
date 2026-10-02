"use client";

// Phase 6J-1 — the last-resort error page, used only if the ROOT layout itself
// fails (anything inside a Museum page is caught by app/(museum)/error.tsx).
// It must render its own <html>/<body> and cannot rely on any stylesheet, so it
// is deliberately plain. No error detail is shown.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#1a1a2e", color: "#f1eef8", display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", margin: 0 }}>
        <main style={{ textAlign: "center", padding: "2rem", maxWidth: "32rem" }}>
          <h1 style={{ fontFamily: "Georgia, serif" }}>We couldn&rsquo;t load Music Madras</h1>
          <p>This is a temporary problem on our side. Please try again in a moment.</p>
          <button type="button" onClick={() => reset()} style={{ padding: "0.6rem 1.2rem", fontSize: "1rem", cursor: "pointer" }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
