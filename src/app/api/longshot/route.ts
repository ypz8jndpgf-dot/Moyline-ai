import { NextResponse } from "next/server";
import {
  addLongshotEntries,
  getLongshotEntries,
  longshotTally,
  type LongshotEntry,
} from "@/lib/longshot";

export const dynamic = "force-dynamic";

function cleanEnv(v: string | undefined): string {
  let s = (v || "").trim();
  const eq = s.indexOf("=");
  if (eq > 0 && /^[A-Z][A-Z0-9_]{2,}$/.test(s.slice(0, eq))) s = s.slice(eq + 1).trim();
  return s.replace(/^["']+|["']+$/g, "");
}

/** Public read: the Longshot Ledger is a public tally by design. */
export async function GET() {
  const entries = await getLongshotEntries();
  return NextResponse.json({ ok: true, entries, tally: longshotTally(entries) });
}

function isValidEntry(e: unknown): e is LongshotEntry {
  if (!e || typeof e !== "object") return false;
  const x = e as Record<string, unknown>;
  return (
    typeof x.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(x.date) &&
    typeof x.game === "string" &&
    typeof x.play === "string" &&
    typeof x.price === "string" &&
    (x.result === "Win" || x.result === "Loss" || x.result === "Push")
  );
}

/** Grader write: bearer-authenticated like the other results endpoints. */
export async function POST(req: Request) {
  const secret = cleanEnv(process.env.PICKS_UPDATE_SECRET);
  if (!secret) {
    return NextResponse.json({ ok: false, error: "PICKS_UPDATE_SECRET not configured" }, { status: 500 });
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
  const entries = (body as { entries?: unknown })?.entries;
  if (!Array.isArray(entries) || !entries.every(isValidEntry)) {
    return NextResponse.json({ ok: false, error: "Invalid entries" }, { status: 400 });
  }
  try {
    const count = await addLongshotEntries(entries as LongshotEntry[]);
    return NextResponse.json({ ok: true, count });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "write failed" },
      { status: 500 }
    );
  }
}
