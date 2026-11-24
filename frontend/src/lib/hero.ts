// Geometry and motion of the landing-page hero: tablets fall out of the filling station into a 10-pocket blister pack
// as the page scrolls. Pure functions (no React) so the choreography is unit-testable.
import { clamp01 } from "../hooks/useScrollProgress";

/** A blister card holds 10 tablets - the same POCKETS_PER_BLISTER the backend simulator uses for the vision count. */
export const POCKETS = 10;
/** Where tablets leave the machine (SVG user units, viewBox 0 0 480 560). */
export const NOZZLE = { x: 240, y: 178 };
/** Pocket centres: 2 rows x 5, filled row by row from the left. */
export const POCKET_POS = Array.from({ length: POCKETS }, (_, i) => ({ x: 88 + (i % 5) * 76, y: i < 5 ? 386 : 468 }));

export type TabletKind = "round" | "capsule";
export interface TabletLook { kind: TabletKind; c1: string; c2: string; rest: number }
export const TABLETS: TabletLook[] = [
  { kind: "round", c1: "#F3F6F5", c2: "#B9CAC7", rest: 0 },
  { kind: "capsule", c1: "#F2C46D", c2: "#F3F6F5", rest: -24 },
  { kind: "round", c1: "#B9CAC7", c2: "#7F9783", rest: 0 },
  { kind: "capsule", c1: "#E6A08A", c2: "#F3F6F5", rest: 18 },
  { kind: "round", c1: "#F3F6F5", c2: "#B9CAC7", rest: 0 },
  { kind: "capsule", c1: "#7F9783", c2: "#F3F6F5", rest: 22 },
  { kind: "round", c1: "#F2C46D", c2: "#D9A94C", rest: 0 },
  { kind: "capsule", c1: "#F3F6F5", c2: "#B9CAC7", rest: -16 },
  { kind: "round", c1: "#E6A08A", c2: "#C98370", rest: 0 },
  { kind: "capsule", c1: "#B9CAC7", c2: "#F3F6F5", rest: 28 },
];

/** Scroll window in which tablet i falls. Starts are staggered so the pack fills one tablet at a time. */
export function dropWindow(i: number): { start: number; end: number } {
  const start = 0.04 + i * 0.072;
  return { start, end: start + 0.16 };
}

/** 0 = still inside the machine, 1 = resting in its pocket. */
export function dropT(p: number, i: number): number {
  const { start, end } = dropWindow(i);
  return clamp01((p - start) / (end - start));
}

/** How many pockets are filled at scroll progress p (they fill in order 0, 1, 2, ...). */
export function landedCount(p: number): number {
  let n = 0;
  for (let i = 0; i < POCKETS; i++) if (dropT(p, i) >= 1) n++;
  return n;
}

/**
 * Position and spin of tablet i at drop progress t: it drifts sideways from the nozzle (ease-out), falls faster and
 * faster (gravity, ease-in), and does one small bounce when it lands.
 */
export function tabletPose(t: number, i: number): { x: number; y: number; r: number; visible: boolean } {
  const to = POCKET_POS[i];
  const rest = TABLETS[i].rest;
  if (t <= 0) return { x: NOZZLE.x, y: NOZZLE.y, r: rest, visible: false };
  const fall = Math.min(1, t / 0.82);
  const x = NOZZLE.x + (to.x - NOZZLE.x) * (1 - (1 - fall) * (1 - fall));
  let y = NOZZLE.y + (to.y - NOZZLE.y) * fall * fall;
  if (t > 0.82) y = to.y - 9 * Math.sin((Math.PI * (t - 0.82)) / 0.18);
  const spin = (i % 2 ? 1 : -1) * 220 * (1 - fall);
  return { x, y, r: rest + spin, visible: true };
}

/** The two-line headline, revealed word by word on first load. */
export const HEADLINE: string[][] = [["Synthetic", "data"], ["for", "smarter"], ["packaging", "lines"]];

/** "What do you want to do?" - the guided entry under the hero (each goes straight to the right page of the app). */
export const INTENTS = [
  { label: "Watch a line fail, live", to: "/app/live" },
  { label: "Make a labelled dataset", to: "/app/simulator" },
  { label: "Describe a scenario in plain English", to: "/app/copilot" },
  { label: "Check if synthetic data is good enough", to: "/app/quality" },
] as const;
