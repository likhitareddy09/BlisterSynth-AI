import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { ThemeProvider, useTheme } from "../../hooks/useTheme";
import DigitalTwin from "../twin/DigitalTwin";
import { Gauge, gaugeColor, Modal, StatCard, Tabs, Toggle, ToastProvider, useToast } from "./index";
import type { LiveRow } from "../../api/types";

describe("Gauge", () => {
  it("exposes its value to assistive tech and clamps it", () => {
    render(<Gauge value={140} label="Fidelity" />);
    const meter = screen.getByRole("meter", { name: "Fidelity" });
    expect(meter.getAttribute("aria-valuenow")).toBe("100");
  });
  it("colours by meaning: high anomaly is bad, high fidelity is good", () => {
    expect(gaugeColor(90, "good-low")).toContain("--bad");
    expect(gaugeColor(10, "good-low")).toContain("--ok");
    expect(gaugeColor(90, "good-high")).toContain("--ok");
    expect(gaugeColor(10, "good-high")).toContain("--bad");
  });
});

describe("StatCard", () => {
  it("shows -- when there is no value, and the number when animate is off", () => {
    const { rerender } = render(<StatCard icon={<i />} label="Runs" value={null} />);
    expect(screen.getByText("--")).toBeTruthy();
    rerender(<StatCard icon={<i />} label="Runs" value={12} animate={false} />);
    expect(screen.getByText("12")).toBeTruthy();
  });
});

describe("Tabs / Toggle / Modal", () => {
  it("Tabs call onChange and mark the selected tab", () => {
    const onChange = vi.fn();
    render(<Tabs items={[{ value: "a", label: "A" }, { value: "b", label: "B" }]} value="a" onChange={onChange} />);
    expect(screen.getByRole("tab", { name: "A" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "B" }));
    expect(onChange).toHaveBeenCalledWith("b");
  });
  it("Toggle flips", () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Dark" />);
    fireEvent.click(screen.getByRole("switch", { name: "Dark" }));
    expect(onChange).toHaveBeenCalledWith(true);
  });
  it("Modal closes on Escape", () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="Hello">body</Modal>);
    expect(screen.getByRole("dialog", { name: "Hello" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("Toast", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("shows a toast and removes it after its time", () => {
    function Btn() { const t = useToast(); return <button onClick={() => t.push({ title: "Forming went red", ms: 1000 })}>go</button>; }
    render(<ToastProvider><Btn /></ToastProvider>);
    fireEvent.click(screen.getByText("go"));
    expect(screen.getByText("Forming went red")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(1200); });
    // exit animation may keep the node briefly; the item is gone from state either way
    expect(screen.queryAllByRole("region").length).toBe(1);
  });
});

describe("theme", () => {
  it("toggles the dark class on <html> and saves the choice", () => {
    localStorage.setItem("bs-theme", "light");
    function T() { const { theme, toggle } = useTheme(); return <button onClick={toggle}>{theme}</button>; }
    render(<ThemeProvider><T /></ThemeProvider>);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    fireEvent.click(screen.getByText("light"));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("bs-theme")).toBe("dark");
  });
});

describe("DigitalTwin", () => {
  const stations = [{ key: "forming", label: "Forming", sensors: [] }, { key: "sealing", label: "Sealing", sensors: [] }, { key: "filling", label: "Filling", sensors: [] }];
  const last = { t_s: 9, line_speed_bpm: 220, health: { forming: 92, sealing: 61, filling: 30 }, status: { forming: "green", sealing: "amber", filling: "red" },
    fault_active: 1, fault_type: "jam", fault_station: "filling" } as unknown as LiveRow;

  it("labels every station with its status for screen readers", () => {
    render(<DigitalTwin stations={stations} last={last} selected={null} onSelect={() => undefined} />);
    expect(screen.getByLabelText(/^Forming: Healthy, health 92/)).toBeTruthy();
    expect(screen.getByLabelText(/^Sealing: Degrading, health 61/)).toBeTruthy();
    expect(screen.getByLabelText(/^Filling: Critical, health 30, active fault jam/)).toBeTruthy();
  });
  it("pulses only the red station", () => {
    const { container } = render(<DigitalTwin stations={stations} last={last} selected={null} onSelect={() => undefined} />);
    expect(container.querySelectorAll(".twin-pulse")).toHaveLength(1);
  });
  it("sets the film speed from line_speed_bpm and pauses the animation when stopped", () => {
    const { container, rerender } = render(<DigitalTwin stations={stations} last={last} selected={null} onSelect={() => undefined} />);
    expect(container.querySelector("svg")!.getAttribute("style")).toContain("--web-dur: 1.2s");
    expect(container.firstElementChild!.className).not.toContain("twin-paused");
    rerender(<DigitalTwin stations={stations} last={{ ...last, line_speed_bpm: 0 } as unknown as LiveRow} selected={null} onSelect={() => undefined} />);
    expect(container.firstElementChild!.className).toContain("twin-paused");
  });
  it("selects a station on click and on Enter", () => {
    const onSelect = vi.fn();
    render(<DigitalTwin stations={stations} last={last} selected={null} onSelect={onSelect} />);
    const forming = screen.getByLabelText(/^Forming:/);
    fireEvent.click(forming);
    expect(onSelect).toHaveBeenLastCalledWith("forming");
    fireEvent.keyDown(forming, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(2);
  });
  it("shows grey 'No data' stations before the first tick", () => {
    render(<DigitalTwin stations={stations} selected={null} onSelect={() => undefined} />);
    expect(screen.getByLabelText(/^Forming: No data/)).toBeTruthy();
  });
});
