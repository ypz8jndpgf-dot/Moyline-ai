import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sendTestPush, tryConsumeTestPush } from "@/lib/push";

export const dynamic = "force-dynamic";

/**
 * POST /api/push/test — "Send me a test push" (Optimization #63).
 *
 * Member-only: sends one test notification to the CALLER's own stored
 * push subscription, through the same delivery path as real alerts, so
 * a member can confirm alerts actually work. Never a broadcast — the
 * recipient is always the signed-in member's own subscription.
 * Rate-limited per member (see tryConsumeTestPush in lib/push).
 *
 * Outcomes are reported honestly: ok:true only when the push service
 * accepted the notification. Expected failure states come back as
 * 200 { ok:false, reason, error } so the bell can show the plain reason.
 */
export async function POST() {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase() || "";
  if (!email) {
    return NextResponse.json(
      { ok: false, reason: "signed-out", error: "Sign in required" },
      { status: 401 }
    );
  }

  const quota = await tryConsumeTestPush(email);
  if (quota === "limited") {
    return NextResponse.json(
      {
        ok: false,
        reason: "rate-limited",
        error: "Too many test pushes — wait a bit and try again.",
      },
      { status: 429 }
    );
  }
  if (quota === "unavailable") {
    return NextResponse.json(
      {
        ok: false,
        reason: "unavailable",
        error: "Push storage is unavailable right now — try again shortly.",
      },
      { status: 500 }
    );
  }

  const outcome = await sendTestPush(email);
  switch (outcome) {
    case "sent":
      return NextResponse.json({ ok: true });
    case "no-subscription":
      return NextResponse.json({
        ok: false,
        reason: "no-subscription",
        error:
          "No subscription saved for your account yet — turn alerts on first.",
      });
    case "expired":
      return NextResponse.json({
        ok: false,
        reason: "expired",
        error:
          "Your saved subscription had expired and was removed — tap the bell off and on again, then retest.",
      });
    case "rejected":
      return NextResponse.json({
        ok: false,
        reason: "rejected",
        error:
          "The push service rejected the test — check this device's notification settings, then try again.",
      });
    case "not-configured":
      return NextResponse.json(
        {
          ok: false,
          reason: "not-configured",
          error: "Push isn't configured on the server yet.",
        },
        { status: 500 }
      );
    case "unavailable":
      return NextResponse.json(
        {
          ok: false,
          reason: "unavailable",
          error: "Push storage is unavailable right now — try again shortly.",
        },
        { status: 500 }
      );
  }
}
