import { NAV, tourId } from "../layout/AppShell";
import { ar1Series, CONCEPTS, INFRA, lag1, PIPELINE } from "./about";
import { appBus, createBus, type AppCommand } from "./bus";
import { describeLoc, errorLines, errorsBySection, EXAMPLE_PROMPTS, parseJsonDraft, prettyJson } from "./copilot";
import { createDemoRunner, formatClock } from "./demoRunner";
import { DEMO_SCRIPT, indexOfLiveAction, indexOfNavigate, validateScript, type DemoScript } from "./demoScript";
import { buildCommands, fuzzyScore, groupCommands, resolveCommand, searchCommands } from "./palette";
import { cardPosition, markTourDone, resetTour, TOUR_KEY, TOUR_STEPS, tourDone } from "./tour";

const PAGES = NAV.map((n) => ({ to: n.to, label: n.label }));
const ALL = buildCommands(PAGES);
const top = (q: string) => searchCommands(ALL, q)[0]?.title;

describe("copilot helpers", () => {
  it("has exactly five example prompts, each with a label", () => {
    expect(EXAMPLE_PROMPTS).toHaveLength(5);
    EXAMPLE_PROMPTS.forEach((e) => { expect(e.label.length).toBeGreaterThan(3); expect(e.prompt.length).toBeGreaterThan(10); });
  });
  it("parses JSON drafts and explains syntax errors", () => {
    expect(parseJsonDraft('{"a": 1}')).toEqual({ ok: true, value: { a: 1 } });
    const bad = parseJsonDraft('{"a": 1,}');
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toMatch(/^Invalid JSON/);
    expect(parseJsonDraft("[1,2]")).toMatchObject({ ok: false });
    expect(parseJsonDraft("null")).toMatchObject({ ok: false });
  });
  it("describes error locations in words", () => {
    expect(describeLoc("")).toBe("Request");
    expect(describeLoc("faults.0.onset_s")).toBe("Fault 1 - onset_s");
    expect(describeLoc("faults.2")).toBe("Fault 3");
    expect(describeLoc("config.duration_s")).toBe("Config - duration_s");
  });
  it("sorts errors by section and finds the JSON lines they point to", () => {
    const errors = [{ loc: "config.duration_s", msg: "x" }, { loc: "faults.1.intensity", msg: "y" }, { loc: "", msg: "z" }];
    const s = errorsBySection(errors);
    expect([s.config.length, s.faults.length, s.other.length]).toEqual([1, 1, 1]);
    const text = prettyJson({ name: "n", config: { duration_s: 5 }, faults: [{ type: "a", intensity: 1 }, { type: "b", intensity: 9 }] });
    const lines = errorLines(text, errors).map((i) => text.split("\n")[i].trim());
    expect(lines).toContain('"duration_s": 5');
    expect(lines).toContain('"intensity": 9');
    expect(lines).not.toContain('"intensity": 1');
  });
});

describe("command palette search", () => {
  it("returns everything for an empty query and nothing for nonsense", () => {
    expect(searchCommands(ALL, "")).toHaveLength(ALL.length);
    expect(searchCommands(ALL, "zzqxj")).toEqual([]);
  });
  it("builds pages, actions and one inject command per fault type", () => {
    const groups = groupCommands(ALL).map((g) => [g.group, g.items.length]);
    expect(groups).toEqual([["Pages", PAGES.length], ["Actions", 6], ["Inject fault", 8]]);
    ["new simulation", "start live stream", "toggle theme", "start demo mode"].forEach((t) => expect(ALL.some((c) => c.title.toLowerCase() === t)).toBe(true));
  });
  it("ranks a plain substring above a scattered match", () => {
    expect(fuzzyScore("live", "Live monitor")).toBeGreaterThan(fuzzyScore("live", "Inject cooling blockage everywhere")); // scattered or none
    expect(fuzzyScore("bwr", "Bearing wear")).toBeGreaterThan(0);          // subsequence
    expect(fuzzyScore("xyz", "Bearing wear")).toBe(0);
  });
  it("finds pages by name, prefix and typo-free fuzzy letters", () => {
    expect(top("live")).toBe("Live monitor");
    expect(top("data lab")).toBe("Data Lab");
    expect(top("copilot")).toBe("Scenario Copilot");
    expect(top("how")).toBe("How it works");
    expect(searchCommands(ALL, "qrep").map((c) => c.title)).toContain("Quality report");
  });
  it("finds actions through their keywords", () => {
    expect(top("dark mode")).toBe("Toggle theme");
    expect(top("viva")).toBe("Start demo mode");
    expect(searchCommands(ALL, "fix").map((c) => c.title)).toContain("Repair all faults");
  });
  it("finds a fault to inject by fault name or synonym", () => {
    expect(top("inject bearing")).toBe("Inject main drive bearing wear");
    expect(searchCommands(ALL, "vacuum").some((c) => c.id === "inject:vacuum_leak")).toBe(true);
    expect(searchCommands(ALL, "heater").some((c) => c.id === "inject:sealing_heater_degradation")).toBe(true);
  });
  it("is case-insensitive and ignores surrounding spaces", () => {
    expect(top("  LIVE ")).toBe("Live monitor");
  });
});

