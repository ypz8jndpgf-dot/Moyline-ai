import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

/**
 * Diagnostic v2: inspect the Lua eval directly.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const results: Record<string, unknown> = {};

  try {
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });

    // Test the exact Lua script from placePaperBets
    const BETS_KEY = "moyline:paper:bets";
    const BANKROLL_KEY = "moyline:paper:bankroll";

    const candidates = [{
      id: "2026-10-16-card-diag-test-unique-12345",
      date: "2026-10-16",
      game: "Diag Test Game",
      play: "Under 99.5",
      price: "-110",
      odds: -110,
      stake: 10,
      status: "open",
      pnl: null,
      placed_at: new Date().toISOString(),
      source: "card",
    }];

    const script = `
      local raw = redis.call("GET", KEYS[1])
      local bets = {}
      if raw then bets = cjson.decode(raw) end
      local have = {}
      for _, b in ipairs(bets) do have[b.id] = true end
      local added = {}
      for _, c in ipairs(cjson.decode(ARGV[1])) do
        if not have[c.id] then
          bets[#bets + 1] = c
          added[#added + 1] = c
          have[c.id] = true
        end
      end
      if #added > 0 then
        redis.call("SET", KEYS[1], cjson.encode(bets))
        redis.call("INCRBYFLOAT", KEYS[2], 0 - (tonumber(ARGV[2]) * #added))
      end
      return cjson.encode(added)
    `;

    results.eval_type = typeof redis.eval;
    
    // Try the eval
    const out = await redis.eval(script, [BETS_KEY, BANKROLL_KEY], [
      JSON.stringify(candidates),
      "10",
    ]);
    
    results.eval_result = out;
    results.eval_result_type = typeof out;

    // Check if it was added
    const bets = await redis.get<any[]>(BETS_KEY);
    const found = bets?.find((b: any) => b.id === candidates[0].id);
    results.found_in_bets = !!found;

    // Clean up the test bet
    if (found && bets) {
      const filtered = bets.filter((b: any) => b.id !== candidates[0].id);
      await redis.set(BETS_KEY, filtered);
      // Refund the bankroll
      await redis.incrbyfloat(BANKROLL_KEY, 10);
      results.cleaned_up = true;
    }

    return NextResponse.json({ ok: true, ...results });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack?.split("\n").slice(0, 8) : undefined,
    }, { status: 200 });
  }
}
