import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper:          "var(--paper)",
        "paper-2":      "var(--paper-2)",
        ink:            "var(--ink)",
        "ink-2":        "var(--ink-2)",
        "ink-3":        "var(--ink-3)",
        line:           "var(--line)",
        "line-2":       "var(--line-2)",
        terra:          "var(--terra)",
        "terra-soft":   "var(--terra-soft)",
        sage:           "var(--sage)",
        "sage-soft":    "var(--sage-soft)",
        mustard:        "var(--mustard)",
        rose:           "var(--rose)",
        // Legacy aliases
        "circuit-bg":      "var(--paper)",
        "circuit-surface": "var(--paper-2)",
        "circuit-border":  "var(--line)",
        "circuit-text":    "var(--ink)",
        "circuit-muted":   "var(--ink-3)",
        "circuit-accent":  "var(--terra)",
        "circuit-accent2": "var(--sage)",
      },
      fontFamily: {
        display: ["var(--font-display)"],
        body:    ["var(--font-body)"],
        mono:    ["var(--font-mono)"],
        serif:   ["var(--font-serif)"],
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
        "count-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up":   "fade-up 0.4s ease both",
        "fade-up-1": "fade-up 0.4s 0.06s ease both",
        "fade-up-2": "fade-up 0.4s 0.12s ease both",
        "fade-up-3": "fade-up 0.4s 0.18s ease both",
        "fade-up-4": "fade-up 0.4s 0.24s ease both",
        "fade-in":   "fade-in 0.3s ease both",
        "bar-grow":  "bar-grow 0.7s ease-out both",
        "count-up":  "count-up 0.35s 0.1s ease both",
      },
    },
  },
  plugins: [],
};

export default config;
