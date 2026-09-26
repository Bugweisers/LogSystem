import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ULPF Review Console",
  description: "Analyst review interface for the ULPF log-processing pipeline — review queue, mapping packs, trace and verify.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
