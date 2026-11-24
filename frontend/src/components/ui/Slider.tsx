import type { CSSProperties } from "react";

/** Range slider with a visible label and live value. The track fills up to the thumb and the touch area is 32px tall (see .range in index.css). */
export function Slider({ label, value, min, max, step = 1, onChange, format, disabled }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void;
  format?: (v: number) => string; disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="label flex justify-between"><span>{label}</span><span className="font-semibold text-ink">{format ? format(value) : value}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))} aria-label={label}
        style={{ "--fill": `${max > min ? ((value - min) / (max - min)) * 100 : 0}%` } as CSSProperties}
        className="range" />
    </label>
  );
}
