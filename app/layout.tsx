import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Music Madras — Production Foundation (Phase 1)",
  description: "Phase 1 application foundation. Not the public Museum site.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
