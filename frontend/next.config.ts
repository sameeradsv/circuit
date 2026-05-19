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
      return [
        {
          source: "/api/:path*",
          destination: `${process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8001"}/api/:path*`,
        },
      ];
    },
  }),
};

export default nextConfig;
