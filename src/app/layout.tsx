import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import PwaRegister from "@/components/PwaRegister";
import Providers from "@/components/Providers";

export const metadata: Metadata = {
  title: "MoyLine AI — Live Sports Betting Lines",
  description: "Live odds aggregation across every major sportsbook. Opening vs current lines, steam alerts, and pro picks.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "MoyLine AI",
  },
  icons: {
    icon: "/icon",
    apple: "/apple-icon",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
};

function Nav() {
  return (
    <header className="border-b border-line/70 bg-ink/90 backdrop-blur sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/" className="font-display text-xl sm:text-2xl shrink-0">
          <span className="gold-text">MOYLINE</span>{" "}
          <span className="text-paper">AI</span>
        </Link>
        <nav className="flex items-center gap-0.5 sm:gap-2 text-xs sm:text-sm font-bold">
          <Link href="/" className="px-2 sm:px-3 py-1.5 rounded hover:text-gold">Lines</Link>
          <Link href="/picks" className="px-2 sm:px-3 py-1.5 rounded hover:text-gold">Picks 🔒</Link>
          <Link href="/track-record" className="px-2 sm:px-3 py-1.5 rounded hover:text-gold">Record</Link>
          <Link href="/pricing" className="px-2.5 sm:px-3 py-1.5 rounded btn-gold whitespace-nowrap">Go Pro</Link>
        </nav>
      </div>
    </header>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <PwaRegister />
        <Providers>
        <div className="hero-grid min-h-screen">
          <Nav />
          <main className="max-w-7xl mx-auto px-4 py-6">{children}</main>
          <footer className="border-t border-line/70 mt-12">
            <div className="max-w-7xl mx-auto px-4 py-6 text-xs text-muted flex flex-col sm:flex-row gap-2 justify-between">
              <span>
                <span className="gold-text font-display">MOYLINE AI</span> — live lines, steam alerts, pro picks.
              </span>
              <span>Analysis for entertainment purposes — not financial advice.</span>
            </div>
          </footer>
        </div>
        </Providers>
      </body>
    </html>
  );
}
