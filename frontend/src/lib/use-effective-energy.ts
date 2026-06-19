"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiUserState } from "./api";
import { CombinedEnergy, compositeToTen, useCombinedEnergy } from "./use-combined-energy";

export type EnergySource = "canopy" | "circuit" | "manual";

const USER_STATE_EVENT = "circuit-user-state-updated";

export function notifyUserStateUpdated(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(USER_STATE_EVENT));
  }
}

/** Default 0–1 energy: Canopy total when available, else Circuit running energy. */
export function canopyPresetZeroOne(combined: CombinedEnergy | null): number {
  if (combined?.canopy !== null && combined?.canopy !== undefined) return combined.canopy;
  if (combined) return combined.circuit;
  return 0.7;
}

export interface EffectiveEnergy {
  /** 1–10 scale for scoring UI */
  value: number;
  /** 0–1 underlying value */
  valueZeroOne: number;
  source: EnergySource;
  manualOverride: boolean;
  canopyPreset: number;
  combined: CombinedEnergy | null;
  userState: ApiUserState | null;
}

function resolveEffective(
  combined: CombinedEnergy | null,
  userState: ApiUserState | null,
): Pick<EffectiveEnergy, "value" | "valueZeroOne" | "source" | "manualOverride" | "canopyPreset"> {
  const canopyPreset = canopyPresetZeroOne(combined);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const manualOverride = (userState?.energy_manual_override ?? false)
    && userState?.energy_manual_override_date === today;

  if (manualOverride && userState) {
    return {
      value: compositeToTen(userState.energy_level),
      valueZeroOne: userState.energy_level,
      source: "manual",
      manualOverride: true,
      canopyPreset,
    };
  }

  const source: EnergySource =
    combined?.canopy !== null && combined?.canopy !== undefined ? "canopy" : "circuit";

  return {
    value: compositeToTen(canopyPreset),
    valueZeroOne: canopyPreset,
    source,
    manualOverride: false,
    canopyPreset,
  };
}

export function useEffectiveEnergy(): EffectiveEnergy & { loading: boolean; refresh: () => Promise<void> } {
  const { energy: combined, loading: combinedLoading, refresh: refreshCombined } = useCombinedEnergy();
  const [userState, setUserState] = useState<ApiUserState | null>(null);
  const [stateLoading, setStateLoading] = useState(true);

  const loadState = useCallback(async () => {
    try {
      setUserState(await api.getUserState());
    } catch {
      setUserState(null);
    } finally {
      setStateLoading(false);
    }
  }, []);

  useEffect(() => { void loadState(); }, [loadState]);

  useEffect(() => {
    const handler = () => { void loadState(); };
    window.addEventListener(USER_STATE_EVENT, handler);
    return () => window.removeEventListener(USER_STATE_EVENT, handler);
  }, [loadState]);

  const refresh = useCallback(async () => {
    await Promise.all([refreshCombined(true), loadState()]);
  }, [refreshCombined, loadState]);

  const resolved = resolveEffective(combined, userState);

  return {
    ...resolved,
    combined,
    userState,
    loading: combinedLoading || stateLoading,
    refresh,
  };
}

export function energySourceLabel(source: EnergySource): string {
  if (source === "manual") return "manual override";
  if (source === "canopy") return "Canopy";
  return "Circuit";
}
