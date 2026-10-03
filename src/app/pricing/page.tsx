"use client";

import { useState } from "react";

export default function PricingPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function subscribe() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Checkout failed");
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto text-center py-10">
      <h1 className="font-display text-5xl mb-3">
        GO <span className="gold-text">PRO</span>
      </h1>
      <p className="text-muted mb-8">Unlock tonight&apos;s card, every card, all season.</p>

      <div className="card card-glow p-8 gold-border">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-gold mb-2">MoyLine Pro</p>
        <p className="font-display text-6xl mb-1">$29<span className="text-xl text-muted">/mo</span></p>
        <p className="text-muted text-sm mb-6">Cancel anytime. Test mode — no real charges while testing.</p>
        <ul className="text-left text-sm space-y-2 mb-8 max-w-sm mx-auto">
          <li>✅ Tonight&apos;s full card, every night</li>
          <li>✅ ★ biggest-edge play with reasoning</li>
          <li>✅ Steam alerts before the market moves</li>
          <li>✅ Full verified track record</li>
        </ul>
        <button onClick={subscribe} disabled={loading} className="btn-gold px-10 py-3 text-lg disabled:opacity-50">
          {loading ? "Loading…" : "Subscribe with Stripe"}
        </button>
        {error && <p className="text-down text-sm mt-4">{error}</p>}
        <p className="text-[11px] text-muted mt-4">You&apos;ll be redirected to Stripe&apos;s secure checkout.</p>
      </div>
    </div>
  );
}
