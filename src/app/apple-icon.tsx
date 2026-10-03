import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
        }}
      >
        <div
          style={{
            fontSize: 110,
            fontWeight: 900,
            background: "linear-gradient(135deg, #ffe9a3, #f5c518 55%, #b8860b)",
            backgroundClip: "text",
            color: "transparent",
            fontFamily: "Arial Black, sans-serif",
          }}
        >
          M
        </div>
      </div>
    ),
    { ...size }
  );
}
