import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { removeSubscription } from "@/lib/push";

/** Removes the signed-in member's push subscription. */
export async function POST() {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase() || "";
  if (!email) {
    return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }
  await removeSubscription(email);
  return NextResponse.json({ ok: true });
}
