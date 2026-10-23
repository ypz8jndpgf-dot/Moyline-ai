"use client";

import { useEffect, useState } from "react";

const SEEN_KEY = "moyline-ios-install-seen";

/**
 * One-time "Add to Home Screen" card for iPhone/iPad members browsing in a
 * tab. Apple only delivers web push to home-screen installs, so the push
 * prompt can never reach these members until they install — and the install
 * also gives them an app icon and sidesteps the Gmail in-app-browser
 * sign-in trap. iOS offers no programmatic install, so the card teaches
 * the two taps. Shows once (localStorage), only on iOS, only when not
 * already running standalone.
 */
export default function IosInstallPrompt() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(SEEN_KEY)) return;
      const ua = navigator.userAgent || "";
      const isIOS =
        /iPhone|iPad|iPod/.test(ua) ||
        // iPadOS 13+ reports a desktop Mac UA; touch points give it away.
        (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
      if (!isIOS) return;
      const nav = navigator as Navigator & { standalone?: boolean };
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        nav.standalone === true;
      if (standalone) return;
      // In-app webviews (Gmail, social apps) can't install — stay hidden
      // there; the member will meet this card in a real browser.
      if (/GMail|FBAN|FBAV|Instagram|Line\/|Twitter/.test(ua)) return;
      setShow(true);
    } catch {
      /* stay hidden */
    }
  }, []);

  if (!show) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* private mode — this session only */
    }
    setShow(false);
  };

  return (
    <div className="card p-4 sm:p-5 mb-6 border-gold/50 bg-gold/5">
      <div className="flex flex-wrap items-center gap-4">
        <div className="text-3xl" aria-hidden>
          📲
        </div>
        <div className="flex-1 min-w-[220px]">
          <p className="font-display text-lg leading-tight">
            Put MoyLine AI on your <span className="gold-text">Home Screen</span>
          </p>
          <p className="text-sm text-muted mt-1">
            On iPhone, push alerts — ★ plays, steam, target lines — only work
            from the Home Screen app. Tap the{" "}
            <span className="text-paper font-bold">Share</span> icon, then{" "}
            <span className="text-paper font-bold">“Add to Home Screen”</span>,
            then open MoyLine from your new icon and turn on alerts.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={dismiss} className="btn-gold px-5 py-2.5">
            Got it
          </button>
          <button onClick={dismiss} className="btn-ghost px-4 py-2.5">
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
