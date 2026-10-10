import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { readTails, writeTails, Tail } from "@/lib/tails";

export const dynamic = "force-dynamic";

const tailId = (t: { game: string; play: string; date: string }) =>
  `${t.game.toLowerCase()}|${t.play.toLowerCase()}|${t.date}`;

/** List the signed-in member's tailed picks. */
export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  return NextResponse.json({ tails: await readTails(email) });
}

/**
 * Toggle a tailed pick: { game, play, price?, date? }.
 * Tailing an already-tailed pick removes it.
 */
export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  let body: { game?: string; play?: string; price?: string; date?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.game || !body.play) {
    return NextResponse.json({ error: "game and play required" }, { status: 400 });
  }

  const todayET = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const tails = await readTails(email);
  const id = tailId({ game: body.game, play: body.play, date: body.date || todayET });
  const existing = tails.findIndex((t) => tailId(t) === id);

  let tailed: boolean;
  if (existing >= 0) {
    tails.splice(existing, 1);
    tailed = false;
  } else {
    const tail: Tail = {
      game: body.game,
      play: body.play,
      price: body.price || "",
      date: body.date || todayET,
      tailedAt: new Date().toISOString(),
    };
    tails.push(tail);
    tailed = true;
  }
  await writeTails(email, tails);
  return NextResponse.json({ tailed, count: tails.length });
}
