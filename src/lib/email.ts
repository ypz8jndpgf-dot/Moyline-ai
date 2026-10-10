import { Redis } from "@upstash/redis";
import { getSubscription, hasAccess } from "./store";

function cleanEnv(v: string | undefined): string {
  let s = (v || "").trim();
  const eq = s.indexOf("=");
  if (eq > 0 && /^[A-Z][A-Z0-9_]{2,}$/.test(s.slice(0, eq))) s = s.slice(eq + 1).trim();
  return s.replace(/^[\"']+|[\"']+$/g, "");
}

function redisClient(): Redis | null {
  const url = cleanEnv(process.env.UPSTASH_REDIS_REST_URL);
  const token = cleanEnv(process.env.UPSTASH_REDIS_REST_TOKEN);
  if (!url || !token) return null;
  return new Redis({ url, token });
}

/** All emails with current access: active subs + beta allowlist + admin. */
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
  }

  const beta = (process.env.BETA_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes("@"));
  for (const e of beta) out.add(e);

  const admin = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (admin.includes("@")) out.add(admin);

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
