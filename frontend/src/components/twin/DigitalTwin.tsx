import { memo, useMemo, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import type { LiveRow, Station } from "../../api/types";
import { punchDuration, reelDuration, stationVisual, toneVar, webDuration } from "../../lib/twin";

interface Props {
  stations: Station[];
  last?: LiveRow;
  selected: string | null;
  onSelect: (key: string | null) => void;       // click / Enter: pin the side panel
  onHover?: (key: string | null) => void;       // mouse over: preview the side panel
}

// Fixed layout of the 7 stations along the web (viewBox 1200 x 380). x = centre of each module.
const XS = [96, 262, 428, 594, 760, 926, 1092];
const WEB_Y = 215;
const MOD_W = 118, MOD_H = 128;

/** Station-specific drawing inside its module (all coordinates are relative to the module centre). */
function Machinery({ id, dur }: { id: string; dur: { reel: number | null; punch: number | null; pill: number | null } }) {
  const stroke = "rgb(var(--soft))";
  const common = { fill: "none", stroke, strokeWidth: 3, strokeLinecap: "round" as const };
  const reelStyle: CSSProperties = dur.reel ? ({ "--reel-dur": `${dur.reel}s` } as CSSProperties) : {};
  switch (id) {
    case "unwind":
      return (
        <g>
          <g className="twin-reel" style={reelStyle}>
            <circle r={36} cx={0} cy={-6} fill="rgb(var(--tint))" stroke={stroke} strokeWidth={3} />
            <circle r={7} cx={0} cy={-6} fill={stroke} />
            {[0, 60, 120].map((a) => <line key={a} x1={0} y1={-6} x2={0} y2={-38} {...common} transform={`rotate(${a} 0 -6)`} />)}
            {[0, 60, 120].map((a) => <line key={a + 180} x1={0} y1={-6} x2={0} y2={-38} {...common} transform={`rotate(${a + 180} 0 -6)`} />)}
          </g>
        </g>
      );
    case "forming":
      return (
        <g>
          <rect x={-34} y={-40} width={68} height={20} rx={6} fill="rgb(var(--rust) / 0.25)" stroke={stroke} strokeWidth={3} />
          {[-20, 0, 20].map((x) => <path key={x} d={`M${x - 6} -18 q6 14 12 0`} {...common} />)}
          <rect x={-34} y={10} width={68} height={14} rx={5} fill="rgb(var(--tint))" stroke={stroke} strokeWidth={3} />
        </g>
      );
    case "filling":
      return (
        <g>
          <path d="M-34 -52 h68 l-18 30 h-32 z" fill="rgb(var(--tint))" stroke={stroke} strokeWidth={3} strokeLinejoin="round" />
          {[-8, 6, 0].map((dx, i) => (
            <circle key={i} className="twin-pill" cx={dx} cy={-14} r={5} fill={["#E9EEF0", "#B9CAC7", "#F2C46D"][i]} stroke="rgb(var(--soft))" strokeWidth={1.5}
              style={{ ["--pill-dur" as string]: dur.pill ? `${dur.pill}s` : "1.2s", animationDelay: `${i * (dur.pill ?? 1.2) / 3}s` }} />
          ))}
        </g>
      );
    case "sealing":
      return (
        <g>
          <circle cx={0} cy={-24} r={18} fill="rgb(var(--tint))" stroke={stroke} strokeWidth={3} />
          <circle cx={0} cy={26} r={18} fill="rgb(var(--tint))" stroke={stroke} strokeWidth={3} />
          <path d="M-8 -24 h16 M-8 26 h16" {...common} />
        </g>
      );
    case "cooling":
      return (
        <g>
          {[-30, -10, 10, 30].map((x) => <rect key={x} x={x - 4} y={-38} width={8} height={62} rx={4} fill="rgb(var(--teal) / 0.35)" stroke={stroke} strokeWidth={2} />)}
          <path d="M-36 34 q9 -9 18 0 t18 0 t18 0 t18 0" {...common} stroke="rgb(var(--teal))" />
        </g>
      );
    case "punching":
      return (
        <g>
          <rect x={-30} y={20} width={60} height={14} rx={5} fill="rgb(var(--tint))" stroke={stroke} strokeWidth={3} />
          <g className="twin-punch" style={dur.punch ? ({ "--punch-dur": `${dur.punch}s` } as CSSProperties) : {}}>
            <rect x={-6} y={-54} width={12} height={34} rx={3} fill={stroke} />
            <rect x={-26} y={-24} width={52} height={14} rx={4} fill="rgb(var(--tint))" stroke={stroke} strokeWidth={3} />
          </g>
        </g>
      );
    case "cartoning":
      return (
        <g>
          <rect x={-36} y={-30} width={72} height={56} rx={6} fill="rgb(var(--pastel-sand))" stroke={stroke} strokeWidth={3} />
          <path d="M-36 -10 h72 M0 -30 v20" {...common} />
          <rect x={-22} y={4} width={44} height={14} rx={3} fill="rgb(var(--surface))" stroke={stroke} strokeWidth={2} />
        </g>
      );
    default:
      return <rect x={-30} y={-30} width={60} height={60} rx={10} {...common} />;
  }
}

function DigitalTwinImpl({ stations, last, selected, onSelect, onHover }: Props) {
  const bpm = typeof last?.line_speed_bpm === "number" ? last.line_speed_bpm : null;
  const web = webDuration(bpm);
  const dur = useMemo(() => ({ reel: reelDuration(bpm), punch: punchDuration(bpm), pill: web }), [bpm, web]);
  const moving = web !== null;
  const activeFault = last && Number(last.fault_active) === 1 ? String(last.fault_type ?? "") : "";
  const faultStation = last && Number(last.fault_active) === 1 ? String(last.fault_station ?? "") : "";

  const summary = stations.length
    ? stations.map((s) => `${s.label} ${stationVisual(last?.status?.[s.key]).label}`).join(", ")
    : "waiting for data";

  const keyHandler = (key: string) => (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(selected === key ? null : key); }
    if (e.key === "Escape") onSelect(null);
  };

  const modules: ReactNode[] = stations.slice(0, XS.length).map((st, i) => {
    const status = last?.status?.[st.key];
    const vis = stationVisual(status);
    const color = toneVar(vis.tone);
    const health = last?.health?.[st.key];
    const x = XS[i];
    const isSel = selected === st.key;
    const hasFault = faultStation === st.key;
    return (
      <g key={st.key} transform={`translate(${x} ${WEB_Y - 14})`} role="button" tabIndex={0} style={{ cursor: "pointer" }}
        aria-label={`${st.label}: ${vis.label}${typeof health === "number" ? `, health ${Math.round(health)}` : ""}${hasFault ? `, active fault ${activeFault}` : ""}`}
        aria-pressed={isSel} onClick={() => onSelect(isSel ? null : st.key)} onKeyDown={keyHandler(st.key)}
        onMouseEnter={() => onHover?.(st.key)} onMouseLeave={() => onHover?.(null)} onFocus={() => onHover?.(st.key)} onBlur={() => onHover?.(null)}>
        {/* glow ring: colour = live health status, pulses when red */}
        <rect className={vis.pulse ? "twin-pulse" : ""} x={-MOD_W / 2 - 6} y={-MOD_H / 2 - 6} width={MOD_W + 12} height={MOD_H + 12} rx={28}
          fill="none" stroke={color} strokeWidth={isSel ? 5 : 3} opacity={vis.tone === "idle" ? 0.35 : 0.9}
          style={{ filter: vis.tone === "idle" ? undefined : `drop-shadow(0 0 10px ${color})` }} />
        <rect x={-MOD_W / 2} y={-MOD_H / 2} width={MOD_W} height={MOD_H} rx={22} fill="rgb(var(--surface))" stroke="rgb(var(--line))" strokeWidth={2} />
        <Machinery id={st.key} dur={dur} />
        <text y={MOD_H / 2 + 30} textAnchor="middle" className="fill-ink font-display" fontSize={21} fontWeight={600}>
          {st.label.length > 14 ? st.label.split(/[ +/]/)[0] : st.label}
        </text>
        <g transform={`translate(0 ${MOD_H / 2 + 56})`}>
          <rect x={-36} y={-18} width={72} height={28} rx={14} fill={color} opacity={0.18} />
          <circle cx={-21} cy={-4} r={5} fill={color} />
          <text x={8} y={2} textAnchor="middle" className="fill-ink" fontSize={18} fontWeight={700}>{typeof health === "number" ? Math.round(health) : "--"}</text>
        </g>
        {hasFault && (
          <g transform={`translate(${MOD_W / 2 - 4} ${-MOD_H / 2 - 2})`}>
            <circle r={13} fill="rgb(var(--rust))" /><text y={5} textAnchor="middle" fill="#fff" fontSize={15} fontWeight={700}>!</text>
          </g>
        )}
      </g>
    );
  });

  return (
    <div className={moving ? "" : "twin-paused"}>
      <svg viewBox="0 100 1200 240" className="h-auto w-full" role="group" aria-label={`Digital twin of the blister packaging line. ${summary}.`}
        style={{ ["--web-dur" as string]: web ? `${web}s` : "1.2s" } as CSSProperties}>
        <title>Blister line digital twin</title>
        <desc>Film runs left to right from the unwind reel through forming, filling, sealing, cooling, punching and cartoning. Each station glows green, amber or red from its live health.</desc>
        {/* the film web */}
        <line x1={20} x2={1180} y1={WEB_Y} y2={WEB_Y} stroke="rgb(var(--mint))" strokeWidth={10} strokeLinecap="round" opacity={0.55} />
        <line className="twin-web" x1={20} x2={1180} y1={WEB_Y} y2={WEB_Y} stroke="rgb(var(--primary))" strokeWidth={4} opacity={0.85} />
        {/* little arrows between stations so the direction reads at a glance. Each module's glow ring ends 65 px from its centre
            (59 + 6), so the 36 px gap runs from x+65 to x+101; the arrow is centred in it (x+78 .. x+88), clear of both rings. */}
        {XS.slice(0, -1).map((x, i) => <path key={i} d={`M${x + 78} ${WEB_Y - 8} l10 8 l-10 8`} fill="none" stroke="rgb(var(--soft))" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />)}
        {modules}
        {stations.length === 0 && <text x={600} y={215} textAnchor="middle" className="fill-soft" fontSize={18}>Waiting for the live stream...</text>}
      </svg>
    </div>
  );
}

export default memo(DigitalTwinImpl);