describe("palette effects", () => {
  it("maps every command to an effect", () => {
    ALL.forEach((c) => expect(resolveCommand(c), c.id).not.toBeNull());
  });
  it("navigates to pages and the simulator", () => {
    expect(resolveCommand({ id: "page:/app/data" })).toEqual({ kind: "navigate", to: "/app/data" });
    expect(resolveCommand({ id: "action:new-simulation" })).toEqual({ kind: "navigate", to: "/app/simulator" });
  });
  it("sends Live-page messages for stream actions and fault injection", () => {
    expect(resolveCommand({ id: "action:start-stream" })).toEqual({ kind: "live", to: "/app/live", msg: { action: "resume" } });
    expect(resolveCommand({ id: "action:repair" })).toMatchObject({ kind: "live", msg: { action: "repair" } });
    expect(resolveCommand({ id: "inject:vacuum_leak" })).toEqual({ kind: "live", to: "/app/live", msg: { action: "inject", fault: { type: "vacuum_leak", onset_s: 0, intensity: 1 } } });
  });
  it("handles theme, demo and tour, and rejects unknown ids", () => {
    expect(resolveCommand({ id: "action:toggle-theme" })).toEqual({ kind: "theme" });
    expect(resolveCommand({ id: "action:start-demo" })).toEqual({ kind: "demo" });
    expect(resolveCommand({ id: "action:tour" })).toEqual({ kind: "tour" });
    expect(resolveCommand({ id: "nonsense" })).toBeNull();
    expect(resolveCommand({ id: "page:https://evil.example" })).toBeNull();
  });
});

