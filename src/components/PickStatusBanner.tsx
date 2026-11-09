import type { FeedPick } from "@/lib/picks";

/**
 * VOIDED / CORRECTED banner for a published pick whose status changed
 * after publication (optimization #62). Renders nothing for a live pick.
 * Shared by every member surface that renders a feed pick — /picks cards,
 * props and Top 3 rows, the Undercard, homepage featured plays and
 * /my-tails — so a dead play reads the same way everywhere: loudly.
 */
export default function PickStatusBanner({
  p,
  className = "",
}: {
  p: Pick<FeedPick, "status" | "statusNote">;
  className?: string;
}) {
  if (p.status === "voided") {
    return (
      <div
        className={`rounded-lg border border-red-500/60 px-3 py-2 ${className}`}
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, rgba(239,68,68,0.16) 0 10px, rgba(239,68,68,0.05) 10px 20px)",
        }}
      >
        <p className="text-sm font-black uppercase tracking-widest text-red-300">
          🚫 Voided — do not play
        </p>
        {p.statusNote && (
          <p className="text-xs text-red-100/90 mt-0.5">{p.statusNote}</p>
        )}
      </div>
    );
  }
  if (p.status === "corrected") {
    return (
      <div
        className={`rounded-lg border border-amber-400/50 bg-amber-400/10 px-3 py-2 ${className}`}
      >
        <p className="text-xs font-black uppercase tracking-widest text-amber-300">
          ✏️ Corrected after publication
        </p>
        {p.statusNote && (
          <p className="text-xs text-amber-100/90 mt-0.5">{p.statusNote}</p>
        )}
      </div>
    );
  }
  return null;
}
