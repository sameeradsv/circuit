"use client";

import { useState, useEffect } from "react";

export const THEMES = ["paper", "ink"] as const;

export type ThemeName = (typeof THEMES)[number];

export const THEME_META: Record<ThemeName, { label: string; swatch: string; desc: string }> = {
  paper: { label: "Paper", swatch: "#f1ebde", desc: "Warm cream" },
  ink:   { label: "Ink",   swatch: "#1f1d1a", desc: "Dark" },
};

const STORAGE_KEY = "circuit_palette";

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeName>("paper");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeName | null;
    if (saved && THEMES.includes(saved)) {
      setThemeState(saved);
      document.documentElement.setAttribute("data-palette", saved);
    }
  }, []);

  const setTheme = (t: ThemeName) => {
    setThemeState(t);
    localStorage.setItem(STORAGE_KEY, t);
    document.documentElement.setAttribute("data-palette", t);
  };

  return { theme, setTheme };
}
