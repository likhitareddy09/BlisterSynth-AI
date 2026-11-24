import { motion, useReducedMotion } from "framer-motion";

export type GaugeTone = "auto" | "good-high" | "good-low";

/** Colour from the value. good-high: big is good (fidelity). good-low: big is bad (anomaly). */
export function gaugeColor(value: number, tone: GaugeTone): string {
  if (tone === "auto") return "rgb(var(--primary))";
  const bad = tone === "good-low" ? value : 100 - value;       // 0 = perfect, 100 = worst
  return bad >= 60 ? "rgb(var(--bad))" : bad >= 30 ? "rgb(var(--warn))" : "rgb(var(--ok))";
}

/** Animated radial gauge (270 degree arc), 0-100. */
export function Gauge({ value, label, tone = "good-high", size = 160, unit = "" }: {
  value: number; label: string; tone?: GaugeTone; size?: number; unit?: string;
}) {
  const reduce = useReducedMotion();
  const v = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const r = 52, c = 2 * Math.PI * r, arc = c * 0.75;
  const color = gaugeColor(v, tone);
  return (
    <div className="inline-flex flex-col items-center" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)}>
      <svg width={size} height={size * 0.86} viewBox="0 0 140 120" aria-hidden>
        <g transform="rotate(135 70 70)" fill="none" strokeLinecap="round" strokeWidth={11}>
          <circle cx={70} cy={70} r={r} stroke="rgb(var(--line))" strokeDasharray={`${arc} ${c}`} />
          <motion.circle
            cx={70} cy={70} r={r} stroke={color} strokeDasharray={`${arc} ${c}`}
            initial={{ strokeDashoffset: arc }} animate={{ strokeDashoffset: arc * (1 - v / 100) }}
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 60, damping: 16 }}
          />
        </g>
        <text x={70} y={72} textAnchor="middle" className="fill-ink font-display" fontSize={28} fontWeight={700}>{Math.round(v)}{unit}</text>
      </svg>
      <span className="-mt-3 text-sm text-soft">{label}</span>
    </div>
  );
}
