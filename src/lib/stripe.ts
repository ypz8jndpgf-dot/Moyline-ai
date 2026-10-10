import Stripe from "stripe";

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}

/** Price ID for a tier (set in Stripe dashboard). */
export type PriceTier = "daily" | "weekly" | "monthly";

const PRICE_ENV: Record<PriceTier, string> = {
  daily: "STRIPE_PRICE_DAILY",
  weekly: "STRIPE_PRICE_WEEKLY",
  monthly: "STRIPE_PRICE_MONTHLY",
};

export function getPriceId(tier: PriceTier = "monthly"): string {
  const id = process.env[PRICE_ENV[tier]];
  if (!id) throw new Error(`${PRICE_ENV[tier]} is not set`);
  return id;
}

/** @deprecated Use getPriceId(tier). Kept for backward compatibility. */
export function getMonthlyPriceId(): string {
  return getPriceId("monthly");
}

export function getAppUrl(): string {
  return (
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  );
}
