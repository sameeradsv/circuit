export const THEMES = ['aurora', 'sunset', 'ocean', 'dusk', 'forest'] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_KEY = 'circuit_theme';

export const THEME_META: Record<
  Theme,
  { name: string; accent: string; accent2: string; text: string; textMuted: string }
> = {
  aurora: { name: 'Aurora', accent: '#7dd3fc', accent2: '#c084fc', text: '#e0f2fe', textMuted: '#bae6fd' },
  sunset: { name: 'Sunset', accent: '#fb923c', accent2: '#f472b6', text: '#fff1f2', textMuted: '#fecdd3' },
  ocean: { name: 'Ocean', accent: '#34d399', accent2: '#38bdf8', text: '#ecfdf5', textMuted: '#a7f3d0' },
  dusk: { name: 'Dusk', accent: '#fbbf24', accent2: '#a78bfa', text: '#fdf4ff', textMuted: '#e9d5ff' },
  forest: { name: 'Forest', accent: '#86efac', accent2: '#d97706', text: '#f0fdf4', textMuted: '#bbf7d0' },
};

export function applyTheme(theme: Theme, save = true): void {
  THEMES.forEach((t) => document.body.classList.remove(`theme-${t}`));
  document.body.classList.add(`theme-${theme}`);
  document.body.setAttribute('data-theme', theme);
  const meta = THEME_META[theme];
  const root = document.documentElement;
  root.style.setProperty('--accent', meta.accent);
  root.style.setProperty('--accent2', meta.accent2);
  root.style.setProperty('--accent-gradient', `linear-gradient(90deg, ${meta.accent}, ${meta.accent2})`);
  root.style.setProperty('--text', meta.text);
  root.style.setProperty('--text-muted', meta.textMuted);
  if (save) localStorage.setItem(THEME_KEY, theme);
}

export function initTheme(): void {
  const saved = localStorage.getItem(THEME_KEY) as Theme | null;
  const theme = saved && THEMES.includes(saved) ? saved : THEMES[0];
  applyTheme(theme, false);
}
