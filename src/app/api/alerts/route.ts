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
  if (market !== "spread" && market !== "total" && market !== "moneyline" && market !== "prop") {
    return NextResponse.json(
      { ok: false, error: "Market must be spread, total, moneyline, or prop" },
      { status: 400 }
    );
  }
  if (market === "moneyline" && (!Number.isInteger(target) || target === 0 || Math.abs(target) < 100)) {
    return NextResponse.json(
      { ok: false, error: "Moneyline target must be an American price (e.g. -120 or +130)" },
      { status: 400 }
    );
  }
  // Prop alerts (optimization #73): the target is a LINE for one player +
  // parsed market, on one side. Player/market come from the Cheatsheet
  // leg the member tapped — validated to the same shapes parseProp emits.
  let prop: { player: string; propMarket: string; propLabel: string } | null = null;
  if (market === "prop") {
    const player = typeof body.player === "string" ? body.player.trim().slice(0, 80) : "";
    const propMarket = typeof body.propMarket === "string" ? body.propMarket.trim() : "";
    const propLabel = typeof body.propLabel === "string" ? body.propLabel.trim().slice(0, 60) : "";
    if (side !== "Over" && side !== "Under") {
      return NextResponse.json(
        { ok: false, error: "Prop side must be Over or Under" },
        { status: 400 }
      );
    }
    if (!player || !/^[a-zA-Z]{2,40}$/.test(propMarket)) {
      return NextResponse.json(
        { ok: false, error: "Prop alerts need a player and a market" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(target) || target < 0 || target > 1000) {
      return NextResponse.json(
        { ok: false, error: "Prop target must be a line (e.g. 24.5)" },
        { status: 400 }
      );
    }
    prop = { player, propMarket, propLabel };
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
    ...(prop
      ? { player: prop.player, propMarket: prop.propMarket, propLabel: prop.propLabel || undefined }
      : {}),
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
