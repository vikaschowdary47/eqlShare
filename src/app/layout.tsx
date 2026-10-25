import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", variable: "--font-serif" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: { default: "Eqlshare · Shared bills, organized", template: "%s · Eqlshare" },
  description: "Eqlshare collects shared bills, splits them to the cent, and shows everyone what is due. No bank account required.",
};

export const viewport: Viewport = {
  // Browser chrome: brand coral in light mode, the dark icon's background in dark mode
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F26B5B" },
    { media: "(prefers-color-scheme: dark)", color: "#1F2937" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} ${serif.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
