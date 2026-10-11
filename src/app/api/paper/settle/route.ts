import { NextResponse } from "next/server";
import { settlePaperBets, getBankroll } from "@/lib/paper";

function cleanEnv(v: string | undefined): string {
  let s = (v || "").trim();
  const eq = s.indexOf("=");
  if (eq > 0 && /^[A-Z][A-Z0-9_]{2,}$/.test(s.slice(0, eq))) {
    s = s.slice(eq + 1).trim();
  }
  return s.replace(/^["']+|["']+$/g, "");
}

interface Grade {
  game: string;
  play: string;
  result: "win" | "loss" | "push";
}

function isValidBody(b: unknown): b is { date: string; grades: Grade[] } {
  const o = b as Record<string, unknown>;
  return (
    !!o &&
    typeof o.date === "string" &&
    Array.isArray(o.grades) &&
    o.grades.every(
      (g: unknown) => {
        const gg = g as Record<string, unknown>;
        return (
          typeof gg.game === "string" &&
          typeof gg.play === "string" &&
          ["win", "loss", "push"].includes(gg.result as string)
        );
      }
    )
  );
}

/**
 * Settles open paper bets against the grader's per-pick results.
 * Called by the 6:30am results grader (off-Vercel worker).
 * Authenticated with the PICKS_UPDATE_SECRET Bearer <redacted>
 */
export async function POST(req: Request) {
  const secret = cleanEnv(process.env.PICKS_UPDATE_SECRET);
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "PICKS_UPDATE_SECRET not configured" },
      { status: 500 }
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  if (!isValidBody(body)) {
    return NextResponse.json({ ok: false, error: "Invalid body shape" }, { status: 400 });
  }

  try {
    const settled = await settlePaperBets(body.grades);
    const bankroll = await getBankroll();
    const dayPnl = Math.round(settled.reduce((s, b) => s + (b.pnl || 0), 0) * 100) / 100;
    return NextResponse.json({
      ok: true,
      settled: settled.length,
      day_pnl: dayPnl,
      bankroll: Math.round(bankroll * 100) / 100,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "settle failed" },
      { status: 500 }
    );
  }
}
