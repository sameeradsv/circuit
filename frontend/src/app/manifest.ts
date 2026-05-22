import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const base = process.env.GITHUB_PAGES === "true" ? "/circuit" : "";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Circuit — Adaptive Task Planner",
    short_name: "Circuit",
    description: "Adaptive scheduling that reshapes around your day",
    start_url: base + "/",
    display: "standalone",
    background_color: "#0d1117",
    theme_color: "#0d1117",
    orientation: "portrait-primary",
    icons: [
      {
        src: base + "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: base + "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: base + "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
