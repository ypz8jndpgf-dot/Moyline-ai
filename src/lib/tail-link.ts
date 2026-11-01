import { createHmac, timingSafeEqual } from "crypto";
import { readTails, writeTails, type Tail } from "@/lib/tails";

/**
 * "Tailed it" links for the brief email (optimization #31).
 *
 * The brief HTML carries one placeholder per grid pick:
 *   {{TAIL_URL|YYYY-MM-DD|Game|Play|Price}}
 * with the date/game/play/price copied EXACTLY from the feed pick. At send
 * time (send + send-bulk routes) each placeholder is replaced per recipient
 * with a signed /api/tail URL — an HMAC over the recipient + pick identity,
 * the same pattern as the unsubscribe link (lib/unsub.ts). The /api/tail
 * route verifies the signature, records the tail idempotently (a click
 * ADDS; it never toggles off a tail the member set in the app), then lands
 * the member signed-in on /my-tails via the brief one-click sign-in token.
 */

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

export interface TailPick {
  date: string;
  game: string;
  play: string;
  price: string;
}

function payload(email: string, pick: TailPick): string {
  return [
    "tail",
    email.trim().toLowerCase(),
    pick.date.trim(),
    pick.game.trim(),
    pick.play.trim(),
    pick.price.trim(),
  ].join("|");
}

/** HMAC token binding a recipient to one exact pick. URL-safe hex. */
export function signTail(email: string, pick: TailPick): string {
  return createHmac("sha256", signingSecret()).update(payload(email, pick)).digest("hex").slice(0, 32);
}

export function verifyTail(email: string, pick: TailPick, token: string): boolean {
  const expected = signTail(email, pick);
  const a = Buffer.from(token || "");
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function tailUrl(email: string, pick: TailPick): string {
  const base = (process.env.NEXTAUTH_URL || "https://moylineai.com").replace(/\/$/, "");
  const qs = new URLSearchParams({
    e: email.trim().toLowerCase(),
    d: pick.date.trim(),
    g: pick.game.trim(),
    p: pick.play.trim(),
    pr: pick.price.trim(),
    t: signTail(email, pick),
  });
  return `${base}/api/tail?${qs.toString()}`;
}

const TAIL_PLACEHOLDER = /\{\{TAIL_URL\|([^}]*)\}\}/g;

/**
 * Replace every {{TAIL_URL|date|game|play|price}} placeholder in a brief's
 * HTML with this recipient's signed tail link. Malformed placeholders fall
 * back to the plain card URL rather than shipping a broken link.
 */
export function replaceTailLinks(html: string, email: string): string {
  const base = (process.env.NEXTAUTH_URL || "https://moylineai.com").replace(/\/$/, "");
  return html.replace(TAIL_PLACEHOLDER, (_m, inner: string) => {
    const parts = String(inner).split("|").map((s) => s.trim());
    if (parts.length < 4) return `${base}/picks`;
    const [date, game, play, ...rest] = parts;
    const price = rest.join("|");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !game || !play) return `${base}/picks`;
    return tailUrl(email, { date, game, play, price });
  });
}

const tailId = (t: { game: string; play: string; date: string }) =>
  `${t.game.toLowerCase()}|${t.play.toLowerCase()}|${t.date}`;

/**
 * Record a tail from an email click. ADD-only (never toggles off), matching
 * the /api/tails identity so an in-app tail and an email tail are one row.
 * Returns true when the pick is tailed after the call.
 */
export async function addTail(email: string, pick: TailPick): Promise<boolean> {
  const tails = await readTails(email);
  const id = tailId(pick);
  if (tails.some((t) => tailId(t) === id)) return true;
  const tail: Tail = {
    game: pick.game.trim(),
    play: pick.play.trim(),
    price: pick.price.trim(),
    date: pick.date.trim(),
    tailedAt: new Date().toISOString(),
  };
  tails.push(tail);
  await writeTails(email, tails);
  return true;
}
