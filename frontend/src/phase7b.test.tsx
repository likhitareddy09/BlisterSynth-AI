import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, vi } from "vitest";
import App from "./App";
import CommandPalette from "./components/CommandPalette";
import DemoPlayer from "./components/DemoPlayer";
import { ToastProvider } from "./components/ui";
import Copilot from "./pages/Copilot";
import { appBus } from "./lib/bus";
import { buildCommands } from "./lib/palette";
import { MockSocket } from "./test/mockSocket";
import { makeReport } from "./test/fixtures";

type Handler = (url: string, init?: RequestInit) => unknown;
function mockApi(handlers: Record<string, Handler | unknown>) {
  const calls: { url: string; init?: RequestInit; body?: any }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const hit = Object.keys(handlers).filter((k) => url.startsWith(k)).sort((a, b) => b.length - a.length)[0];
    if (!hit) return { ok: false, status: 404, statusText: "Not Found", json: async () => ({ detail: `no mock for ${url}` }) };
    const h = handlers[hit];
    return { ok: true, status: 200, statusText: "OK", json: async () => (typeof h === "function" ? (h as Handler)(url, init) : h) };
  }));
  return calls;
}

const overview = { app: "BlisterSynth AI", version: "0.7.0", runs: { total: 1, by_kind: { physics: 1 } }, scenarios: 0, generative_models: 1, pdm_models: 1, active_jobs: 0 };
const sensors = { sensors: [{ key: "vib_x_mm_s", label: "Vibration X", unit: "mm/s", nominal: 2, lo: 0, hi: 10, station: "cartoning", decimals: 2, description: "" }], stations: [] };
const catalog = { fault_types: [{ key: "bearing_wear", label: "Main drive bearing wear", station: "cartoning", default_profile: "gradual" }], profiles: [{ key: "gradual", description: "" }] };

const parsed = (over: Record<string, unknown> = {}) => ({
  parser: "rules", model: null, claude_available: false, valid: true, errors: [], warnings: [], notes: ["run length = 2 h"], fallback_reason: null,
  request: { name: "Copilot: bearing", config: { duration_s: 7200, seed: 42 }, faults: [{ type: "bearing_wear", profile: "gradual", onset_s: 2400, intensity: 2 }] },
  ...over,
});
const status = (over: Record<string, unknown> = {}) => ({ claude_available: false, model: "claude-sonnet-5-5", parser: "rules", max_prompt_chars: 1000, ...over });
const wrap = (ui: React.ReactElement) => render(<MemoryRouter><ToastProvider>{ui}</ToastProvider></MemoryRouter>);

