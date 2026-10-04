// Phase 6J-3B — the loading state for Studio screens: quiet, announced to screen
// readers, no decoration. It sits BELOW the protected layout, so the sign-in
// redirect (which runs in that layout) still happens before anything streams.
// (The public Museum deliberately has no loading.tsx: it would make a missing
// public page answer HTTP 200 instead of 404 — see tests/unit/museumPublicSafety.test.ts.)

export default function StudioLoading() {
  return (
    <div className="studio-loading" role="status" aria-live="polite">
      Loading…
    </div>
  );
}