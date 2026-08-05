import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    tsconfigPath: "./tsconfig.vercel.json",
  },
  compress: true,
  experimental: {
    optimizePackageImports: ["react", "react-dom"],
  },
};

export default nextConfig;