beforeEach(() => { MockSocket.reset(); vi.stubGlobal("WebSocket", MockSocket); localStorage.setItem("bs-tour-done", "1"); window.location.hash = "#/app"; });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Scenario Copilot page", () => {
  it("shows the five example chips and which parser is active", async () => {
    mockApi({ "/api/copilot/status": status() });
    wrap(<Copilot onRunCreated={() => undefined} />);
    expect(await screen.findByText(/Rule-based parser/)).toBeTruthy();
    expect(within(screen.getByLabelText("Example prompts")).getAllByRole("button")).toHaveLength(5);
    expect(screen.queryByText("Use Claude")).toBeNull();            // no toggle without a key
  });

  it("sends the prompt, shows the editable JSON and the 'rules' badge", async () => {
    const calls = mockApi({ "/api/copilot/status": status(), "/api/copilot/parse": parsed() });
    wrap(<Copilot onRunCreated={() => undefined} />);
    fireEvent.change(screen.getByLabelText("Describe a scenario"), { target: { value: "2 hours bearing wear at minute 40, high severity" } });
    fireEvent.click(screen.getByLabelText("Send"));
    const box = (await screen.findByLabelText(/Simulation request/)) as HTMLTextAreaElement;
    expect(JSON.parse(box.value).faults[0].type).toBe("bearing_wear");
    expect(screen.getAllByText("Parsed by rules").length).toBeGreaterThan(0);
    expect(screen.getByText("valid config")).toBeTruthy();
    expect(calls.find((c) => c.url === "/api/copilot/parse")!.body).toEqual({ prompt: "2 hours bearing wear at minute 40, high severity", use_claude: true });
  });

  it("an example chip sends its prompt", async () => {
    const calls = mockApi({ "/api/copilot/status": status(), "/api/copilot/parse": parsed() });
    wrap(<Copilot onRunCreated={() => undefined} />);
    fireEvent.click(await screen.findByText("Bearing wear, high severity"));
    await screen.findByLabelText(/Simulation request/);
    expect(calls.find((c) => c.url === "/api/copilot/parse")!.body.prompt).toMatch(/bearing wear starting at minute 40/);
  });

  it("badges a Claude answer with the model name, and explains a fallback to the rules", async () => {
    mockApi({ "/api/copilot/status": status({ claude_available: true }), "/api/copilot/parse": parsed({ parser: "claude", model: "claude-sonnet-5-5" }) });
    const { unmount } = wrap(<Copilot onRunCreated={() => undefined} />);
    expect(await screen.findByText(/Claude connected/)).toBeTruthy();
    expect(screen.getByLabelText("Use Claude")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Describe a scenario"), { target: { value: "x" } });
    fireEvent.click(screen.getByLabelText("Send"));
    expect(await screen.findByText("Parsed by Claude | claude-sonnet-5-5")).toBeTruthy();
    unmount();
    mockApi({ "/api/copilot/status": status({ claude_available: true }), "/api/copilot/parse": parsed({ fallback_reason: "Claude call failed (RateLimitError). Used the rule-based parser instead." }) });
    wrap(<Copilot onRunCreated={() => undefined} />);
    fireEvent.change(await screen.findByLabelText("Describe a scenario"), { target: { value: "x" } });
    fireEvent.click(screen.getByLabelText("Send"));
    expect((await screen.findByTestId("fallback-note")).textContent).toMatch(/Used the rule-based parser instead/);
    expect(screen.getAllByText("Parsed by rules").length).toBeGreaterThan(0);
  });

  it("shows invalid JSON inline and blocks Run until it is fixed", async () => {
    mockApi({ "/api/copilot/status": status(), "/api/copilot/parse": parsed(), "/api/copilot/validate": { valid: true, errors: [] } });
    wrap(<Copilot onRunCreated={() => undefined} />);
    fireEvent.click(await screen.findByText("Healthy baseline"));
    const box = (await screen.findByLabelText(/Simulation request/)) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: '{"config": {' } });
    expect((await screen.findAllByRole("alert"))[0].textContent).toMatch(/Invalid JSON/);
    expect((screen.getByText("Run").closest("button") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText("Reset JSON"));
    await waitFor(() => expect((screen.getByText("Run").closest("button") as HTMLButtonElement).disabled).toBe(false));
  });

  it("validates edits with the backend and shows the error next to the field", async () => {
    mockApi({
      "/api/copilot/status": status(), "/api/copilot/parse": parsed(),
      "/api/copilot/validate": { valid: false, errors: [{ loc: "faults.0.intensity", msg: "Input should be less than or equal to 3" }] },
    });
    wrap(<Copilot onRunCreated={() => undefined} />);
    fireEvent.click(await screen.findByText("Healthy baseline"));
    const box = (await screen.findByLabelText(/Simulation request/)) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: box.value.replace('"intensity": 2', '"intensity": 9') } });
    expect(await screen.findByText(/Fault 1 - intensity:/, {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText(/less than or equal to 3/)).toBeTruthy();
    expect(screen.getByText("1 problem")).toBeTruthy();
    expect((screen.getByText("Run").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("Run posts the (edited) JSON to /api/simulate and shows the run", async () => {
    const created = vi.fn();
    const calls = mockApi({
      "/api/copilot/status": status(), "/api/copilot/parse": parsed(), "/api/sensors": sensors,
      "/api/simulate": { id: "run_1", name: "Copilot: bearing", kind: "physics", created_at: "", config: { faults: [{}] }, n_rows: 7200, duration_s: 7200, summary: {},
        preview: { stride: 1, rows: [{ t_s: 0, vib_x_mm_s: 1, fault_active: 0 }, { t_s: 60, vib_x_mm_s: 2, fault_active: 1 }] } },
      "/api/runs/run_1/labels": { run_id: "run_1", faults: [], segments: [], summary: {} },
    });
    wrap(<Copilot onRunCreated={created} />);
    fireEvent.click(await screen.findByText("Healthy baseline"));
    await screen.findByLabelText(/Simulation request/);
    fireEvent.click(screen.getByText("Run"));
    expect(await screen.findByText(/Result: Copilot: bearing/)).toBeTruthy();
    expect(calls.find((c) => c.url === "/api/simulate")!.body.faults[0].type).toBe("bearing_wear");
    expect(created).toHaveBeenCalled();
  });

  it("shows a readable error when the parse request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("status")
      ? { ok: true, status: 200, statusText: "OK", json: async () => status() }
      : { ok: false, status: 422, statusText: "x", json: async () => ({ detail: "prompt is empty" }) }));
    wrap(<Copilot onRunCreated={() => undefined} />);
    fireEvent.click(await screen.findByText("Healthy baseline"));
    expect(await screen.findByText("prompt is empty")).toBeTruthy();
  });
});

