import { NextResponse } from "next/server";
import { lookup } from "dns/promises";
import { Socket } from "net";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Mask a secret: show first 3 + last 2 chars only. */
function mask(s: string): string {
  if (s.length <= 8) return "***";
  return `${s.slice(0, 3)}…${s.slice(-2)} (${s.length} chars)`;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

async function tcpCheck(host: string, port: number): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const sock = new Socket();
    const done = (ok: boolean, detail: string) => {
      try { sock.destroy(); } catch { /* noop */ }
      resolve({ ok, detail });
    };
    sock.setTimeout(8000);
    sock.once("connect", () => done(true, `TCP connect to ${host}:${port} succeeded`));
    sock.once("timeout", () => done(false, `TCP connect to ${host}:${port} timed out (8s)`));
    sock.once("error", (e) => done(false, `TCP error: ${(e as Error).message}`));
    try {
      sock.connect(port, host);
    } catch (e) {
      done(false, `TCP threw: ${(e as Error).message}`);
    }
  });
}

export async function GET(req: Request) {
  const out: Record<string, unknown> = {};
  const server = process.env.EMAIL_SERVER || "";
  const from = process.env.EMAIL_FROM || "";

  // 1. Format check (no secrets exposed)
  let url: URL | null = null;
  try {
    url = new URL(server);
    out.format = {
      ok: url.protocol === "smtp:",
      protocol: url.protocol,
      host: url.hostname,
      port: url.port || "(default)",
      hasUser: !!url.username,
      passwordHint: url.password ? mask(url.password) : "(missing!)",
    };
  } catch {
    out.format = { ok: false, error: "EMAIL_SERVER is not a parseable URL", length: server.length };
  }
  out.from = from || "(EMAIL_FROM not set)";

  // 2. DNS
  const host = url?.hostname || "smtp.resend.com";
  const port = parseInt(url?.port || "587", 10);
  try {
    const addrs = await withTimeout(lookup(host), 8000, "DNS lookup");
    out.dns = { ok: true, address: (addrs as { address: string }).address };
  } catch (e) {
    out.dns = { ok: false, error: (e as Error).message };
  }

  // 3. TCP
  out.tcp = await tcpCheck(host, port);

  // 4. SMTP verify (connect + EHLO + STARTTLS + AUTH, no email sent)
  if ((out.tcp as { ok: boolean }).ok && url) {
    try {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.createTransport(server, {
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        socketTimeout: 10000,
      });
      await withTimeout(transport.verify(), 15000, "SMTP verify");
      out.smtp = { ok: true, detail: "SMTP handshake + AUTH succeeded (no email sent)" };
      try { transport.close(); } catch { /* noop */ }
    } catch (e) {
      out.smtp = { ok: false, error: (e as Error).message };
    }
  } else {
    out.smtp = { ok: false, error: "skipped — TCP failed" };
  }

  // 5. Optional one-time real send test: ?send_to=addr — attempts one sendMail
  // and returns the exact result/error. TEMPORARY diagnostic.
  const sendTo = new URL(req.url).searchParams.get("send_to");
  if (sendTo && (out.smtp as { ok?: boolean })?.ok && url) {
    try {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.createTransport(server, {
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        socketTimeout: 15000,
      });
      const info = await withTimeout(
        transport.sendMail({
          to: sendTo,
          from: from || "MoyLine AI <onboarding@resend.dev>",
          subject: "MoyLine AI email deliverability test",
          text: "One-time test — please ignore.",
        }),
        25000,
        "sendMail"
      );
      out.send_test = {
        ok: true,
        to: sendTo,
        messageId: (info as { messageId?: string }).messageId,
        response: String((info as { response?: unknown }).response || "").slice(0, 200),
      };
      try { transport.close(); } catch { /* noop */ }
    } catch (e) {
      out.send_test = { ok: false, to: sendTo, error: (e as Error).message };
    }
  }

  return NextResponse.json(out);
}
