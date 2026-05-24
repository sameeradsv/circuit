"use client";

import { useState, useEffect } from "react";

export const THEMES = ["circuit", "dusk", "grove"] as const;

export type ThemeName = (typeof THEMES)[number];

export const THEME_META: Record<ThemeName, { label: string; swatch: string; desc: string }> = {
  circuit: { label: "Circuit", swatch: "#58a6ff", desc: "Default blue-gray" },
  dusk:    { label: "Dusk",    swatch: "#d09060", desc: "Warm-cool twilight" },
  grove:   { label: "Grove",   swatch: "#80c890", desc: "Earthy organic" },
};

const STORAGE_KEY = "circuit_ui_theme";

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeName>("circuit");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeName | null;
    if (saved && THEMES.includes(saved)) {
      setThemeState(saved);
      document.documentElement.setAttribute("data-theme", saved);
    }
  }, []);

  const setTheme = (t: ThemeName) => {
    setThemeState(t);
    localStorage.setItem(STORAGE_KEY, t);
    document.documentElement.setAttribute("data-theme", t);
  };

  return { theme, setTheme };
}
