import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { Redis } from "@upstash/redis";

const ADMIN = (process.env.ADMIN_EMAIL || "").toLowerCase();

function getRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

/**
 * Admin beta-list management. No redeploy needed — changes take effect immediately.
 * GET    /api/admin/beta          -> { members: [...] }
 * POST   /api/admin/beta { email } -> adds one
 * DELETE /api/admin/beta { email } -> removes one
 * Bearer PICKS_UPDATE_SECRET also accepted (for CLI/script use).
 */
async function authorized(req: NextRequest): Promise<boolean> {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret && secret === process.env.PICKS_UPDATE_SECRET) return true;
  const session = await auth();
  return !!session?.user?.email && session.user.email.toLowerCase() === ADMIN;
}

export async function GET(req: NextRequest) {
  if (!(await authorized(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "redis not configured" }, { status: 500 });
  const members = await redis.smembers("moyline:beta");
  return NextResponse.json({ members: (members || []).sort() });
}

export async function POST(req: NextRequest) {
  if (!(await authorized(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { email } = await req.json();
  if (!email || typeof email !== "string" || !email.includes("@"))
    return NextResponse.json({ error: "valid email required" }, { status: 400 });
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "redis not configured" }, { status: 500 });
  const normalized = email.trim().toLowerCase();
  await redis.sadd("moyline:beta", normalized);
  const members = await redis.smembers("moyline:beta");
  return NextResponse.json({ added: normalized, count: members?.length || 0 });
}

export async function DELETE(req: NextRequest) {
  if (!(await authorized(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { email } = await req.json();
  if (!email || typeof email !== "string")
    return NextResponse.json({ error: "email required" }, { status: 400 });
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "redis not configured" }, { status: 500 });
  const normalized = email.trim().toLowerCase();
  await redis.srem("moyline:beta", normalized);
  const members = await redis.smembers("moyline:beta");
  return NextResponse.json({ removed: normalized, count: members?.length || 0 });
}
