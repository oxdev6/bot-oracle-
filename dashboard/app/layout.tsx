import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://lodestar-oracle.vercel.app"),
  applicationName: "Lodestar Oracle",
  title: {
    default: "Lodestar Oracle",
    template: "%s | Lodestar Oracle",
  },
  description: "Live BOT Chain oracle prices, operator health, rewards, and protocol activity.",
  openGraph: {
    title: "Lodestar Oracle",
    description: "Live BOT Chain oracle prices, operator health, rewards, and protocol activity.",
    siteName: "Lodestar Oracle",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Lodestar Oracle",
    description: "Live BOT Chain oracle prices, operator health, rewards, and protocol activity.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen text-slate-100">{children}</body>
    </html>
  );
}