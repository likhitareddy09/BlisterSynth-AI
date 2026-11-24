// Demo mode for the viva: the whole 3-4 minute walkthrough as PLAIN DATA.
// Nothing here touches React or the network, so the order and timing can be unit-tested (demo.test.ts).
//
// `at` is the time in seconds since the demo started. When the clock reaches `at`, the step's caption card is shown and its
// actions run. To change the story, edit this array - no other file needs to change.

export type DemoAction =
  | { type: "navigate"; to: string }                                  // go to a page
  | { type: "live"; msg: Record<string, unknown> }                    // a WebSocket message for the Live page
  | { type: "ui"; target: "quality:run" | "pdm:diagnostics" };       // press a page's main button

export interface DemoStep {
  id: string;
  at: number;                       // seconds from the start of the demo
  title: string;                    // caption card heading
  body: string;                     // caption card text (what to say out loud)
  actions: DemoAction[];
}

export interface DemoScript { id: string; title: string; endAt: number; steps: DemoStep[] }

/**
 * Stream playback multiplier used by the demo. Measured with the real simulator (seed 7, intensity 2, ramp 600 s):
 * at 5x the cartoning / main-drive station turns amber about 24 s after injection and red about 26 s after it,
 * so the "alerts" and "twin-red" steps below are timed to land just after those moments.
 */
export const DEMO_SPEED = 5;
export const DEMO_SEED = 7;
/** The injected fault: bearing wear, gradual, failing 10 simulated minutes after injection, twice the normal severity. */
export const DEMO_FAULT = { type: "bearing_wear", profile: "gradual", ramp_s: 600, intensity: 2 } as const;

export const DEMO_SCRIPT: DemoScript = {
  id: "viva-v1",
  title: "BlisterSynth AI - guided demo",
  endAt: 232,
  steps: [
    { id: "intro", at: 0, title: "BlisterSynth AI in one minute",
      body: "A generator of synthetic sensor data for a pharmaceutical blister-packaging line, built to train predictive-maintenance models when real failure data is rare.",
      actions: [{ type: "navigate", to: "/app" }] },
    { id: "open-live", at: 12, title: "The digital twin",
      body: "Seven stations - unwind, forming, filling, sealing, cooling, punching, cartoning - driven by a physics simulator with 14 sensors. The data arrives over a WebSocket.",
      actions: [{ type: "navigate", to: "/app/live" }] },
    { id: "start-stream", at: 24, title: "Start the stream",
      body: `A fresh run with seed ${DEMO_SEED}, played at ${DEMO_SPEED}x real time. Same seed, same data: every run is reproducible.`,
      actions: [
        { type: "live", msg: { action: "reset", config: { seed: DEMO_SEED } } },
        { type: "live", msg: { action: "speed", value: DEMO_SPEED } },
        { type: "live", msg: { action: "resume" } },
      ] },
    { id: "baseline", at: 44, title: "A healthy line",
      body: "All stations are green and every sensor sits around its nominal value, with realistic AR(1) noise, drift and shift changes.",
      actions: [] },
    { id: "inject", at: 62, title: "Inject bearing wear",
      body: "We inject a gradual bearing-wear fault. Vibration climbs and the motor works harder, exactly like a real wear-out - with ground-truth labels attached.",
      actions: [{ type: "live", msg: { action: "inject", fault: { ...DEMO_FAULT } } }] },
    { id: "alerts", at: 86, title: "Alerts fire",
      body: "As the main drive's health collapses, the alerts feed and a toast notification fire: amber first, then critical. The anomaly score climbs with it.",
      actions: [] },
    { id: "twin-red", at: 98, title: "The twin goes red",
      body: "The affected station (cartoning, driven by the main drive) pulses red. The fault timeline shows when it started and the remaining useful life (RUL) counting down to failure.",
      actions: [] },
    { id: "repair", at: 122, title: "Repair it",
      body: "Maintenance clears the fault. Health recovers, and the labels mark exactly when the fault was active.",
      actions: [{ type: "live", msg: { action: "repair" } }] },
    { id: "recovered", at: 140, title: "Back to normal",
      body: "Every run like this is saved with its labels, so it can become training data for fault classifiers and RUL models.",
      actions: [] },
    { id: "quality", at: 158, title: "Is the synthetic data any good?",
      body: "The quality report scores fidelity (does it look real?), utility (does it train models as well as real data?) and diversity (does it cover everything?).",
      actions: [{ type: "navigate", to: "/app/quality" }, { type: "ui", target: "quality:run" }] },
    { id: "pdm", at: 188, title: "Predictive maintenance results",
      body: "TSTR - train on synthetic, test on real. A confusion matrix, ROC curves and feature importance show what the fault classifier learned, and which sensors matter.",
      actions: [{ type: "navigate", to: "/app/pdm" }, { type: "ui", target: "pdm:diagnostics" }] },
    { id: "wrap-up", at: 216, title: "That is BlisterSynth AI",
      body: "Physics simulator, labelled faults, generative models, quality scoring and predictive maintenance in one pipeline. Thank you - questions?",
      actions: [{ type: "navigate", to: "/app/about" }] },
  ],
};

// ---------------------------------------------------------------------------------------------- checks
/** Everything that must hold for the script to be playable. Returns [] when the script is fine. */
export function validateScript(script: DemoScript, minTotal = 180, maxTotal = 240): string[] {
  const errors: string[] = [];
  const { steps } = script;
  if (steps.length === 0) return ["the script has no steps"];
  if (steps[0].at !== 0) errors.push("the first step must start at 0 s");
  const ids = new Set<string>();
  steps.forEach((s, i) => {
    if (ids.has(s.id)) errors.push(`duplicate step id '${s.id}'`);
    ids.add(s.id);
    if (i > 0 && s.at <= steps[i - 1].at) errors.push(`step '${s.id}' is not later than the step before it`);
    if (!s.title.trim() || !s.body.trim()) errors.push(`step '${s.id}' has an empty caption`);
    if (i < steps.length - 1 && steps[i + 1].at - s.at < 8) errors.push(`step '${s.id}' is on screen for less than 8 s - too short to read`);
    for (const a of s.actions) {
      if (a.type === "navigate" && !a.to.startsWith("/app")) errors.push(`step '${s.id}' navigates outside the app: ${a.to}`);
    }
  });
  if (script.endAt <= steps[steps.length - 1].at) errors.push("endAt must be after the last step");
  if (script.endAt < minTotal || script.endAt > maxTotal) errors.push(`the demo lasts ${script.endAt} s; it should be ${minTotal}-${maxTotal} s`);
  return errors;
}

/** Index of the first step that runs this kind of live action (-1 = none). */
export function indexOfLiveAction(script: DemoScript, action: string): number {
  return script.steps.findIndex((s) => s.actions.some((a) => a.type === "live" && a.msg.action === action));
}
export function indexOfNavigate(script: DemoScript, to: string): number {
  return script.steps.findIndex((s) => s.actions.some((a) => a.type === "navigate" && a.to === to));
}