describe("Command palette", () => {
  const pages = [{ to: "/app", label: "Overview" }, { to: "/app/live", label: "Live monitor" }, { to: "/app/data", label: "Data Lab" }];
  const setup = () => {
    mockApi({ "/api/faults/catalog": catalog });
    const onRun = vi.fn(); const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} pages={pages} onRun={onRun} />);
    return { onRun, onClose, input: screen.getByRole("combobox") };
  };
  it("lists pages and actions first, and hides the eight inject commands until you type", () => {
    setup();
    const opts = screen.getAllByRole("option").map((o) => o.textContent);
    expect(opts.some((t) => t?.includes("Live monitor"))).toBe(true);
    expect(opts.some((t) => t?.includes("Toggle theme"))).toBe(true);
    expect(opts.some((t) => t?.includes("Inject"))).toBe(false);
  });
  it("filters as you type and runs the top result with Enter", () => {
    const { onRun, onClose, input } = setup();
    fireEvent.change(input, { target: { value: "data" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ id: "page:/app/data" }));
    expect(onClose).toHaveBeenCalled();
  });
  it("moves with the arrow keys and wraps around", () => {
    const { onRun, input } = setup();
    fireEvent.change(input, { target: { value: "theme" } });
    fireEvent.keyDown(input, { key: "ArrowDown" }); fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRun.mock.calls[0][0].id).toBe("action:toggle-theme");
  });
  it("finds a fault to inject (typing reveals the inject group)", async () => {
    const { onRun, input } = setup();
    fireEvent.change(input, { target: { value: "inject bearing" } });
    await screen.findByText("Inject main drive bearing wear");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRun.mock.calls[0][0].id).toBe("inject:bearing_wear");
  });
  it("says so when nothing matches", () => {
    const { onRun, input } = setup();
    fireEvent.change(input, { target: { value: "zzqxj" } });
    expect(screen.getByText(/No commands match/)).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRun).not.toHaveBeenCalled();
  });
  it("is also reachable by clicking a row", () => {
    const { onRun } = setup();
    fireEvent.click(screen.getByText("Data Lab"));
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ id: "page:/app/data" }));
  });
  it("builds the same commands the shell uses", () => { expect(buildCommands(pages).length).toBeGreaterThan(pages.length + 6); });
});

