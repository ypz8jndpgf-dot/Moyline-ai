"use client";

import { useState, useRef, useEffect, useCallback } from "react";

type Msg = {
  role: "user" | "moy";
  text: string;
  gameIds?: string[];
  error?: boolean;
};

const SUGGESTIONS = [
  "What games are on tonight?",
  "What's on today's card?",
  "How's the record looking?",
];

const GREETING: Msg = {
  role: "moy",
  text: "Hey — I'm MoyAI. Ask me about any game on the board, tonight's slate, today's card, or how the record's looking. I read the live lines and give it to you straight. What's on your mind?",
};

const STORAGE_KEY = "moyline-ask-chat-v2";

/** ET calendar date — a restored conversation is only valid the same day. */
function todayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export function AskClient({ suggestions }: { suggestions?: string[] }) {
  const chips = suggestions && suggestions.length >= 2 ? suggestions : SUGGESTIONS;
  const [msgs, setMsgs] = useState<Msg[]>([GREETING]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [staleMins, setStaleMins] = useState<number | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Restore the conversation after a refresh (same tab session, same ET day
  // only — yesterday's game context would resolve against a stale board).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const stored = Array.isArray(parsed) ? parsed : parsed?.msgs;
        const fresh = Array.isArray(parsed) ? true : parsed?.date === todayET();
        if (fresh && Array.isArray(stored) && stored.length > 0) {
          setMsgs(
            stored
              .filter((m: any) => m && (m.role === "user" || m.role === "moy") && typeof m.text === "string")
              .slice(-40)
          );
        } else {
          sessionStorage.removeItem(STORAGE_KEY);
        }
      }
    } catch {
      /* storage unavailable — chat still works in-memory */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ date: todayET(), msgs: msgs.slice(-40) }));
    } catch {
      /* ignore quota errors */
    }
  }, [msgs, hydrated]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, loading]);

  const send = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || loading) return;

      const history = msgs
        .filter((m) => !m.error)
        .slice(-10)
        .map((m) => ({
          role: m.role === "user" ? ("user" as const) : ("assistant" as const),
          text: m.text,
          gameIds: m.gameIds,
        }));

      setMsgs((m) => [...m, { role: "user", text: q }]);
      setInput("");
      if (inputRef.current) inputRef.current.style.height = "auto";
      setLoading(true);
      try {
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: q, history }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.reply) {
          setMsgs((m) => [
            ...m,
            { role: "moy", text: data.error || "Something went wrong — try that again.", error: true },
          ]);
        } else {
          setMsgs((m) => [...m, { role: "moy", text: data.reply, gameIds: data.gameIds }]);
          if (typeof data.meta?.staleMins === "number") setStaleMins(data.meta.staleMins);
        }
      } catch {
        setMsgs((m) => [
          ...m,
          { role: "moy", text: "Couldn't reach the brain — check your connection and try again.", error: true },
        ]);
      }
      setLoading(false);
      inputRef.current?.focus();
    },
    [msgs, loading]
  );

  function newChat() {
    setMsgs([GREETING]);
    setStaleMins(null);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    inputRef.current?.focus();
  }

  const chatting = msgs.some((m) => m.role === "user");

  // Deep-linked question (steal #2): /ask?q=... from a pick card's
  // "Ask about this game" chips — auto-send it once, then clean the URL
  // so a refresh doesn't re-ask.
  const qSentRef = useRef(false);
  useEffect(() => {
    if (!hydrated || qSentRef.current) return;
    const q = new URLSearchParams(window.location.search).get("q");
    if (q && q.trim()) {
      qSentRef.current = true;
      window.history.replaceState(null, "", window.location.pathname);
      send(q.slice(0, 300));
    }
  }, [hydrated, send]);

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="text-center mb-5">
        <div className="inline-flex items-center gap-2 mb-3 px-3 py-1.5 rounded-full border border-gold/40 bg-gold/10 text-gold text-[11px] font-bold uppercase tracking-[0.2em]">
          <span>✦</span> Ask MoyAI
        </div>
        <h1 className="font-display text-4xl sm:text-5xl">
          CHAT WITH <span className="gold-text">MOYAI.</span>
        </h1>
        <p className="text-muted mt-2 text-sm max-w-xl mx-auto">
          Real talk on the live board — lines, leans, today's card, and the record.
          Ask a question, then keep asking. It remembers the conversation.
        </p>
      </div>

      {/* Chat panel */}
      <div className="card overflow-hidden flex flex-col h-[62dvh] min-h-[430px]">
        {/* Panel toolbar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10 bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted">
              MoyAI · live board
            </span>
          </div>
          {chatting && (
            <button
              onClick={newChat}
              className="text-[11px] font-bold uppercase tracking-widest text-gold/80 hover:text-gold transition"
            >
              ↺ New chat
            </button>
          )}
        </div>

        {/* Thread */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 sm:px-5 py-4">
          <div className="space-y-4">
            {msgs.map((msg, i) =>
              msg.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[82%] px-4 py-2.5 rounded-2xl rounded-br-md bg-gold text-black font-medium text-sm leading-relaxed whitespace-pre-wrap break-words">
                    {msg.text}
                  </div>
                </div>
              ) : (
                <div key={i} className="flex gap-2.5">
                  <div className="shrink-0 w-8 h-8 rounded-full bg-gold/15 border border-gold/40 flex items-center justify-center text-gold text-sm select-none">
                    ✦
                  </div>
                  <div className="min-w-0 max-w-[88%]">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold/70 mb-1">
                      MoyAI
                    </p>
                    <div
                      className={`px-4 py-3 rounded-2xl rounded-tl-md text-sm leading-relaxed whitespace-pre-wrap break-words ${
                        msg.error
                          ? "bg-red-500/10 border border-red-500/30 text-red-200"
                          : "bg-white/5 border border-white/10 text-paper/90"
                      }`}
                    >
                      {msg.text}
                    </div>
                  </div>
                </div>
              )
            )}

            {/* Starter chips — empty state only */}
            {!chatting && !loading && (
              <div className="flex flex-wrap gap-2 pl-10 pt-1">
                {chips.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="px-3 py-1.5 rounded-full border border-gold/30 text-gold text-xs hover:bg-gold/10 transition text-left"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {/* Thinking indicator */}
            {loading && (
              <div className="flex gap-2.5 items-start">
                <div className="shrink-0 w-8 h-8 rounded-full bg-gold/15 border border-gold/40 flex items-center justify-center text-gold text-sm select-none">
                  ✦
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold/70 mb-1">
                    MoyAI
                  </p>
                  <div className="px-4 py-3 rounded-2xl rounded-tl-md bg-white/5 border border-white/10 flex items-center gap-2">
                    <span className="flex gap-1.5">
                      {[0, 1, 2].map((d) => (
                        <span
                          key={d}
                          className="w-2 h-2 rounded-full bg-gold animate-bounce"
                          style={{ animationDelay: `${d * 0.15}s` }}
                        />
                      ))}
                    </span>
                    <span className="text-xs text-muted">thinking…</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Input bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="border-t border-white/10 p-3 flex gap-2 items-end bg-white/[0.02]"
        >
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 120) + "px";
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Ask about a game, the card, the record…"
            className="flex-1 px-4 py-3 rounded-xl bg-white/5 border border-white/15 text-paper placeholder:text-muted/50 text-sm leading-relaxed resize-none focus:outline-none focus:border-gold/50 max-h-[120px]"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-5 py-3 rounded-xl btn-gold font-bold text-sm disabled:opacity-40 shrink-0"
          >
            Send
          </button>
        </form>
      </div>

      <p className="text-[11px] text-muted/50 text-center mt-3">
        Answers come only from the live board, today's card, and the graded record — no made-up lines.
        {staleMins !== null && staleMins > 0 ? ` Lines cached ${staleMins}m ago.` : ""} For entertainment
        purposes — not financial advice.
      </p>
    </div>
  );
}
