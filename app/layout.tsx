import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Music Madras — Production Foundation",
  description: "Production application foundation, including the Studio content-management app. Not the public Museum site.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
