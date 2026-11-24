// The scroll-driven "film to carton" story on the landing page: chapter text, camera shots of the machine illustration
// and the little "how this fault looks in the data" curves. Pure (no React) so the maths is unit-testable.
import { clamp01 } from "../hooks/useScrollProgress";

/** Width and height of the machine illustration (LineIllustration's viewBox). */
export const LINE_W = 1400;
export const LINE_H = 440;

export type Signature = "healthy" | "step" | "intermittent" | "decline" | "accelerating";
export interface Chapter {
  id: string; station: string | null; eyebrow: string; title: string; body: string;
  sensors: string; fault: string; signature: Signature;
  /** camera: centre of the shot (SVG units) and zoom (1 = whole line) */
  shot: { cx: number; cy: number; zoom: number };
}

// Numbers are the simulator's own nominal values (backend/app/simulator/sensors.py) and fault catalogue.
export const CHAPTERS: Chapter[] = [
  { id: "line", station: null, eyebrow: "00 / The line", title: "Seven stations, one film web",
    body: "A blister line turns a roll of PVC film into sealed, cut and boxed blister cards. BlisterSynth simulates the whole line: 14 sensors, one reading per second, all physically linked.",
    sensors: "14 sensors | 7 stations", fault: "8 fault types, each labelled second by second", signature: "healthy",
    shot: { cx: 700, cy: 228, zoom: 1.06 } },
  { id: "forming", station: "forming", eyebrow: "01 / Forming", title: "Heat it, then pull it into shape",
    body: "The film is heated to about 135 °C and sucked into a mould by vacuum. That is where the pockets come from.",
    sensors: "forming temperature | forming vacuum", fault: "Vacuum leak (sudden): pockets form badly and the camera rejects more of them.", signature: "step",
    shot: { cx: 345, cy: 214, zoom: 2.3 } },
  { id: "filling", station: "filling", eyebrow: "02 / Filling", title: "One tablet in every pocket",
    body: "A feeder drops tablets into the pockets at 220 blisters a minute while a camera counts every single pocket.",
    sensors: "pocket count (vision) | line speed", fault: "Feeder jam (intermittent): empty pockets come in bursts and the line speed jitters.", signature: "intermittent",
    shot: { cx: 548, cy: 196, zoom: 2.3 } },
  { id: "sealing", station: "sealing", eyebrow: "03 / Sealing", title: "Sealed at 180 °C",
    body: "Heated rollers press the lidding foil onto the film at about 4.5 bar, so every pocket is airtight.",
    sensors: "sealing temperature | sealing pressure", fault: "Heater degradation (gradual): the roller slowly fails to reach its set-point.", signature: "decline",
    shot: { cx: 708, cy: 206, zoom: 2.3 } },
  { id: "punching", station: "punching", eyebrow: "04 / Punching", title: "Cut out, card by card",
    body: "A press punches each blister card out of the web. As the tool wears, every cut needs more force.",
    sensors: "cutting force | vibration Z", fault: "Punch dulling (gradual, accelerating): force and vibration creep up until the tool fails.", signature: "accelerating",
    shot: { cx: 1075, cy: 206, zoom: 2.3 } },
];

/** Smooth 0..1 ease with a flat start and end. */
export const smooth = (t: number) => { const x = clamp01(t); return x * x * (3 - 2 * x); };

/**
 * Camera position at scroll progress p. Between two shots the camera moves only in the middle half of the segment, so it
 * holds still on each station while its text is on screen.
 */
export function cameraAt(p: number, chapters: Chapter[] = CHAPTERS): { cx: number; cy: number; zoom: number; index: number } {
  const n = chapters.length;
  const q = clamp01(p) * (n - 1);
  const i = Math.min(n - 2, Math.floor(q));
  const f = smooth((q - i - 0.25) / 0.5);
  const a = chapters[i].shot, b = chapters[i + 1].shot;
  // zoom is interpolated in log space so zooming in and out feel equally fast
  const zoom = Math.exp(Math.log(a.zoom) + (Math.log(b.zoom) - Math.log(a.zoom)) * f);
  return { cx: a.cx + (b.cx - a.cx) * f, cy: a.cy + (b.cy - a.cy) * f, zoom, index: Math.round(q) };
}

/** viewBox for a camera shot in a panel of the given size (keeps the drawing's proportions, no stretching). */
export function viewBoxFor(cam: { cx: number; cy: number; zoom: number }, panelW: number, panelH: number): string {
  const aspect = panelW > 0 && panelH > 0 ? panelH / panelW : LINE_H / LINE_W;
  let w = LINE_W / cam.zoom;
  let h = w * aspect;
  // never show less than the full machine height in the overview, whatever the panel shape
  if (cam.zoom < 1.2 && h < LINE_H * 1.05) { h = LINE_H * 1.05; w = h / aspect; }
  return `${(cam.cx - w / 2).toFixed(1)} ${(cam.cy - h / 2).toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`;
}

/** Scroll position (0..1) at which chapter i is centred - used by the chapter buttons. */
export const progressOfChapter = (i: number, n = CHAPTERS.length) => (n <= 1 ? 0 : clamp01(i / (n - 1)));

/** A small SVG path of how the fault shows up in its sensor: deterministic "noise" so it looks like data, not a rule. */
export function signaturePath(kind: Signature, w = 220, h = 56, points = 72): string {
  const pts: string[] = [];
  for (let k = 0; k < points; k++) {
    const t = k / (points - 1);
    const noise = 0.035 * Math.sin(k * 2.7) + 0.025 * Math.sin(k * 7.3 + 1) + 0.015 * Math.sin(k * 13.1);
    let v = 0.25;                                                  // 0 = bottom, 1 = top
    if (kind === "step") v = t < 0.45 ? 0.22 : 0.72;
    if (kind === "intermittent") {
      const bursts = [[0.3, 0.36], [0.52, 0.6], [0.72, 0.84], [0.9, 1.01]];
      v = bursts.some(([a, b]) => t >= a && t < b) ? 0.75 : 0.22;
    }
    if (kind === "decline") v = t < 0.35 ? 0.75 : 0.75 - 0.55 * ((t - 0.35) / 0.65);
    if (kind === "accelerating") v = t < 0.3 ? 0.2 : 0.2 + 0.7 * Math.pow((t - 0.3) / 0.7, 1.5);
    const y = h - 4 - (clamp01(v + noise)) * (h - 8);
    pts.push(`${k === 0 ? "M" : "L"}${(t * w).toFixed(1)} ${y.toFixed(1)}`);
  }
  return pts.join(" ");
}
