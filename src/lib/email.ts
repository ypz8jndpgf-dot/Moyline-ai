import { Redis } from "@upstash/redis";
import { getSubscription, hasAccess } from "./store";

function cleanEnv(v: string | undefined): string {
  let s = (v || "").trim();
  const eq = s.indexOf("=");
  if (eq > 0 && /^[A-Z][A-Z0-9_]{2,}$/.test(s.slice(0, eq))) s = s.slice(eq + 1).trim();
  return s.replace(/^[\"']+|[\"']+$/g, "");
}

/**
 * BRIEF SEND MODE (user directive 2026-11-08 — supersedes the 2026-11-04
 * member pause on the brief path): while this mode is on, every
 * member-broadcast recipient list (getMemberEmails — brief bulk sends,
 * results recaps, steam alerts, the 5-alarm) resolves to the OWNER ONLY,
 * and the one-off send route refuses non-owner recipients. Members
 * receive nothing; unsubscribe/snooze logic is untouched (it still
 * filters the owner like anyone else).
 *
 * ONE-CHANGE FLIP: set BRIEF_SEND_MODE=members in the Vercel env to
 * restore normal member sends — no code edit. Unset defaults to "owner".
 */
export const OWNER_EMAIL = "amoyseowicz@gmail.com";
export const BRIEF_SEND_MODE = (process.env.BRIEF_SEND_MODE || "owner")
  .trim()
  .toLowerCase();
export const OWNER_ONLY_SENDS = BRIEF_SEND_MODE !== "members";

function redisClient(): Redis | null {
  const url = cleanEnv(process.env.UPSTASH_REDIS_REST_URL);
  const token = cleanEnv(process.env.UPSTASH_REDIS_REST_TOKEN);
  if (!url || !token) return null;
  return new Redis({ url, token });
}

/** All emails with current access: active subs + beta allowlist + admin, minus unsubscribes. */
export async function getMemberEmails(): Promise<string[]> {
  const out = new Set<string>();
  const redis = redisClient();

  if (redis) {
    try {
      let cursor = 0;
      do {
        const [next, keys] = await redis.scan(cursor, { match: "moyline:sub:*", count: 100 });
        cursor = Number(next);
        for (const key of keys as string[]) {
          const email = key.replace("moyline:sub:", "");
          try {
            const raw = await redis.get<string>(key);
            if (!raw) continue;
            const sub = (typeof raw === "string" ? JSON.parse(raw) : raw) as {
              status?: string;
              expiresAt?: string;
            };
            const active =
              sub.status === "active" || sub.status === "trialing"
                ? !sub.expiresAt || new Date(sub.expiresAt).getTime() > Date.now()
                : false;
            if (active && email.includes("@")) out.add(email.toLowerCase());
          } catch {
            /* skip bad records */
          }
        }
      } while (cursor !== 0);
    } catch {
      /* redis unavailable */
    }

    // Redis beta list (managed via /api/admin/beta), same source hasAccess()
    // reads in store.ts. Merged as a union source so members added via the
    // admin route reach bulk sends without an env-var redeploy. Fail soft:
    // an error here leaves the existing sources untouched.
    try {
      const betaMembers = await redis.smembers("moyline:beta");
      for (const m of betaMembers as string[]) {
        const e = String(m).trim().toLowerCase();
        if (e.includes("@")) out.add(e);
      }
    } catch {
      /* redis beta set unavailable — existing sources still apply */
    }
  }

  const beta = (process.env.BETA_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes("@"));
  for (const e of beta) out.add(e);

  const admin = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (admin.includes("@")) out.add(admin);

  // OWNER-ONLY MODE (2026-11-08): hard-restrict the broadcast list to the
  // owner alone, whatever the member sources above produced (defense in
  // depth — the filter lives here, not at each caller).
  if (OWNER_ONLY_SENDS) {
    out.clear();
    out.add(OWNER_EMAIL);
  }

  // Honor one-click unsubscribes and snoozes (paused briefs).
  if (redis) {
    try {
      const { isUnsubscribed, isSnoozed } = await import("./unsub");
      for (const e of [...out]) {
        if ((await isUnsubscribed(e)) || (await isSnoozed(e))) out.delete(e);
      }
    } catch {
      /* unsub lib unavailable — send anyway */
    }
  }

  return [...out];
}

/** Send a plain email via the configured SMTP (Resend). No-op when unconfigured. */
export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const server = process.env.EMAIL_SERVER;
  if (!server) {
    console.warn("[email] EMAIL_SERVER not set — skipping send to", to);
    return false;
  }
  const from = process.env.EMAIL_FROM || "MoyLine AI <noreply@moylineai.com>";
  try {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport(server);
    await transport.sendMail({ to, from, subject, html });
    return true;
  } catch (e) {
    console.error("[email] send failed:", e instanceof Error ? e.message : e);
    return false;
  }
}

/** Re-exported for routes that need the access check alongside member lists. */
export { hasAccess, getSubscription };
