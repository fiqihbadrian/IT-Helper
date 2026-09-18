import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Silence the "multiple lockfiles" warning: pin the tracing root to this project.
  outputFileTracingRoot: path.join(import.meta.dirname),
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/**" },
    ],
  },
};

export default nextConfig;
