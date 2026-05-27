"use client";

import { useState, useEffect } from "react";

const KEY = "circuit_energy_level_v1";

export function useEnergyLevel(): [number, (n: number) => void] {
  const [energy, setEnergyState] = useState(6);

  useEffect(() => {
    const stored = localStorage.getItem(KEY);
    if (stored) {
      const n = parseInt(stored, 10);
      if (n >= 1 && n <= 10) setEnergyState(n);
    }
  }, []);

  function setEnergy(n: number) {
    const clamped = Math.max(1, Math.min(10, n));
    localStorage.setItem(KEY, String(clamped));
    setEnergyState(clamped);
  }

  return [energy, setEnergy];
}

export function energyDescriptor(e: number): { word: string; hint: string } {
  if (e >= 9) return { word: "Peak",    hint: "go for the hardest thing on the list" };
  if (e >= 7) return { word: "Focused", hint: "ship a deep-work block" };
  if (e >= 5) return { word: "Steady",  hint: "make a clean dent in the middle of the list" };
  if (e >= 3) return { word: "Low",     hint: "easy admin, replies, errands" };
  return        { word: "Drained",  hint: "two-minute tasks only, or rest" };
}
