import { X } from "lucide-react";
import { memo, useMemo } from "react";
import type { LiveRow, Sensor, Station } from "../../api/types";
import { formatValue } from "../../lib/chart";
import { stationVisual } from "../../lib/twin";
import { Badge, type BadgeTone } from "../ui";
import { Sparkline } from "./Sparkline";

const TONE: Record<string, BadgeTone> = { ok: "green", warn: "amber", bad: "red", idle: "neutral" };

/** Side panel for one station: health, active fault, and each sensor's live value with a sparkline. */
function StationPanelImpl({ station, sensors, rows, onClose }: { station: Station; sensors: Sensor[]; rows: LiveRow[]; onClose?: () => void }) {
  const last = rows[rows.length - 1];
  const vis = stationVisual(last?.status?.[station.key]);
  const health = last?.health?.[station.key];
  const tail = useMemo(() => rows.slice(-60), [rows]);
  const mine = useMemo(() => sensors.filter((s) => station.sensors.includes(s.key)), [sensors, station]);
  const faulty = last && Number(last.fault_active) === 1 && last.fault_station === station.key;
  return (
    <div className="h-full" aria-live="polite">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">{station.label}</h3>
          <Badge tone={TONE[vis.tone]} className="mt-1">{vis.label}</Badge>
        </div>
        {onClose && <button aria-label="Close station panel" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full text-soft hover:bg-tint"><X className="h-4 w-4" /></button>}
      </div>
      <div className="mt-4 flex items-end gap-2">
        <span className="font-display text-5xl font-bold tabular-nums">{typeof health === "number" ? Math.round(health) : "--"}</span>
        <span className="pb-2 text-sm text-soft">/ 100 health</span>
      </div>
      {faulty ? (
        <p className="mt-3 rounded-2xl bg-rust/10 px-3 py-2 text-sm text-rust">
          Active fault: <strong>{String(last.fault_type)}</strong> ({String(last.fault_profile)}) - RUL {formatValue(last.rul_s, 0)} s
        </p>
      ) : <p className="mt-3 text-sm text-soft">No active fault on this station.</p>}
      <ul className="mt-4 divide-y divide-line/60">
        {mine.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{s.label}</p>
              <p className="text-xs text-soft">nominal {s.nominal} {s.unit}</p>
            </div>
            <div className="flex items-center gap-3">
              <Sparkline values={tail.map((r) => Number(r[s.key]))} color={faulty ? "rgb(var(--rust))" : "rgb(var(--teal))"} />
              <span className="w-20 text-right text-sm font-semibold tabular-nums">{formatValue(last?.[s.key], s.decimals)} <span className="text-xs font-normal text-soft">{s.unit}</span></span>
            </div>
          </li>
        ))}
        {mine.length === 0 && <li className="py-3 text-sm text-soft">No sensors reported for this station yet.</li>}
      </ul>
    </div>
  );
}
export default memo(StationPanelImpl);
