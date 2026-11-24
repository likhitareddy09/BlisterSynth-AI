// Shapes of the backend responses (see /docs). Only the fields the UI reads are typed strictly.

export interface Sensor {
  key: string; label: string; unit: string; nominal: number; lo: number; hi: number;
  station: string; decimals: number; description: string;
}
export interface Station { key: string; label: string; sensors: string[] }
export interface SensorCatalog { sensors: Sensor[]; stations: Station[] }

export interface FaultType {
  key: string; label: string; station: string; default_profile: string; description?: string;
  [k: string]: unknown;
}
export interface FaultCatalog { fault_types: FaultType[]; profiles: { key: string; description: string }[] }

export interface FaultSpec {
  type: string; profile?: string | null; onset_s: number; ramp_s?: number | null;
  end_s?: number | null; intensity: number;
}
export interface SimConfigIn {
  duration_s: number; sample_rate_hz: number; seed: number | null; nominal_speed_bpm: number;
  noise_scale: number; drift_scale: number; include_startup: boolean; include_shutdown: boolean;
}
export interface SimulateBody { name: string; config: Partial<SimConfigIn>; faults: FaultSpec[] }

export type Row = Record<string, number | string | boolean | null>;
export interface Preview { stride: number; rows: Row[]; health?: Row[] }

export interface Run {
  id: string; name: string; kind: string; created_at: string; config: Record<string, unknown>;
  n_rows: number; duration_s: number; summary: Record<string, any>;
}
export interface RunWithPreview extends Run { preview: Preview }

export interface Segment { fault_type?: string; type?: string; start_s: number; end_s: number; [k: string]: unknown }
export interface RunLabels { run_id: string; faults: FaultSpec[]; segments: Segment[]; summary: Record<string, any> }

export interface Overview {
  app: string; version: string; runs: { total: number; by_kind: Record<string, number> };
  scenarios: number; generative_models: number; pdm_models: number; active_jobs: number;
}

export interface Scenario { id: string; name: string; description: string; created_at: string; config: Record<string, any> }

export interface GenModel { id: string; name: string; kind: string; created_at: string; [k: string]: any }
export interface Job {
  id: string; kind: string; name: string; status: "queued" | "running" | "done" | "failed" | "cancelled";
  stage: string; progress: number; epoch: number; epochs: number; model_id: string | null;
  error: string | null; created_at: string; finished_at: string | null;
}
export interface GenTrainBody {
  kind: "cvae" | "timegan"; name: string; n_seed_runs: number; seed_duration_s: number; epochs: number; seed: number;
  dataset_ids?: string[];
}

export interface PdmModel {
  id: string; name: string; task: "fault" | "rul"; train_source: string; created_at: string;
  metrics: Record<string, any>; [k: string]: any;
}
export interface PdmTrainBody {
  task: "fault" | "rul"; name: string; train_source: string; n_train_runs: number; n_test_runs: number;
  duration_s: number; seed: number;
}
export interface PdmPrediction {
  model_id: string; run_id: string; task: "fault" | "rul"; n_windows: number; t_s: number[];
  predicted?: string[]; p_fault?: number[]; rul_s?: number[]; rul_cap_s?: number;
}
export interface TstrResult {
  task: string; model_id: string;
  summary: Record<string, { physics_trained: number | null; synthetic_trained: number | null }>;
}
export interface QualityResult {
  score: number; components: Record<string, number>; corr_distance?: number;
  sensors?: Record<string, Record<string, number>>;
}

// ---- WebSocket (/ws/stream) ----
export interface LiveRow {
  t_s: number; health: Record<string, number>; status: Record<string, "green" | "amber" | "red">;
  [sensorOrLabel: string]: unknown;
}
export type StreamMessage =
  | { type: "hello"; sensors: Sensor[]; stations: Station[]; faults: FaultCatalog; config: Record<string, any> }
  | { type: "tick"; rows: LiveRow[] }
  | { type: "ack"; action: string; speed: number; paused: boolean; [k: string]: unknown }
  | { type: "reset"; config: Record<string, any>; faults: FaultSpec[] }
  | { type: "error"; message: string; action?: string };

// ---------------------------------------------------------------- Phase 7A: Data Lab
export interface Dataset {
  id: string; name: string; source: string; created_at: string; n_rows: number; columns: string[];
  mapping: Record<string, string>; sample_rate_hz: number; has_labels: boolean; duration_s: number;
}
export interface DatasetDetail extends Dataset { preview: Record<string, number | string | null>[]; stats: Record<string, ColumnStats> }
export interface ColumnStats { mean: number | null; std: number | null; min: number | null; max: number | null; missing: number }
export interface InspectResult {
  filename: string; n_rows: number; columns: string[]; suggested_mapping: Record<string, string>;
  match_kinds: Record<string, "exact" | "alias" | "fuzzy">;
  check: { missing: string[]; errors: string[]; ready: boolean; unmapped_columns: string[] };
  preview: Record<string, number | string | null>[]; stats: Record<string, ColumnStats>;
}

