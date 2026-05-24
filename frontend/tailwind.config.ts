import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "circuit-bg":      "var(--circuit-bg)",
        "circuit-surface": "var(--circuit-surface)",
        "circuit-border":  "var(--circuit-border)",
        "circuit-text":    "var(--circuit-text)",
        "circuit-muted":   "var(--circuit-muted)",
        "circuit-accent":  "var(--circuit-accent)",
        "circuit-accent2": "var(--circuit-accent2)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to:   { opacity: "1" },
        },
        "bar-grow": {
          from: { transform: "scaleX(0)" },
          to:   { transform: "scaleX(1)" },
        },
        "pulse-glow": {
          "0%, 100%": { boxShadow: "0 0 0 0 var(--circuit-glow)" },
          "50%":      { boxShadow: "0 0 12px 4px var(--circuit-glow)" },
        },
        "count-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up":     "fade-up 0.4s ease both",
        "fade-up-1":   "fade-up 0.4s 0.06s ease both",
        "fade-up-2":   "fade-up 0.4s 0.12s ease both",
        "fade-up-3":   "fade-up 0.4s 0.18s ease both",
        "fade-up-4":   "fade-up 0.4s 0.24s ease both",
        "fade-in":     "fade-in 0.3s ease both",
        "bar-grow":    "bar-grow 0.7s ease-out both",
        "pulse-glow":  "pulse-glow 2.2s ease-in-out infinite",
        "count-up":    "count-up 0.35s 0.1s ease both",
      },
    },
  },
  plugins: [],
};

export default config;
