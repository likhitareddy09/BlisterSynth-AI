import { memo, useMemo } from "react";
import { CartesianGrid, Line, LineChart as RLineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { activeBands, formatTime, valueRange, type Num } from "../lib/chart";
import { FAULT_COLOR } from "./common";

export interface ChartSeries { name: string; color: string; values: Num[] }
interface Props {
  x: number[]; series: ChartSeries[]; height?: number; unit?: string;
  /** values (same length as x) that are truthy while a fault is active - shaded in the rust accent */
  faultFlags?: Num[]; yRange?: [number, number];
}

/** Y tick labels with enough decimals for the visible span, so neighbouring ticks never print the same number. */
function tickFmt([lo, hi]: [number, number]) {
  const span = Math.abs(hi - lo);
  const dec = span === 0 || !Number.isFinite(span) ? 1 : Math.min(4, Math.max(0, Math.ceil(-Math.log10(span / 3))));
  return (v: number) => v.toFixed(dec);
}

/** Recharts line chart with fault periods shaded. Animations are off so streaming updates never janks. */
function LineChartImpl({ x, series, height = 220, unit, faultFlags, yRange }: Props) {
  const data = useMemo(() => x.map((t, i) => {
    const row: Record<string, number | null> = { t };
    series.forEach((s, j) => { const v = s.values[i]; row[`s${j}`] = typeof v === "number" && Number.isFinite(v) ? v : null; });
    return row;
  }), [x, series]);
  const bands = useMemo(() => (faultFlags ? activeBands(x, faultFlags) : []), [x, faultFlags]);
  const yr = useMemo(() => yRange ?? valueRange(series.map((s) => s.values)), [yRange, series]);

  if (x.length < 2) {
    return <div className="chart-empty grid place-items-center rounded-2xl bg-tint text-sm text-soft" style={{ height }}>Waiting for data...</div>;
  }
  return (
    <div>
      <div role="img" aria-label={`${series.map((s) => s.name).join(", ")}${unit ? ` in ${unit}` : ""}`}>
        <ResponsiveContainer width="100%" height={height}>
          <RLineChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={formatTime} tickCount={5} minTickGap={30} />
            <YAxis domain={yr} width={52} tickCount={4} tickFormatter={tickFmt(yr)} />
            <Tooltip
              isAnimationActive={false} labelFormatter={(t) => formatTime(Number(t))}
              contentStyle={{ borderRadius: 12, border: "1px solid rgb(var(--line))", background: "rgb(var(--surface))", color: "rgb(var(--ink))", fontSize: 12 }}
              formatter={(v, name) => [typeof v === "number" ? v.toFixed(2) : String(v), name]}
            />
            {bands.map(([a, b], i) => <ReferenceArea key={i} x1={a} x2={Math.max(b, a + 1)} fill={FAULT_COLOR} fillOpacity={0.16} ifOverflow="hidden" />)}
            {series.map((s, j) => (
              <Line key={s.name} name={s.name} dataKey={`s${j}`} stroke={s.color} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} type="monotone" />
            ))}
          </RLineChart>
        </ResponsiveContainer>
      </div>
      <div className="legend mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-soft">
        {series.map((s) => <span key={s.name} className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.name}</span>)}
        {unit && <span>{unit}</span>}
        {bands.length > 0 && <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm" style={{ background: FAULT_COLOR, opacity: 0.5 }} />fault active</span>}
      </div>
    </div>
  );
}
export default memo(LineChartImpl);
