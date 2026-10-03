import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getStripe, getPriceId, getAppUrl } from "@/lib/stripe";

export const dynamic = "force-dynamic";

/** Create a Stripe Checkout session (subscription mode, TEST keys = no real charges). */
export async function POST() {
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

  try {
    const stripe = getStripe();
    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: email,
      line_items: [{ price: getPriceId(), quantity: 1 }],
      success_url: `${getAppUrl()}/picks?subscribed=1`,
      cancel_url: `${getAppUrl()}/pricing`,
      metadata: { email },
    });
    return NextResponse.json({ url: checkout.url });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Stripe checkout failed" },
      { status: 500 }
    );
  }
}
