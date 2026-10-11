import { getBankroll, getBets, PAPER_START, type PaperBet } from "@/lib/paper";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

function isAdmin(email: string | null | undefined): boolean {
  const admin = (process.env.ADMIN_EMAIL || "").toLowerCase();
  return !!email && !!admin && email.toLowerCase() === admin;
}

function fmt(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function BetRow({ b }: { b: PaperBet }) {
  const statusColor =
    b.status === "win"
      ? "text-up"
      : b.status === "loss"
        ? "text-down"
        : b.status === "push"
          ? "text-muted"
          : "text-gold";
  const statusLabel =
    b.status === "open" ? "OPEN" : b.status.toUpperCase();
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-1">
        <span className={`text-xs font-bold uppercase tracking-widest ${statusColor}`}>
          {statusLabel}
        </span>
        <span className="text-xs text-muted">
          {(b.source || "card") === "backpage" ? "Backpage · " : ""}{b.date} · ${b.stake.toFixed(0)}
        </span>
      </div>
      <h3 className="font-display text-lg">{b.game}</h3>
      <p className="text-md font-bold text-goldsoft">
        {b.play} <span className="text-sm text-muted">{b.price}</span>
      </p>
      {b.pnl != null && (
        <p className={`text-sm font-bold ${b.pnl >= 0 ? "text-up" : "text-down"}`}>
          {fmt(b.pnl)}
        </p>
      )}
    </div>
  );
}

export default async function PaperPage() {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center">
        <h1 className="font-display text-3xl mb-2">Restricted</h1>
        <p className="text-muted text-sm">This page is private.</p>
      </div>
    );
  }
  const [bankroll, bets] = await Promise.all([getBankroll(), getBets()]);
  const pnl = Math.round((bankroll - PAPER_START) * 100) / 100;
  const srcOf = (b: PaperBet) => b.source || "card"; // legacy bets predate the field
  const open = bets.filter((b) => b.status === "open");
  const settled = bets
    .filter((b) => b.status !== "open")
    .sort((a, b) => (b.settled_at || "").localeCompare(a.settled_at || ""))
    .slice(0, 30);
  const rec = (src: string) => {
    const s = bets.filter((b) => srcOf(b) === src);
    return {
      w: s.filter((b) => b.status === "win").length,
      l: s.filter((b) => b.status === "loss").length,
      p: s.filter((b) => b.status === "push").length,
    };
  };
  const cardRec = rec("card");
  const bpRec = rec("backpage");
  const wins = cardRec.w + bpRec.w;
  const losses = cardRec.l + bpRec.l;
  const pushes = cardRec.p + bpRec.p;

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <h1 className="font-display text-3xl sm:text-4xl mb-1">
        <span className="gold-text">PAPER</span>{" "}
        <span className="text-paper">TRADING</span>
      </h1>
      <p className="text-sm text-muted mb-6">
        Every card pick auto-tracked at $10 flat. Virtual money — no real wagers.
      </p>

      <div className="grid grid-cols-3 gap-3 mb-8">
        <div className="card p-4 text-center">
          <p className="text-xs uppercase tracking-widest text-muted mb-1">Bankroll</p>
          <p className="font-display text-2xl sm:text-3xl">${bankroll.toFixed(2)}</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-xs uppercase tracking-widest text-muted mb-1">P&amp;L</p>
          <p className={`font-display text-2xl sm:text-3xl ${pnl >= 0 ? "text-up" : "text-down"}`}>
            {fmt(pnl)}
          </p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-xs uppercase tracking-widest text-muted mb-1">Record</p>
          <p className="font-display text-2xl sm:text-3xl">
            {wins}-{losses}-{pushes}
          </p>
          <p className="text-xs text-muted mt-1">
            Card {cardRec.w}-{cardRec.l}-{cardRec.p} · Backpage {bpRec.w}-{bpRec.l}-{bpRec.p}
          </p>
        </div>
      </div>

      <h2 className="font-display text-2xl mb-4">
        Open bets <span className="text-sm text-muted font-sans">({open.length})</span>
      </h2>
      {open.length === 0 ? (
        <p className="text-muted text-sm mb-8">No open paper bets right now.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 mb-8">
          {open.map((b) => (
            <BetRow key={b.id} b={b} />
          ))}
        </div>
      )}

      <h2 className="font-display text-2xl mb-4">Recent results</h2>
      {settled.length === 0 ? (
        <p className="text-muted text-sm">
          Nothing settled yet — results grade overnight and the bankroll updates each morning.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {settled.map((b) => (
            <BetRow key={b.id} b={b} />
          ))}
        </div>
      )}
    </div>
  );
}
