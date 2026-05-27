"use client";

import { useTheme, THEMES, THEME_META } from "@/lib/use-theme";

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="row gap-2 aic">
      {THEMES.map((t) => {
        const active = theme === t;
        return (
          <button
            key={t}
            onClick={() => setTheme(t)}
            title={`${THEME_META[t].label} — ${THEME_META[t].desc}`}
            className="pill"
            style={{
              background: active ? "var(--ink)" : "transparent",
              color: active ? "var(--paper)" : "var(--ink-2)",
              borderColor: active ? "var(--ink)" : "var(--line)",
            }}
          >
            {THEME_META[t].label}
          </button>
        );
      })}
    </div>
  );
}
