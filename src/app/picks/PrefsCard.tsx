"use client";

import { useEffect, useState } from "react";

/**
 * Personalization (steal #5): favorite sports + primary book.
 * Favorites lead the homepage board; the book gets a "Your book" price
 * line on every card pick. Saved per account via /api/prefs.
 */
export default function PrefsCard({
  sportOptions,
  books,
}: {
  sportOptions: { key: string; label: string }[];
  books: string[];
}) {
  const [open, setOpen] = useState(false);
  const [sports, setSports] = useState<string[]>([]);
  const [book, setBook] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/prefs")
      .then((r) => r.json())
      .then((d) => {
        if (d?.prefs) {
          setSports(d.prefs.sports || []);
          setBook(d.prefs.book || "");
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const toggleSport = (key: string) => {
    setSaved(false);
    setSports((s) => (s.includes(key) ? s.filter((x) => x !== key) : [...s, key]));
  };

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sports, book }),
      });
      const d = await res.json().catch(() => ({}));
      if (d.ok) setSaved(true);
    } catch {
      /* leave unsaved state visible */
    }
    setBusy(false);
  }

  return (
    <div className="card p-4 mb-6">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between text-left"
      >
        <span className="text-xs font-bold uppercase tracking-widest text-gold">
          ⚙ Make it yours
        </span>
        <span className="text-xs text-muted">
          {sports.length > 0 || book
            ? `${sports.length} favorite sport${sports.length === 1 ? "" : "s"}${book ? ` · ${book}` : ""}`
            : "Favorite sports + your book"}{" "}
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && loaded && (
        <div className="mt-4">
          <p className="text-xs text-muted mb-2">
            Favorite sports lead the lines board. Your book gets its own price
            line on every pick.
          </p>
          <div className="flex flex-wrap gap-1.5 mb-4">
            {sportOptions.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => toggleSport(s.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold ${
                  sports.includes(s.key)
                    ? "bg-gold text-black"
                    : "bg-white/5 text-muted hover:text-white"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5 mb-4">
            <button
              type="button"
              onClick={() => { setBook(""); setSaved(false); }}
              className={`px-3 py-1.5 rounded-full text-xs font-bold ${
                book === "" ? "bg-gold text-black" : "bg-white/5 text-muted hover:text-white"
              }`}
            >
              No primary book
            </button>
            {books.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => { setBook(b); setSaved(false); }}
                className={`px-3 py-1.5 rounded-full text-xs font-bold ${
                  book === b ? "bg-gold text-black" : "bg-white/5 text-muted hover:text-white"
                }`}
              >
                {b}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="btn-gold px-6 py-2 text-sm disabled:opacity-50"
          >
            {busy ? "Saving…" : saved ? "Saved ✓" : "Save preferences"}
          </button>
        </div>
      )}
    </div>
  );
}
