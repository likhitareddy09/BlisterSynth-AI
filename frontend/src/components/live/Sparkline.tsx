import { memo } from "react";

/** Tiny dependency-free sparkline (a polyline scaled to its own min/max). */
function SparklineImpl({ values, width = 120, height = 32, color = "rgb(var(--teal))" }: { values: number[]; width?: number; height?: number; color?: string }) {
  const v = values.filter((n) => Number.isFinite(n));
  if (v.length < 2) return <svg width={width} height={height} aria-hidden />;
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  const pts = v.map((n, i) => `${((i / (v.length - 1)) * width).toFixed(1)},${(height - 3 - ((n - lo) / span) * (height - 6)).toFixed(1)}`).join(" ");
  return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden><polyline points={pts} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" /></svg>;
}
export const Sparkline = memo(SparklineImpl);
