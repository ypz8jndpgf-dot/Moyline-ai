import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // The promo video is a large, rarely-changing static asset; let
        // browsers keep it for a week instead of revalidating (and often
        // re-downloading ~5 MB) on every visit.
        source: "/video/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=604800, stale-while-revalidate=86400",
          },
        ],
      },
    ];
  },
  async redirects() {
    return [
      // The live record page is /track-record; /record 404'd for days
      // (showcase audits Oct 24–26) for anyone holding the old link.
      { source: "/record", destination: "/track-record", permanent: true },
    ];
  },
};

export default nextConfig;
