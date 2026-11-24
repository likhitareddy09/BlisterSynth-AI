// Phase 8 (UI polish): hero pack, toggles, story, trust section and the control room.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, vi } from "vitest";
import App from "./App";
import Hero from "./components/landing/Hero";
import LineStory from "./components/landing/LineStory";
import TrustSection from "./components/landing/TrustSection";
import { MotionToggle, SoundToggle } from "./components/SoundToggle";
import KpiStrip from "./components/live/KpiStrip";
import MiniLine from "./components/twin/MiniLine";
import { DialGauge } from "./components/ui";
import { useMotionPaused } from "./hooks/useMotionPaused";
import { CASE_KEY, type CaseStudy } from "./lib/caseStudy";
import { SOUND_KEY } from "./lib/sound";
import { CHAPTERS } from "./lib/story";
import { MockSocket } from "./test/mockSocket";
import type { LiveRow } from "./api/types";

/** Render at `path` inside a router; every other page is a stub that just shows its own path. */
function atRoute(ui: React.ReactElement, path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path} element={ui} />
        {["/app/live", "/app/simulator", "/app/copilot", "/app/quality", "/app/pdm"].filter((p) => p !== path).map((p) => (
          <Route key={p} path={p} element={<p>page {p}</p>} />
        ))}
      </Routes>
    </MemoryRouter>,
  );
}

const savedCase: CaseStudy = {
  saved_at: "2026-11-20T09:00:00.000Z", model_id: "gen_1", real_only_f1: 0.41, aug_f1: 0.67, delta: 0.26,
  classes_improved: 2, classes_worse: 0, headline: "Macro-F1 0.41 -> 0.67", n_real: 10, n_fault_real: 2, n_synth: 24,
};

beforeEach(() => {
  [SOUND_KEY, "bs-motion", CASE_KEY].forEach((k) => localStorage.removeItem(k));
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.classList.remove("motion-paused");
});

