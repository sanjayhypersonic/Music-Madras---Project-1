"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Phase 6J-3B — the Recording workflow's step list. Same links as before, now with
// the current step marked (aria-current) and a layout that wraps into chips on a
// narrow screen instead of squeezing the form into a sliver beside a fixed column.

export function RecordingSteps({ recordingId, steps }: { recordingId: string; steps: Array<{ slug: string; label: string }> }) {
  const pathname = usePathname();
  const current = (slug: string) => pathname === `/studio/recordings/${recordingId}/${slug}`;
  return (
    <nav className="studio-steps" aria-label="Recording steps">
      <ul className="studio-steps__list">
        {steps.map((step) => (
          <li key={step.slug}>
            <Link href={`/studio/recordings/${recordingId}/${step.slug}`} aria-current={current(step.slug) ? "page" : undefined}>
              {step.label}
            </Link>
          </li>
        ))}
        <li className="studio-steps__preview">
          <Link href={`/studio/recordings/${recordingId}/preview`} aria-current={current("preview") ? "page" : undefined}>
            Preview
          </Link>
        </li>
      </ul>
    </nav>
  );
}