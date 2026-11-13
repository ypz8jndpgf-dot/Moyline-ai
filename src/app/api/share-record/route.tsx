import { ImageResponse } from "next/og";
import { parseRecordShare, recordLabel, type RecordShareStats } from "@/lib/record-share";
import { formatUnits } from "@/lib/records";

export const dynamic = "force-dynamic";

/**
 * Branded 1200×630 card image for a member-shared tail record (the OG
 * image behind /share-record links, optimization #75). The record
 * renders ONLY from a signature-verified stat snapshot (lib/record-
 * share.ts) — the numbers are the ones the /my-tails page computed
 * from the member's actual stored tails when they tapped Share. A
 * link with missing, malformed, or tampered params renders a generic
 * branded card with no numbers on it at all.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const stats = parseRecordShare((k) => searchParams.get(k));

  return new ImageResponse(<Card stats={stats} />, {
    width: 1200,
    height: 630,
    headers: { "Cache-Control": "public, max-age=86400" },
  });
}

function Card({ stats }: { stats: RecordShareStats | null }) {
  const winPct =
    stats && stats.w + stats.l > 0
      ? Math.round((stats.w / (stats.w + stats.l)) * 1000) / 10
      : null;
  return (
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#0a0a0a",
        padding: "56px 64px",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: "3px solid #f5c518",
          paddingBottom: "22px",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: "34px",
            fontWeight: 900,
            color: "#f5c518",
            letterSpacing: "6px",
          }}
        >
          MOYLINE AI
        </div>
        <div
          style={{
            display: "flex",
            fontSize: "20px",
            fontWeight: 700,
            color: "#ffe9a3",
            letterSpacing: "3px",
          }}
        >
          MY TAILS
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          justifyContent: "center",
        }}
      >
        {stats ? (
          <>
            <div style={{ display: "flex", fontSize: "30px", color: "#999999", fontWeight: 700 }}>
              My tail record
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                marginTop: "14px",
              }}
            >
              <div style={{ display: "flex", fontSize: "110px", color: "#ffffff", fontWeight: 900 }}>
                {recordLabel(stats)}
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: "64px",
                  color: stats.units >= 0 ? "#f5c518" : "#ff6b6b",
                  fontWeight: 900,
                  marginLeft: "30px",
                }}
              >
                {formatUnits(stats.units)}
              </div>
            </div>
            <div style={{ display: "flex", fontSize: "24px", color: "#999999", marginTop: "20px" }}>
              {winPct !== null ? `${winPct}% winners · ` : ""}
              {stats.graded} graded tail{stats.graded === 1 ? "" : "s"}
              {stats.priced < stats.graded
                ? ` · units on ${stats.priced} of ${stats.graded} graded`
                : " · flat 1u a tail, at the prices I tailed"}
            </div>
          </>
        ) : (
          <>
            <div style={{ display: "flex", fontSize: "64px", color: "#ffffff", fontWeight: 900 }}>
              Every tail, tracked.
            </div>
            <div style={{ display: "flex", fontSize: "26px", color: "#999999", marginTop: "18px" }}>
              Members track their own record on every pick they tail — graded &amp; published, win or lose.
            </div>
          </>
        )}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", fontSize: "24px", color: "#f5c518", fontWeight: 700 }}>
          moylineai.com
        </div>
        <div style={{ display: "flex", fontSize: "20px", color: "#666666" }}>
          Every play graded &amp; published — no hiding losers
        </div>
      </div>
    </div>
  );
}
