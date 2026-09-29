"use client";

import type { ReactNode } from "react";
import { trackYouTubeClickAction } from "../../app/(museum)/videos/[slug]/actions";

// Phase 6G-18 — the one Client Component boundary this phase introduces,
// for the one outbound YouTube link that exists anywhere in the public
// Museum (app/(museum)/videos/[slug]/page.tsx's "Watch on YouTube"
// button). A plain server-rendered <a> can't itself call the server-side
// analytics service on click, so this thin wrapper adds only an onClick
// that fires the tracking Server Action — fire-and-forget, never awaited,
// never calling preventDefault, so the browser's normal outbound
// navigation is never delayed or blocked by analytics (brief §17/§22).

export interface OutboundYouTubeLinkProps {
  href: string;
  youtubeVideoId: string;
  className?: string;
  children: ReactNode;
}

export function OutboundYouTubeLink({ href, youtubeVideoId, className, children }: OutboundYouTubeLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onClick={() => {
        void trackYouTubeClickAction(youtubeVideoId);
      }}
    >
      {children}
    </a>
  );
}
