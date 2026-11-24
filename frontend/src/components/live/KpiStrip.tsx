import { memo } from "react";
import type { LiveRow, Station } from "../../api/types";
import { availability, minHealth } from "../../lib/live";

function Tile({ label, value, unit, hint, alert }: { label: string; value: string; unit?: string; hint: string; alert?: boolean }) {
  return (
    <div className={`foil rounded-3xl p-4 shadow-card sm:p-5 ${alert ? "bg-rust/10" : "bg-surface"}`}>
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-soft">{label}</p>
      <p className={`mt-1 font-display text-3xl font-bold tabular-nums leading-none sm:text-4xl ${alert ? "text-rust" : ""}`}>
        {value}{unit && <span className="ml-1 text-base font-semibold text-soft">{unit}</span>}
      </p>
      <p className="mt-1.5 text-xs text-soft">{hint}</p>
    </div>
  );
}

/**
 * Live KPIs. The most important number - the health of the worst station - is the biggest thing on the page;
 * line speed, availability (share of ticks running, OEE-style) and active alerts sit next to it.
 */
function KpiStripImpl({ rows, stations = [] }: { rows: LiveRow[]; stations?: Station[] }) {
  const last = rows[rows.length - 1];
  const speed = typeof last?.line_speed_bpm === "number" ? last.line_speed_bpm : null;
  const avail = availability(rows);
  const active = last ? Object.values(last.status ?? {}).filter((s) => s !== "green").length : null;
  const health = minHealth(last);
  let worstKey: string | null = null;
  if (last) { let h = Infinity; for (const [k, v] of Object.entries(last.health ?? {})) if (typeof v === "number" && v < h) { h = v; worstKey = k; } }
  const worstLabel = stations.find((s) => s.key === worstKey)?.label ?? worstKey ?? "";
  const status = worstKey ? last?.status?.[worstKey] : undefined;
  const sentence = !last ? "waiting for the stream" : status === "red" ? `${worstLabel} is critical` : status === "amber" ? `${worstLabel} is degrading` : "every station healthy";
  const color = status === "red" ? "text-[#F0A48C]" : status === "amber" ? "text-[#F2C46D]" : "text-white";
  return (
    <div className="grid grid-cols-3 gap-3 xl:grid-cols-[1.7fr_1fr_1fr_1fr]" aria-label="Key performance indicators">
      <div className="foil col-span-3 flex items-center justify-between gap-4 rounded-3xl bg-deep p-5 text-white shadow-card xl:col-span-1">
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-white/60">Line health | worst station</p>
          <p className="mt-1 truncate text-sm font-semibold text-white/80" role="status">{sentence}</p>
        </div>
        <p className={`shrink-0 font-display text-6xl font-extrabold leading-none tabular-nums tracking-tight sm:text-7xl ${color}`}>
          {health === null ? "--" : Math.round(health)}<span className="ml-1 font-mono text-sm font-semibold text-white/50">/100</span>
        </p>
      </div>
      <Tile label="Line speed" value={speed === null ? "--" : speed.toFixed(0)} unit="bpm" hint="blisters per minute" />
      <Tile label="Availability" value={avail === null ? "--" : avail.toFixed(0)} unit="%" hint="share of ticks running" />
      <Tile label="Active alerts" value={active === null ? "--" : String(active)} hint="stations amber or red" alert={!!active} />
    </div>
  );
}
export default memo(KpiStripImpl);
