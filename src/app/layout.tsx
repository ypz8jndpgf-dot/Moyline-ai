import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import PwaRegister from "@/components/PwaRegister";
import PushBell from "@/components/PushBell";
import Providers from "@/components/Providers";
import { auth } from "@/lib/auth";

/** Set true to show the Go Pro / pricing CTA in the header. Hidden for now (2026-10-13). */
const SHOW_GO_PRO = true;

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

async function Nav() {
  const session = await auth();
  const email = session?.user?.email || null;
  const adminEmail = (process.env.ADMIN_EMAIL || "").toLowerCase();
  const isAdmin = !!email && !!adminEmail && email.toLowerCase() === adminEmail;
  const accountLink = email ? (
    <>
      <PushBell />
      <Link
        href="/my-tails"
        className="px-2 sm:px-3 py-1.5 rounded text-gold whitespace-nowrap shrink-0"
        title={email}
      >
        {email.split("@")[0]}
      </Link>
    </>
  ) : (
    <Link
      href="/signin"
      className="px-2.5 sm:px-3 py-1.5 rounded border border-gold/60 text-gold whitespace-nowrap shrink-0 hover:bg-gold/10"
    >
      Sign in
    </Link>
  );
  return (
    <header className="border-b border-line/70 bg-ink/90 backdrop-blur sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between flex-wrap gap-y-2">
        <Link href="/" className="font-display text-lg sm:text-2xl shrink-0 order-1">
          <span className="gold-text">MOYLINE</span>{" "}
          <span className="text-paper">AI</span>
        </Link>
        <div className="flex items-center gap-2 shrink-0 order-2 sm:order-3 text-xs sm:text-sm font-bold">
          {accountLink}
          {SHOW_GO_PRO && (
            <Link href="/pricing" className="px-2.5 sm:px-3 py-1.5 rounded btn-gold whitespace-nowrap shrink-0">Go Pro</Link>
          )}
        </div>
        <nav className="flex items-center gap-0.5 sm:gap-2 text-xs sm:text-sm font-bold overflow-x-auto whitespace-nowrap order-3 sm:order-2 w-full sm:w-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Link href="/" className="px-2 sm:px-3 py-1.5 rounded hover:text-gold shrink-0">Lines</Link>
          <Link href="/picks" className="px-2 sm:px-3 py-1.5 rounded hover:text-gold shrink-0">Picks 🔒</Link>
          <Link href="/lab" className="px-2 sm:px-3 py-1.5 rounded hover:text-gold shrink-0">Lab 🔒</Link>
          <Link href="/builder" className="px-2 sm:px-3 py-1.5 rounded hover:text-gold shrink-0">Builder 🔒</Link>
          <Link href="/track-record" className="px-2 sm:px-3 py-1.5 rounded hover:text-gold shrink-0">Record</Link>
          {/* <Link href="/archive" className="px-2 sm:px-3 py-1.5 rounded hover:text-gold shrink-0">Archive</Link> — hidden until track record is ready for prime time */}
          <Link href="/my-tails" className="px-2 sm:px-3 py-1.5 rounded hover:text-gold shrink-0">Tails</Link>
          <Link href="/alerts" className="px-2 sm:px-3 py-1.5 rounded hover:text-gold shrink-0">Alerts</Link>
          <Link href="/backpage" className="px-2 sm:px-3 py-1.5 rounded hover:text-gold shrink-0">Undercard 🔒</Link>
          <Link href="/ask" className="px-2 sm:px-3 py-1.5 rounded hover:text-gold shrink-0">Ask MoyAI ✨</Link>
          {isAdmin && (
            <Link href="/paper" className="px-2 sm:px-3 py-1.5 rounded hover:text-gold shrink-0">Paper</Link>
          )}
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
              <span>Analysis for entertainment purposes — not financial advice. <a href="mailto:support@moylineai.com" className="underline hover:text-gold">support@moylineai.com</a></span>
            </div>
          </footer>
        </div>
        </Providers>
      </body>
    </html>
  );
}
