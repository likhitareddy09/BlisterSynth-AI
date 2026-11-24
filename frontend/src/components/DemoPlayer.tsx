import { AnimatePresence, motion } from "framer-motion";
import { Pause, Play, SkipForward, Square, X } from "lucide-react";
import type { DemoView } from "../hooks/useDemo";
import { formatClock } from "../lib/demoRunner";
import { Button } from "./ui";

interface Props { view: DemoView | null; onPause: () => void; onResume: () => void; onStop: () => void; onSkip: () => void }

/** The floating caption card of demo mode: what to say now, a progress bar, and pause / skip / stop. */
export default function DemoPlayer({ view, onPause, onResume, onStop, onSkip }: Props) {
  const finished = view?.state === "finished";
  return (
    <AnimatePresence>
      {view && (
        <motion.section key="demo" role="region" aria-label="Demo mode" data-testid="demo-player"
          initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 30 }}
          className="fixed inset-x-3 bottom-3 z-[80] mx-auto w-auto max-w-2xl overflow-hidden rounded-3xl border border-line bg-surface shadow-float sm:bottom-6">
          <div className="h-1.5 bg-line" role="progressbar" aria-label="Demo progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(view.progress * 100)}>
            <div className="h-full bg-teal transition-[width] duration-300" style={{ width: `${view.progress * 100}%` }} />
          </div>
          <div className="p-4 sm:p-5">
            <div className="flex items-center gap-2 text-xs font-medium text-soft">
              <span className="rounded-full bg-primary px-2 py-0.5 text-on-primary">DEMO</span>
              <span>Step {Math.max(1, view.stepIndex + 1)} of {view.stepCount}</span>
              <span className="ml-auto tabular-nums">{formatClock(view.elapsed)} / {formatClock(view.duration)}</span>
              {view.state === "paused" && <span className="rounded-full bg-warn/15 px-2 py-0.5 text-warn">Paused</span>}
            </div>
            {/* keyed, so every new step fades in; no exit animation, so the caption can never lag behind the clock */}
            <motion.div key={view.step?.id ?? "none"} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
              <h2 className="mt-2 font-display text-lg font-semibold sm:text-xl" aria-live="polite">{view.step?.title}</h2>
              <p className="mt-1 text-sm leading-relaxed text-soft sm:text-[15px]">{view.step?.body}</p>
            </motion.div>
            <div className="mt-4 flex items-center gap-2">
              {finished ? (
                <Button onClick={onStop}><X className="h-4 w-4" aria-hidden />Close</Button>
              ) : (
                <>
                  {view.state === "paused"
                    ? <Button onClick={onResume}><Play className="h-4 w-4" aria-hidden />Resume</Button>
                    : <Button variant="secondary" onClick={onPause}><Pause className="h-4 w-4" aria-hidden />Pause</Button>}
                  <Button variant="ghost" onClick={onSkip} disabled={view.stepIndex >= view.stepCount - 1}><SkipForward className="h-4 w-4" aria-hidden />Next step</Button>
                  <Button variant="danger" className="ml-auto" onClick={onStop}><Square className="h-4 w-4" aria-hidden />Stop</Button>
                </>
              )}
            </div>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
