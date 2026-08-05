import type { NextConfig } from "next";

/**
 * Shot Planner ships as a fully static site so it can be hosted on GitHub
 * Pages. When the site is served from a project subpath such as
 * `/Shot-Planner`, set NEXT_PUBLIC_BASE_PATH to that subpath at build time.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath,
  assetPrefix: basePath || undefined,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
