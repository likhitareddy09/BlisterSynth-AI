// Plain data + one pure function for the About / How it works page (so it can be unit-tested).

export interface PipelineNode { id: string; title: string; sub: string }
/** The data flow, left to right. */
export const PIPELINE: PipelineNode[] = [
  { id: "simulator", title: "Simulator", sub: "14 sensors, 7 stations" },
  { id: "faults", title: "Faults + labels", sub: "8 fault types, RUL" },
  { id: "generative", title: "Generative model", sub: "cVAE / TimeGAN" },
  { id: "quality", title: "Quality", sub: "fidelity, utility, diversity" },
  { id: "pdm", title: "PdM models", sub: "fault class + RUL" },
  { id: "dashboard", title: "Dashboard", sub: "React + live twin" },
];

export interface InfraNode { id: string; title: string; sub: string }
/** What the pipeline runs on. */
export const INFRA: InfraNode[] = [
  { id: "fastapi", title: "FastAPI", sub: "REST endpoints /api/*" },
  { id: "websocket", title: "WebSocket", sub: "/ws/stream live ticks" },
  { id: "sqlite", title: "SQLite", sub: "runs, scenarios, models, datasets" },
];

export const TECH_STACK: { group: string; items: { name: string; why: string }[] }[] = [
  { group: "Backend", items: [
    { name: "FastAPI + Pydantic", why: "typed REST + WebSocket API; every request is validated by the same models" },
    { name: "NumPy / SciPy / pandas", why: "the physics simulator, AR(1) filters and Cholesky-correlated noise" },
    { name: "PyTorch (CPU)", why: "conditional VAE and TimeGAN generators" },
    { name: "scikit-learn", why: "PdM classifiers / RUL regressors, KS tests, PCA, t-SNE" },
    { name: "SQLite", why: "zero-setup storage for runs, scenarios, models, datasets" },
    { name: "reportlab + matplotlib", why: "the downloadable PDF report" },
    { name: "Anthropic SDK (optional)", why: "Scenario Copilot with forced tool use; rules are the fallback" },
  ] },
  { group: "Frontend", items: [
    { name: "React 18 + TypeScript", why: "typed components, hooks for the live stream and the demo clock" },
    { name: "Vite", why: "fast dev server and production build" },
    { name: "Tailwind CSS", why: "design tokens as CSS variables, light and dark mode" },
    { name: "Framer Motion", why: "page transitions, tour spotlight, caption cards" },
    { name: "Recharts", why: "sensor, health, ROC and distribution charts" },
    { name: "react-router (HashRouter)", why: "works from the dev server and when FastAPI serves the build" },
    { name: "Vitest + Testing Library", why: "unit and component tests" },
  ] },
];

export interface Concept { id: string; title: string; plain: string; project: string; formula?: string }
export const CONCEPTS: Concept[] = [
  { id: "ar1", title: "AR(1) noise",
    plain: "Real sensor noise has memory: if a reading is a little high now, it is probably still a little high one second later. An AR(1) filter creates exactly that: each noise value is a fraction (phi) of the previous one plus a fresh random shock.",
    project: "Every sensor channel passes through an AR(1) filter scaled so its long-run standard deviation equals the sensor's noise level. Streaming in small chunks gives the same numbers as one big batch because the filter state is carried over.",
    formula: "y[t] = phi * y[t-1] + sd * sqrt(1 - phi^2) * shock[t]" },
  { id: "correlation", title: "Correlated sensors",
    plain: "Sensors do not wiggle independently. Vibration on the X and Y axes move together, and motor current rises with vibration and speed. Generating each sensor separately would give data a classifier could easily tell from real data.",
    project: "The random shocks are drawn together using the Cholesky factor of a 14 x 14 correlation matrix (for example vib_x / vib_y = 0.60), then passed through the AR(1) filters.",
    formula: "shocks = z @ L.T   where   L @ L.T = R (correlation matrix)" },
  { id: "rul", title: "Remaining useful life (RUL)",
    plain: "How many seconds are left before a fault becomes a failure. It is the quantity maintenance teams want to predict: replace the part too early and you waste it, too late and the line stops.",
    project: "Because the data is simulated, the true countdown is known for every row: RUL(t) = max(failure_time - t, 0), where failure_time is onset + ramp for gradual faults and the onset itself for sudden ones. RUL models are trained on gradual faults, with the countdown capped.",
    formula: "RUL(t) = max(onset + ramp_s - t, 0)" },
  { id: "generative", title: "cVAE and TimeGAN",
    plain: "Two ways to learn from simulated data and make new, different samples. A conditional VAE compresses a window of sensor readings into a small latent code and learns to decode it back, conditioned on the fault state; sampling new codes gives new data. A TimeGAN trains a generator against a discriminator on sequences, so it keeps time structure.",
    project: "Both are conditioned on the 8 per-fault severities, so you can ask for a specific fault. Generated runs are saved like any other run and can be scored in the Quality report." },
  { id: "tstr", title: "TSTR: train on synthetic, test on real",
    plain: "The practical test of synthetic data: if a model trained only on synthetic data works on real data almost as well as a model trained on real data (TRTR), the synthetic data kept what matters for the task.",
    project: "Utility = TSTR / TRTR as a percentage (macro-F1 of a fault classifier), capped at 100. A weak baseline is flagged, because a ratio of two bad scores means little.",
    formula: "Utility = 100 * min(1, F1(train synthetic, test real) / F1(train real, test real))" },
];

/** Small deterministic random generator (mulberry32), so the AR(1) demo draws the same picture every time. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Approximately standard normal numbers (sum of 12 uniforms - 6). */
function gaussian(rand: () => number): number {
  let s = 0;
  for (let i = 0; i < 12; i++) s += rand();
  return s - 6;
}

/**
 * n samples of AR(1) noise with stationary standard deviation `sd`:  y[t] = phi*y[t-1] + sd*sqrt(1-phi^2)*shock.
 * phi = 0 is plain white noise. The same seed gives the same shocks for every phi, so moving the slider only changes the memory.
 */
export function ar1Series(n: number, phi: number, seed = 7, sd = 1): number[] {
  const rand = seededRandom(seed);
  const b0 = sd * Math.sqrt(Math.max(0, 1 - phi * phi));
  const out: number[] = [];
  let y = 0;
  for (let i = 0; i < n; i++) {
    y = phi * y + b0 * gaussian(rand);
    out.push(y);
  }
  return out;
}

/** Lag-1 autocorrelation of a series (what the slider is changing). */
export function lag1(values: number[]): number {
  const n = values.length;
  if (n < 3) return 0;
  const m = values.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    den += (values[i] - m) ** 2;
    if (i > 0) num += (values[i] - m) * (values[i - 1] - m);
  }
  return den === 0 ? 0 : num / den;
}
