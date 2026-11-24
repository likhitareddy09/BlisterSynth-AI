import { isRunning, punchDuration, reelDuration, stationVisual, toneVar, webDuration } from "./twin";
import type { LiveRow } from "../api/types";

describe("stationVisual (status -> twin colour)", () => {
  it("maps green/amber/red to ok/warn/bad and only red pulses", () => {
    expect(stationVisual("green")).toMatchObject({ tone: "ok", pulse: false });
    expect(stationVisual("amber")).toMatchObject({ tone: "warn", pulse: false });
    expect(stationVisual("red")).toMatchObject({ tone: "bad", pulse: true });
  });
  it("shows an idle grey station when there is no status yet", () => {
    expect(stationVisual(undefined)).toMatchObject({ tone: "idle", pulse: false });
    expect(stationVisual("purple")).toMatchObject({ tone: "idle" });
  });
  it("gives each tone a CSS-variable colour", () => {
    expect(toneVar("bad")).toBe("rgb(var(--bad))");
    expect(toneVar("idle")).toBe("rgb(var(--sage))");
  });
});

describe("animation speeds follow line_speed_bpm", () => {
  it("220 bpm gives a 1.2 s web cycle; faster = shorter", () => {
    expect(webDuration(220)).toBeCloseTo(1.2);
    expect(webDuration(400)!).toBeLessThan(webDuration(220)!);
    expect(webDuration(60)!).toBeGreaterThan(webDuration(220)!);
  });
  it("stops (null) when the line is stopped or the value is missing", () => {
    expect(webDuration(0)).toBeNull();
    expect(webDuration(3)).toBeNull();
    expect(webDuration(undefined)).toBeNull();
    expect(webDuration(NaN)).toBeNull();
    expect(reelDuration(0)).toBeNull();
    expect(punchDuration(null)).toBeNull();
  });
  it("is clamped so it never gets absurdly fast or slow", () => {
    expect(webDuration(100000)).toBe(0.15);
    expect(webDuration(6)).toBe(6);
    expect(punchDuration(100000)).toBe(0.45);
  });
  it("reels turn slower than the web moves", () => expect(reelDuration(220)!).toBeGreaterThan(webDuration(220)!));
});

describe("isRunning", () => {
  it("is true above 5 bpm", () => {
    expect(isRunning({ line_speed_bpm: 200 } as unknown as LiveRow)).toBe(true);
    expect(isRunning({ line_speed_bpm: 0 } as unknown as LiveRow)).toBe(false);
    expect(isRunning(undefined)).toBe(false);
  });
});
