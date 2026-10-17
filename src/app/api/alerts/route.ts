import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAlerts, addAlert, removeAlert } from "@/lib/alerts";

export const dynamic = "force-dynamic";

/** GET /api/alerts — list the user's line alerts. */
export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }
  const alerts = await getAlerts(email);
  return NextResponse.json({ ok: true, alerts });
}

/** POST /api/alerts — create a line alert. */
export async function POST(req: NextRequest) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }
  const body = await req.json();
  const { game, gameLabel, market, side, target } = body;
  if (!game || !gameLabel || !market || !side || typeof target !== "number") {
    return NextResponse.json(
      { ok: false, error: "Missing game, gameLabel, market, side, or target" },
      { status: 400 }
    );
  }
  if (market !== "spread" && market !== "total") {
    return NextResponse.json({ ok: false, error: "Market must be spread or total" }, { status: 400 });
  }
  // Cap at 20 active alerts per user.
  const existing = await getAlerts(email);
  const active = existing.filter((a) => !a.triggered_at);
  if (active.length >= 20) {
    return NextResponse.json(
      { ok: false, error: "Alert limit reached (20). Cancel one to add another." },
      { status: 400 }
    );
  }
  const alert = await addAlert(email, {
    game,
    gameLabel,
    market,
    side,
    target,
    direction: "at-or-better",
  });
  return NextResponse.json({ ok: true, alert });
}

/** DELETE /api/alerts?id=xxx — cancel an alert. */
export async function DELETE(req: NextRequest) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });
  }
  const removed = await removeAlert(email, id);
  return NextResponse.json({ ok: true, removed });
}