describe("demo script (plain data)", () => {
  it("passes every playability check", () => { expect(validateScript(DEMO_SCRIPT)).toEqual([]); });
  it("lasts between 3 and 4 minutes and starts at 0", () => {
    expect(DEMO_SCRIPT.steps[0].at).toBe(0);
    expect(DEMO_SCRIPT.endAt).toBeGreaterThanOrEqual(180);
    expect(DEMO_SCRIPT.endAt).toBeLessThanOrEqual(240);
  });
  it("has strictly increasing times and unique ids", () => {
    const times = DEMO_SCRIPT.steps.map((s) => s.at);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(new Set(times).size).toBe(times.length);
    expect(new Set(DEMO_SCRIPT.steps.map((s) => s.id)).size).toBe(DEMO_SCRIPT.steps.length);
  });
  it("tells the story in the required order: live -> stream -> inject -> alerts -> red -> repair -> quality -> PdM", () => {
    const ids = DEMO_SCRIPT.steps.map((s) => s.id);
    const order = ["open-live", "start-stream", "inject", "alerts", "twin-red", "repair", "quality", "pdm"];
    const at = order.map((id) => ids.indexOf(id));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
  it("performs the right actions at the right steps", () => {
    const s = DEMO_SCRIPT;
    expect(indexOfNavigate(s, "/app/live")).toBe(s.steps.findIndex((x) => x.id === "open-live"));
    const reset = indexOfLiveAction(s, "reset"), speed = indexOfLiveAction(s, "speed"), resume = indexOfLiveAction(s, "resume");
    expect(reset).toBe(speed); expect(speed).toBe(resume);                                   // all three in the "start-stream" step
    expect(indexOfLiveAction(s, "inject")).toBeGreaterThan(resume);
    expect(indexOfLiveAction(s, "repair")).toBeGreaterThan(indexOfLiveAction(s, "inject"));
    expect(indexOfNavigate(s, "/app/quality")).toBeGreaterThan(indexOfLiveAction(s, "repair"));
    expect(indexOfNavigate(s, "/app/pdm")).toBeGreaterThan(indexOfNavigate(s, "/app/quality"));
    const startStream = s.steps.find((x) => x.id === "start-stream")!;
    expect(startStream.actions).toEqual([
      { type: "live", msg: { action: "reset", config: { seed: 7 } } },
      { type: "live", msg: { action: "speed", value: 5 } },       // "a set speed"
      { type: "live", msg: { action: "resume" } },
    ]);
    const inject = s.steps.find((x) => x.id === "inject")!.actions[0];
    expect(inject).toMatchObject({ type: "live", msg: { action: "inject", fault: { type: "bearing_wear" } } });
  });
  it("leaves time for the fault to develop between inject and repair (>= 40 s at 5x playback)", () => {
    const at = (id: string) => DEMO_SCRIPT.steps.find((s) => s.id === id)!.at;
    expect(at("repair") - at("inject")).toBeGreaterThanOrEqual(40);
    expect(at("twin-red")).toBeGreaterThan(at("alerts"));
  });
  it("rejects broken scripts", () => {
    const base = DEMO_SCRIPT.steps;
    const mk = (steps: DemoScript["steps"], endAt = 200): DemoScript => ({ id: "t", title: "t", endAt, steps });
    expect(validateScript(mk([]))).toHaveLength(1);
    expect(validateScript(mk([{ ...base[0], at: 3 }, ...base.slice(1)]))).toContain("the first step must start at 0 s");
    expect(validateScript(mk([base[0], { ...base[1], id: base[0].id }]))).toContain(`duplicate step id '${base[0].id}'`);
    expect(validateScript(mk([base[0], { ...base[1], at: 3 }])).join()).toMatch(/less than 8 s|not later/);
    expect(validateScript(mk([base[0], { ...base[1], at: 0 }])).join()).toMatch(/not later/);
    expect(validateScript(mk([{ ...base[0], body: " " }]))).toContain(`step '${base[0].id}' has an empty caption`);
    expect(validateScript(mk([{ ...base[0], actions: [{ type: "navigate", to: "/elsewhere" }] }])).join()).toMatch(/outside the app/);
    expect(validateScript({ ...DEMO_SCRIPT, endAt: 100 }).join()).toMatch(/should be 180-240/);
  });
});

describe("demo runner (the clock)", () => {
  const ids = (steps: { id: string }[]) => steps.map((s) => s.id);
  it("fires the first step on start and the next ones when their time comes", () => {
    const r = createDemoRunner(DEMO_SCRIPT);
    expect(r.state).toBe("idle");
    expect(ids(r.start())).toEqual(["intro"]);
    expect(r.state).toBe("playing");
    expect(r.tick(11.9)).toEqual([]);
    expect(ids(r.tick(0.1))).toEqual(["open-live"]);
    expect(r.index).toBe(1);
  });
  it("does not advance while paused and continues after resume", () => {
    const r = createDemoRunner(DEMO_SCRIPT);
    r.start();
    r.tick(5);
    r.pause();
    expect(r.state).toBe("paused");
    expect(r.tick(100)).toEqual([]);
    expect(r.elapsed).toBe(5);
    r.resume();
    expect(ids(r.tick(7))).toEqual(["open-live"]);
  });
  it("skip jumps to the next step (also while paused) and stays paused", () => {
    const r = createDemoRunner(DEMO_SCRIPT);
    r.start();
    expect(ids(r.skip())).toEqual(["open-live"]);
    expect(r.elapsed).toBe(12);
    r.pause();
    expect(ids(r.skip())).toEqual(["start-stream"]);
    expect(r.state).toBe("paused");
  });
  it("stop ends it for good", () => {
    const r = createDemoRunner(DEMO_SCRIPT);
    r.start(); r.tick(30); r.stop();
    expect(r.state).toBe("stopped");
    expect(r.tick(500)).toEqual([]);
    expect(r.skip()).toEqual([]);
    r.resume();
    expect(r.state).toBe("stopped");
  });
  it("plays the whole script exactly once, in order, and finishes", () => {
    const r = createDemoRunner(DEMO_SCRIPT);
    const seen = ids(r.start());
    for (let t = 0; t < DEMO_SCRIPT.endAt + 10; t += 0.25) seen.push(...ids(r.tick(0.25)));
    expect(seen).toEqual(DEMO_SCRIPT.steps.map((s) => s.id));
    expect(r.state).toBe("finished");
    expect(r.progress()).toBe(1);
    expect(r.elapsed).toBe(DEMO_SCRIPT.endAt);
  });
  it("one huge tick still fires every step in order", () => {
    const r = createDemoRunner(DEMO_SCRIPT);
    r.start();
    expect(ids(r.tick(1000))).toEqual(DEMO_SCRIPT.steps.slice(1).map((s) => s.id));
  });
  it("ignores bad time deltas and formats the clock", () => {
    const r = createDemoRunner(DEMO_SCRIPT);
    r.start();
    expect(r.tick(-3)).toEqual([]); expect(r.tick(NaN)).toEqual([]);
    expect(r.elapsed).toBe(0);
    expect(formatClock(0)).toBe("0:00"); expect(formatClock(75)).toBe("1:15"); expect(formatClock(232)).toBe("3:52");
  });
});

describe("product tour data", () => {
  it("has unique ids, titles and bodies, and starts with a centred welcome", () => {
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(TOUR_STEPS.length);
    TOUR_STEPS.forEach((s) => { expect(s.title).toBeTruthy(); expect(s.body.length).toBeGreaterThan(20); });
    expect(TOUR_STEPS[0].target).toBeNull();
  });
  it("covers the main pages, and every nav target really exists in the sidebar", () => {
    const navIds = NAV.map((n) => tourId(n.to));
    const targets = TOUR_STEPS.map((s) => s.target).filter(Boolean) as string[];
    targets.filter((t) => t.includes("nav-")).forEach((t) => expect(navIds, t).toContain(t.match(/nav-[a-z]+/)![0]));
    ["live", "simulator", "copilot", "generative", "pdm", "quality"].forEach((p) => expect(targets.join()).toContain(`nav-${p}`));
    expect(targets.join()).toContain("search");
    expect(targets.join()).toContain("help");
  });
  it("derives the sidebar ids from the route", () => {
    expect(tourId("/app")).toBe("nav-overview");
    expect(tourId("/app/live")).toBe("nav-live");
  });
  it("remembers completion in storage and can be reset", () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    expect(tourDone(storage)).toBe(false);
    markTourDone(storage);
    expect(mem.get(TOUR_KEY)).toBe("1");
    expect(tourDone(storage)).toBe(true);
    resetTour(storage);
    expect(tourDone(storage)).toBe(false);
  });
  it("does not crash when storage is blocked", () => {
    const blocked = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => { throw new Error("denied"); } };
    expect(tourDone(blocked)).toBe(false);
    expect(() => markTourDone(blocked)).not.toThrow();
    expect(() => resetTour(blocked)).not.toThrow();
  });
  it("places the card to the right of a sidebar item, below a header button, and centred without a target", () => {
    const vp = { w: 1200, h: 800 };
    const side = cardPosition({ top: 300, left: 12, width: 220, height: 44 }, vp);
    expect(side.left).toBeGreaterThan(232);
    const head = cardPosition({ top: 12, left: 1000, width: 90, height: 40 }, vp);
    expect(head.top).toBeGreaterThan(52);
    expect(head.left + 340).toBeLessThanOrEqual(1200 - 16 + 0.001);
    const mid = cardPosition(null, vp);
    expect(mid.left).toBeCloseTo((1200 - 340) / 2);
  });
});

