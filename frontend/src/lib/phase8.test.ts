// Phase 8 (UI polish): the pure maths behind the cinematic hero, the scroll story, the control room and the trust
// section. No React here - see src/phase8.test.tsx for the components.
import { afterEach, vi } from "vitest";
import type { ImbalanceResult, LiveRow } from "../api/types";
import { arcPath, needleAngle } from "../components/ui/DialGauge";
import { clamp01, stickyProgress, travelProgress } from "../hooks/useScrollProgress";
import { CASE_KEY, caseFromResult, loadCase, saveCase } from "./caseStudy";
import { accumulateCounters, clock, initialCounters, rulText } from "./counters";
import { installFoilTracking, localPoint } from "./foil";
import { dropWindow, HEADLINE, INTENTS, landedCount, NOZZLE, POCKET_POS, POCKETS, tabletPose } from "./hero";
import { READINESS } from "./readiness";
import { playPop, setSoundOn, SOUND_KEY, soundOn, subscribeSound } from "./sound";
import { cameraAt, CHAPTERS, LINE_H, LINE_W, progressOfChapter, signaturePath, smooth, viewBoxFor } from "./story";

const row = (t_s: number, extra: Record<string, unknown> = {}): LiveRow => ({ t_s, health: {}, status: {}, ...extra });

/** A Map-backed stand-in for localStorage. */
function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, raw: m };
}

afterEach(() => {
  localStorage.removeItem(SOUND_KEY);
  vi.unstubAllGlobals();
});

describe("scroll progress", () => {
  it("clamp01 keeps 0..1 and turns NaN into 0", () => {
    expect(clamp01(-2)).toBe(0);
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(7)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
  });
  it("stickyProgress: 0 before the section reaches the header, 1 after scrolling height - stuck", () => {
    // section 2000 px tall, sticky box 800 px, 64 px header
    expect(stickyProgress(300, 2000, 800, 64)).toBe(0);
    expect(stickyProgress(64, 2000, 800, 64)).toBe(0);
    expect(stickyProgress(64 - 600, 2000, 800, 64)).toBeCloseTo(0.5);
    expect(stickyProgress(64 - 1200, 2000, 800, 64)).toBe(1);
    expect(stickyProgress(-5000, 2000, 800, 64)).toBe(1);
  });
  it("stickyProgress does not divide by zero when nothing can scroll", () => {
    expect(stickyProgress(10, 800, 800, 64)).toBe(1);
    expect(stickyProgress(100, 800, 800, 64)).toBe(0);
  });
  it("travelProgress: 0 low in the viewport, 1 near the top", () => {
    expect(travelProgress(950, 1000)).toBe(0);
    expect(travelProgress(920, 1000)).toBe(0);
    expect(travelProgress(520, 1000)).toBeCloseTo(0.5);
    expect(travelProgress(120, 1000)).toBe(1);
    expect(travelProgress(-300, 1000)).toBe(1);
  });
});

