import { BookOpen, CircleHelp, Command, MonitorPlay, Route } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

interface Props { onTour: () => void; onDemo: () => void; onPalette: () => void }

/** "?" button in the top bar: take the tour again, play the demo, read how it works, open the command palette. */
export default function HelpMenu({ onTour, onDemo, onPalette }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const item = "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-tint";
  const pick = (fn: () => void) => () => { setOpen(false); fn(); };
  return (
    <div className="relative" ref={ref}>
      <button data-tour="help" aria-label="Help" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} title="Help"
        className="grid h-10 w-10 place-items-center rounded-full border border-line bg-surface text-ink transition hover:bg-tint">
        <CircleHelp className="h-4 w-4" aria-hidden />
      </button>
      {open && (
        <div role="menu" aria-label="Help menu" className="absolute right-0 top-12 z-50 w-64 rounded-2xl border border-line bg-surface p-1.5 shadow-float">
          <button role="menuitem" className={item} onClick={pick(onTour)}><Route className="h-4 w-4 text-primary" aria-hidden />Take the product tour</button>
          <button role="menuitem" className={item} onClick={pick(onDemo)}><MonitorPlay className="h-4 w-4 text-primary" aria-hidden />Play demo (3-4 min)</button>
          <Link role="menuitem" to="/app/about" className={item} onClick={() => setOpen(false)}><BookOpen className="h-4 w-4 text-primary" aria-hidden />How it works</Link>
          <button role="menuitem" className={item} onClick={pick(onPalette)}><Command className="h-4 w-4 text-primary" aria-hidden />Command palette<kbd className="ml-auto rounded border border-line bg-tint px-1.5 text-[11px] text-soft">Ctrl K</kbd></button>
        </div>
      )}
    </div>
  );
}
