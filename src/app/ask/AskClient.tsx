"use client";

import { useState, useRef, useEffect } from "react";

type Analysis = {
  game: {
    away: string;
    home: string;
    sport: string;
    commence: string;
    spread?: { home: number; away: number };
    total?: { line: number };
    ml?: { home: number; away: number };
  };
  lean: string;
  confidence: number;
  factors: string[];
  edge: string;
  caveat: string;
  onCard?: { play: string; confidence: number };
};

type Msg = {
  role: "user" | "moy";
  text?: string;
  analyses?: Analysis[];
  error?: string;
  gameId?: string;
};

const SUGGESTIONS = [
  "Chiefs vs Chargers",
  "Who wins Cowboys Packers?",
  "Rams Cardinals spread",
  "Any value in tonight's NHL?",
];

function fmtOdds(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

function gameTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function ConfidenceMeter({ level }: { level: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] font-bold uppercase tracking-widest text-muted mr-1">
        Confidence
      </span>
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className={`h-2 w-8 rounded-full transition-all ${
            i <= level
              ? "bg-gradient-to-r from-gold to-goldsoft shadow-[0_0_8px_rgba(212,175,55,0.6)]"
              : "bg-white/10"
          }`}
        />
      ))}
      <span className="text-gold font-display text-lg ml-1">{level}/5</span>
    </div>
  );
}