describe("hero: tablets fall into a 10-pocket pack", () => {
  it("has 10 pockets in two rows of five", () => {
    expect(POCKETS).toBe(10);
    expect(POCKET_POS).toHaveLength(10);
    expect(new Set(POCKET_POS.map((p) => p.y)).size).toBe(2);
  });
  it("drop windows are staggered and all finish before the end of the scroll", () => {
    for (let i = 1; i < POCKETS; i++) expect(dropWindow(i).start).toBeGreaterThan(dropWindow(i - 1).start);
    expect(dropWindow(POCKETS - 1).end).toBeLessThanOrEqual(1);
  });
  it("fills the pack one tablet at a time as the page scrolls", () => {
    expect(landedCount(0)).toBe(0);
    expect(landedCount(1)).toBe(POCKETS);
    let prev = 0;
    for (let p = 0; p <= 1.0001; p += 0.01) {
      const n = landedCount(p);
      expect(n).toBeGreaterThanOrEqual(prev);
      expect(n - prev).toBeLessThanOrEqual(1);
      prev = n;
    }
  });
  it("a tablet starts hidden at the nozzle and ends in its own pocket", () => {
    const start = tabletPose(0, 3);
    expect(start).toMatchObject({ x: NOZZLE.x, y: NOZZLE.y, visible: false });
    const end = tabletPose(1, 3);
    expect(end.visible).toBe(true);
    expect(end.x).toBeCloseTo(POCKET_POS[3].x, 5);
    expect(end.y).toBeCloseTo(POCKET_POS[3].y, 5);
  });
  it("falls downwards and bounces only a little", () => {
    const ys = Array.from({ length: 81 }, (_, k) => tabletPose(k / 100, 0).y);   // the fall part (t < 0.82)
    for (let k = 1; k < ys.length; k++) expect(ys[k]).toBeGreaterThanOrEqual(ys[k - 1]);
    for (let t = 0.82; t <= 1; t += 0.02) expect(POCKET_POS[0].y - tabletPose(t, 0).y).toBeLessThanOrEqual(9.0001);
  });
  it("headline and guided entry", () => {
    expect(HEADLINE.flat().join(" ")).toBe("Synthetic data for smarter packaging lines");
    expect(INTENTS.map((x) => x.to)).toEqual(["/app/live", "/app/simulator", "/app/copilot", "/app/quality"]);
  });
});

describe("story: the camera visits each station", () => {
  it("smooth is an ease from 0 to 1", () => {
    expect(smooth(-1)).toBe(0);
    expect(smooth(0.5)).toBeCloseTo(0.5);
    expect(smooth(2)).toBe(1);
  });
  it("starts on the whole line and ends on the punch", () => {
    const start = cameraAt(0);
    expect(start.index).toBe(0);
    expect(start.cx).toBeCloseTo(CHAPTERS[0].shot.cx);
    expect(start.zoom).toBeCloseTo(CHAPTERS[0].shot.zoom);
    const end = cameraAt(1);
    expect(end.index).toBe(CHAPTERS.length - 1);
    expect(end.cx).toBeCloseTo(CHAPTERS[CHAPTERS.length - 1].shot.cx);
    expect(end.zoom).toBeCloseTo(CHAPTERS[CHAPTERS.length - 1].shot.zoom);
  });
  it("holds still on each chapter while its text is on screen", () => {
    CHAPTERS.forEach((ch, i) => {
      const cam = cameraAt(progressOfChapter(i));
      expect(cam.index).toBe(i);
      expect(cam.cx).toBeCloseTo(ch.shot.cx);
      expect(cam.cy).toBeCloseTo(ch.shot.cy);
      expect(cam.zoom).toBeCloseTo(ch.shot.zoom);
    });
  });
  it("never zooms outside the range of the shots", () => {
    const zooms = CHAPTERS.map((c) => c.shot.zoom);
    for (let p = 0; p <= 1; p += 0.01) {
      const z = cameraAt(p).zoom;
      expect(z).toBeGreaterThanOrEqual(Math.min(...zooms) - 1e-9);
      expect(z).toBeLessThanOrEqual(Math.max(...zooms) + 1e-9);
    }
  });
  it("viewBoxFor keeps the panel's proportions and centres the shot", () => {
    const [x, y, w, h] = viewBoxFor({ cx: 500, cy: 200, zoom: 2 }, 800, 400).split(" ").map(Number);
    expect(w).toBeCloseTo(LINE_W / 2, 0);
    expect(h / w).toBeCloseTo(0.5, 2);
    expect(x + w / 2).toBeCloseTo(500, 0);
    expect(y + h / 2).toBeCloseTo(200, 0);
  });
  it("the overview always shows the full machine height, even on a wide, short panel", () => {
    const h = Number(viewBoxFor(CHAPTERS[0].shot, 1600, 300).split(" ")[3]);
    expect(h).toBeGreaterThanOrEqual(LINE_H);
  });
  it("signature curves stay inside their box and show the right shape", () => {
    const ys = (kind: Parameters<typeof signaturePath>[0]) =>
      signaturePath(kind, 220, 56, 72).split(" L").map((s) => Number(s.replace("M", "").split(" ")[1]));
    for (const kind of ["healthy", "step", "intermittent", "decline", "accelerating"] as const) {
      const pts = ys(kind);
      expect(pts).toHaveLength(72);
      pts.forEach((y) => { expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(56); });
    }
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    // SVG y grows downwards: a value that rises gets a smaller y
    expect(mean(ys("step").slice(-10))).toBeLessThan(mean(ys("step").slice(0, 10)));
    expect(mean(ys("decline").slice(-10))).toBeGreaterThan(mean(ys("decline").slice(0, 10)));
    expect(mean(ys("accelerating").slice(-10))).toBeLessThan(mean(ys("accelerating").slice(0, 10)));
  });
});

