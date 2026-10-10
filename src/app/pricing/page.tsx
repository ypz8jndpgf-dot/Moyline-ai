"use client";

import { useState } from "react";

type Tier = "daily" | "weekly" | "monthly";

const TIERS: {
  id: Tier;
  name: string;
  price: string;
  per: string;
  tag?: string;
  blurb: string;
  cta: string;
  featured?: boolean;
}[] = [
  {
    id: "daily",
    name: "Day Pass",
    price: "$9.99",
    per: "24 hours",
    tag: "Trial",
    blurb: "Full access for a day. Perfect for trying it out.",
    cta: "Try it for a day",
  },
  {
    id: "weekly",
    name: "Week Pass",
    price: "$19.99",
    per: "7 days",
    blurb: "A full week of cards. One-time payment, no subscription.",
    cta: "Get the week",
    featured: true,
  },
  {
    id: "monthly",
    name: "Monthly Pro",
    price: "$49.99",
    per: "per month",
    blurb: "Every card, all season. Cancel anytime.",
    cta: "Go monthly",
  },
];

const PERKS = [
  "Tonight's full card, every night",
  "★ biggest-edge play with reasoning",
  "Parlay Lab ticket builder",
  "Teaser & parlay of the day",
  "Full verified track record",
];

export default function PricingPage() {
  const [loading, setLoading] = useState<Tier | null>(null);
  const [error, setError] = useState("");

  async function subscribe(tier: Tier) {
    setLoading(tier);
    setError("");
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Checkout failed");
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout failed");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="max-w-4xl mx-auto text-center py-10">
      <h1 className="font-display text-5xl mb-3">
        GO <span className="gold-text">PRO</span>
      </h1>
      <p className="text-muted mb-8">Unlock tonight&apos;s card, every card, all season.</p>

      <div className="grid gap-4 md:grid-cols-3 mb-8">
        {TIERS.map((t) => (
          <div
            key={t.id}
            className={`card p-6 flex flex-col ${t.featured ? "card-glow gold-border" : ""}`}
          >
            {t.tag && (
              <p className="text-xs font-bold uppercase tracking-[0.25em] text-gold mb-2">{t.tag}</p>
            )}
            <p className="font-display text-2xl mb-1">{t.name}</p>
            <p className="font-display text-5xl mb-1">
              {t.price}
              <span className="text-sm text-muted"> / {t.per}</span>
            </p>
            <p className="text-muted text-sm mb-6 min-h-[40px]">{t.blurb}</p>
            <button
              onClick={() => subscribe(t.id)}
              disabled={loading !== null}
              className={`px-6 py-3 mt-auto ${t.featured ? "btn-gold" : "btn-ghost"} disabled:opacity-50`}
            >
              {loading === t.id ? "Loading…" : t.cta}
            </button>
          </div>
        ))}
      </div>

      {error && <p className="text-down text-sm mb-4">{error}</p>}

      <div className="card p-6 max-w-xl mx-auto text-left">
        <p className="text-xs font-bold uppercase tracking-widest text-gold mb-3">
          Every plan includes
        </p>
        <ul className="text-sm space-y-2">
          {PERKS.map((p) => (
            <li key={p}>✅ {p}</li>
          ))}
        </ul>
      </div>
      <p className="text-[11px] text-muted mt-6">
        Day and week passes are one-time payments. Monthly is a subscription — cancel anytime.
        You&apos;ll be redirected to Stripe&apos;s secure checkout.
      </p>
    </div>
  );
}