describe("app bus", () => {
  const live = (a: string): AppCommand => ({ type: "live", msg: { action: a } });
  it("delivers to subscribers and stops after unsubscribe", () => {
    const bus = createBus(); const got: AppCommand[] = [];
    const off = bus.subscribe((c) => got.push(c));
    bus.publish(live("a")); off(); bus.publish(live("b"));
    expect(got).toEqual([live("a")]);
  });
  it("queues commands until the first subscriber and drops stale ones", () => {
    let now = 0;
    const bus = createBus(20, 1000, () => now);
    bus.publish(live("old")); now = 5000; bus.publish(live("fresh"));
    const got: AppCommand[] = [];
    bus.subscribe((c) => got.push(c));
    expect(got).toEqual([live("fresh")]);
  });
  it("keeps only the newest commands when the queue is full, and can be cleared", () => {
    const bus = createBus(2);
    ["1", "2", "3"].forEach((a) => bus.publish(live(a)));
    const got: AppCommand[] = [];
    bus.subscribe((c) => got.push(c));
    expect(got.map((c) => (c.type === "live" ? String(c.msg.action) : ""))).toEqual(["2", "3"]);
    const b2 = createBus(); b2.publish(live("x")); b2.clear();
    const got2: AppCommand[] = []; b2.subscribe((c) => got2.push(c));
    expect(got2).toEqual([]);
  });
  it("exports one shared instance", () => { expect(typeof appBus.publish).toBe("function"); });
});

describe("about page data", () => {
  it("lists the pipeline in the required order", () => {
    expect(PIPELINE.map((n) => n.id)).toEqual(["simulator", "faults", "generative", "quality", "pdm", "dashboard"]);
    expect(INFRA.map((n) => n.id)).toEqual(["fastapi", "websocket", "sqlite"]);
  });
  it("explains the five concepts", () => {
    expect(CONCEPTS.map((c) => c.id)).toEqual(["ar1", "correlation", "rul", "generative", "tstr"]);
  });
  it("AR(1) series are deterministic and phi sets the memory", () => {
    expect(ar1Series(50, 0.9)).toEqual(ar1Series(50, 0.9));
    const white = lag1(ar1Series(4000, 0, 3)), sticky = lag1(ar1Series(4000, 0.9, 3));
    expect(Math.abs(white)).toBeLessThan(0.1);
    expect(sticky).toBeGreaterThan(0.8);
  });
  it("AR(1) series keep the requested standard deviation", () => {
    const v = ar1Series(8000, 0.8, 5, 2);
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
    expect(sd).toBeGreaterThan(1.7); expect(sd).toBeLessThan(2.3);
  });
});
