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
  document.getElementById('mode-popup')?.setAttribute('hidden', '');
  if (notify) onModeChange?.();
}

export function initModes(onChange: () => void): void {
  onModeChange = onChange;
  const saved = (localStorage.getItem(MODE_KEY) as EnergyMode | null) || 'normal';
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => setMode((btn as HTMLElement).dataset.mode as EnergyMode));
  });
  const pill = document.getElementById('mode-display');
  const popup = document.getElementById('mode-popup');
  if (pill && popup) {
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      if (popup.hasAttribute('hidden')) {
        popup.removeAttribute('hidden');
      } else {
        popup.setAttribute('hidden', '');
      }
    });
    document.addEventListener('click', (e) => {
      if (!popup.hasAttribute('hidden') && !popup.contains(e.target as Node)) {
        popup.setAttribute('hidden', '');
      }
    });
  }
  setMode(saved, false);
}
