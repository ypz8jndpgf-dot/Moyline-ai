import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const ADMIN = (process.env.ADMIN_EMAIL || "").toLowerCase();

/**
 * Redis storage diagnostic (Nov 26, 2026). The Moyline-auth Upstash
 * database hit 70% of the free-plan storage limit; its credentials are
 * Vercel "sensitive" env vars that the API cannot read back, so this
 * route reports key sizes from inside the app's own runtime instead.
 * GET /api/admin/redis-info -> { dbsize, usedMemoryHuman, totalBytes,
 * top: [{ key, type, bytes }] } (top 25 keys by size).
 * Bearer PICKS_UPDATE_SECRET or an admin session, same as /api/admin/beta.
 */
async function authorized(req: NextRequest): Promise<boolean> {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret && secret === process.env.PICKS_UPDATE_SECRET) return true;
  const session = await auth();
  return !!session?.user?.email && session.user.email.toLowerCase() === ADMIN;
}

async function cmd(url: string, token: string, args: (string | number)[]) {
  const res = await fetch(`${url}/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const data = (await res.json().catch(() => null)) as { result?: unknown } | null;
  return data?.result;
}

export async function GET(req: NextRequest) {
  if (!(await authorized(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = (process.env.UPSTASH_REDIS_REST_URL || "").trim();
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  if (!url || !token)
    return NextResponse.json({ error: "redis not configured" }, { status: 500 });

  const dbsize = await cmd(url, token, ["DBSIZE"]);
  const info = await cmd(url, token, ["INFO", "memory"]);
  let usedMemoryHuman: string | null = null;
  if (typeof info === "string") {
    const m = info.match(/used_memory_human:(\S+)/);
    if (m) usedMemoryHuman = m[1].trim();
  }

  const sizes: { key: string; type: string; bytes: number }[] = [];
  let cursor = "0";
  do {
    const res = (await cmd(url, token, ["SCAN", cursor, "COUNT", "500"])) as
      | [string, string[]]
      | undefined;
    if (!res) break;
    cursor = res[0];
    for (const key of res[1]) {
      const type = String(await cmd(url, token, ["TYPE", key]));
      let bytes = 0;
      if (type === "string") {
        bytes = Number(await cmd(url, token, ["STRLEN", key])) || 0;
      } else {
        bytes = Number(await cmd(url, token, ["MEMORY", "USAGE", key])) || 0;
      }
      sizes.push({ key, type, bytes });
    }
  } while (cursor !== "0");

  sizes.sort((a, b) => b.bytes - a.bytes);
  const totalBytes = sizes.reduce((s, x) => s + x.bytes, 0);
  return NextResponse.json({
    ok: true,
    dbsize,
    usedMemoryHuman,
    totalBytes,
    top: sizes.slice(0, 25),
  });
}