function AnalysisCard({ a }: { a: Analysis }) {
  const g = a.game;
  return (
    <div className="rounded-xl border border-gold/30 bg-gradient-to-b from-gold/10 to-transparent p-5 mb-3">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-gold">
          {g.sport.replace(/_/g, " ")} · {gameTime(g.commence)}
        </p>
        {a.onCard && (
          <span className="px-2 py-0.5 rounded-full bg-gold text-black text-[10px] font-bold uppercase tracking-wider">
            ★ On today's card
          </span>
        )}
      </div>
      <h3 className="font-display text-xl mb-3">
        {g.away} <span className="text-muted text-sm">at</span> {g.home}
      </h3>

      {/* Lines */}
      <div className="flex flex-wrap gap-2 mb-4">
        {g.spread && (
          <span className="px-2.5 py-1 rounded bg-white/5 border border-white/10 text-xs">
            Spread: {g.away} {fmtOdds(g.spread.away)} / {g.home} {fmtOdds(g.spread.home)}
          </span>
        )}
        {g.total && (
          <span className="px-2.5 py-1 rounded bg-white/5 border border-white/10 text-xs">
            Total: {g.total.line}
          </span>
        )}
        {g.ml && (
          <span className="px-2.5 py-1 rounded bg-white/5 border border-white/10 text-xs">
            ML: {g.away} {fmtOdds(g.ml.away)} / {g.home} {fmtOdds(g.ml.home)}
          </span>
        )}
      </div>

      {/* The lean */}
      <div className="mb-3 p-3 rounded-lg bg-black/40 border border-gold/20">
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted mb-1">MoyAI lean</p>
        <p className="font-display text-2xl text-gold">{a.lean}</p>
      </div>

      <div className="mb-3">
        <ConfidenceMeter level={a.confidence} />
      </div>

      {a.factors.length > 0 && (
        <div className="mb-3">
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted mb-1.5">
            Key factors
          </p>
          <ul className="space-y-1">
            {a.factors.map((f, i) => (
              <li key={i} className="text-sm text-paper/90 flex gap-2">
                <span className="text-gold">✦</span> {f}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-muted mb-1">
        <span className="font-bold text-paper/70">Edge: </span>
        {a.edge}
      </p>
      <p className="text-[11px] text-muted/60 italic">{a.caveat}</p>
    </div>
  );
}

export function AskClient() {
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      role: "moy",
      text: "Ask me about any matchup on the board — I'll give you the lines, my lean, and a confidence rating. Try a team name to start.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastGameId, setLastGameId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, loading]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || loading) return;
    setMsgs((m) => [...m, { role: "user", text: q }]);
    setInput("");
    setLoading(true);
    try {
      // If the question is short/generic and we have context, treat as follow-up
      const isFollowUp = lastGameId && q.split(/\s+/).length <= 4 &&
        !/[a-z]{4,}/i.test(q.replace(/what|about|the|total|spread|line|odds|moneyline|over|under/gi, ""));
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: isFollowUp ? "" : q,
          contextGameId: isFollowUp ? lastGameId : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsgs((m) => [...m, { role: "moy", error: data.error || "Something went wrong." }]);
      } else {
        setMsgs((m) => [...m, { role: "moy", analyses: data.analyses }]);
        if (data.analyses?.[0]?.game?.id) {
          setLastGameId(data.analyses[0].game.id);
        }
      }
    } catch {
      setMsgs((m) => [...m, { role: "moy", error: "Couldn't reach the brain — try again." }]);
    }
    setLoading(false);
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="text-center mb-6">
        <div className="inline-flex items-center gap-2 mb-3 px-3 py-1.5 rounded-full border border-gold/40 bg-gold/10 text-gold text-[11px] font-bold uppercase tracking-[0.2em]">
          <span>✦</span> Ask MoyAI
        </div>
        <h1 className="font-display text-4xl sm:text-5xl">
          ASK ABOUT <span className="gold-text">ANY GAME.</span>
        </h1>
        <p className="text-muted mt-2 text-sm max-w-xl mx-auto">
          Not on today's card? No problem. Ask about any matchup and get the live lines,
          MoyAI's lean, and a confidence rating — instantly.
        </p>
      </div>

      {/* Chat */}
      <div className="card p-4 sm:p-6 mb-4 min-h-[400px] max-h-[60vh] overflow-y-auto">
        <div className="space-y-4">
          {msgs.map((msg, i) => (
            <div key={i}>
              {msg.role === "user" ? (
                <div className="flex justify-end">
                  <div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-br-md bg-gold text-black font-medium text-sm">
                    {msg.text}
                  </div>
                </div>
              ) : (
                <div className="flex justify-start">
                  <div className="max-w-[95%] w-full">
                    {msg.text && (
                      <div className="px-4 py-2.5 rounded-2xl rounded-bl-md bg-white/5 border border-white/10 text-sm text-paper/90 inline-block">
                        {msg.text}
                      </div>
                    )}
                    {msg.error && (
                      <div className="px-4 py-2.5 rounded-2xl rounded-bl-md bg-red-500/10 border border-red-500/30 text-sm text-red-200 inline-block">
                        {msg.error}
                      </div>
                    )}
                    {msg.analyses && (
                      <div className="mt-2">
                        {msg.analyses.map((a, j) => (
                          <AnalysisCard key={j} a={a} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="px-4 py-3 rounded-2xl rounded-bl-md bg-white/5 border border-white/10">
                <div className="flex gap-1.5">
                  {[0, 1, 2].map((d) => (
                    <div
                      key={d}
                      className="w-2 h-2 rounded-full bg-gold animate-bounce"
                      style={{ animationDelay: `${d * 0.15}s` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Suggestions */}
      <div className="flex flex-wrap gap-2 mb-4 justify-center">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => send(s)}
            className="px-3 py-1.5 rounded-full border border-gold/30 text-gold text-xs hover:bg-gold/10 transition"
          >
            {s}
          </button>
        ))}
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about any matchup… e.g. 'Lakers Celtics'"
          className="flex-1 px-4 py-3 rounded-xl bg-white/5 border border-white/15 text-paper placeholder:text-muted/50 text-sm focus:outline-none focus:border-gold/50"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="px-6 py-3 rounded-xl btn-gold font-bold text-sm disabled:opacity-40"
        >
          Ask
        </button>
      </form>
      <p className="text-[11px] text-muted/50 text-center mt-3">
        Board-only reads from live lines. For entertainment purposes — not financial advice.
      </p>
    </div>
  );
}