// ---------------------------------------------------------------- Phase 7A: quality report
export interface SourceRef { kind: "run" | "dataset"; id: string }
export type QualityReportBody =
  | { model_id: string; n_runs?: number; duration_s?: number; include_tsne?: boolean; seed?: number }
  | { real: SourceRef[]; synthetic: SourceRef[]; include_tsne?: boolean; seed?: number };
export interface KsRow { sensor: string; ks: number; p_value: number | null; pass: boolean; mean_real: number; mean_syn: number; std_real: number; std_syn: number }
export interface Scores { macro_f1: number; accuracy: number; balanced_accuracy: number }
export interface TstrReport {
  available: boolean; reason?: string; tstr?: Scores; trtr?: Scores; utility_ratio?: number | null; baseline_weak?: boolean;
  baseline_note?: string; classes?: string[]; n_train_real?: number; n_train_syn?: number; n_test?: number; split?: string;
}
export interface DiversityReport {
  available: boolean; reason?: string; coverage?: number; recall?: number; k?: number; spread_ratio?: number; mode_coverage?: number;
  n_clusters?: number; cluster_share_real?: number[]; cluster_share_syn?: number[]; collapse_suspected?: boolean; collapse_reason?: string;
}
export type Pt = [number, number];
export interface DistSeries { x: number[]; real_hist: number[]; syn_hist: number[]; kde_x: number[]; real_kde: number[]; syn_kde: number[] }
export interface QualityReport {
  gauges: { fidelity: number | null; utility: number | null; diversity: number | null };
  fidelity: { score: number; components: Record<string, number>; discriminator_auc: number | null; mode: string };
  ks: KsRow[]; ks_pass_d: number;
  correlation: { sensors: string[]; real: number[][]; syn: number[][]; diff: number[][]; mean_abs_diff: number };
  embeddings: { pca: { real: Pt[]; syn: Pt[]; explained: number[] }; tsne: { real: Pt[]; syn: Pt[]; n_per_side: number } | null; tsne_note: string | null };
  distributions: Record<string, DistSeries>;
  tstr: TstrReport; diversity: DiversityReport;
  sizes: { real_runs: number; syn_runs: number; real_samples: number; syn_samples: number; real_windows: number; syn_windows: number };
  definitions: { fidelity: string; utility: string; diversity: string };
  source: Record<string, unknown>;
}

// ---------------------------------------------------------------- Phase 7A: PdM visuals
export interface DiagnosticsBody { model_id: string; n_runs?: number; duration_s?: number | null; seed?: number }
export interface RocCurve { class: string; auc: number; points: Pt[]; n_positive: number }
export interface Importance { method: string; features: { feature: string; importance: number; std: number }[]; by_sensor: { sensor: string; importance: number }[] }
export interface FaultDiagnostics {
  task: "fault"; model_id: string; model_name?: string; n_windows: number; labels: string[]; confusion_matrix: number[][];
  accuracy: number; balanced_accuracy: number; macro_f1: number; per_class_recall: Record<string, number>;
  roc_per_class: RocCurve[]; roc_fault_vs_none: { auc: number; points: Pt[] } | null; importance: Importance;
}
export interface RulDiagnostics {
  task: "rul"; model_id: string; model_name?: string; n_windows: number; rul_cap_s: number; mae_s: number; r2: number; scatter: Pt[]; importance: Importance;
}
export type DiagnosticsResult = FaultDiagnostics | RulDiagnostics;
export interface ImbalanceBody { model_id: string; n_real?: number; n_fault_real?: number; n_synth?: number; n_test?: number; duration_s?: number; seed?: number }
export interface ImbalanceArm { macro_f1: number; accuracy: number; balanced_accuracy: number; per_class_recall: Record<string, number>; train_class_counts: Record<string, number>; n_train_runs: number }
export interface ImbalanceResult {
  model_id: string; real_only: ImbalanceArm; real_plus_synthetic: ImbalanceArm;
  improvement: { macro_f1_delta: number; macro_f1_relative: number | null; classes: { class: string; recall_real: number; recall_aug: number; delta: number }[];
    classes_improved: number; classes_worse: number; headline: string; note: string };
  setup: Record<string, number>;
}

// ---------------------------------------------------------------- Phase 7B: Scenario Copilot
export interface CopilotError { loc: string; msg: string }
export interface CopilotStatus { claude_available: boolean; model: string; parser: "claude" | "rules"; max_prompt_chars: number }
export interface CopilotParse {
  parser: "claude" | "rules";
  model: string | null;
  claude_available: boolean;
  /** A SimulateRequest ({name, config, faults}) - editable in the UI, then posted to /api/simulate. */
  request: Record<string, unknown>;
  valid: boolean;
  errors: CopilotError[];
  warnings: string[];
  notes: string[];
  fallback_reason: string | null;
}
export interface CopilotValidation { valid: boolean; errors: CopilotError[] }
