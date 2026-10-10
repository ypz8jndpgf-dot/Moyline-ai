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
        text: `Sign in to MoyLine AI:\n\n${url}\n\nThis link expires in 24 hours.`,
        html: `<p>Sign in to <strong>MoyLine AI</strong>:</p><p><a href="${url}">Sign in</a></p><p>This link expires in 24 hours.</p>`,
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
function getAdapter() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    return UpstashRedisAdapter(new Redis({ url, token }));
  }
  console.warn("[auth] Upstash env vars not set — using ephemeral file adapter (dev only).");
  return fileAdapter();
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