describe("App shell: Ctrl+K, tour, help menu, demo", () => {
  const routes = () => mockApi({ "/api/overview": overview, "/api/sensors": sensors, "/api/faults/catalog": catalog, "/api/copilot/status": status(), "/api/runs": [], "/api/scenarios": [] });

  it("Ctrl+K and Cmd+K open the palette; Esc closes it", async () => {
    routes(); render(<App />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(await screen.findByRole("dialog", { name: "Command palette" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull());
    fireEvent.keyDown(window, { key: "K", metaKey: true });
    expect(await screen.findByRole("dialog", { name: "Command palette" })).toBeTruthy();
  });

  it("the palette navigates to a page", async () => {
    routes(); render(<App />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "copilot" } });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(await screen.findByText("Scenario Copilot", { selector: "h1" })).toBeTruthy();
    expect(window.location.hash).toBe("#/app/copilot");
  });

  it("'Start live stream' opens Live and sends resume as soon as the socket is open", async () => {
    routes(); render(<App />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "start live" } });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    await screen.findByText("Live monitor", { selector: "h1" });
    expect(MockSocket.last.sent).toEqual([]);                       // not connected yet: the command waits
    act(() => MockSocket.last.open());
    await waitFor(() => expect(MockSocket.last.sent.map((s) => JSON.parse(s).action)).toEqual(["resume"]));
  });

  it("'Inject ...' from the palette sends an inject message once connected", async () => {
    routes(); render(<App />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "inject bearing" } });
    await screen.findByText("Inject main drive bearing wear");
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    await screen.findByText("Live monitor", { selector: "h1" });
    act(() => MockSocket.last.open());
    await waitFor(() => expect(MockSocket.last.sent).toHaveLength(1));
    expect(JSON.parse(MockSocket.last.sent[0])).toMatchObject({ action: "inject", fault: { type: "bearing_wear" } });
  });

  it("'Toggle theme' flips the dark class", async () => {
    routes(); render(<App />);
    const was = document.documentElement.classList.contains("dark");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "toggle theme" } });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(!was));
    document.documentElement.classList.remove("dark");
  });

  it("shows the tour on the first visit, can be skipped, and does not come back", async () => {
    localStorage.removeItem("bs-tour-done");
    routes(); render(<App />);
    const card = await screen.findByTestId("tour-card", {}, { timeout: 3000 });
    expect(card.textContent).toMatch(/Welcome to BlisterSynth AI/);
    fireEvent.click(screen.getByText("Next"));
    await waitFor(() => expect(screen.getByTestId("tour-card").textContent).toMatch(/Overview/));
    fireEvent.click(screen.getByText("Skip tour"));
    await waitFor(() => expect(screen.queryByTestId("tour-card")).toBeNull());
    expect(localStorage.getItem("bs-tour-done")).toBe("1");
  });

  it("Esc skips the tour; it is not shown when already done; the help menu restarts it", async () => {
    localStorage.removeItem("bs-tour-done");
    routes(); const first = render(<App />);
    await screen.findByTestId("tour-card", {}, { timeout: 3000 });
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("tour-card")).toBeNull());
    expect(localStorage.getItem("bs-tour-done")).toBe("1");
    first.unmount();
    routes(); render(<App />);
    await new Promise((r) => setTimeout(r, 1200));
    expect(screen.queryByTestId("tour-card")).toBeNull();
    fireEvent.click(screen.getByLabelText("Help"));
    fireEvent.click(screen.getByText("Take the product tour"));
    expect(await screen.findByTestId("tour-card")).toBeTruthy();
  });

  it("the tour walks through every step and finishes", async () => {
    localStorage.removeItem("bs-tour-done");
    routes(); render(<App />);
    await screen.findByTestId("tour-card", {}, { timeout: 3000 });
    for (let i = 0; i < 9; i++) fireEvent.click(screen.getByText("Next"));
    expect(screen.getByTestId("tour-card").textContent).toMatch(/Help & demo mode/);
    fireEvent.click(screen.getByText("Finish"));
    await waitFor(() => expect(screen.queryByTestId("tour-card")).toBeNull());
    expect(localStorage.getItem("bs-tour-done")).toBe("1");
  });

  it("demo mode: Play demo shows caption cards, navigates on schedule, pauses and stops", async () => {
    routes(); render(<App />);
    await screen.findByText("1 runs");
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "performance"] });
    fireEvent.click(screen.getByLabelText("Help"));
    fireEvent.click(screen.getByText(/Play demo/));
    expect(screen.getByTestId("demo-player").textContent).toMatch(/BlisterSynth AI in one minute/);
    act(() => { vi.advanceTimersByTime(12_500); });
    expect(screen.getByTestId("demo-player").textContent).toMatch(/The digital twin/);
    expect(window.location.hash).toBe("#/app/live");
    // pause freezes the clock
    const player = () => within(screen.getByTestId("demo-player"));
    fireEvent.click(player().getByText("Pause"));
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByTestId("demo-player").textContent).toMatch(/The digital twin/);
    expect(screen.getByTestId("demo-player").textContent).toMatch(/Paused/);
    fireEvent.click(player().getByText("Resume"));
    // the stream-start step sends reset, speed and resume once the (mock) socket is open
    act(() => { MockSocket.last.open(); });
    act(() => { vi.advanceTimersByTime(12_000); });
    expect(screen.getByTestId("demo-player").textContent).toMatch(/Start the stream/);
    const actions = MockSocket.last.sent.map((s) => JSON.parse(s).action);
    expect(actions).toEqual(expect.arrayContaining(["reset", "speed", "resume"]));
    fireEvent.click(player().getByText("Stop"));
    vi.useRealTimers();                                              // framer-motion's exit animation needs real frames
    await waitFor(() => expect(screen.queryByTestId("demo-player")).toBeNull());
  });

  it("demo mode: the full script ends on the About page with a Close button", async () => {
    routes(); render(<App />);
    await screen.findByText("1 runs");
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "performance"] });
    fireEvent.click(screen.getByLabelText("Help"));
    fireEvent.click(screen.getByText(/Play demo/));
    for (let i = 0; i < 240; i++) act(() => { vi.advanceTimersByTime(1000); });
    expect(window.location.hash).toBe("#/app/about");
    expect(screen.getByTestId("demo-player").textContent).toMatch(/That is BlisterSynth AI/);
    fireEvent.click(within(screen.getByTestId("demo-player")).getByText("Close"));
    vi.useRealTimers();
    await waitFor(() => expect(screen.queryByTestId("demo-player")).toBeNull());
  });

  it("demo steps for Quality and PdM press the page buttons (queued on the bus)", async () => {
    mockApi({ "/api/overview": overview, "/api/sensors": sensors, "/api/faults/catalog": catalog, "/api/generative/models": [{ id: "g1", name: "cvae", kind: "cvae" }],
      "/api/runs": [], "/api/datasets": [], "/api/quality/report": makeReport() });
    window.location.hash = "#/app/quality";
    const calls = (vi.mocked(fetch) as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    render(<App />);
    await screen.findByText("Generate report");
    act(() => appBus.publish({ type: "ui", target: "quality:run" }));
    await waitFor(() => expect(calls.some((c) => String(c[0]) === "/api/quality/report")).toBe(true));
    expect((await screen.findAllByText(/Fidelity/)).length).toBeGreaterThan(0);
  });
});

