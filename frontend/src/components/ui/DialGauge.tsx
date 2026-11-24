// Control-room style needle gauge: 240 degree dial with tick marks, coloured bands and a needle that swings to the value.

export interface DialBand { from: number; to: number; color: string }

const START = 150, SWEEP = 240;           // degrees, 0 = pointing right, clockwise (SVG y axis points down)
const rad = (deg: number) => (deg * Math.PI) / 180;
const pt = (cx: number, cy: number, r: number, deg: number) => [cx + r * Math.cos(rad(deg)), cy + r * Math.sin(rad(deg))] as const;

/** SVG arc path between two dial fractions (0..1). Exported for tests. */
export function arcPath(cx: number, cy: number, r: number, f0: number, f1: number): string {
  const a0 = START + SWEEP * Math.max(0, Math.min(1, f0)), a1 = START + SWEEP * Math.max(0, Math.min(1, f1));
  const [x0, y0] = pt(cx, cy, r, a0), [x1, y1] = pt(cx, cy, r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
/** Needle angle (degrees) for a value. */
export const needleAngle = (value: number, min: number, max: number) => START + SWEEP * Math.max(0, Math.min(1, (value - min) / (max - min || 1)));

export function DialGauge({ value, min = 0, max = 100, label, unit = "", decimals = 0, bands = [], tone = "dark", size = 150 }: {
  value: number | null | undefined; min?: number; max?: number; label: string; unit?: string; decimals?: number;
  bands?: DialBand[]; tone?: "dark" | "light"; size?: number;
}) {
  const has = typeof value === "number" && Number.isFinite(value);
  const v = has ? value! : min;
  const dark = tone === "dark";
  const ink = dark ? "rgb(255 255 255 / 0.92)" : "rgb(var(--ink))";
  const faint = dark ? "rgb(255 255 255 / 0.16)" : "rgb(var(--line))";
  const ticks = Array.from({ length: 11 }, (_, i) => i / 10);
  return (
    <div className="flex flex-col items-center" role="meter" aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={has ? Math.round(v) : undefined}
      aria-valuetext={has ? `${v.toFixed(decimals)} ${unit}`.trim() : "no data"}>
      <svg viewBox="0 0 140 118" width={size} height={size * 0.84} aria-hidden className="max-w-full">
        <path d={arcPath(70, 70, 56, 0, 1)} fill="none" stroke={faint} strokeWidth={9} strokeLinecap="round" />
        {bands.map((b, i) => <path key={i} d={arcPath(70, 70, 56, (b.from - min) / (max - min), (b.to - min) / (max - min))} fill="none" stroke={b.color} strokeWidth={9} opacity={0.85} />)}
        {ticks.map((f, i) => {
          const a = START + SWEEP * f, major = i % 5 === 0;
          const [x0, y0] = pt(70, 70, 44, a), [x1, y1] = pt(70, 70, major ? 37 : 40, a);
          return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke={ink} strokeOpacity={0.5} strokeWidth={major ? 2 : 1.2} />;
        })}
        <g style={{ transform: `rotate(${needleAngle(v, min, max)}deg)`, transformOrigin: "70px 70px", transition: "transform 0.7s cubic-bezier(0.3, 0.7, 0.3, 1.25)" }}>
          <path d="M70 66.5 L118 70 L70 73.5 Z" fill={has ? "#F2C46D" : faint} />
        </g>
        <circle cx={70} cy={70} r={7} fill={dark ? "#0E2E25" : "rgb(var(--surface))"} stroke={has ? "#F2C46D" : faint} strokeWidth={3} />
        <text x={70} y={102} textAnchor="middle" fontFamily="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" fontSize={17} fontWeight={700} fill={ink}>
          {has ? v.toFixed(decimals) : "--"}<tspan fontSize={10} dx={2} fillOpacity={0.6}>{unit}</tspan>
        </text>
      </svg>
      <span className={`-mt-1 text-center font-mono text-[10px] font-semibold uppercase tracking-[0.14em] ${dark ? "text-white/60" : "text-soft"}`}>{label}</span>
    </div>
  );
}
