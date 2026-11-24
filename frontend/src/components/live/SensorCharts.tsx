import { memo, useMemo } from "react";
import type { LiveRow, Sensor } from "../../api/types";
import { column } from "../../lib/chart";
import { decimate } from "../../lib/live";
import { COLORS } from "../common";
import LineChart from "../LineChart";
import { Card } from "../ui";

export const MAX_SELECTED = 3;

/** Real-time chart of up to 3 chosen sensors (rolling window, fault periods shaded in rust). */
function SensorChartsImpl({ rows, sensors, selected, onChange }: { rows: LiveRow[]; sensors: Sensor[]; selected: string[]; onChange: (keys: string[]) => void }) {
  const win = useMemo(() => decimate(rows, 160), [rows]);
  const x = useMemo(() => win.map((r) => r.t_s), [win]);
  const flags = useMemo(() => column(win, "fault_active"), [win]);
  const chosen = useMemo(() => selected.map((k) => sensors.find((s) => s.key === k)).filter((s): s is Sensor => Boolean(s)), [selected, sensors]);
  // One small chart per sensor: sensors have very different scales, so sharing one y-axis would flatten some of them.
  const panels = useMemo(() => chosen.map((s, i) => ({ sensor: s, series: [{ name: s.label, color: COLORS[i % COLORS.length], values: column(win, s.key) }] })), [chosen, win]);
  const toggle = (k: string) => {
    if (selected.includes(k)) onChange(selected.filter((s) => s !== k));
    else onChange([...selected, k].slice(-MAX_SELECTED));
  };
  return (
    <Card title="Live sensor traces" actions={<span className="text-xs text-soft">pick up to {MAX_SELECTED}</span>}>
      <div className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1 [mask-image:linear-gradient(90deg,#000_85%,transparent)] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:[mask-image:none]" role="group" aria-label="Choose sensors to plot">
        {sensors.map((s) => {
          const on = selected.includes(s.key);
          return (
            <button key={s.key} aria-pressed={on} onClick={() => toggle(s.key)}
              className={`press inline-flex min-h-[40px] shrink-0 items-center whitespace-nowrap rounded-full px-3 text-xs font-medium sm:min-h-0 sm:py-1.5 ${on ? "bg-primary text-on-primary" : "bg-tint text-soft hover:text-ink"}`}>
              {s.label}
            </button>
          );
        })}
      </div>
      {panels.length === 0 ? <p className="py-8 text-center text-sm text-soft">Select a sensor to plot.</p>
        : <div className="space-y-4">{panels.map((p) => (
            <LineChart key={p.sensor.key} x={x} series={p.series} height={panels.length > 1 ? 150 : 240} faultFlags={flags} unit={p.sensor.unit} />
          ))}</div>}
    </Card>
  );
}
export default memo(SensorChartsImpl);
