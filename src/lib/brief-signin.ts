import { createHash, randomBytes } from "crypto";
import { getAuthAdapter } from "@/lib/auth";

/**
 * One-click sign-in links for brief emails.
 *
 * Mints a real NextAuth email verification token (the same credential a
 * magic link carries — SHA-256 of `${token}${secret}` in the adapter store,
 * raw token in the URL) and returns the NextAuth callback URL, so a member
 * tapping the brief's card button lands on /picks already signed in. The
 * token is single-use and expires in 24 hours, exactly like a magic link,
 * because it IS one — just delivered inside the brief instead of as a
 * separate email. Any failure falls back to the plain /picks URL.
 */
export async function briefSignInUrl(email: string): Promise<string> {
  const base = (process.env.NEXTAUTH_URL || "https://moylineai.com").replace(/\/$/, "");
  const fallback = `${base}/picks`;
  try {
    const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";
    if (!secret) return fallback;

    const identifier = email.trim().toLowerCase();
    const token = randomBytes(32).toString("base64url");
    const hashed = createHash("sha256").update(`${token}${secret}`).digest("hex");
    const expires = new Date(Date.now() + 24 * 3600 * 1000);

    const adapter = getAuthAdapter();
    if (!adapter?.createVerificationToken) return fallback;
    await adapter.createVerificationToken({ identifier, token: hashed, expires });

    const qs = new URLSearchParams({ callbackUrl: "/picks", token, email: identifier });
    return `${base}/api/auth/callback/nodemailer?${qs.toString()}`;
  } catch (e) {
    console.error(
      "[brief-signin] token mint failed, using plain link:",
      e instanceof Error ? e.message : e
    );
    return fallback;
  }
}
