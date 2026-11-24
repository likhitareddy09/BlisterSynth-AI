import type { InspectResult, QualityReport } from "../api/types";
import { SENSOR_KEYS } from "../lib/metrics";

const eye = (n: number, off = 0.2) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : off)));

/** A complete, valid quality report (small numbers) for page tests. */
export function makeReport(over: Partial<QualityReport> = {}): QualityReport {
  const n = SENSOR_KEYS.length;
  return {
    gauges: { fidelity: 62, utility: 89, diversity: 54 },
    fidelity: { score: 62, components: { marginals: 0.5, scale: 0.6, correlation: 0.8, temporal: 0.7 }, discriminator_auc: null, mode: "8 matched pair(s)" },
    ks: SENSOR_KEYS.map((s, i) => ({ sensor: s, ks: i < 5 ? 0.05 : 0.2, p_value: 0.0001, pass: i < 5, mean_real: 1, mean_syn: 1.1, std_real: 1, std_syn: 0.9 })),
    ks_pass_d: 0.1,
    correlation: { sensors: [...SENSOR_KEYS], real: eye(n), syn: eye(n, 0.3), diff: eye(n, 0.1).map((r, i) => r.map((v, j) => (i === j ? 0 : v))), mean_abs_diff: 0.1 },
    embeddings: { pca: { real: [[0, 0], [1, 1], [2, 1]], syn: [[0.1, 0], [1, 1.2], [2, 0.9]], explained: [0.5, 0.2] },
      tsne: { real: [[0, 0], [1, 1]], syn: [[0.5, 0.2], [1, 0.8]], n_per_side: 2 }, tsne_note: "t-SNE on a random sample" },
    distributions: Object.fromEntries(SENSOR_KEYS.map((k) => [k, { x: [0, 1, 2], real_hist: [1, 2, 1], syn_hist: [1, 1, 2], kde_x: [0, 0.5, 1, 1.5, 2], real_kde: [0.1, 0.4, 0.6, 0.4, 0.1], syn_kde: [0.1, 0.3, 0.5, 0.5, 0.2] }])),
    tstr: { available: true, tstr: { macro_f1: 0.53, accuracy: 0.7, balanced_accuracy: 0.57 }, trtr: { macro_f1: 0.6, accuracy: 0.78, balanced_accuracy: 0.62 },
      utility_ratio: 0.89, baseline_weak: false, baseline_note: "", classes: ["none", "bearing_wear"], n_train_real: 456, n_train_syn: 456, n_test: 456, split: "held-out real runs" },
    diversity: { available: true, coverage: 0.54, recall: 0.67, k: 5, spread_ratio: 0.93, mode_coverage: 1, n_clusters: 3, cluster_share_real: [0.5, 0.3, 0.2],
      cluster_share_syn: [0.45, 0.35, 0.2], collapse_suspected: false, collapse_reason: "no sign of mode collapse" },
    sizes: { real_runs: 8, syn_runs: 8, real_samples: 8000, syn_samples: 8000, real_windows: 456, syn_windows: 456 },
    definitions: { fidelity: "FID-DEF", utility: "UTIL-DEF", diversity: "DIV-DEF" }, source: { mode: "model" },
    ...over,
  };
}

export function makeInspect(over: Partial<InspectResult> = {}): InspectResult {
  const mapping = Object.fromEntries(SENSOR_KEYS.map((k) => [k, `col_${k}`]));
  return {
    filename: "plant.csv", n_rows: 3600, columns: [...Object.values(mapping), "operator_note"], suggested_mapping: mapping,
    match_kinds: Object.fromEntries(SENSOR_KEYS.map((k) => [k, "alias"])) as InspectResult["match_kinds"],
    check: { missing: [], errors: [], ready: true, unmapped_columns: ["operator_note"] },
    preview: [Object.fromEntries(Object.values(mapping).map((c) => [c, 1.5]))], stats: Object.fromEntries(Object.values(mapping).map((c) => [c, { mean: 1, std: 0.1, min: 0, max: 2, missing: 0 }])), ...over,
  };
}
