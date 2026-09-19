// Phase 1 placeholder — NOT the Museum homepage. The real homepage will
// live at app/(museum)/page.tsx once the Museum phase begins (ADR §3, §9).
export default function Phase1FoundationPlaceholder() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem" }}>
      <h1>Music Madras — Production Foundation</h1>
      <p>
        This is the Phase 1 application foundation described in{" "}
        <code>docs/architecture/ADR-0001-production-platform.md</code> and{" "}
        <code>docs/phase-1-foundation.md</code>. It is not the public Museum
        site, which is a later phase.
      </p>
    </main>
  );
}
