"use client";

import { useEffect, useState } from "react";
import { api } from "./api";
import { getAuthToken } from "./auth";

const CANOPY_URL = (process.env.NEXT_PUBLIC_CANOPY_API_URL ?? "").replace(/\/$/, "");
const CHEF_URL   = (process.env.NEXT_PUBLIC_CHEF_API_URL   ?? "").replace(/\/$/, "");

export interface CombinedEnergy {
  /** 0–1 weighted composite across all available sources */
  composite: number;
  /** 0–1 stress level from Circuit UserState */
  stress: number;
  /** Which apps contributed */
  sources: string[];
  /** Per-source breakdown */
  circuit: number;
  canopy: number | null;
  chef: number | null;
}

async function fetchSiblingSync(baseUrl: string, token: string): Promise<number | null> {
  if (!baseUrl) return null;
  try {
    const r = await fetch(`${baseUrl}/api/sync/energy`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    // Canopy: energy_so_far (0-1); Chef: 1 - drain_so_far
    if (typeof d.energy_so_far === "number") return d.energy_so_far;
    if (typeof d.drain_so_far === "number") return Math.max(0, 1 - d.drain_so_far);
    return null;
  } catch {
    return null;
  }
}

function composite(
  circuit: number,
  canopy: number | null,
  chef: number | null,
): number {
  // Weights: manual energy slider carries most weight since it's explicit user input.
  // Task-event curve, Canopy social drain, and Chef meal energy round it out.
  const pairs: [number, number][] = [[circuit, 1.0]];
  if (canopy !== null) pairs.push([canopy, 0.75]);
  if (chef   !== null) pairs.push([chef,   0.50]);
  const totalW = pairs.reduce((s, [, w]) => s + w, 0);
  return Math.max(0, Math.min(1, pairs.reduce((s, [v, w]) => s + v * w, 0) / totalW));
}

export function useCombinedEnergy() {
  const [energy, setEnergy] = useState<CombinedEnergy | null>(null);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const token = getAuthToken() ?? "";

      const [sync, canopyE, chefE] = await Promise.all([
        api.getSyncEnergy().catch(() => null),
        fetchSiblingSync(CANOPY_URL, token),
        fetchSiblingSync(CHEF_URL,   token),
      ]);

      if (!sync) { setLoading(false); return; }

      // Circuit's own energy: blend manual slider with task-event curve
      const circuitE = sync.manual_energy * 0.7 + sync.energy_so_far * 0.3;

      const sources = ["circuit"];
      if (canopyE !== null) sources.push("canopy");
      if (chefE   !== null) sources.push("chef");

      setEnergy({
        composite: Math.round(composite(circuitE, canopyE, chefE) * 1000) / 1000,
        stress:    sync.stress_level,
        sources,
        circuit:   Math.round(circuitE * 1000) / 1000,
        canopy:    canopyE !== null ? Math.round(canopyE * 1000) / 1000 : null,
        chef:      chefE   !== null ? Math.round(chefE   * 1000) / 1000 : null,
      });
    } catch {
      // silently degrade — suggestSlot falls back to defaults
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  return { energy, loading, refresh };
}
