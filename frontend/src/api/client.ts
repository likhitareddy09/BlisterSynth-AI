import type {
  Dataset, DatasetDetail, DiagnosticsBody, DiagnosticsResult, FaultCatalog, FaultSpec, GenModel, GenTrainBody, ImbalanceBody,
  CopilotParse, CopilotStatus, CopilotValidation, ImbalanceResult, InspectResult, Job, Overview, PdmModel, PdmPrediction, PdmTrainBody, Preview, QualityReport, QualityReportBody,
  QualityResult, Run, RunLabels, RunWithPreview, Scenario, SensorCatalog, SimulateBody, TstrResult,
} from "./types";

/** Empty in dev (Vite proxies /api to :8000) and when the backend serves the build. Set VITE_API_URL to override. */
export const API_BASE: string = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

/** FastAPI errors are `{detail: "text"}` or `{detail: [{loc: [...], msg: "..."}]}` (validation). Make both readable. */
export function formatDetail(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => {
        const where = Array.isArray(d?.loc) ? d.loc.filter((p: unknown) => p !== "body").join(".") : "";
        return where ? `${where}: ${d?.msg ?? "invalid"}` : String(d?.msg ?? JSON.stringify(d));
      })
      .join("; ");
  }
  return detail == null ? "Unknown error" : JSON.stringify(detail);
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      ...init,
      // JSON bodies get a JSON content type; FormData (file uploads) must NOT, the browser adds the multipart boundary itself
      headers: { ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...init.headers },
    });
  } catch {
    throw new ApiError(0, "Cannot reach the backend. Is it running on port 8000?");
  }
  if (!res.ok) {
    let msg = res.statusText || `HTTP ${res.status}`;
    try {
      msg = formatDetail((await res.json()).detail ?? msg);
    } catch {
      /* body was not JSON - keep the status text */
    }
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as T;
}

const post = <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) });
const del = <T = { deleted: string }>(path: string) => request<T>(path, { method: "DELETE" });
const patch = <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) });

export type ExportFormat = "csv" | "parquet" | "json";

/** GET a binary file (PDF report) with the same readable errors as `request`. */
export async function requestBlob(path: string): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path);
  } catch {
    throw new ApiError(0, "Cannot reach the backend. Is it running on port 8000?");
  }
  if (!res.ok) {
    let msg = res.statusText || `HTTP ${res.status}`;
    try { msg = formatDetail((await res.json()).detail ?? msg); } catch { /* not JSON */ }
    throw new ApiError(res.status, msg);
  }
  return res.blob();
}

export const api = {
  overview: () => request<Overview>("/api/overview"),
  sensors: () => request<SensorCatalog>("/api/sensors"),
  faultCatalog: () => request<FaultCatalog>("/api/faults/catalog"),

  simulate: (body: SimulateBody) => post<RunWithPreview>("/api/simulate", body),
  runs: () => request<Run[]>("/api/runs"),
  runData: (id: string, maxPoints = 600) => request<Preview>(`/api/runs/${id}/data?max_points=${maxPoints}`),
  runLabels: (id: string) => request<RunLabels>(`/api/runs/${id}/labels`),
  deleteRun: (id: string) => del(`/api/runs/${id}`),
  downloadUrl: (id: string, format: ExportFormat = "csv") => `${API_BASE}/api/runs/${id}/download${format === "csv" ? "" : `?format=${format}`}`,
  renameRun: (id: string, name: string) => patch<{ id: string; name: string }>(`/api/runs/${id}`, { name }),
  runReport: (id: string) => requestBlob(`/api/runs/${id}/report`),

  scenarios: () => request<Scenario[]>("/api/scenarios"),
  saveScenario: (name: string, config: Record<string, unknown>, description = "") =>
    post<Scenario>("/api/scenarios", { name, description, config }),
  deleteScenario: (id: string) => del(`/api/scenarios/${id}`),
  renameScenario: (id: string, name: string) => patch<{ id: string; name: string }>(`/api/scenarios/${id}`, { name }),

  genModels: () => request<GenModel[]>("/api/generative/models"),
  genTrain: (body: GenTrainBody) => post<Job>("/api/generative/train", body),
  genJobs: () => request<Job[]>("/api/generative/jobs"),
  genCancel: (id: string) => post<Job>(`/api/generative/jobs/${id}/cancel`, {}),
  genGenerate: (body: SimulateBody & { model_id: string }) => post<RunWithPreview>("/api/generative/generate", body),
  genDelete: (id: string) => del(`/api/generative/models/${id}`),

  pdmModels: () => request<PdmModel[]>("/api/pdm/models"),
  pdmTrain: (body: PdmTrainBody) => post<PdmModel>("/api/pdm/train", body),
  pdmPredict: (model_id: string, run_id: string) => post<PdmPrediction>("/api/pdm/predict", { model_id, run_id }),
  pdmTstr: (body: Omit<PdmTrainBody, "name" | "train_source"> & { model_id: string }) =>
    post<TstrResult>("/api/pdm/tstr", body),
  pdmDelete: (id: string) => del(`/api/pdm/models/${id}`),
  qualityCompare: (real_run_id: string, synthetic_run_id: string) =>
    post<QualityResult>("/api/quality/compare", { real_run_id, synthetic_run_id }),

  // ---- Phase 7A ----
  qualityReport: (body: QualityReportBody) => post<QualityReport>("/api/quality/report", body),
  pdmDiagnostics: (body: DiagnosticsBody) => post<DiagnosticsResult>("/api/pdm/diagnostics", body),
  pdmImbalance: (body: ImbalanceBody) => post<ImbalanceResult>("/api/pdm/imbalance-fix", body),

  datasets: () => request<Dataset[]>("/api/datasets"),
  dataset: (id: string) => request<DatasetDetail>(`/api/datasets/${id}`),
  inspectCsv: (file: File) => { const f = new FormData(); f.append("file", file); return request<InspectResult>("/api/datasets/inspect", { method: "POST", body: f }); },
  saveDataset: (file: File, name: string, mapping: Record<string, string>, sampleRate: number) => {
    const f = new FormData();
    f.append("file", file); f.append("name", name); f.append("mapping", JSON.stringify(mapping)); f.append("sample_rate_hz", String(sampleRate));
    return request<Dataset & { notes: string[]; out_of_range: Record<string, number> }>("/api/datasets", { method: "POST", body: f });
  },
  renameDataset: (id: string, name: string) => patch<{ id: string; name: string }>(`/api/datasets/${id}`, { name }),
  deleteDataset: (id: string) => del(`/api/datasets/${id}`),
  datasetDownloadUrl: (id: string, format: ExportFormat = "csv") => `${API_BASE}/api/datasets/${id}/download?format=${format}`,

  // ---- Phase 7B: Scenario Copilot ----
  copilotStatus: () => request<CopilotStatus>("/api/copilot/status"),
  copilotParse: (prompt: string, use_claude = true) => post<CopilotParse>("/api/copilot/parse", { prompt, use_claude }),
  copilotValidate: (req: unknown) => post<CopilotValidation>("/api/copilot/validate", { request: req }),
};

export type { FaultSpec };
