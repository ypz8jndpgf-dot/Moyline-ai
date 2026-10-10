import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getStripe, getPriceId, getAppUrl, PriceTier } from "@/lib/stripe";

export const dynamic = "force-dynamic";

const TIERS: PriceTier[] = ["daily", "weekly", "monthly"];

/**
 * Create a Stripe Checkout session.
 * - daily/weekly: one-time payment (24h / 7d access via webhook expiry).
 * - monthly: recurring subscription.
 */
export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

  // Owner never pays
  const admin = (process.env.ADMIN_EMAIL || "").toLowerCase();
  if (admin && email.toLowerCase() === admin) {
    return NextResponse.json({ error: "Owner account already has full access" }, { status: 400 });
  }

  let tier: PriceTier = "monthly";
  try {
    const body = await req.json();
    if (body && TIERS.includes(body.tier)) tier = body.tier;
  } catch {
    // no body — default to monthly
  }

  try {
    const stripe = getStripe();
    const isRecurring = tier === "monthly";
    const checkout = await stripe.checkout.sessions.create({
      mode: isRecurring ? "subscription" : "payment",
      customer_email: email,
      line_items: [{ price: getPriceId(tier), quantity: 1 }],
      success_url: `${getAppUrl()}/picks?subscribed=1`,
      cancel_url: `${getAppUrl()}/pricing`,
      metadata: { email, tier },
    });
    return NextResponse.json({ url: checkout.url });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Stripe checkout failed" },
      { status: 500 }
    );
  }
}
