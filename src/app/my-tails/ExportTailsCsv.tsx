"use client";

/**
 * Export My Tails as CSV (optimization #66): one click downloads the
 * member's own tail record — date · game · play · price · result · units —
 * so they can track it in their own spreadsheet instead of retyping rows.
 * Rows are computed server-side from the same graded data the page shows;
 * this component only serializes and downloads them.
 */

export interface TailCsvRow {
  date: string;
  game: string;
  play: string;
  price: string;
  result: string;
  units: string;
}

function csvField(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export default function ExportTailsCsv({ rows }: { rows: TailCsvRow[] }) {
  if (rows.length === 0) return null;

  const download = () => {
    const header = "date,game,play,price,result,units";
    const lines = rows.map((r) =>
      [r.date, r.game, r.play, r.price, r.result, r.units].map(csvField).join(",")
    );
    const blob = new Blob([[header, ...lines].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "my-tails.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <button
      onClick={download}
      className="btn-ghost px-4 py-1.5 rounded-full text-sm font-bold"
    >
      ⬇ Export CSV ({rows.length})
    </button>
  );
}
