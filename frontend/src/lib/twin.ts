// Pure helpers behind the digital-twin SVG (status mapping and animation speeds).
import type { LiveRow } from "../api/types";

export type TwinTone = "ok" | "warn" | "bad" | "idle";
export interface StationVisual { tone: TwinTone; pulse: boolean; label: string }

/** Map a backend status (green/amber/red) to the twin's colour tone. Red pulses. Unknown -> idle (grey). */
export function stationVisual(status?: string | null): StationVisual {
  switch (status) {
    case "green": return { tone: "ok", pulse: false, label: "Healthy" };
    case "amber": return { tone: "warn", pulse: false, label: "Degrading" };
    case "red": return { tone: "bad", pulse: true, label: "Critical" };
    default: return { tone: "idle", pulse: false, label: "No data" };
  }
}

/** Tailwind-independent colour (CSS variable) for a tone, usable in SVG fill/stroke. */
export const toneVar = (tone: TwinTone) =>
  tone === "idle" ? "rgb(var(--sage))" : `rgb(var(--${tone}))`;

/** Is the line moving? True while the encoder reports more than 5 blisters/min. */
export function isRunning(row?: LiveRow | null): boolean {
  if (!row) return false;
  return Number(row.line_speed_bpm ?? 0) > 5;
}

/** Seconds for one cycle of the moving film dashes. 220 bpm -> 1.2 s; faster line = shorter cycle; null = stopped. */
export function webDuration(bpm: number | null | undefined): number | null {
  if (typeof bpm !== "number" || !Number.isFinite(bpm) || bpm <= 5) return null;
  return Math.min(6, Math.max(0.15, 264 / bpm));
}
export const reelDuration = (bpm: number | null | undefined) => { const w = webDuration(bpm); return w === null ? null : w * 3.3; };
/** One punch stroke per blister, but never faster than the eye can follow. */
export const punchDuration = (bpm: number | null | undefined) =>
  typeof bpm === "number" && bpm > 5 ? Math.min(4, Math.max(0.45, 60 / bpm * 2)) : null;
