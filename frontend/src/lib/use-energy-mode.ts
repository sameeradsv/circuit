"use client";

import { useEffect, useState } from 'react';
import type { EnergyMode } from '../engines/src/types/task';

const KEY = 'circuit_energy_mode_v1';

export type { EnergyMode };

export function useEnergyMode(): [EnergyMode, (m: EnergyMode) => void] {
  const [mode, setModeState] = useState<EnergyMode>('normal');

  useEffect(() => {
    const stored = localStorage.getItem(KEY) as EnergyMode | null;
    if (stored && ['normal', 'deep', 'low', 'social'].includes(stored)) {
      setModeState(stored);
    }
  }, []);

  function setMode(m: EnergyMode) {
    localStorage.setItem(KEY, m);
    setModeState(m);
  }

  return [mode, setMode];
}
