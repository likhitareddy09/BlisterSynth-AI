// Pure helpers for the quality report, PdM visuals and Data Lab (no React, so they are easy to unit-test).
import type { DistSeries, ImbalanceResult, Pt, QualityReport } from "../api/types";

export const SENSOR_KEYS = [
  "forming_temp_c", "sealing_temp_c", "sealing_pressure_bar", "film_tension_n", "vacuum_kpa", "motor_current_a",
  "vib_x_mm_s", "vib_y_mm_s", "vib_z_mm_s", "line_speed_bpm", "cooling_flow_lpm", "humidity_pct", "cutting_force_n", "pocket_fill_count",
] as const;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const TEAL = "31, 158, 147";
const BLUE = "91, 127, 166";           // negative values (rust stays reserved for faults and alerts)

/** Heat-map cell colour for a correlation in [-1, 1]: teal = positive, blue = negative, strength = opacity. */
export function corrColor(v: number | null | undefined): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "transparent";
  const a = clamp(Math.abs(v), 0, 1);
  return `rgba(${v >= 0 ? TEAL : BLUE}, ${(0.08 + 0.88 * a).toFixed(3)})`;
}

/** Colour for a difference matrix; `maxAbs` is the value that gets full colour (differences are usually small). */
export function diffColor(v: number | null | undefined, maxAbs = 0.5): string {
  if (typeof v !== "number" || !Number.isFinite(v) || maxAbs <= 0) return "transparent";
  const a = clamp(Math.abs(v) / maxAbs, 0, 1);
  return `rgba(${v >= 0 ? TEAL : BLUE}, ${(0.05 + 0.9 * a).toFixed(3)})`;
}

/** Confusion-matrix colour: share of the row (0..1) -> teal opacity. */
export function shareColor(share: number): string {
  return `rgba(${TEAL}, ${(0.05 + 0.9 * clamp(share, 0, 1)).toFixed(3)})`;
}

/** Row-normalise a confusion matrix (each row sums to 1; empty rows stay 0). */
export function normalizeRows(m: number[][]): number[][] {
  return m.map((row) => { const s = row.reduce((a, b) => a + b, 0); return row.map((v) => (s > 0 ? v / s : 0)); });
}

/** Largest absolute off-diagonal-free value of a matrix, at least `floor` (so an all-zero matrix does not divide by 0). */
export function maxAbs(m: number[][], floor = 0.05): number {
  let best = floor;
  for (const row of m) for (const v of row) if (Number.isFinite(v)) best = Math.max(best, Math.abs(v));
  return best;
}

/** "<0.001" style p-value. */
export function fmtP(p: number | null | undefined): string {
  if (typeof p !== "number" || !Number.isFinite(p)) return "-";
  if (p < 0.001) return "<0.001";
  return p.toFixed(p < 0.1 ? 3 : 2);
}

export function pct(v: number | null | undefined, digits = 0): string {
  return typeof v === "number" && Number.isFinite(v) ? `${(v * 100).toFixed(digits)}%` : "-";
}

/** Gauge verdict word used under each of the three quality gauges. */
export function gaugeVerdict(value: number | null | undefined): "good" | "fair" | "poor" | "n/a" {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return value >= 75 ? "good" : value >= 50 ? "fair" : "poor";
}

/** Share of sensors that pass the KS test. */
export function ksSummary(rows: { pass: boolean }[]): { passed: number; total: number } {
  return { passed: rows.filter((r) => r.pass).length, total: rows.length };
}

/** Trapezoid area under a ROC curve given [fpr, tpr] points (sorted by fpr). Used to sanity-check the server's AUC. */
export function rocAuc(points: Pt[]): number {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let area = 0;
  for (let i = 1; i < p.length; i++) area += ((p[i][0] - p[i - 1][0]) * (p[i][1] + p[i - 1][1])) / 2;
  return area;
}

/** Merge a histogram (30 bins) and a KDE (80 grid points) into one row list for a single Recharts chart. */
export function mergeDist(d: DistSeries): { x: number; real_kde: number; syn_kde: number; real_hist: number; syn_hist: number }[] {
  const lo = d.x[0], hi = d.x[d.x.length - 1];
  const w = d.x.length > 1 ? (hi - lo) / (d.x.length - 1) : 1;
  return d.kde_x.map((x, i) => {
    const bin = clamp(Math.round((x - lo) / (w || 1)), 0, d.x.length - 1);
    return { x, real_kde: d.real_kde[i], syn_kde: d.syn_kde[i], real_hist: d.real_hist[bin], syn_hist: d.syn_hist[bin] };
  });
}

/** Turn the scatter embedding lists into Recharts rows. */
export const toXY = (pts: Pt[]) => pts.map(([x, y]) => ({ x, y }));

/** Utility gauge sub-text, e.g. "TSTR 0.53 / TRTR 0.60 = 89%". */
export function utilityText(r: QualityReport["tstr"]): string {
  if (!r.available || !r.tstr || !r.trtr) return r.reason ?? "Not available";
  const ratio = r.utility_ratio;
  return `TSTR ${r.tstr.macro_f1.toFixed(2)} / TRTR ${r.trtr.macro_f1.toFixed(2)}${typeof ratio === "number" ? ` = ${(ratio * 100).toFixed(0)}%` : ""}`;
}

/** Per-class rows for the imbalance bar chart, sorted so the biggest improvement comes first. */
export function imbalanceRows(r: ImbalanceResult): { name: string; real: number; aug: number; delta: number }[] {
  return [...r.improvement.classes].sort((a, b) => b.delta - a.delta)
    .map((c) => ({ name: c.class.replace(/_/g, " "), real: c.recall_real, aug: c.recall_aug, delta: c.delta }));
}

/** "sealing_pressure_bar" -> "sealing pressure" (unit suffix dropped, for heat-map axes). */
export function shortSensor(key: string): string {
  return key.replace(/_(c|bar|n|kpa|a|mm_s|bpm|lpm|pct|count)$/, "").replace(/_/g, " ");
}

/** Short readable feature name: "vib_x_mm_s__std" -> "vib_x_mm_s (std)". */
export function featureLabel(name: string): string {
  const [sensor, stat] = name.split("__");
  return stat ? `${sensor} (${stat})` : sensor;
}

// ------------------------------------------------------------------ Data Lab
/** Which of the 14 sensors have no column yet. mapping = {schema name: file column}. */
export function missingSensors(mapping: Record<string, string>): string[] {
  return SENSOR_KEYS.filter((k) => !mapping[k]);
}

/** Columns used by more than one schema field (the server rejects this). */
export function duplicateColumns(mapping: Record<string, string>): string[] {
  const seen = new Map<string, number>();
  for (const col of Object.values(mapping)) if (col) seen.set(col, (seen.get(col) ?? 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([c]) => c);
}

/** Set (or clear, with "") one mapping entry without mutating the old object. */
export function setMapping(mapping: Record<string, string>, field: string, column: string): Record<string, string> {
  const next = { ...mapping };
  if (column) next[field] = column; else delete next[field];
  return next;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function isCsvFile(f: { name: string; type?: string }): boolean {
  return /\.csv$/i.test(f.name) || f.type === "text/csv";
}
