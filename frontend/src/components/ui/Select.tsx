import { ChevronDown } from "lucide-react";
import type { SelectHTMLAttributes } from "react";

/** Styled native <select> (native = best keyboard + mobile behaviour). Pass `label` for a visible caption. */
export function Select({ label, className = "", children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <label className={`block ${className}`}>
      {label && <span className="label">{label}</span>}
      <span className="relative block">
        <select {...rest} className="field appearance-none pr-9">{children}</select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-soft" aria-hidden />
      </span>
    </label>
  );
}