describe("control room counters", () => {
  it("220 blisters per minute for one minute is 220 blisters", () => {
    const rows = Array.from({ length: 61 }, (_, t) => row(t, { line_speed_bpm: 220, pocket_fill_count: 10 }));
    const c = accumulateCounters(initialCounters(), rows);
    expect(c.blisters).toBeCloseTo(220 + 220 / 60, 6);     // the first row counts as one second too
    expect(c.rejected).toBe(0);
    expect(c.seconds).toBe(61);
  });
  it("counts a blister with an empty pocket as rejected", () => {
    const c = accumulateCounters(initialCounters(), [row(1, { line_speed_bpm: 60, pocket_fill_count: 9 }), row(2, { line_speed_bpm: 60, pocket_fill_count: 10 })]);
    expect(c.blisters).toBeCloseTo(2);
    expect(c.rejected).toBeCloseTo(1);
  });
  it("only counts each row once, even when the same window arrives again", () => {
    const rows = [row(1, { line_speed_bpm: 120 }), row(2, { line_speed_bpm: 120 })];
    const once = accumulateCounters(initialCounters(), rows);
    const twice = accumulateCounters(once, rows);
    expect(twice).toEqual(once);
  });
  it("a stopped line adds time but no blisters; a reset starts over", () => {
    const a = accumulateCounters(initialCounters(), [row(10, { line_speed_bpm: 0 }), row(11, { line_speed_bpm: 0 })]);
    expect(a.blisters).toBe(0);
    expect(a.seconds).toBe(2);
    const b = accumulateCounters(a, [row(1, { line_speed_bpm: 60 })]);            // time went backwards
    expect(b.seconds).toBe(1);
    expect(b.blisters).toBeCloseTo(1);
  });
  it("formats the clock and the remaining useful life", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(754)).toBe("12:34");
    expect(clock(3725)).toBe("1:02:05");
    expect(rulText(45)).toBe("45 s");
    expect(rulText(500)).toBe("8 min 20 s");
    expect(rulText(600)).toBe("10 min");
    expect(rulText(3900)).toBe("1 h 5 min");
    expect(rulText(-3)).toBe("0 s");
  });
});

describe("dial gauge geometry", () => {
  it("the needle sweeps 240 degrees and is clamped", () => {
    expect(needleAngle(0, 0, 100)).toBe(150);
    expect(needleAngle(100, 0, 100)).toBe(390);
    expect(needleAngle(50, 0, 100)).toBe(270);                 // straight up
    expect(needleAngle(-20, 0, 100)).toBe(150);
    expect(needleAngle(500, 0, 100)).toBe(390);
  });
  it("arcs longer than half a circle set the large-arc flag", () => {
    expect(arcPath(70, 70, 56, 0, 1)).toContain(" 0 1 1 ");
    expect(arcPath(70, 70, 56, 0, 0.5)).toContain(" 0 0 1 ");
  });
});

