import { NextResponse } from "next/server";
import { getSubscription, hasAccess } from "@/lib/store";
import { verifyTail, addTail } from "@/lib/tail-link";
import { briefSignInUrl } from "@/lib/brief-signin";

export const dynamic = "force-dynamic";

/**
 * One-click "Tailed it" from the brief email (optimization #31).
 *
 * GET /api/tail?e=<email>&d=<date>&g=<game>&p=<play>&pr=<price>&t=<hmac>
 * The HMAC (lib/tail-link.ts) binds the recipient to the exact pick, so the
 * link works without a session. On a valid click from a member: record the
 * tail (add-only, idempotent) and redirect through the brief one-click
 * sign-in so they land signed-in on /my-tails with the pick showing as
 * tailed. Anything invalid or non-member goes to the plain card.
 */
export async function GET(req: Request) {
  const base = (process.env.NEXTAUTH_URL || "https://moylineai.com").replace(/\/$/, "");
  const toPicks = () => NextResponse.redirect(`${base}/picks`);

  const url = new URL(req.url);
  const email = (url.searchParams.get("e") || "").trim().toLowerCase();
  const pick = {
    date: (url.searchParams.get("d") || "").trim(),
    game: (url.searchParams.get("g") || "").trim(),
    play: (url.searchParams.get("p") || "").trim(),
    price: (url.searchParams.get("pr") || "").trim(),
  };
  const token = url.searchParams.get("t") || "";

  if (!email.includes("@") || !pick.game || !pick.play || !/^\d{4}-\d{2}-\d{2}$/.test(pick.date)) {
    return toPicks();
  }
  if (!verifyTail(email, pick, token)) return toPicks();

  const sub = await getSubscription(email);
  if (!(await hasAccess(email, sub))) return toPicks();

  try {
    await addTail(email, pick);
  } catch {
    // Storage hiccup — still land them signed-in on the card.
    return NextResponse.redirect(await briefSignInUrl(email, "/picks"));
  }
  return NextResponse.redirect(await briefSignInUrl(email, "/my-tails"));
}
