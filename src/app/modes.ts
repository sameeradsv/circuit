import type { EnergyMode } from '../types';

export const MODE_KEY = 'circuit_mode';
const MODE_NAMES: Record<EnergyMode, string> = {
  normal: 'Normal',
  deep: 'Deep Work',
  low: 'Low Energy',
  social: 'Social Recovery',
};

let currentMode: EnergyMode = 'normal';
let onModeChange: (() => void) | null = null;

export function getMode(): EnergyMode {
  return currentMode;
}

export function setMode(mode: EnergyMode, notify = true): void {
  currentMode = mode;
  localStorage.setItem(MODE_KEY, mode);
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.mode === mode);
  });
  document.body.setAttribute('data-mode', mode);
  const pill = document.getElementById('mode-display');
  if (pill) pill.textContent = MODE_NAMES[mode] ?? mode;
  if (notify) onModeChange?.();
}

export function initModes(onChange: () => void): void {
  onModeChange = onChange;
  const saved = (localStorage.getItem(MODE_KEY) as EnergyMode | null) || 'normal';
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => setMode((btn as HTMLElement).dataset.mode as EnergyMode));
  });
  const pill = document.getElementById('mode-display');
  if (pill) {
    pill.addEventListener('click', () => {
      document.getElementById('mode-selector')?.classList.toggle('visible');
    });
  }
  setMode(saved, false);
}
