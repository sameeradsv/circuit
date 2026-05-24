"use client";

import { useTheme, THEMES, THEME_META } from "@/lib/use-theme";

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex items-center gap-1.5" aria-label="Theme switcher">
      {THEMES.map((t) => {
        const active = theme === t;
        return (
          <button
            key={t}
            onClick={() => setTheme(t)}
            title={`${THEME_META[t].label} — ${THEME_META[t].desc}`}
            aria-pressed={active}
            className={[
              "rounded-full transition-all duration-200",
              active
                ? "w-4 h-4 ring-2 ring-white/40 ring-offset-1 ring-offset-transparent scale-110"
                : "w-3.5 h-3.5 opacity-50 hover:opacity-90 hover:scale-110",
            ].join(" ")}
            style={{ backgroundColor: THEME_META[t].swatch }}
          />
        );
      })}
    </div>
  );
}
