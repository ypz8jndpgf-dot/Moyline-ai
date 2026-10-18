import { NextResponse } from "next/server";
import { getTrackRecord, appendTrackPicks, type TrackPick, type TrackRecord } from "@/lib/store";
import { auth } from "@/lib/auth";
import { Redis } from "@upstash/redis";

export const dynamic = "force-dynamic";

const TRACK_REDIS_KEY = "moyline:track-record";

function checkAuth(req: Request): boolean {
  // Bearer token path (grader)
  const secret = (process.env.PICKS_UPDATE_SECRET || "").trim();
  const authHeader = req.headers.get("authorization");
  if (secret && authHeader === `Bearer ${secret}`) return true;
  return false;
}

async function checkAdminSession(): Promise<boolean> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase() || "";
  const admin = (process.env.ADMIN_EMAIL || "").toLowerCase();
  return !!(admin && email === admin);
}

/** Public: read the all-time record. */
export async function GET() {
  const rec = await getTrackRecord();
  return NextResponse.json(rec);
}

/**
 * Admin-only: append graded picks (dedupe: identical game+play+line+book
 * counted once). Auth via signed-in ADMIN_EMAIL, or via PICKS_UPDATE_SECRET
 * bearer token (for the off-Vercel grader).
 */
export async function POST(req: Request) {
  if (!checkAuth(req) && !(await checkAdminSession())) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  try {
    const body = await req.json();
    const picks = body.picks as Omit<TrackPick, "id">[];
    if (!Array.isArray(picks) || picks.length === 0) {
      return NextResponse.json({ error: "Body must include picks[]" }, { status: 400 });
    }
    for (const p of picks) {
      if (!p.game || !p.play || !p.line || !p.book || !p.result || !p.final || !p.date || !p.sport) {
        return NextResponse.json(
          { error: "Each pick needs: game, play, line, book, result, final, date, sport" },
          { status: 400 }
        );
      }
    }
    const result = await appendTrackPicks(picks);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Append failed" },
      { status: 500 }
    );
  }
}

/**
 * Admin-only: fully replace the track record (for dedupe/cleanup).
 * Body: full TrackRecord object. Auth: bearer token or admin session.
 */
export async function PUT(req: Request) {
  if (!checkAuth(req) && !(await checkAdminSession())) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  try {
    const body = (await req.json()) as TrackRecord;
    if (!body || !Array.isArray(body.picks) || !body.totals) {
      return NextResponse.json({ error: "Body must be a full TrackRecord" }, { status: 400 });
    }
    const url = (process.env.UPSTASH_REDIS_REST_URL || "").trim();
    const token = (process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
    if (!url || !token) {
      return NextResponse.json({ error: "Redis not configured" }, { status: 500 });
    }
    const redis = new Redis({ url, token });
    await redis.set(TRACK_REDIS_KEY, JSON.stringify(body));
    return NextResponse.json({
      ok: true,
      picks: body.picks.length,
      totals: body.totals,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Replace failed" },
      { status: 500 }
    );
  }
}
