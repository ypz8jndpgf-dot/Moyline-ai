"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await signIn("nodemailer", { email, callbackUrl: "/picks" });
    setSent(true);
    setLoading(false);
  }

  if (sent) {
    return (
      <div className="max-w-md mx-auto text-center py-16">
        <h1 className="font-display text-3xl mb-3">CHECK YOUR <span className="gold-text">INBOX</span></h1>
        <p className="text-muted">We sent a sign-in link to <span className="text-paper">{email}</span>.</p>
        <div className="card p-4 mt-6 text-left">
          <p className="text-gold text-xs font-bold uppercase tracking-widest mb-1.5">📱 Opening it on your phone?</p>
          <p className="text-sm text-muted leading-relaxed">
            Open the link in <strong className="text-paper">Safari or Chrome</strong> — not inside your email app.
            If you&apos;re in the Gmail app, <strong className="text-paper">long-press the link and tap &ldquo;Open in Safari&rdquo;</strong> (or copy it into your browser).
            Links opened inside Gmail&apos;s built-in browser don&apos;t stay signed in.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto py-16">
      <h1 className="font-display text-4xl mb-2 text-center">SIGN <span className="gold-text">IN</span></h1>
      <p className="text-muted text-sm text-center mb-6">We&apos;ll email you a magic sign-in link. No password needed.</p>
      <form onSubmit={submit} className="card p-6 space-y-4">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full bg-ink border border-line rounded-lg px-4 py-3 text-paper placeholder:text-muted focus:border-gold outline-none"
        />
        <button type="submit" disabled={loading} className="btn-gold w-full py-3 disabled:opacity-50">
          {loading ? "Sending…" : "Email me a sign-in link"}
        </button>
      </form>
    </div>
  );
}