describe("DemoPlayer", () => {
  const view = (over = {}) => ({ state: "playing" as const, step: { id: "s", at: 0, title: "Hello", body: "World", actions: [] }, stepIndex: 0, stepCount: 11, elapsed: 75, duration: 232, progress: 0.32, ...over });
  it("renders nothing without a view", () => {
    const { container } = render(<DemoPlayer view={null} onPause={() => undefined} onResume={() => undefined} onStop={() => undefined} onSkip={() => undefined} />);
    expect(container.textContent).toBe("");
  });
  it("shows the caption, clock and progress, and wires the buttons", () => {
    const h = { onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn(), onSkip: vi.fn() };
    render(<DemoPlayer view={view()} {...h} />);
    expect(screen.getByText("Hello")).toBeTruthy();
    expect(screen.getByText("1:15 / 3:52")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("32");
    fireEvent.click(screen.getByText("Pause")); fireEvent.click(screen.getByText("Next step")); fireEvent.click(screen.getByText("Stop"));
    expect([h.onPause, h.onSkip, h.onStop].every((f) => f.mock.calls.length === 1)).toBe(true);
  });
  it("offers Resume while paused and Close when finished", () => {
    const h = { onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn(), onSkip: vi.fn() };
    const { rerender } = render(<DemoPlayer view={view({ state: "paused" })} {...h} />);
    fireEvent.click(screen.getByText("Resume"));
    expect(h.onResume).toHaveBeenCalled();
    rerender(<DemoPlayer view={view({ state: "finished", stepIndex: 10 })} {...h} />);
    fireEvent.click(screen.getByText("Close"));
    expect(h.onStop).toHaveBeenCalled();
  });
});

describe("About page", () => {
  it("renders the architecture diagram, tech stack and the five explanations", async () => {
    mockApi({ "/api/overview": overview });
    window.location.hash = "#/app/about";
    const { container } = render(<App />);
    expect(await screen.findByText("How it works", { selector: "h1" })).toBeTruthy();
    expect(screen.getByRole("img", { name: /Architecture: the simulator feeds/ })).toBeTruthy();
    ["simulator", "faults", "generative", "quality", "pdm", "dashboard", "fastapi", "websocket", "sqlite"].forEach((id) => expect(container.querySelector(`[data-node="${id}"]`), id).toBeTruthy());
    ["AR(1) noise", "Correlated sensors", "Remaining useful life (RUL)", "cVAE and TimeGAN", "TSTR: train on synthetic, test on real"].forEach((t) => expect(screen.getByText(t)).toBeTruthy());
    expect(screen.getByText(/FastAPI \+ Pydantic/)).toBeTruthy();
    expect(screen.getByText(/React 18 \+ TypeScript/)).toBeTruthy();
  });
  it("the AR(1) slider changes the measured autocorrelation", async () => {
    mockApi({ "/api/overview": overview });
    window.location.hash = "#/app/about";
    render(<App />);
    const slider = await screen.findByLabelText("phi (memory)");
    const before = screen.getByText(/measured lag-1 autocorrelation/).textContent;
    fireEvent.change(slider, { target: { value: "0" } });
    expect(screen.getByText(/measured lag-1 autocorrelation/).textContent).not.toBe(before);
  });
});
