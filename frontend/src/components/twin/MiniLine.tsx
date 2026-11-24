import { memo, type CSSProperties } from "react";
import { stationVisual, toneVar, webDuration } from "../../lib/twin";

// A small, always-moving picture of the 7-station line with a status light per station - for the control-room
// overview and the landing page. The big interactive version is DigitalTwin (Live monitor).

export const MINI_STATIONS = [
  { key: "unwind", short: "Unwind" }, { key: "forming", short: "Form" }, { key: "filling", short: "Fill" }, { key: "sealing", short: "Seal" },
  { key: "cooling", short: "Cool" }, { key: "punching", short: "Punch" }, { key: "cartoning", short: "Carton" },
] as const;

function Glyph({ id, stroke }: { id: string; stroke: string }) {
  const p = { fill: "none", stroke, strokeWidth: 2.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (id) {
    case "unwind": return <g><circle r={11} {...p} /><circle r={3} fill={stroke} /></g>;
    case "forming": return <g><rect x={-12} y={-10} width={24} height={8} rx={2} {...p} /><path d="M-8 6 q4 6 8 0 q4 6 8 0" {...p} /></g>;
    case "filling": return <g><path d="M-11 -10 h22 l-7 11 h-8 z" {...p} /><circle cy={8} r={2.6} fill={stroke} /></g>;
    case "sealing": return <g><circle cy={-6} r={6} {...p} /><circle cy={8} r={6} {...p} /></g>;
    case "cooling": return <g>{[-8, 0, 8].map((x) => <path key={x} d={`M${x} -10 v20`} {...p} />)}</g>;
    case "punching": return <g><path d="M-11 -10 h22 M0 -10 v10 M-8 0 h16" {...p} /><path d="M-10 10 h20" {...p} /></g>;
    default: return <g><rect x={-11} y={-7} width={22} height={17} rx={2} {...p} /><path d="M-11 -7 l5 -5 h12 l5 5" {...p} /></g>;
  }
}

interface Props {
  status?: Record<string, string | undefined>;
  health?: Record<string, number | undefined>;
  /** blisters per minute; sets the film speed, and 0 / null stops it */
  speed?: number | null;
  tone?: "light" | "dark";
  showHealth?: boolean;
  className?: string;
  label?: string;
}

function MiniLineImpl({ status = {}, health = {}, speed = 220, tone = "light", showHealth = false, className = "", label = "Blister line status" }: Props) {
  const dark = tone === "dark";
  const dur = webDuration(speed);
  const summary = MINI_STATIONS.map((s) => `${s.short} ${stationVisual(status[s.key]).label}`).join(", ");
  return (
    <div className={dur === null ? "twin-paused" : ""}>
      <svg viewBox={`0 0 700 ${showHealth ? 140 : 118}`} className={className} role="img" aria-label={`${label}: ${summary}`}
        style={{ ["--web-dur" as string]: `${dur ?? 1.2}s` } as CSSProperties}>
        <line x1={14} x2={686} y1={62} y2={62} stroke={dark ? "rgb(255 255 255 / 0.18)" : "rgb(var(--mint))"} strokeWidth={8} strokeLinecap="round" />
        <line x1={14} x2={686} y1={62} y2={62} stroke={dark ? "#7FE0C8" : "rgb(var(--primary))"} strokeWidth={2.5} className="twin-web" opacity={0.8} />
        {MINI_STATIONS.map((s, i) => {
          const cx = 50 + i * 100;
          const vis = stationVisual(status[s.key]);
          const col = vis.tone === "idle" ? (dark ? "rgb(255 255 255 / 0.35)" : "rgb(var(--sage))") : toneVar(vis.tone);
          const h = health[s.key];
          return (
            <g key={s.key}>
              <rect x={cx - 34} y={34} width={68} height={56} rx={16} fill={dark ? "#0E2E25" : "rgb(var(--surface))"} stroke={col} strokeWidth={vis.tone === "idle" ? 1.5 : 2.5}
                style={vis.tone !== "idle" ? { filter: `drop-shadow(0 0 ${vis.tone === "ok" ? 3 : 7}px ${col})` } : undefined} />
              <g transform={`translate(${cx} 63)`}><Glyph id={s.key} stroke={dark ? "rgb(255 255 255 / 0.8)" : "rgb(var(--soft))"} /></g>
              <circle cx={cx + 22} cy={45} r={8} fill={col} opacity={0.25} className={vis.pulse ? "twin-pulse" : ""} />
              <circle cx={cx + 22} cy={45} r={4.5} fill={col} />
              <text x={cx} y={112} textAnchor="middle" fontFamily="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" fontSize={12} fontWeight={700}
                letterSpacing={1} fill={dark ? "rgb(255 255 255 / 0.7)" : "rgb(var(--soft))"}>{s.short.toUpperCase()}</text>
              {showHealth && <text x={cx} y={133} textAnchor="middle" fontFamily="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" fontSize={13} fontWeight={700}
                fill={col}>{typeof h === "number" ? Math.round(h) : "--"}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
export default memo(MiniLineImpl);
