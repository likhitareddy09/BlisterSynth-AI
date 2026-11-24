// Pure helpers behind the SVG line chart (kept separate so they are easy to unit-test).

export type Num = number | null | undefined;

/** [min, max] over the finite values, padded a little; a flat or empty series gets a sensible range. */
export function valueRange(series: Num[][]): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const s of series) for (const v of s) if (typeof v === "number" && Number.isFinite(v)) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (lo === Infinity) return [0, 1];
  if (lo === hi) return [lo - 1, hi + 1];
  const pad = (hi - lo) * 0.05;
  return [lo - pad, hi + pad];
}

/** SVG path for one series. Missing values (null/NaN) break the line instead of drawing to zero. */
export function linePath(xs: number[], ys: Num[], w: number, h: number, xr: [number, number], yr: [number, number]): string {
  const sx = (x: number) => ((x - xr[0]) / (xr[1] - xr[0] || 1)) * w;
  const sy = (y: number) => h - ((y - yr[0]) / (yr[1] - yr[0] || 1)) * h;
  let d = "", pen = false;
  for (let i = 0; i < xs.length; i++) {
    const y = ys[i];
    if (typeof y !== "number" || !Number.isFinite(y)) { pen = false; continue; }
    d += `${pen ? "L" : "M"}${sx(xs[i]).toFixed(1)},${sy(y).toFixed(1)}`;
    pen = true;
  }
  return d;
}

/** Contiguous [start, end] x-ranges where `flags` is truthy - used to shade fault periods. */
export function activeBands(xs: number[], flags: Num[]): [number, number][] {
  const bands: [number, number][] = [];
  let start: number | null = null;
  for (let i = 0; i < xs.length; i++) {
    const on = Boolean(flags[i]);
    if (on && start === null) start = xs[i];
    if (!on && start !== null) { bands.push([start, xs[i - 1]]); start = null; }
  }
  if (start !== null && xs.length) bands.push([start, xs[xs.length - 1]]);
  return bands;
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}m` : m > 0 ? `${m}m${String(r).padStart(2, "0")}s` : `${r}s`;
}

export function formatValue(v: unknown, decimals = 2): string {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(decimals) : "-";
}

/** Pull one numeric column out of preview rows. */
export function column(rows: Record<string, unknown>[], key: string): Num[] {
  return rows.map((r) => (typeof r[key] === "number" ? (r[key] as number) : null));
}
