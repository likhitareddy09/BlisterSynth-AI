import { useCallback, useEffect, useRef, useState } from "react";
import { appBus } from "../lib/bus";
import { DEMO_SCRIPT, type DemoAction, type DemoScript, type DemoStep } from "../lib/demoScript";
import { createDemoRunner, type DemoRunner, type DemoState } from "../lib/demoRunner";

export interface DemoView {
  state: DemoState;
  step: DemoStep | null;
  stepIndex: number;
  stepCount: number;
  elapsed: number;
  duration: number;
  progress: number;
}

interface Options {
  navigate: (to: string) => void;
  /** Called with the Live-page stream message when the demo pauses/resumes (only while the Live page is open). */
  isOnLive: () => boolean;
  script?: DemoScript;
  tickMs?: number;
}

/**
 * React wrapper around the demo clock (lib/demoRunner.ts). A timer calls runner.tick() with the real time that passed;
 * every step that becomes due has its actions carried out: navigate (react-router) or publish on the app bus
 * (the Live / Quality / PdM pages listen there).
 */
export function useDemo({ navigate, isOnLive, script = DEMO_SCRIPT, tickMs = 250 }: Options) {
  const runner = useRef<DemoRunner | null>(null);
  const [view, setView] = useState<DemoView | null>(null);
  const nav = useRef(navigate); nav.current = navigate;
  const onLive = useRef(isOnLive); onLive.current = isOnLive;

  const snapshot = useCallback((): DemoView | null => {
    const r = runner.current;
    if (!r) return null;
    return { state: r.state, step: r.index >= 0 ? script.steps[r.index] : null, stepIndex: r.index, stepCount: script.steps.length,
      elapsed: r.elapsed, duration: r.duration, progress: r.progress() };
  }, [script]);

  const perform = useCallback((steps: DemoStep[]) => {
    steps.forEach((s) => s.actions.forEach((a: DemoAction) => {
      if (a.type === "navigate") nav.current(a.to);
      else appBus.publish(a);
    }));
  }, []);

  const start = useCallback(() => {
    appBus.clear();
    runner.current = createDemoRunner(script);
    perform(runner.current.start());
    setView(snapshot());
  }, [script, perform, snapshot]);

  const pause = useCallback(() => {
    runner.current?.pause();
    if (onLive.current()) appBus.publish({ type: "live", msg: { action: "pause" } });   // freeze the twin together with the captions
    setView(snapshot());
  }, [snapshot]);

  const resume = useCallback(() => {
    runner.current?.resume();
    if (onLive.current()) appBus.publish({ type: "live", msg: { action: "resume" } });
    setView(snapshot());
  }, [snapshot]);

  const stop = useCallback(() => {
    runner.current?.stop();
    appBus.clear();
    setView(null);
    runner.current = null;
  }, []);

  const skip = useCallback(() => { if (runner.current) { perform(runner.current.skip()); setView(snapshot()); } }, [perform, snapshot]);

  // the clock
  const active = view?.state === "playing";
  useEffect(() => {
    if (!active) return;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      if (!runner.current) return;
      perform(runner.current.tick(dt));
      setView(snapshot());
    }, tickMs);
    return () => clearInterval(id);
  }, [active, perform, snapshot, tickMs]);

  useEffect(() => () => { appBus.clear(); }, []);

  return { view, running: view !== null && (view.state === "playing" || view.state === "paused"), start, pause, resume, stop, skip };
}
