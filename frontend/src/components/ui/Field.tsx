import type { InputHTMLAttributes } from "react";

/** Labelled text/number input in the design-system style. */
export function Field({ label, className = "", ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      <input className="field" {...rest} />
    </label>
  );
}
