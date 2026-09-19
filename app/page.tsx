// Placeholder — NOT the Museum homepage. The real homepage will live at
// app/(museum)/page.tsx once the Museum phase begins (ADR §3, §9). The
// authenticated Studio application already exists at /studio (Phase 4).
export default function FoundationPlaceholder() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem" }}>
      <h1>Music Madras — Production Foundation</h1>
      <p>
        This is the production application foundation described in{" "}
        <code>docs/architecture/ADR-0001-production-platform.md</code>. The
        public Museum site is a later phase; the Studio content-management
        application is at <code>/studio</code> (see{" "}
        <code>docs/phase-4-studio.md</code>).
      </p>
    </main>
  );
}
