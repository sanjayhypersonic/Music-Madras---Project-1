import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Music Madras — Production Foundation",
  description: "Production application foundation, including the Studio content-management app. Not the public Museum site.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: the Museum layout's pre-paint script
    // (app/(museum)/layout.tsx) sets data-theme on this element before
    // React hydrates, for a returning light-mode visitor. That's an
    // intentional, expected mismatch — Studio never reads or sets this
    // attribute, so this has no effect on Studio's own rendering.
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
