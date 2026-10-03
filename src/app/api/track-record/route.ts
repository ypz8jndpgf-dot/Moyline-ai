import { NextResponse } from "next/server";
import { getTrackRecord, appendTrackPicks, type TrackPick } from "@/lib/store";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Public: read the all-time record. */
export async function GET() {
  const rec = await getTrackRecord();
  return NextResponse.json(rec);
}

/**
 * Admin-only: append graded picks (dedupe: identical game+play+line+book
 * counted once). Auth via signed-in ADMIN_EMAIL.
 */
export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase() || "";
  const admin = (process.env.ADMIN_EMAIL || "").toLowerCase();
  if (!admin || email !== admin) {
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