describe("case study (the user's own imbalance-fix result)", () => {
  const result = {
    model_id: "mdl_1",
    real_only: { macro_f1: 0.41 }, real_plus_synthetic: { macro_f1: 0.67 },
    improvement: { macro_f1_delta: 0.26, classes_improved: 2, classes_worse: 0, headline: "Macro-F1 0.41 -> 0.67" },
  } as unknown as ImbalanceResult;

  it("keeps the numbers of the run that produced it", () => {
    const c = caseFromResult(result, { n_real: 10, n_fault_real: 2, n_synth: 24 }, new Date("2026-11-01T10:00:00Z"));
    expect(c).toMatchObject({ real_only_f1: 0.41, aug_f1: 0.67, delta: 0.26, classes_improved: 2, n_real: 10, n_fault_real: 2, n_synth: 24, saved_at: "2026-11-01T10:00:00.000Z" });
  });
  it("round-trips through storage", () => {
    const s = memoryStorage();
    const c = caseFromResult(result, { n_real: 10, n_fault_real: 2, n_synth: 24 });
    saveCase(c, s);
    expect(s.raw.has(CASE_KEY)).toBe(true);
    expect(loadCase(s)).toEqual(c);
  });
  it("shows nothing rather than something made up when storage is empty or damaged", () => {
    const s = memoryStorage();
    expect(loadCase(s)).toBeNull();
    s.setItem(CASE_KEY, "{not json");
    expect(loadCase(s)).toBeNull();
    s.setItem(CASE_KEY, JSON.stringify({ saved_at: "x", model_id: "m", real_only_f1: "0.4" }));
    expect(loadCase(s)).toBeNull();
    expect(loadCase(null)).toBeNull();
  });
});

describe("readiness table (trust section)", () => {
  it("every level fits its stages and no row claims a certification", () => {
    for (const g of READINESS) {
      for (const r of g.rows) {
        expect(r.level).toBeGreaterThanOrEqual(0);
        expect(r.level).toBeLessThanOrEqual(g.stages.length);
        expect(r.status).not.toMatch(/certified/i);
      }
    }
  });
  it("each product claim names the test that backs it", () => {
    const product = READINESS.find((g) => g.id === "product")!;
    product.rows.forEach((r) => expect(r.note).toMatch(/(test_phase\d|smoke_test)\.py/));
  });
  it("nothing is marked as validated on a real plant", () => {
    const product = READINESS.find((g) => g.id === "product")!;
    expect(Math.max(...product.rows.map((r) => r.level))).toBeLessThan(3);
  });
});

describe("sound", () => {
  it("is on by default; muting is remembered and shared", () => {
    expect(soundOn()).toBe(true);
    const seen: boolean[] = [];
    const off = subscribeSound((on) => seen.push(on));
    setSoundOn(false);
    expect(localStorage.getItem(SOUND_KEY)).toBe("off");
    expect(soundOn()).toBe(false);
    setSoundOn(true);
    off();
    setSoundOn(false);                                  // after unsubscribing, no more calls
    expect(seen).toEqual([false, true]);
  });
  it("a pop does nothing when muted, or when the browser has no Web Audio", () => {
    setSoundOn(false);
    expect(playPop()).toBe(false);
    setSoundOn(true);
    vi.stubGlobal("AudioContext", undefined);
    expect(playPop()).toBe(false);
  });
});

describe("foil shine", () => {
  it("localPoint is the pointer position inside the element, rounded to whole pixels", () => {
    expect(localPoint(130.6, 52.2, { left: 100, top: 40 })).toEqual({ mx: "31px", my: "12px" });
  });
  it("writes --mx / --my on the .foil card under the mouse, and ignores touch", () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 0; });
    const card = document.createElement("div");
    card.className = "foil";
    const inner = document.createElement("span");
    card.appendChild(inner);
    document.body.appendChild(card);
    const stop = installFoilTracking(document);
    const move = (pointerType: string, x: number, y: number) => {
      const e = new MouseEvent("pointermove", { bubbles: true, clientX: x, clientY: y });
      Object.defineProperty(e, "pointerType", { value: pointerType });
      inner.dispatchEvent(e);
    };
    move("touch", 5, 6);
    expect(card.style.getPropertyValue("--mx")).toBe("");
    move("mouse", 25, 30);
    expect(card.style.getPropertyValue("--mx")).toBe("25px");     // jsdom boxes sit at 0,0
    expect(card.style.getPropertyValue("--my")).toBe("30px");
    stop();
    move("mouse", 80, 90);
    expect(card.style.getPropertyValue("--mx")).toBe("25px");     // listener removed
    card.remove();
  });
});
