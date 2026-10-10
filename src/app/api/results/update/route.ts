import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

export const dynamic = "force-dynamic";

const RESULTS_PREFIX = "moyline:results:";

export type DayResults = {
  date: string; // YYYY-MM-DD (ET) — the day that was graded
  wins: number;
  losses: number;
  pushes: number;
  /** Short plain-language recap lines, e.g. "★ Nevada -9.5 cashed 28-14". */
  highlights: string[];
  updated_at: string;
};

function cleanEnv(v: string | undefined): string {
  let s = (v || "").trim();
  const eq = s.indexOf("=");
  if (eq > 0 && /^[A-Z][A-Z0-9_]{2,}$/.test(s.slice(0, eq))) s = s.slice(eq + 1).trim();
  return s.replace(/^[\"']+|[\"']+$/g, "");
}

function isValid(b: unknown): b is Omit<DayResults, "updated_at"> {
  if (!b || typeof b !== "object") return false;
  const f = b as Record<string, unknown>;
  return (
    typeof f.date === "string" &&
    typeof f.wins === "number" &&
    typeof f.losses === "number" &&
    typeof f.pushes === "number" &&
    Array.isArray(f.highlights)
  );
}

/**
 * Receives the graded day's results from the 6:30am results grader
 * (off-Vercel worker). Authenticated with PICKS_UPDATE_SECRET.
 * The morning-results cron reads this to email members.
 */
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
  if (!isValid(body)) {
    return NextResponse.json({ ok: false, error: "Invalid results shape" }, { status: 400 });
  }

  const url = cleanEnv(process.env.UPSTASH_REDIS_REST_URL);
  const token = cleanEnv(process.env.UPSTASH_REDIS_REST_TOKEN);
  if (!url || !token) {
    return NextResponse.json({ ok: false, error: "Upstash not configured" }, { status: 500 });
  }

  try {
    const redis = new Redis({ url, token });
    const record: DayResults = { ...body, updated_at: new Date().toISOString() };
    await redis.set(RESULTS_PREFIX + body.date, JSON.stringify(record), { ex: 7 * 24 * 3600 });
    return NextResponse.json({ ok: true, date: body.date });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "Redis write failed" },
      { status: 500 }
    );
  }
}
