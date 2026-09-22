import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Phase 6G-3 — the Museum homepage's discovery grid shows real YouTube
    // thumbnails for published recordings via next/image. i.ytimg.com is
    // YouTube's own thumbnail CDN host, the same one already stored in
    // YouTubeVideo.thumbnailUrl by the sync engine.
    remotePatterns: [{ protocol: "https", hostname: "i.ytimg.com" }],
  },
};

export default nextConfig;
