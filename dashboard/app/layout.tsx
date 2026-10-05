import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lodestar Oracle Dashboard",
  description: "Live feed prices, operator status, and slashing history on BOT Chain",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-surface-950">{children}</body>
    </html>
  );
}