// The first-visit product tour: plain data (so the order and targets are unit-testable) + the localStorage flag.

export interface TourStep {
  id: string;
  /** CSS selector of the element to spotlight. When it is missing on screen the card is centred instead. */
  target: string | null;
  title: string;
  body: string;
}

export const TOUR_STEPS: TourStep[] = [
  { id: "welcome", target: null, title: "Welcome to BlisterSynth AI",
    body: "A 30-second tour of the main pages. You can skip it at any time (Esc) and restart it later from the help menu." },
  { id: "overview", target: '[data-tour="nav-overview"]', title: "Overview",
    body: "Everything generated so far - runs, generators, PdM models - plus the live health of the line at a glance." },
  { id: "live", target: '[data-tour="nav-live"]', title: "Live monitor",
    body: "The digital twin. A WebSocket streams the simulator tick by tick; inject a fault and watch stations turn amber, then red." },
  { id: "simulator", target: '[data-tour="nav-simulator"]', title: "Simulator",
    body: "Configure the physics model and add faults with ground-truth labels and remaining-useful-life (RUL). Every run is saved." },
  { id: "copilot", target: '[data-tour="nav-copilot"]', title: "Scenario Copilot",
    body: "Describe a scenario in plain English. Claude (or the built-in rule parser) turns it into a config you can edit and run." },
  { id: "generative", target: '[data-tour="nav-generative"]', title: "Generative models",
    body: "Train a conditional VAE or a TimeGAN on simulator or uploaded data, then generate new synthetic runs from it." },
  { id: "pdm", target: '[data-tour="nav-pdm"]', title: "PdM & quality",
    body: "Predictive-maintenance models for fault classification and RUL, and the TSTR test: train on synthetic, test on real." },
  { id: "quality", target: '[data-tour="nav-quality"]', title: "Quality report",
    body: "Fidelity, utility and diversity of the synthetic data, with the evidence: KS tests, correlations, PCA / t-SNE." },
  { id: "search", target: '[data-tour="search"]', title: "Command palette",
    body: "Press Ctrl+K (Cmd+K on Mac) from anywhere to jump to a page, start the stream, inject a fault or toggle the theme." },
  { id: "help", target: '[data-tour="help"]', title: "Help & demo mode",
    body: "Restart this tour, read how it works, or press Play demo for a scripted 3-4 minute walkthrough - handy for a presentation." },
];

export const TOUR_KEY = "bs-tour-done";

export function tourDone(storage: Pick<Storage, "getItem"> | null = safeStorage()): boolean {
  try { return storage?.getItem(TOUR_KEY) === "1"; } catch { return false; }
}
export function markTourDone(storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try { storage?.setItem(TOUR_KEY, "1"); } catch { /* storage blocked: the tour will simply show again next visit */ }
}
export function resetTour(storage: Pick<Storage, "removeItem"> | null = safeStorage()): void {
  try { storage?.removeItem(TOUR_KEY); } catch { /* ignore */ }
}
function safeStorage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

/** Where to put the tooltip card next to the spotlighted rectangle. Pure so it can be tested. */
export interface Rect { top: number; left: number; width: number; height: number }
export function cardPosition(target: Rect | null, viewport: { w: number; h: number }, card = { w: 340, h: 200 }, gap = 16): { top: number; left: number } {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  if (!target) return { top: Math.max(16, (viewport.h - card.h) / 2), left: Math.max(16, (viewport.w - card.w) / 2) };
  const rightRoom = viewport.w - (target.left + target.width) - gap;
  if (rightRoom >= card.w + 8) {                                         // sidebar items: card to the right
    return { left: target.left + target.width + gap, top: clamp(target.top + target.height / 2 - card.h / 2, 16, viewport.h - card.h - 16) };
  }
  const below = target.top + target.height + gap;                        // header buttons: card underneath
  const top = below + card.h + 16 <= viewport.h ? below : Math.max(16, target.top - card.h - gap);
  return { top, left: clamp(target.left + target.width - card.w, 16, viewport.w - card.w - 16) };
}
