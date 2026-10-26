import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // The live record page is /track-record; /record 404'd for days
      // (showcase audits Oct 24–26) for anyone holding the old link.
      { source: "/record", destination: "/track-record", permanent: true },
    ];
  },
};

export default nextConfig;
