import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import App from "./App";
import { MockSocket } from "./test/mockSocket";

const overview = { app: "BlisterSynth AI", version: "0.7.0", runs: { total: 3, by_kind: { physics: 3 } }, scenarios: 0, generative_models: 1, pdm_models: 2, active_jobs: 0 };

function mockFetch(routes: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const hit = Object.keys(routes).find((k) => url.startsWith(k));
    if (!hit) return { ok: false, status: 404, statusText: "Not Found", json: async () => ({ detail: "nope" }) };
    return { ok: true, status: 200, statusText: "OK", json: async () => routes[hit] };
  }));
}

const push = (msg: unknown) => act(() => MockSocket.last.push(msg));

// The app uses a HashRouter, so a test picks its page by setting the hash before render().
const go = (hash: string) => { window.location.hash = hash; };

beforeEach(() => { MockSocket.reset(); vi.stubGlobal("WebSocket", MockSocket); go("#/app/live"); });
afterEach(() => vi.unstubAllGlobals());

describe("App", () => {
  it("shows the landing page at / with a way into the app", async () => {
    go("#/");
    mockFetch({ "/api/overview": overview });
    render(<App />);
    expect(await screen.findByText(/Synthetic data for/)).toBeTruthy();
    expect(screen.getAllByText(/Open app/).length).toBeGreaterThan(0);
  });

  it("shows backend counts from /api/overview", async () => {
    go("#/app");
    mockFetch({ "/api/overview": overview });
    render(<App />);
    expect(await screen.findByText("3 runs")).toBeTruthy();
    expect(screen.getByText("2 PdM models")).toBeTruthy();
    expect(screen.getByText("v0.7.0")).toBeTruthy();
  });

  it("shows an offline notice when the backend is unreachable", async () => {
    go("#/app");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("down")));
    render(<App />);
    expect(await screen.findByText("Backend offline")).toBeTruthy();
  });

  it("renders live station health from the stream", async () => {
    mockFetch({ "/api/overview": overview });
    render(<App />);
    act(() => MockSocket.last.open());
    push({ type: "hello", sensors: [{ key: "forming_temp_c", label: "Forming temperature", unit: "C", decimals: 2 }],
      stations: [{ key: "forming", label: "Forming", sensors: [] }], faults: { fault_types: [{ key: "bearing_wear", label: "Bearing wear" }], profiles: [] }, config: {} });
    push({ type: "tick", rows: [{ t_s: 1, forming_temp_c: 135, fault_active: 0, health: { forming: 91 }, status: { forming: "green" } },
      { t_s: 2, forming_temp_c: 136, fault_active: 0, health: { forming: 42 }, status: { forming: "red" } }] });
    expect(await screen.findByText("Live")).toBeTruthy();
    await waitFor(() => expect(document.querySelector(".station.red")).not.toBeNull());
    expect(screen.getAllByText("42").length).toBeGreaterThan(0);          // chip + twin both show the health number
    expect(screen.getByLabelText(/^Forming: Critical, health 42/)).toBeTruthy();   // the twin station is labelled for screen readers
  });

  it("sends an inject message from the Live monitor", async () => {
    mockFetch({ "/api/overview": overview });
    render(<App />);
    act(() => MockSocket.last.open());
    push({ type: "hello", sensors: [], stations: [], faults: { fault_types: [{ key: "bearing_wear", label: "Bearing wear" }], profiles: [] }, config: {} });
    const btn = await screen.findByText("Inject fault");
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    const msg = JSON.parse(MockSocket.last.sent[0]);
    expect(msg.action).toBe("inject");
    expect(msg.fault.type).toBe("bearing_wear");
  });

  it("switches tabs and lists runs", async () => {
    mockFetch({
      "/api/overview": overview, "/api/sensors": { sensors: [], stations: [] },
      "/api/runs": [{ id: "run_a", name: "Healthy", kind: "physics", created_at: "2026-01-01T00:00:00", config: {}, n_rows: 60, duration_s: 60, summary: {} }],
    });
    render(<App />);
    fireEvent.click(screen.getByText("Runs"));
    expect(await screen.findByText("Healthy")).toBeTruthy();
    expect(screen.getByText("run_a")).toBeTruthy();
  });

  it("shows a readable error when a request fails", async () => {
    mockFetch({ "/api/overview": overview, "/api/sensors": { sensors: [], stations: [] }, "/api/faults/catalog": { fault_types: [], profiles: [] }, "/api/scenarios": [] });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/simulate") return { ok: false, status: 422, statusText: "x", json: async () => ({ detail: [{ loc: ["body", "config", "duration_s"], msg: "too small" }] }) };
      const body = url === "/api/overview" ? overview : url === "/api/sensors" ? { sensors: [], stations: [] } : url === "/api/faults/catalog" ? { fault_types: [], profiles: [] } : [];
      return { ok: true, status: 200, statusText: "OK", json: async () => body, init };
    }));
    render(<App />);
    fireEvent.click(screen.getByText("Simulator"));
    fireEvent.click(await screen.findByText("Run simulation"));
    expect(await screen.findByText(/config.duration_s: too small/)).toBeTruthy();
  });
});
