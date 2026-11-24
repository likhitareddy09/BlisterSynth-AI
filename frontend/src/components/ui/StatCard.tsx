import type { ReactNode } from "react";
import { useCountUp } from "../../hooks/useCountUp";

/** Small green icon tile + big animated number (counts up from 0 on first render, eases between updates). */
export function StatCard({ icon, label, value, decimals = 0, suffix = "", hint, tone = "default", className = "", animate = true }: {
  icon: ReactNode; label: string; value: number | null | undefined; decimals?: number; suffix?: string;
  hint?: ReactNode; tone?: "default" | "alert"; className?: string;
  /** false = show the number directly (use for values that update many times a second) */
  animate?: boolean;
}) {
  const has = typeof value === "number" && Number.isFinite(value);
  const counted = useCountUp(has ? value! : 0);
  const shown = animate ? counted : has ? value! : 0;
  return (
    <div className={`foil flex items-center gap-4 rounded-3xl bg-surface p-5 shadow-card ${className}`}>
      <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${tone === "alert" ? "bg-rust/15 text-rust" : "bg-primary/10 text-primary"}`}>
        {icon}
      </span>
      <div className="min-w-0">
        <div className="font-display text-2xl font-bold leading-none tabular-nums sm:text-3xl" aria-label={`${label}: ${has ? value!.toFixed(decimals) + suffix : "no data"}`}>
          {has ? shown.toFixed(decimals) : "--"}<span className="text-lg font-semibold text-soft">{has ? suffix : ""}</span>
        </div>
        <div className="mt-1 text-sm leading-snug text-soft">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-soft">{hint}</div>}
      </div>
    </div>
  );
}
