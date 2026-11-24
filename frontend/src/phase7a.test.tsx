import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, vi } from "vitest";
import Heatmap from "./components/charts/Heatmap";
import Dropzone from "./components/datalab/Dropzone";
import { InfoTip, ToastProvider } from "./components/ui";
import DataLab from "./pages/DataLab";
import Quality from "./pages/Quality";
import { corrColor } from "./lib/metrics";
import { makeInspect, makeReport } from "./test/fixtures";

type Handler = (url: string, init?: RequestInit) => unknown;
function mockApi(handlers: Record<string, Handler | unknown>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const hit = Object.keys(handlers).filter((k) => url.startsWith(k)).sort((a, b) => b.length - a.length)[0];
    if (!hit) return { ok: false, status: 404, statusText: "Not Found", json: async () => ({ detail: `no mock for ${url}` }) };
    const h = handlers[hit];
    const out = typeof h === "function" ? (h as Handler)(url, init) : h;
    if (out && typeof out === "object" && "__status" in (out as object)) {
      const o = out as { __status: number; detail: unknown };
      return { ok: false, status: o.__status, statusText: "ERR", json: async () => ({ detail: o.detail }) };
    }
    return { ok: true, status: 200, statusText: "OK", json: async () => out };
  }));
  return calls;
}
const wrap = (ui: React.ReactElement) => render(<MemoryRouter><ToastProvider>{ui}</ToastProvider></MemoryRouter>);
afterEach(() => vi.unstubAllGlobals());

describe("Heatmap", () => {
  it("renders one cell per matrix entry with a tooltip", () => {
    const { container } = render(<Heatmap labels={["a", "b"]} matrix={[[1, 0.5], [0.5, 1]]} color={corrColor} title="test map" showValues />);
    expect(container.querySelectorAll("rect")).toHaveLength(4);
    expect(screen.getByRole("img", { name: "test map" })).toBeTruthy();
    expect(container.querySelector("title")!.textContent).toBe("a / a: 1.00");
  });
  it("uses the custom formatter", () => {
    render(<Heatmap labels={["x"]} matrix={[[0.25]]} color={corrColor} title="m" showValues format={(v) => `${Math.round(v * 100)}`} />);
    expect(screen.getByText("25")).toBeTruthy();
  });
});

describe("InfoTip", () => {
  it("shows its text on click and hides on Escape", () => {
    render(<InfoTip label="what is this">Definition text</InfoTip>);
    expect(screen.queryByText("Definition text")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "what is this" }));
    expect(screen.getByRole("tooltip").textContent).toBe("Definition text");
    fireEvent.keyDown(screen.getByRole("button", { name: "what is this" }), { key: "Escape" });
    expect(screen.queryByText("Definition text")).toBeNull();
  });
});

describe("Dropzone", () => {
  it("accepts a CSV and rejects other file types with a message", () => {
    const onFile = vi.fn(), onError = vi.fn();
    const { container } = render(<Dropzone onFile={onFile} onError={onError} />);
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["a"], "plant.csv", { type: "text/csv" })] } });
    expect(onFile).toHaveBeenCalledTimes(1);
    fireEvent.change(input, { target: { files: [new File(["a"], "plant.xlsx")] } });
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("not a CSV"));
    expect(onFile).toHaveBeenCalledTimes(1);
  });
  it("handles a drop", () => {
    const onFile = vi.fn();
    render(<Dropzone onFile={onFile} onError={vi.fn()} />);
    fireEvent.drop(screen.getByRole("button"), { dataTransfer: { files: [new File(["a"], "d.csv", { type: "text/csv" })] } });
    expect(onFile).toHaveBeenCalled();
  });
  it("ignores a drop while disabled", () => {
    const onFile = vi.fn();
    render(<Dropzone onFile={onFile} onError={vi.fn()} disabled />);
    fireEvent.drop(screen.getByRole("button"), { dataTransfer: { files: [new File(["a"], "d.csv", { type: "text/csv" })] } });
    expect(onFile).not.toHaveBeenCalled();
  });
});