describe("Hero", () => {
  it("has the full headline for screen readers and a guided 'what do you want to do?' entry", async () => {
    atRoute(<Hero />);
    expect(screen.getByText("Synthetic data for smarter packaging lines")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("What do you want to do?"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Go: Describe a scenario in plain English" }));
    expect(await screen.findByText("page /app/copilot")).toBeTruthy();
  });

  it("fills the pack (here the scene is already in view) and pops a tablet on click or keyboard", () => {
    atRoute(<Hero />);
    expect(screen.getByText("10/10 in the pack")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pop tablet 1" }));
    expect(screen.getByText("9/10 in the pack")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pocket 1, popped" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("button", { name: "Pop tablet 2" }), { key: "Enter" });
    expect(screen.getByText("8/10 in the pack")).toBeTruthy();
  });

  it("offers a refill once every tablet is popped", () => {
    atRoute(<Hero />);
    for (let i = 1; i <= 10; i++) fireEvent.click(screen.getByRole("button", { name: `Pop tablet ${i}` }));
    expect(screen.getByText("0/10 in the pack")).toBeTruthy();
    fireEvent.click(screen.getByText("Refill the pack"));
    expect(screen.getByText("10/10 in the pack")).toBeTruthy();
  });
});

describe("Sound and motion toggles", () => {
  it("the sound toggle mutes, remembers it, and every toggle on the page follows", () => {
    render(<><SoundToggle withLabel /><SoundToggle /></>);
    const [first, second] = screen.getAllByRole("button", { name: "Mute sounds" });
    expect(screen.getByText("Sound on")).toBeTruthy();
    fireEvent.click(first);
    expect(localStorage.getItem(SOUND_KEY)).toBe("off");
    expect(screen.getByText("Muted")).toBeTruthy();
    expect(second.getAttribute("aria-label")).toBe("Turn sounds on");
    expect(second.getAttribute("aria-pressed")).toBe("true");
  });

  it("'Pause motion' pauses every looping animation and is remembered", () => {
    function Demo() {
      const [paused, toggle] = useMotionPaused();
      return <MotionToggle paused={paused} onToggle={toggle} withLabel />;
    }
    const { unmount } = render(<Demo />);
    fireEvent.click(screen.getByRole("button", { name: "Pause animations" }));
    expect(document.documentElement.classList.contains("motion-paused")).toBe(true);
    expect(localStorage.getItem("bs-motion")).toBe("paused");
    expect(screen.getByText("Play motion")).toBeTruthy();
    unmount();
    expect(document.documentElement.classList.contains("motion-paused")).toBe(false);
  });
});

describe("Scroll story", () => {
  it("has one button per chapter and shows the text of the current one", () => {
    render(<LineStory />);
    const nav = screen.getByRole("navigation", { name: "Story chapters" });
    const buttons = within(nav).getAllByRole("button");
    expect(buttons).toHaveLength(CHAPTERS.length);
    const current = buttons.findIndex((b) => b.getAttribute("aria-current") === "step");
    expect(current).toBeGreaterThanOrEqual(0);
    expect(buttons.filter((b) => b.getAttribute("aria-current") === "step")).toHaveLength(1);
    const active = document.querySelector('[data-state="active"]');
    expect(active?.textContent).toContain(CHAPTERS[current].title);
  });
});

describe("Trust section", () => {
  it("is honest about readiness: nothing certified, and says what is missing", () => {
    atRoute(<TrustSection />);
    expect(screen.getByRole("meter", { name: /FDA 21 CFR Part 11: Not started, stage 0 of 4/ })).toBeTruthy();
    expect(screen.getByRole("meter", { name: /Physics digital twin: Tested in software, stage 2 of 4/ })).toBeTruthy();
    expect(screen.getByText(/It is not certified for any regulated use/)).toBeTruthy();
    expect(screen.getByText(/There are no user accounts yet/)).toBeTruthy();
  });

  it("without a saved experiment the case study says so and links to it", async () => {
    atRoute(<TrustSection />);
    expect(screen.getByText("No result on this computer yet.")).toBeTruthy();
    fireEvent.click(screen.getByText("Run the experiment"));
    expect(await screen.findByText("page /app/pdm")).toBeTruthy();
  });

  it("shows the user's own saved result", () => {
    localStorage.setItem(CASE_KEY, JSON.stringify(savedCase));
    atRoute(<TrustSection />);
    expect(screen.getByText("0.41")).toBeTruthy();
    expect(screen.getByText("0.67")).toBeTruthy();
    expect(screen.getByText("+0.26 macro-F1")).toBeTruthy();
    expect(screen.queryByText("No result on this computer yet.")).toBeNull();
  });
});

describe("Control-room pieces", () => {
  const row = (health: Record<string, number>, status: Record<string, "green" | "amber" | "red">, extra: Record<string, unknown> = {}): LiveRow =>
    ({ t_s: 10, health, status, line_speed_bpm: 220, ...extra });

  it("DialGauge exposes its value, and says when there is none", () => {
    const { rerender } = render(<DialGauge label="Line speed" value={219.6} max={300} unit="bpm" />);
    const meter = screen.getByRole("meter", { name: "Line speed" });
    expect(meter.getAttribute("aria-valuenow")).toBe("220");
    expect(meter.getAttribute("aria-valuetext")).toBe("220 bpm");
    rerender(<DialGauge label="Line speed" value={null} max={300} unit="bpm" />);
    expect(screen.getByRole("meter", { name: "Line speed" }).getAttribute("aria-valuetext")).toBe("no data");
  });

  it("MiniLine describes every station's light", () => {
    render(<MiniLine status={{ forming: "red", sealing: "amber", unwind: "green" }} label="Line" />);
    const img = screen.getByRole("img");
    expect(img.getAttribute("aria-label")).toMatch(/^Line: Unwind Healthy, Form Critical, Fill No data, Seal Degrading/);
  });

  it("KpiStrip makes the worst station the headline", () => {
    render(<KpiStrip rows={[row({ forming: 42, sealing: 90 }, { forming: "red", sealing: "green" })]} stations={[{ key: "forming", label: "Forming", sensors: [] }]} />);
    expect(screen.getByRole("status").textContent).toBe("Forming is critical");
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("220")).toBeTruthy();
  });
});

describe("Overview control room (live)", () => {
  const overview = { app: "BlisterSynth AI", version: "0.7.0", runs: { total: 0, by_kind: {} }, scenarios: 0, generative_models: 0, pdm_models: 0, active_jobs: 0 };
  beforeEach(() => {
    MockSocket.reset();
    vi.stubGlobal("WebSocket", MockSocket);
    const routes: Record<string, unknown> = { "/api/overview": overview, "/api/runs": [], "/api/generative/models": [], "/api/pdm/models": [] };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const hit = Object.keys(routes).find((k) => url.startsWith(k));
      return hit ? { ok: true, status: 200, statusText: "OK", json: async () => routes[hit] }
        : { ok: false, status: 404, statusText: "Not Found", json: async () => ({ detail: "nope" }) };
    }));
    window.location.hash = "#/app";
  });

  it("shows the worst station's health as the big number and counts blisters", async () => {
    render(<App />);
    expect(await screen.findByText("Line health not available yet")).toBeTruthy();
    act(() => MockSocket.last.open());
    act(() => MockSocket.last.push({ type: "hello", sensors: [], stations: [{ key: "forming", label: "Forming", sensors: [] }], faults: { fault_types: [], profiles: [] }, config: {} }));
    act(() => MockSocket.last.push({ type: "tick", rows: [
      { t_s: 1, line_speed_bpm: 240, pocket_fill_count: 10, fault_active: 0, health: { forming: 91, sealing: 95 }, status: { forming: "green", sealing: "green" } },
      { t_s: 2, line_speed_bpm: 240, pocket_fill_count: 10, fault_active: 1, fault_type: "vacuum_leak", rul_s: 500, health: { forming: 42, sealing: 95 }, status: { forming: "red", sealing: "green" } },
    ] }));
    expect(await screen.findByText("Line health 42 out of 100")).toBeTruthy();
    expect(screen.getByText("Forming is critical")).toBeTruthy();
    expect(screen.getByText("8 min 20 s")).toBeTruthy();                       // time to failure from rul_s
    await waitFor(() => expect(screen.getByText("Blisters packed").previousElementSibling?.textContent).toBe("8"));
  });
});
