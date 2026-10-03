import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { setSubscription } from "@/lib/store";
import type Stripe from "stripe";

export const dynamic = "force-dynamic";

/** Stripe webhook: keeps subscription status in sync. */
export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !webhookSecret) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    const body = await req.text();
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (e) {
    return NextResponse.json(
      { error: `Signature verification failed: ${e instanceof Error ? e.message : e}` },
      { status: 400 }
    );
  }

  const stripe = getStripe();

  async function emailForCustomer(customerId: string): Promise<string | null> {
    try {
      const customer = (await stripe.customers.retrieve(customerId)) as Stripe.Customer;
      return customer.email || null;
    } catch {
      return null;
    }
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        const email = s.metadata?.email || s.customer_email || (s.customer ? await emailForCustomer(s.customer as string) : null);
        if (email) {
          await setSubscription(email, {
            status: "active",
            customerId: (s.customer as string) || undefined,
            subscriptionId: (s.subscription as string) || undefined,
            updatedAt: new Date().toISOString(),
          });
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const email = sub.metadata?.email || (await emailForCustomer(sub.customer as string));
        if (email) {
          const s = sub.status as string;
          const status: "active" | "trialing" | "past_due" | "canceled" =
            s === "active" || s === "trialing"
              ? s
              : s === "past_due"
                ? "past_due"
                : "canceled";
          await setSubscription(email, {
            status,
            customerId: sub.customer as string,
            subscriptionId: sub.id,
            updatedAt: new Date().toISOString(),
          });
        }
        break;
      }
    }
    return NextResponse.json({ received: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Webhook handler failed" },
      { status: 500 }
    );
  }
}
