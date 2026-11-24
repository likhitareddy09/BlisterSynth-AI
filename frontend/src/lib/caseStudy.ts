// The landing-page case study shows the user's OWN latest "imbalance fix" result (PdM page), saved in localStorage.
// Nothing is invented: with no saved result the card says so and links to the experiment.
import type { ImbalanceResult } from "../api/types";

export const CASE_KEY = "bs-case-imbalance";

export interface CaseStudy {
  saved_at: string; model_id: string;
  real_only_f1: number; aug_f1: number; delta: number;
  classes_improved: number; classes_worse: number; headline: string;
  n_real: number; n_fault_real: number; n_synth: number;
}

export function caseFromResult(r: ImbalanceResult, setup: { n_real: number; n_fault_real: number; n_synth: number }, now: Date = new Date()): CaseStudy {
  return {
    saved_at: now.toISOString(), model_id: r.model_id,
    real_only_f1: r.real_only.macro_f1, aug_f1: r.real_plus_synthetic.macro_f1, delta: r.improvement.macro_f1_delta,
    classes_improved: r.improvement.classes_improved, classes_worse: r.improvement.classes_worse, headline: r.improvement.headline,
    ...setup,
  };
}

function storage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

export function saveCase(c: CaseStudy, s: Pick<Storage, "setItem"> | null = storage()): void {
  try { s?.setItem(CASE_KEY, JSON.stringify(c)); } catch { /* storage full or blocked: the card simply stays empty */ }
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The saved case study, or null when there is none (or it is damaged). */
export function loadCase(s: Pick<Storage, "getItem"> | null = storage()): CaseStudy | null {
  try {
    const raw = s?.getItem(CASE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<CaseStudy>;
    if (!c || typeof c !== "object") return null;
    const nums: (keyof CaseStudy)[] = ["real_only_f1", "aug_f1", "delta", "classes_improved", "classes_worse", "n_real", "n_fault_real", "n_synth"];
    if (!nums.every((k) => isNum(c[k])) || typeof c.saved_at !== "string" || typeof c.model_id !== "string") return null;
    return { headline: "", ...c } as CaseStudy;
  } catch {
    return null;
  }
}
