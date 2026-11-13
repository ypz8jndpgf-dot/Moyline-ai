import { createHmac, timingSafeEqual } from "crypto";

/**
 * Share-your-tail-record card (optimization #75).
 *
 * A member can post their own tail record ("My tails: 14-9 · +3.2u") as
 * a branded card. The numbers on that card must be the member's REAL
 * stored tails, never something a URL can invent — so the /my-tails
 * page (server-side, from the graded tails it already computed) signs
 * the exact stat snapshot with the server secret, and both the landing
 * page and the OG image route verify the signature before rendering a
 * single number. An unsigned or tampered link renders a generic card
 * with no record on it at all.
 *
 * Same HMAC pattern as the tail links (lib/tail-link.ts): the secret is
 * the auth secret, the token is a truncated hex digest, verification
 * is timing-safe. The snapshot carries no identity — the card shows a
 * record, not a name or an email.
 */

export type RecordShareStats = {
  w: number;
  l: number;
  p: number;
  /** Units over the priced graded tails (flat 1u risked, tailed price). */
  units: number;
  /** Graded tails the units figure is computed over. */
  priced: number;
  /** All graded tails (W+L+P). */
  graded: number;
};

function cleanEnv(v: string | undefined): string {
  let s = (v || "").trim();
  const eq = s.indexOf("=");
  if (eq > 0 && /^[A-Z][A-Z0-9_]{2,}$/.test(s.slice(0, eq))) s = s.slice(eq + 1).trim();
  return s.replace(/^["']+|["']+$/g, "");
}

function signingSecret(): string {
  return (
    cleanEnv(process.env.NEXTAUTH_SECRET) ||
    cleanEnv(process.env.AUTH_SECRET) ||
    cleanEnv(process.env.CRON_SECRET) ||
    "moyline-tail-fallback"
  );
}

function payload(s: RecordShareStats): string {
  return [
    "record",
    String(Math.trunc(s.w)),
    String(Math.trunc(s.l)),
    String(Math.trunc(s.p)),
    s.units.toFixed(2),
    String(Math.trunc(s.priced)),
    String(Math.trunc(s.graded)),
  ].join("|");
}

/** HMAC token binding the exact stat snapshot. URL-safe hex. */
export function signRecordShare(stats: RecordShareStats): string {
  return createHmac("sha256", signingSecret()).update(payload(stats)).digest("hex").slice(0, 32);
}

export function verifyRecordShare(stats: RecordShareStats, token: string): boolean {
  const expected = signRecordShare(stats);
  const a = Buffer.from(token || "");
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** "14-9" / "14-9-2" — pushes shown only when any tail pushed. */
export function recordLabel(s: Pick<RecordShareStats, "w" | "l" | "p">): string {
  return s.p > 0 ? `${s.w}-${s.l}-${s.p}` : `${s.w}-${s.l}`;
}

/**
 * Query params for the share link / card image, from a stat snapshot
 * the server computed. `u` is fixed at 2dp so the signature payload and
 * the re-parsed values can never drift apart.
 */
export function recordShareParams(stats: RecordShareStats): URLSearchParams {
  return new URLSearchParams({
    w: String(Math.trunc(stats.w)),
    l: String(Math.trunc(stats.l)),
    p: String(Math.trunc(stats.p)),
    u: stats.units.toFixed(2),
    pr: String(Math.trunc(stats.priced)),
    g: String(Math.trunc(stats.graded)),
    s: signRecordShare(stats),
  });
}

/**
 * Strictly parse + verify share params (landing page and OG route).
 * Returns the stats only when every field is a clean bounded number
 * AND the signature matches; otherwise null — callers render a generic
 * card, never unverified numbers.
 */
export function parseRecordShare(get: (key: string) => string | null): RecordShareStats | null {
  const int = (k: string): number | null => {
    const v = get(k);
    if (v === null || !/^\d{1,6}$/.test(v)) return null;
    return parseInt(v, 10);
  };
  const w = int("w");
  const l = int("l");
  const p = int("p");
  const priced = int("pr");
  const graded = int("g");
  const uRaw = get("u");
  if (w === null || l === null || p === null || priced === null || graded === null) return null;
  if (uRaw === null || !/^-?\d{1,6}(\.\d{1,2})?$/.test(uRaw)) return null;
  const stats: RecordShareStats = { w, l, p, units: parseFloat(uRaw), priced, graded };
  if (graded !== w + l + p || priced > graded) return null;
  const token = get("s");
  if (!token || !verifyRecordShare(stats, token)) return null;
  return stats;
}
