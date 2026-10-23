import NextAuth from "next-auth";
import Nodemailer from "next-auth/providers/nodemailer";
import { Redis } from "@upstash/redis";
import { UpstashRedisAdapter } from "@auth/upstash-redis-adapter";
import { fileAdapter } from "./auth-adapter";

/**
 * NextAuth v5 config. Email (magic link) provider.
 *
 * Required env:
 *   NEXTAUTH_SECRET, NEXTAUTH_URL
 *   EMAIL_SERVER  — SMTP URL, e.g. smtp://user:pass@smtp.resend.com:587
 *   EMAIL_FROM    — e.g. "MoyLine AI <noreply@yourdomain.com>"
 *
 * Dev fallback: if EMAIL_SERVER is unset, the magic link is printed to the
 * server console instead of emailed (local development only).
 */
function emailProvider() {
  const server = process.env.EMAIL_SERVER;
  const from = process.env.EMAIL_FROM || "MoyLine AI <noreply@moyline.ai>";

  if (!server) {
    console.warn("[auth] EMAIL_SERVER not set — magic links will be logged to console (dev only).");
  }

  return Nodemailer({
    server: server || "smtp://localhost:1025",
    from,
    async sendVerificationRequest({ identifier, url }) {
      if (!server) {
        console.log(`[auth] Magic link for ${identifier}: ${url}`);
        return;
      }
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.createTransport(server);
      await transport.sendMail({
        to: identifier,
        from,
        subject: "Sign in to MoyLine AI",
        text:
          `Sign in to MoyLine AI:\n\n${url}\n\nThis link expires in 24 hours.\n\n` +
          `IMPORTANT — open the link in your browser (Safari or Chrome), not inside an email app. ` +
          `If you're reading this in the Gmail app: long-press the link and tap "Open in Safari" (or copy it into your browser). ` +
          `Links opened inside Gmail's built-in browser don't stay signed in.`,
        html: `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0a0a0a;">
          <tr><td align="center" style="padding:0;">
          <table role="presentation" width="720" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:720px;background-color:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">
            <tr><td style="background-color:#0a0a0a;border-bottom:3px solid #f5c518;padding:30px 24px 22px 24px;text-align:center;">
              <div style="font-size:32px;font-weight:900;color:#f5c518;letter-spacing:5px;line-height:1;">MOYLINE AI</div>
              <div style="font-size:12px;font-weight:700;color:#ffe9a3;letter-spacing:7px;margin-top:10px;">SIGN IN</div>
            </td></tr>
            <tr><td style="padding:28px 24px 30px 24px;text-align:center;">
              <p style="color:#eeeeee;font-size:16px;margin:0 0 22px;">Tap below to sign in — no password needed.</p>
              <a href="${url}" style="display:inline-block;background:#f5c518;color:#0a0a0a;font-weight:900;padding:14px 40px;border-radius:10px;text-decoration:none;font-size:16px;">SIGN IN →</a>
              <p style="color:#888888;font-size:12px;margin:20px 0 0;">This link expires in 24 hours.</p>
              <div style="border:1px solid #333;margin:26px auto 0;max-width:560px;text-align:left;">
                <div style="background:#1a1a1a;border-bottom:2px solid #f5c518;padding:10px 14px;color:#f5c518;font-size:11px;font-weight:800;letter-spacing:1px;">ON YOUR PHONE? READ THIS FIRST</div>
                <p style="color:#cccccc;font-size:13px;line-height:1.55;margin:0;padding:14px;">Open the link in <strong style="color:#ffffff;">Safari or Chrome</strong> — not inside an email app. If you're reading this in the Gmail app, <strong style="color:#ffffff;">long-press the button and tap "Open in Safari"</strong> (or copy the link into your browser). Links opened inside Gmail's built-in browser don't stay signed in.</p>
              </div>
            </td></tr>
          </table>
          </td></tr>
          </table>`,
      });
    },
  });
}

/**
 * Adapter: Upstash Redis in production (durable across serverless instances),
 * file adapter as a local-dev fallback. The file adapter cannot work on Vercel —
 * the filesystem is ephemeral, so verification tokens written by one instance
 * are invisible to the next and every magic link fails.
 */
function cleanEnv(v: string | undefined): string {
  // Defensively normalize pasted values: strip whitespace, a pasted `KEY=` prefix
  // (e.g. copying the whole `UPSTASH_REDIS_REST_TOKEN="..."` line), and
  // surrounding quotes.
  let s = (v || "").trim();
  const eq = s.indexOf("=");
  // Only strip a KEY= prefix when it looks like an env var name (ALL_CAPS).
  // A bare base64 token may itself contain "=" padding — never strip that.
  if (eq > 0 && /^[A-Z][A-Z0-9_]{2,}$/.test(s.slice(0, eq))) {
    s = s.slice(eq + 1).trim();
  }
  return s.replace(/^["']+|["']+$/g, "");
}

function getAdapter() {
  const url = cleanEnv(process.env.UPSTASH_REDIS_REST_URL);
  const token = cleanEnv(process.env.UPSTASH_REDIS_REST_TOKEN);
  if (url && token) {
    if (!/^https:\/\//.test(url)) {
      throw new Error(
        `[auth] UPSTASH_REDIS_REST_URL looks malformed (${url.slice(0, 12)}…). ` +
          `It should be the bare https:// REST URL from Upstash, with no quotes.`
      );
    }
    return UpstashRedisAdapter(new Redis({ url, token }));
  }
  console.warn("[auth] Upstash env vars not set — using ephemeral file adapter (dev only).");
  return fileAdapter();
}

/** Exposed for server utilities that need the same adapter NextAuth uses
 *  (e.g. minting one-click sign-in tokens for brief emails). */
export function getAuthAdapter() {
  return getAdapter();
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: getAdapter(),
  session: { strategy: "jwt" },
  trustHost: true,
  providers: [emailProvider()],
  pages: {
    signIn: "/signin",
  },
  callbacks: {
    async session({ session, token }) {
      if (session.user && token.sub) {
        (session.user as { id?: string }).id = token.sub;
      }
      return session;
    },
  },
});
