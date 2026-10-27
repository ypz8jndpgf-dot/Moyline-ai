import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPrefs, setPrefs, PREF_BOOKS } from "@/lib/prefs";
import { SPORT_LABELS } from "@/lib/odds-shared";

export const dynamic = "force-dynamic";

/** Member personalization (steal #5): favorite sports + primary book. */
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
  let body: { sports?: unknown; book?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }
  const sports = Array.isArray(body.sports)
    ? body.sports
        .filter((s): s is string => typeof s === "string" && s in SPORT_LABELS)
        .slice(0, 13)
    : [];
  const book =
    typeof body.book === "string" &&
    (body.book === "" || PREF_BOOKS.some((b) => b.toLowerCase() === (body.book as string).toLowerCase()))
      ? PREF_BOOKS.find((b) => b.toLowerCase() === (body.book as string).toLowerCase()) || ""
      : "";
  const ok = await setPrefs(email, { sports, book });
  return NextResponse.json({ ok, prefs: { sports, book } });
}
