"use client";

import { useEffect, useState } from "react";
import type { EnergyMode } from "../engines/src/types/task";
import { api } from "./api";
import { notifyUserStateUpdated } from "./use-effective-energy";

const KEY = "circuit_energy_mode_v1";
const USER_STATE_EVENT = "circuit-user-state-updated";
const VALID_MODES: EnergyMode[] = ["normal", "deep", "low", "social"];

export type { EnergyMode };

function isValidMode(m: string | null | undefined): m is EnergyMode {
  return !!m && VALID_MODES.includes(m as EnergyMode);
}

export function useEnergyMode(): [EnergyMode, (m: EnergyMode) => void] {
  const [mode, setModeState] = useState<EnergyMode>("normal");

  useEffect(() => {
    const stored = localStorage.getItem(KEY);
    if (isValidMode(stored)) setModeState(stored);

    api.getUserState()
      .then((state) => {
        if (isValidMode(state.focus_mode)) {
          setModeState(state.focus_mode);
          localStorage.setItem(KEY, state.focus_mode);
        }
      })
      .catch(() => {});

    const handler = () => {
      api.getUserState()
        .then((state) => {
          if (isValidMode(state.focus_mode)) {
            setModeState(state.focus_mode);
            localStorage.setItem(KEY, state.focus_mode);
          }
        })
        .catch(() => {});
    };
    window.addEventListener(USER_STATE_EVENT, handler);
    return () => window.removeEventListener(USER_STATE_EVENT, handler);
  }, []);

  function setMode(m: EnergyMode) {
    localStorage.setItem(KEY, m);
    setModeState(m);
    api.setUserState({ focus_mode: m })
      .then(() => notifyUserStateUpdated())
      .catch(() => {});
  }

  return [mode, setMode];
}
