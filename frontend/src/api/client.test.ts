import { afterEach, vi } from "vitest";
import { ApiError, api, formatDetail, request } from "./client";

const respond = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue({ ok: status < 400, status, statusText: "ERR", json: async () => body });

afterEach(() => vi.unstubAllGlobals());

describe("formatDetail", () => {
  it("passes strings through", () => expect(formatDetail("Run not found")).toBe("Run not found"));
  it("flattens FastAPI validation errors", () => {
    const d = [{ loc: ["body", "config", "duration_s"], msg: "Input should be >= 60" }, { loc: ["body"], msg: "bad" }];
    expect(formatDetail(d)).toBe("config.duration_s: Input should be >= 60; bad");
  });
  it("handles null", () => expect(formatDetail(null)).toBe("Unknown error"));
});

describe("request", () => {
  it("returns parsed JSON on success", async () => {
    vi.stubGlobal("fetch", respond(200, { ok: 1 }));
    await expect(request("/api/x")).resolves.toEqual({ ok: 1 });
  });
  it("turns an HTTP error into ApiError with the backend message", async () => {
    vi.stubGlobal("fetch", respond(404, { detail: "Run not found" }));
    await expect(request("/api/runs/x")).rejects.toMatchObject({ status: 404, message: "Run not found" });
  });
  it("reports an unreachable backend", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const err: any = await request("/api/x").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/Cannot reach the backend/);
  });
  it("falls back to status text when the error body is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "Server Error", json: async () => { throw new Error("no json"); } }));
    await expect(request("/api/x")).rejects.toMatchObject({ status: 500, message: "Server Error" });
  });
});

describe("api helpers", () => {
  it("POSTs JSON to /api/simulate", async () => {
    const f = respond(200, { id: "run_1" });
    vi.stubGlobal("fetch", f);
    await api.simulate({ name: "t", config: { duration_s: 60 }, faults: [] });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("/api/simulate");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).config.duration_s).toBe(60);
  });
  it("builds the download url", () => expect(api.downloadUrl("run_1")).toBe("/api/runs/run_1/download"));
});

describe("Phase 7 client", () => {
  it("builds export urls for runs and datasets", () => {
    expect(api.downloadUrl("run_1", "csv")).toBe("/api/runs/run_1/download");
    expect(api.downloadUrl("run_1", "parquet")).toBe("/api/runs/run_1/download?format=parquet");
    expect(api.datasetDownloadUrl("ds_1", "json")).toBe("/api/datasets/ds_1/download?format=json");
  });
  it("does not force a JSON content type on FormData uploads", async () => {
    const f = respond(200, { ok: 1 });
    vi.stubGlobal("fetch", f);
    await api.inspectCsv(new File(["a,b"], "x.csv", { type: "text/csv" }));
    const init = f.mock.calls[0][1];
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers["Content-Type"]).toBeUndefined();
  });
  it("PATCHes a rename and POSTs a quality report", async () => {
    const f = respond(200, {});
    vi.stubGlobal("fetch", f);
    await api.renameRun("run_1", "New name");
    expect(f.mock.calls[0][1].method).toBe("PATCH");
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ name: "New name" });
    await api.qualityReport({ model_id: "mdl_1" });
    expect(f.mock.calls[1][0]).toBe("/api/quality/report");
  });
  it("requestBlob returns a Blob and maps errors like request()", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, blob: async () => new Blob(["%PDF"]) }));
    expect((await api.runReport("run_1")).size).toBe(4);
    vi.stubGlobal("fetch", respond(404, { detail: "Run not found" }));
    await expect(api.runReport("x")).rejects.toMatchObject({ status: 404, message: "Run not found" });
  });
});
