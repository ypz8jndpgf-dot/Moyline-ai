"use client";

import { useState } from "react";

/**
 * Footer feedback / report-an-issue form (optimization #24). Collapsed to a
 * single link until tapped; posts to /api/feedback, which emails the admin
 * inbox. Gives members a voice — bugs, wrong lines, feature asks — ahead of
 * the support@moylineai.com mailbox.
 */
export default function FeedbackForm() {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("Bug report");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot — humans never fill this
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state === "sending") return;
    setState("sending");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, message, email, website }),
      });
      setState(res.ok ? "sent" : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <p className="text-xs text-muted">
        💬 Feedback sent — thanks, we read every note.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-muted underline hover:text-gold cursor-pointer"
      >
        💬 Feedback / report an issue
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="text-xs text-muted space-y-2 max-w-md">
      <div className="flex items-center gap-2">
        <label htmlFor="fb-topic" className="font-bold text-paper">
          Feedback
        </label>
        <select
          id="fb-topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          className="bg-ink border border-line rounded px-2 py-1 text-paper"
        >
          <option>Bug report</option>
          <option>Wrong line</option>
          <option>Feature request</option>
          <option>Other</option>
        </select>
      </div>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        required
        minLength={3}
        maxLength={2000}
        rows={3}
        placeholder="What's up? A wrong line, a bug, an idea…"
        className="w-full bg-ink border border-line rounded px-2 py-1.5 text-paper placeholder:text-muted/60"
      />
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email for a reply (optional)"
        className="w-full bg-ink border border-line rounded px-2 py-1.5 text-paper placeholder:text-muted/60"
      />
      <input
        type="text"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={state === "sending"}
          className="px-3 py-1.5 rounded bg-gold text-black font-bold disabled:opacity-50 cursor-pointer"
        >
          {state === "sending" ? "Sending…" : "Send"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="underline hover:text-gold cursor-pointer"
        >
          Cancel
        </button>
        {state === "error" && (
          <span className="text-red-400">Couldn&apos;t send — try again.</span>
        )}
      </div>
    </form>
  );
}
