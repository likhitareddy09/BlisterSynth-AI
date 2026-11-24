import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "./ui";
import { cardPosition, TOUR_STEPS, type Rect, type TourStep } from "../lib/tour";

/** Rectangle of the step's target, or null when it is missing or off screen (the sidebar on a phone) -> the card is centred. */
function measure(step: TourStep): Rect | null {
  if (!step.target) return null;
  const el = document.querySelector(step.target);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0 || r.right <= 0 || r.left >= window.innerWidth || r.bottom <= 0 || r.top >= window.innerHeight) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

interface Props { open: boolean; onClose: (completed: boolean) => void; steps?: TourStep[] }

/** First-visit spotlight tour. A dimmed backdrop with a "hole" around the target and a card next to it. Esc skips. */
export default function Tour({ open, onClose, steps = TOUR_STEPS }: Props) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const cardRef = useRef<HTMLDivElement>(null);
  const step = steps[i];
  const last = i === steps.length - 1;

  useEffect(() => { if (open) setI(0); }, [open]);

  useLayoutEffect(() => {
    if (!open || !step) return;
    const update = () => { setRect(measure(step)); setVp({ w: window.innerWidth, h: window.innerHeight }); };
    update();
    window.addEventListener("resize", update);
    const t = setTimeout(update, 250);                      // after the sidebar's own transition has finished
    return () => { window.removeEventListener("resize", update); clearTimeout(t); };
  }, [open, step]);

  useEffect(() => {
    if (!open) return;
    cardRef.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose(false);
      else if (e.key === "ArrowRight") setI((n) => Math.min(steps.length - 1, n + 1));
      else if (e.key === "ArrowLeft") setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, onClose, steps.length]);

  const pad = 6;
  const pos = cardPosition(rect, vp, { w: Math.min(340, vp.w - 32), h: 210 });
  return (
    <AnimatePresence>
      {open && step && (
        <motion.div key="tour" className="fixed inset-0 z-[100]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          {/* click-catcher so the page behind cannot be used mid-tour */}
          <div className="absolute inset-0" onMouseDown={(e) => e.stopPropagation()} aria-hidden />
          {rect ? (
            <motion.div aria-hidden className="pointer-events-none absolute rounded-2xl ring-2 ring-teal"
              animate={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }}
              transition={{ type: "spring", stiffness: 260, damping: 30 }}
              style={{ boxShadow: "0 0 0 9999px rgba(8, 20, 16, 0.62)" }} />
          ) : <div className="absolute inset-0 bg-[rgb(8_20_16/0.62)]" aria-hidden />}
          <motion.div ref={cardRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Tour: ${step.title}`} data-testid="tour-card"
            animate={{ top: pos.top, left: pos.left }} transition={{ type: "spring", stiffness: 260, damping: 30 }}
            className="absolute w-[min(340px,calc(100vw-2rem))] rounded-3xl bg-surface p-5 shadow-float outline-none">
            <p className="text-xs font-medium text-soft">Step {i + 1} of {steps.length}</p>
            <h2 className="mt-1 font-display text-lg font-semibold">{step.title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-soft">{step.body}</p>
            <div className="mt-4 flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => onClose(false)}>Skip tour</Button>
              <div className="ml-auto flex gap-2">
                {i > 0 && <Button variant="secondary" size="sm" onClick={() => setI(i - 1)}>Back</Button>}
                <Button size="sm" onClick={() => (last ? onClose(true) : setI(i + 1))}>{last ? "Finish" : "Next"}</Button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
