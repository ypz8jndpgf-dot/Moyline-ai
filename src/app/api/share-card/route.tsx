import { ImageResponse } from "next/og";

export const dynamic = "force-dynamic";

/**
 * Branded 1200×630 card image for a member-shared pick (the OG image
 * behind /share links, so a shared pick unfurls as a MoyLine AI card in
 * Messages/WhatsApp/X). Params are the same short keys ShareButton sends:
 * g=game, p=play, pr=price, c=confidence, s=star, d=date, t=starts.
 * Values are capped so the route can't be used to render arbitrary
 * billboards; Satori escapes text by construction.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const get = (k: string, max = 140) => (searchParams.get(k) || "").slice(0, max);
  const game = get("g") || "MoyLine AI";
  const play = get("p") || "Today's card";
  const price = get("pr", 40);
  const conf = get("c", 1);
  const star = get("s", 1) === "1";
  const dateLabel = get("d", 40);
  const starts = get("t", 40);
  const when = [dateLabel, starts].filter(Boolean).join(" · ");

  return new ImageResponse(
    (
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
            {star ? "★ FEATURED PLAY" : "TODAY'S CARD"}
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
          <div style={{ display: "flex", fontSize: "38px", color: "#ffffff", fontWeight: 700 }}>
            {game}
          </div>
          {when ? (
            <div style={{ display: "flex", fontSize: "24px", color: "#999999", marginTop: "10px" }}>
              {when}
            </div>
          ) : null}
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              marginTop: "26px",
            }}
          >
            <div style={{ display: "flex", fontSize: "64px", color: "#ffffff", fontWeight: 900 }}>
              {play}
            </div>
            {price ? (
              <div
                style={{
                  display: "flex",
                  fontSize: "36px",
                  color: "#f5c518",
                  fontWeight: 700,
                  marginLeft: "22px",
                }}
              >
                {price}
              </div>
            ) : null}
          </div>
          {conf ? (
            <div style={{ display: "flex", fontSize: "24px", color: "#999999", marginTop: "18px" }}>
              Confidence {conf}/5 · Graded &amp; published after the game
            </div>
          ) : null}
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
    ),
    {
      width: 1200,
      height: 630,
      headers: { "Cache-Control": "public, max-age=86400" },
    }
  );
}
