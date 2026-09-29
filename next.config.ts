import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "pg", "telegram"],
  async redirects() {
    return [
      { source: "/sources", destination: "/dashboard", permanent: false },
      { source: "/sources/:id", destination: "/dashboard", permanent: false },
    ];
  },
};

export default nextConfig;
