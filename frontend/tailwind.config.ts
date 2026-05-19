import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "circuit-bg": "var(--circuit-bg)",
        "circuit-surface": "var(--circuit-surface)",
        "circuit-border": "var(--circuit-border)",
        "circuit-text": "var(--circuit-text)",
        "circuit-muted": "var(--circuit-muted)",
        "circuit-accent": "var(--circuit-accent)",
        "circuit-accent2": "var(--circuit-accent2)",
      },
    },
  },
  plugins: [],
};

export default config;
