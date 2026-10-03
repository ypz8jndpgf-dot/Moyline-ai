import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
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
          borderRadius: "22%",
        }}
      >
        <div
          style={{
            fontSize: 300,
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