describe("Quality page", () => {
  const base = { "/api/generative/models": [{ id: "mdl_1", name: "cVAE v1", kind: "cvae", created_at: "2026-01-01T00:00:00" }], "/api/runs": [], "/api/datasets": [],
    "/api/sensors": { sensors: [{ key: "forming_temp_c", label: "Forming temperature", unit: "C", decimals: 2 }], stations: [] } };

  it("sends the model request and renders gauges, KS chips, tables and notices", async () => {
    const calls = mockApi({ ...base, "/api/quality/report": makeReport() });
    wrap(<Quality />);
    fireEvent.click(await screen.findByRole("button", { name: /Generate report/ }));
    expect(await screen.findByText("Per-sensor Kolmogorov-Smirnov test")).toBeTruthy();
    const post = calls.find((c) => c.url === "/api/quality/report")!;
    expect(JSON.parse(post.init!.body as string)).toMatchObject({ model_id: "mdl_1", n_runs: 8, include_tsne: true });
    expect(screen.getByText("5 / 14 pass")).toBeTruthy();
    expect(screen.getAllByText("pass").length).toBeGreaterThanOrEqual(5);
    expect(screen.getAllByText("fail")).toHaveLength(9);
    expect(screen.getByText("TSTR 0.53 / TRTR 0.60 = 89%")).toBeTruthy();
    expect(screen.getByText("no mode collapse")).toBeTruthy();
    expect(screen.getByText(/Looks healthy/)).toBeTruthy();
    expect(screen.getByText("Difference (synthetic - real)")).toBeTruthy();
    expect(screen.getAllByRole("img", { name: /Correlation matrix|Difference of correlation/ })).toHaveLength(3);
  });

  it("shows the gauge definitions in the tooltips", async () => {
    mockApi({ ...base, "/api/quality/report": makeReport() });
    wrap(<Quality />);
    fireEvent.click(await screen.findByRole("button", { name: /Generate report/ }));
    await screen.findByText("Per-sensor Kolmogorov-Smirnov test");
    fireEvent.click(screen.getByRole("button", { name: "What is Utility?" }));
    expect(screen.getByRole("tooltip").textContent).toBe("UTIL-DEF");
  });

  it("warns when the TRTR baseline is weak and when collapse is suspected", async () => {
    const r = makeReport();
    r.tstr = { ...r.tstr, baseline_weak: true, baseline_note: "BASELINE-WEAK" };
    r.diversity = { ...r.diversity, collapse_suspected: true, collapse_reason: "only 1 of 8 clusters" };
    mockApi({ ...base, "/api/quality/report": r });
    wrap(<Quality />);
    fireEvent.click(await screen.findByRole("button", { name: /Generate report/ }));
    expect((await screen.findAllByText("BASELINE-WEAK")).length).toBe(2);       // under the gauge and under the chart
    expect(screen.getByText("mode collapse suspected")).toBeTruthy();
    expect(screen.getByText(/only 1 of 8 clusters/)).toBeTruthy();
  });

  it("handles unavailable TSTR / diversity / t-SNE without crashing", async () => {
    const r = makeReport({ gauges: { fidelity: 40, utility: null, diversity: null } });
    r.tstr = { available: false, reason: "NO-FAULT-CLASSES" };
    r.diversity = { available: false, reason: "NEED-MORE-WINDOWS" };
    r.embeddings = { ...r.embeddings, tsne: null, tsne_note: "TSNE-OFF" };
    mockApi({ ...base, "/api/quality/report": r });
    wrap(<Quality />);
    fireEvent.click(await screen.findByRole("button", { name: /Generate report/ }));
    expect(await screen.findByText("TSTR not available")).toBeTruthy();
    expect(screen.getAllByText("NO-FAULT-CLASSES").length).toBe(2);          // under the gauge and in the empty state
    expect(screen.getByText("Diversity not available")).toBeTruthy();
    expect(screen.getAllByText("not available").length).toBe(2);
    fireEvent.click(screen.getByRole("tab", { name: "t-SNE" }));
    expect(screen.getByText("t-SNE not available")).toBeTruthy();
    expect(screen.getByText("TSNE-OFF")).toBeTruthy();
  });

  it("shows a readable error when the server rejects the request", async () => {
    mockApi({ ...base, "/api/quality/report": { __status: 422, detail: "Need at least 50 running samples on each side." } });
    wrap(<Quality />);
    fireEvent.click(await screen.findByRole("button", { name: /Generate report/ }));
    expect(await screen.findByText(/Need at least 50 running samples/)).toBeTruthy();
  });

  it("asks to train a generator first when none exists", async () => {
    mockApi({ ...base, "/api/generative/models": [] });
    wrap(<Quality />);
    expect(await screen.findByText("No generative model yet")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Generate report/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("sources mode needs a real and a synthetic selection, then posts both lists", async () => {
    const calls = mockApi({ ...base,
      "/api/runs": [{ id: "run_p", name: "Physics run", kind: "physics", created_at: "2026-01-01T00:00:00", config: {}, n_rows: 10, duration_s: 10, summary: {} },
        { id: "run_g", name: "Generated run", kind: "generative", created_at: "2026-01-01T00:00:00", config: {}, n_rows: 10, duration_s: 10, summary: {} }],
      "/api/datasets": [{ id: "ds_1", name: "Plant A", source: "upload", created_at: "2026-01-01T00:00:00", n_rows: 3600, columns: [], mapping: {}, sample_rate_hz: 1, has_labels: true, duration_s: 3600 }],
      "/api/quality/report": makeReport() });
    wrap(<Quality />);
    fireEvent.click(await screen.findByRole("tab", { name: "Saved runs & datasets" }));
    const button = screen.getByRole("button", { name: /Generate report/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(await screen.findByLabelText(/Plant A/));
    fireEvent.click(screen.getAllByLabelText(/Generated run/)[0]);
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    await screen.findByText("Per-sensor Kolmogorov-Smirnov test");
    const body = JSON.parse(calls.find((c) => c.url === "/api/quality/report")!.init!.body as string);
    expect(body.real).toEqual([{ kind: "dataset", id: "ds_1" }]);
    expect(body.synthetic).toEqual([{ kind: "run", id: "run_g" }]);
  });
});

describe("Data Lab upload", () => {
  const uploadFile = (container: HTMLElement, name = "plant.csv") =>
    fireEvent.change(container.querySelector("input[type=file]") as HTMLInputElement, { target: { files: [new File(["a,b"], name, { type: "text/csv" })] } });

  it("inspects a file, shows the mapping and saves with the mapping as JSON form data", async () => {
    const calls = mockApi({ "/api/datasets/inspect": makeInspect(),
      "/api/datasets": (_u: string, init?: RequestInit) => (init?.method === "POST" ? { id: "ds_9", name: "plant", n_rows: 3600, duration_s: 3600, sample_rate_hz: 1, has_labels: false, notes: ["note one"], columns: [], mapping: {}, source: "upload", created_at: "" } : []) });
    const { container } = wrap(<DataLab />);
    uploadFile(container);
    expect(await screen.findByText("all 14 sensors mapped")).toBeTruthy();
    expect(screen.getAllByText("alias").length).toBe(14);
    const save = screen.getByRole("button", { name: /Save dataset/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect((await screen.findAllByText("Dataset saved")).length).toBeGreaterThanOrEqual(1);          // toast + card title
    const post = calls.find((c) => c.url === "/api/datasets" && c.init?.method === "POST")!;
    expect(post.init!.body).toBeInstanceOf(FormData);
    expect((post.init!.headers as Record<string, string>)["Content-Type"]).toBeUndefined();        // the browser sets the multipart boundary
    const form = post.init!.body as FormData;
    expect(JSON.parse(form.get("mapping") as string).vacuum_kpa).toBe("col_vacuum_kpa");
    expect(form.get("name")).toBe("plant");
    expect(screen.getByText("note one")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Train a generator on it/ }).getAttribute("href")).toBe("/app/generative?dataset=ds_9");
    expect(screen.getByRole("link", { name: /quality report/ }).getAttribute("href")).toBe("/app/quality?real=dataset:ds_9");
  });

  it("blocks saving until every sensor is mapped, and flags a column used twice", async () => {
    const mapping = makeInspect().suggested_mapping;
    const { vacuum_kpa: _drop, ...partial } = mapping;
    mockApi({ "/api/datasets/inspect": makeInspect({ suggested_mapping: partial, check: { missing: ["vacuum_kpa"], errors: [], ready: false, unmapped_columns: [] } }), "/api/datasets": [] });
    const { container } = wrap(<DataLab />);
    uploadFile(container);
    expect(await screen.findByText("1 sensor(s) missing")).toBeTruthy();
    const save = screen.getByRole("button", { name: /Save dataset/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.getByText(/Still missing: vacuum/)).toBeTruthy();
    const sel = screen.getByLabelText("Column for vacuum_kpa") as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: "col_humidity_pct" } });                              // already used by humidity
    expect(screen.getByRole("alert").textContent).toContain("col_humidity_pct");
    expect(save.disabled).toBe(true);
    fireEvent.change(sel, { target: { value: "operator_note" } });
    await waitFor(() => expect(save.disabled).toBe(false));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the server's message when the file is rejected", async () => {
    mockApi({ "/api/datasets/inspect": { __status: 422, detail: "The file is empty." }, "/api/datasets": [] });
    const { container } = wrap(<DataLab />);
    uploadFile(container);
    expect(await screen.findByText("The file is empty.")).toBeTruthy();
    expect(screen.queryByText(/Match your columns/)).toBeNull();
  });

  it("rejects a non-CSV file before calling the server", async () => {
    const calls = mockApi({ "/api/datasets": [] });
    const { container } = wrap(<DataLab />);
    fireEvent.change(container.querySelector("input[type=file]") as HTMLInputElement, { target: { files: [new File(["x"], "notes.pdf")] } });
    expect(await screen.findByText(/not a CSV file/)).toBeTruthy();
    expect(calls.some((c) => c.url.includes("inspect"))).toBe(false);
  });

  it("lists datasets with export links and renames one", async () => {
    const ds = { id: "ds_1", name: "Plant A", source: "upload", created_at: "2026-01-01T00:00:00", n_rows: 3600, columns: [], mapping: {}, sample_rate_hz: 1, has_labels: true, duration_s: 3600 };
    const calls = mockApi({ "/api/datasets/ds_1": (_u: string, init?: RequestInit) => (init?.method === "PATCH" ? { id: "ds_1", name: "Plant B" } : ds), "/api/datasets": [ds] });
    wrap(<DataLab />);
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "My datasets" })); });
    expect(await screen.findByText("Plant A")).toBeTruthy();
    const links = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(links).toContain("/api/datasets/ds_1/download?format=parquet");
    expect(links).toContain("/api/datasets/ds_1/download?format=json");
    expect(links).toContain("/api/datasets/ds_1/download?format=csv");
    fireEvent.click(screen.getByRole("button", { name: "Rename Plant A" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Plant B" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === "PATCH")).toBe(true));
    expect(JSON.parse(calls.find((c) => c.init?.method === "PATCH")!.init!.body as string)).toEqual({ name: "Plant B" });
  });
});
