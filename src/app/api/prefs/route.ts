import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPrefs, setPrefs, PREF_BOOKS } from "@/lib/prefs";
import { SPORT_LABELS } from "@/lib/odds-shared";

export const dynamic = "force-dynamic";

/** Member personalization (steal #5): favorite sports + primary book + tail alerts. */
export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const prefs = await getPrefs(email);
  return NextResponse.json({ ok: true, prefs });
}

export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { sports?: unknown; book?: unknown; tailAlerts?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }
  // Merge semantics: a field that isn't sent keeps its stored value, so
  // the tail-alerts toggle can POST just { tailAlerts } without wiping
  // the member's sports/book (and vice versa).
  const current = await getPrefs(email);
  const sports =
    body.sports === undefined
      ? current.sports
      : Array.isArray(body.sports)
        ? body.sports
            .filter((s): s is string => typeof s === "string" && s in SPORT_LABELS)
            .slice(0, 13)
        : [];
  const book =
    body.book === undefined
      ? current.book
      : typeof body.book === "string" &&
          (body.book === "" || PREF_BOOKS.some((b) => b.toLowerCase() === (body.book as string).toLowerCase()))
        ? PREF_BOOKS.find((b) => b.toLowerCase() === (body.book as string).toLowerCase()) || ""
        : "";
  const tailAlerts =
    body.tailAlerts === undefined ? current.tailAlerts : body.tailAlerts === true;
  const prefs = { sports, book, tailAlerts };
  const ok = await setPrefs(email, prefs);
  return NextResponse.json({ ok, prefs });
}
