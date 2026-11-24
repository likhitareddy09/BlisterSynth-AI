// Recharts wrappers used by the quality report and the PdM page. Colours follow light/dark mode through CSS variables.
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, Area } from "recharts";
import type { DistSeries, Pt } from "../../api/types";
import { featureLabel, mergeDist, toXY } from "../../lib/metrics";
import { COLORS } from "../common";

export const REAL_COLOR = COLORS[0];       // teal
export const SYN_COLOR = COLORS[1];        // amber
const TOOLTIP = { contentStyle: { background: "rgb(var(--surface))", border: "1px solid rgb(var(--line))", borderRadius: 12, fontSize: 12 }, labelStyle: { color: "rgb(var(--ink))" } };
const AXIS = { tick: { fontSize: 11 }, stroke: "rgb(var(--line))" };

/** Real vs synthetic windows as two clouds (PCA or t-SNE). */
export function EmbeddingScatter({ real, syn, xLabel, yLabel }: { real: Pt[]; syn: Pt[]; xLabel: string; yLabel: string }) {
  return (
    <div className="h-80 w-full" role="img" aria-label={`Scatter of real versus synthetic windows (${xLabel} by ${yLabel})`}>
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 8, right: 12, bottom: 20, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" dataKey="x" name={xLabel} {...AXIS} label={{ value: xLabel, position: "insideBottom", offset: -10, fontSize: 11 }} />
          <YAxis type="number" dataKey="y" name={yLabel} {...AXIS} label={{ value: yLabel, angle: -90, position: "insideLeft", fontSize: 11 }} />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} {...TOOLTIP} />
          <Legend verticalAlign="top" height={28} />
          <Scatter name="Real" data={toXY(real)} fill={REAL_COLOR} fillOpacity={0.6} isAnimationActive={false} />
          <Scatter name="Synthetic" data={toXY(syn)} fill={SYN_COLOR} fillOpacity={0.6} isAnimationActive={false} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Histogram (steps) + KDE line for real and synthetic of one sensor. */
export function DistChart({ dist, unit }: { dist: DistSeries; unit?: string }) {
  const rows = mergeDist(dist);
  return (
    <div className="h-72 w-full" role="img" aria-label="Distribution of real versus synthetic values">
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 18, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v) => Number(v).toFixed(Math.abs(v) < 10 ? 2 : 0)} {...AXIS}
            label={{ value: unit ?? "", position: "insideBottom", offset: -8, fontSize: 11 }} />
          <YAxis {...AXIS} tickFormatter={(v) => Number(v).toPrecision(2)} />
          <Tooltip formatter={(v: number) => Number(v).toPrecision(3)} labelFormatter={(v) => `value ${Number(v).toFixed(2)}`} {...TOOLTIP} />
          <Legend verticalAlign="top" height={28} />
          <Area type="step" dataKey="real_hist" name="Real histogram" stroke="none" fill={REAL_COLOR} fillOpacity={0.18} isAnimationActive={false} />
          <Area type="step" dataKey="syn_hist" name="Synthetic histogram" stroke="none" fill={SYN_COLOR} fillOpacity={0.18} isAnimationActive={false} />
          <Line type="monotone" dataKey="real_kde" name="Real KDE" stroke={REAL_COLOR} dot={false} strokeWidth={2} isAnimationActive={false} />
          <Line type="monotone" dataKey="syn_kde" name="Synthetic KDE" stroke={SYN_COLOR} dot={false} strokeWidth={2} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** ROC curves: one line per class (thin) and the fault-vs-none curve (thick). */
export function RocChart({ curves }: { curves: { name: string; auc: number; points: Pt[]; bold?: boolean }[] }) {
  return (
    <div className="h-[26rem] w-full" role="img" aria-label="ROC curves">
      <ResponsiveContainer>
        <LineChart margin={{ top: 8, right: 12, bottom: 8, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" dataKey="x" domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} {...AXIS} label={{ value: "false positive rate", position: "insideBottom", offset: -10, fontSize: 11 }} />
          <YAxis type="number" domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} {...AXIS} label={{ value: "true positive rate", angle: -90, position: "insideLeft", fontSize: 11 }} />
          <Tooltip formatter={(v: number) => Number(v).toFixed(3)} {...TOOLTIP} />
          <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 11, paddingTop: 16 }} />
          <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke="rgb(var(--soft))" strokeDasharray="4 4" ifOverflow="extendDomain" />
          {curves.map((c, i) => (
            <Line key={c.name} data={c.points.map(([x, y]) => ({ x, y }))} dataKey="y" name={`${c.name} (AUC ${c.auc.toFixed(2)})`} type="monotone" dot={false}
              stroke={c.bold ? "rgb(var(--ink))" : COLORS[i % COLORS.length]} strokeWidth={c.bold ? 3 : 1.6} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal bars, biggest first (feature / sensor importance). */
export function ImportanceChart({ rows }: { rows: { name: string; value: number }[] }) {
  const data = rows.map((r) => ({ ...r, label: r.name.includes("__") ? featureLabel(r.name) : r.name }));
  return (
    <div className="w-full" style={{ height: Math.max(180, 26 * data.length + 30) }} role="img" aria-label="Importance bars">
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" {...AXIS} tickFormatter={(v) => Number(v).toPrecision(2)} />
          <YAxis type="category" dataKey="label" width={190} {...AXIS} interval={0} />
          <Tooltip formatter={(v: number) => Number(v).toFixed(4)} {...TOOLTIP} />
          <Bar dataKey="value" name="importance" fill={REAL_COLOR} radius={[0, 6, 6, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Two bars per category (TSTR vs TRTR scores, per-class recall before / after). */
export function GroupedBars({ data, a, b, height = 260, domain = [0, 1] as [number, number] }: {
  data: Record<string, number | string>[]; a: { key: string; name: string; color?: string }; b: { key: string; name: string; color?: string }; height?: number; domain?: [number, number];
}) {
  return (
    <div className="w-full" style={{ height }} role="img" aria-label={`${a.name} versus ${b.name}`}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 28, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="name" interval={0} angle={-20} textAnchor="end" height={54} {...AXIS} />
          <YAxis domain={domain} {...AXIS} tickFormatter={(v) => Number(v).toFixed(1)} />
          <Tooltip formatter={(v: number) => Number(v).toFixed(3)} {...TOOLTIP} />
          <Legend verticalAlign="top" height={28} />
          <Bar dataKey={a.key} name={a.name} fill={a.color ?? SYN_COLOR} radius={[6, 6, 0, 0]} isAnimationActive={false} />
          <Bar dataKey={b.key} name={b.name} fill={b.color ?? REAL_COLOR} radius={[6, 6, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Predicted vs actual RUL with the ideal y = x line. */
export function RulScatter({ points, max }: { points: Pt[]; max: number }) {
  return (
    <div className="h-80 w-full" role="img" aria-label="Predicted versus actual remaining useful life">
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 8, right: 12, bottom: 20, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" dataKey="x" name="actual RUL (s)" domain={[0, max]} allowDataOverflow tickCount={6} tickFormatter={(v) => String(Math.round(Number(v)))} {...AXIS} label={{ value: "actual RUL (s)", position: "insideBottom", offset: -10, fontSize: 11 }} />
          <YAxis type="number" dataKey="y" name="predicted RUL (s)" domain={[0, max]} allowDataOverflow tickCount={6} tickFormatter={(v) => String(Math.round(Number(v)))} {...AXIS} label={{ value: "predicted RUL (s)", angle: -90, position: "insideLeft", fontSize: 11 }} />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} {...TOOLTIP} />
          <ReferenceLine segment={[{ x: 0, y: 0 }, { x: max, y: max }]} stroke="rgb(var(--soft))" strokeDasharray="4 4" />
          <Scatter name="windows" data={toXY(points)} fill={REAL_COLOR} fillOpacity={0.55} isAnimationActive={false} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
