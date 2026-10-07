import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lodestar Oracle | Protocol Intelligence",
  description: "Live BOT Chain oracle prices, operator health, rewards, and protocol activity.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://localhost:3000"),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#040b16] text-slate-100">{children}</body>
    </html>
  );
}