// The demo clock: a small state machine with NO timers of its own. The React hook calls tick(dtSeconds) on an interval,
// which makes it trivial to test with fake time (pause, resume, stop and skip all behave exactly the same in tests).
import type { DemoScript, DemoStep } from "./demoScript";

export type DemoState = "idle" | "playing" | "paused" | "finished" | "stopped";

export interface DemoRunner {
  readonly state: DemoState;
  readonly elapsed: number;
  /** Index of the step currently on screen (-1 before the first). */
  readonly index: number;
  readonly duration: number;
  start(): DemoStep[];
  pause(): void;
  resume(): void;
  stop(): void;
  /** Advance the clock. Returns the steps that became due (in order). Does nothing unless playing. */
  tick(dtSeconds: number): DemoStep[];
  /** Jump to the next step right away (also fires its actions). Returns [] at the last step. */
  skip(): DemoStep[];
  /** 0-1 */
  progress(): number;
}

export function createDemoRunner(script: DemoScript): DemoRunner {
  let state: DemoState = "idle";
  let elapsed = 0;
  let index = -1;

  const due = (): DemoStep[] => {
    const fired: DemoStep[] = [];
    while (index + 1 < script.steps.length && script.steps[index + 1].at <= elapsed + 1e-9) {
      index += 1;
      fired.push(script.steps[index]);
    }
    if (elapsed >= script.endAt - 1e-9 && state === "playing") state = "finished";
    return fired;
  };

  const runner: DemoRunner = {
    get state() { return state; },
    get elapsed() { return elapsed; },
    get index() { return index; },
    get duration() { return script.endAt; },
    start() {
      state = "playing"; elapsed = 0; index = -1;
      return due();
    },
    pause() { if (state === "playing") state = "paused"; },
    resume() { if (state === "paused") state = "playing"; },
    stop() { if (state === "playing" || state === "paused") state = "stopped"; },
    tick(dt) {
      if (state !== "playing" || !(dt > 0)) return [];
      elapsed = Math.min(script.endAt, elapsed + dt);
      return due();
    },
    skip() {
      if (state !== "playing" && state !== "paused") return [];
      const next = script.steps[index + 1];
      if (!next) return [];
      elapsed = next.at;
      const was = state;
      if (was === "paused") state = "playing";          // fire the step, then go back to paused
      const fired = due();
      if (was === "paused") state = "paused";
      return fired;
    },
    progress() { return script.endAt > 0 ? Math.min(1, elapsed / script.endAt) : 0; },
  };
  return runner;
}

export const formatClock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
