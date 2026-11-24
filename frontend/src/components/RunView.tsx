import { useMemo, useState } from "react";
import type { Preview, RunLabels, Sensor } from "../api/types";
import { column, formatTime } from "../lib/chart";
import LineChart from "./LineChart";
import { COLORS } from "./common";
import { Select } from "./ui";

interface Props { preview: Preview; sensors: Sensor[]; labels?: RunLabels | null }

/** Sensor chart (pick a sensor, fault periods shaded) + station health chart for a saved or fresh run. */
export default function RunView({ preview, sensors, labels }: Props) {
  const [key, setKey] = useState(sensors[0]?.key ?? "");
  const sensor = sensors.find((s) => s.key === key) ?? sensors[0];
  const t = useMemo(() => column(preview.rows, "t_s") as number[], [preview]);
  const healthKeys = useMemo(
    () => Object.keys(preview.health?.[0] ?? {}).filter((k) => typeof preview.health?.[0]?.[k] === "number"),
    [preview],
  );
  if (!sensor) return <p className="text-sm text-soft">Sensor catalogue not loaded yet.</p>;
  return (
    <div>
      <Select label="Sensor" className="mb-3 max-w-xs" value={sensor.key} onChange={(e) => setKey(e.target.value)}>
        {sensors.map((s) => <option key={s.key} value={s.key}>{s.label} ({s.unit})</option>)}
      </Select>
      <LineChart x={t} unit={sensor.unit} faultFlags={column(preview.rows, "fault_active")}
        series={[{ name: sensor.label, color: COLORS[0], values: column(preview.rows, sensor.key) }]} />
      {healthKeys.length > 0 && (
        <>
          <h4 className="mb-1 mt-5 text-sm font-semibold">Station health</h4>
          <LineChart x={t} height={180} yRange={[0, 100]}
            series={healthKeys.map((k, i) => ({ name: k, color: COLORS[i % COLORS.length], values: column(preview.health ?? [], k) }))} />
        </>
      )}
      {labels && labels.segments.length > 0 && (
        <div className="mt-4 max-h-64 overflow-y-auto rounded-2xl" tabIndex={0} aria-label={`${labels.segments.length} fault segments`}>
        <table className="table-clean w-full">
          <thead><tr><th>Fault</th><th>Start</th><th>End</th></tr></thead>
          <tbody>
            {labels.segments.map((s, i) => (
              <tr key={i}><td>{String(s.fault_type ?? s.type ?? "-")}</td><td>{formatTime(s.start_s)}</td><td>{formatTime(s.end_s)}</td></tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
