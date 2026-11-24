import { Info } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

/** Small (i) button; the explanation shows on hover, keyboard focus or click and is linked with aria-describedby. */
export function InfoTip({ children, label = "More information" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-label={label} aria-describedby={open ? id : undefined} aria-expanded={open}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
        className="relative grid h-5 w-5 place-items-center rounded-full text-soft before:absolute before:-inset-1.5 before:rounded-full before:content-[''] hover:bg-tint hover:text-ink">
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open && (
        <span id={id} role="tooltip"
          className="absolute left-1/2 top-full z-50 mt-2 w-64 -translate-x-1/2 rounded-2xl border border-line bg-surface p-3 text-left text-xs font-normal leading-relaxed text-ink shadow-float">
          {children}
        </span>
      )}
    </span>
  );
}
