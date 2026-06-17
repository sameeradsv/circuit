import type { NextConfig } from "next";

const isGithubPages = process.env.GITHUB_PAGES === "true";

const nextConfig: NextConfig = {
  transpilePackages: ["@shared/cortex"],
  ...(isGithubPages && {
    output: "export",
    basePath: "/circuit",
    assetPrefix: "/circuit/",
    trailingSlash: true,
    images: { unoptimized: true },
  }),
  ...(!isGithubPages && {
    async rewrites() {
      const base = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
      if (!base) return [];
      return [
        {
          source: "/api/:path*",
          destination: `${base}/api/:path*`,
        },
      ];
    },
  }),
};

export default nextConfig;
