import { ALERT_COOLDOWN_S, anomalyScore, availability, decimate, initialAlertState, initialTimeline, minHealth, processAlerts, updateTimeline } from "./live";
import type { LiveRow } from "../api/types";

const row = (t_s: number, status: Record<string, "green" | "amber" | "red">, health: Record<string, number> = {}, extra: Record<string, unknown> = {}): LiveRow =>
  ({ t_s, status, health, ...extra }) as LiveRow;
const labels = { forming: "Forming", sealing: "Sealing" };

describe("anomalyScore", () => {
  it("is 100 minus the lowest station health", () => {
    expect(anomalyScore(row(1, {}, { forming: 90, sealing: 35 }))).toBe(65);
    expect(minHealth(row(1, {}, { forming: 90, sealing: 35 }))).toBe(35);
  });
  it("is 0 when there is no data and is clamped to 0-100", () => {
    expect(anomalyScore(undefined)).toBe(0);
    expect(anomalyScore(row(1, {}, {}))).toBe(0);
    expect(anomalyScore(row(1, {}, { a: 130 }))).toBe(0);
    expect(anomalyScore(row(1, {}, { a: -20 }))).toBe(100);
  });
  it("prefers a backend anomaly_score when one is sent", () => {
    expect(anomalyScore(row(1, {}, { forming: 90 }, { anomaly_score: 77 }))).toBe(77);
  });
});

describe("availability", () => {
  it("is the share of running ticks", () => {
    const rows = [row(1, {}, {}, { machine_state: "running" }), row(2, {}, {}, { machine_state: "running" }), row(3, {}, {}, { machine_state: "idle" }), row(4, {}, {}, { machine_state: "running" })];
    expect(availability(rows)).toBe(75);
  });
  it("is null when ticks carry no machine_state", () => expect(availability([row(1, {})])).toBeNull());
});

describe("processAlerts (de-duplication)", () => {
  it("raises an alert when a station gets worse, not when it stays the same", () => {
    const { state, fresh } = processAlerts(initialAlertState(), [
      row(1, { forming: "green" }, { forming: 95 }),
      row(2, { forming: "amber" }, { forming: 70 }),
      row(3, { forming: "amber" }, { forming: 68 }),
      row(4, { forming: "red" }, { forming: 30 }),
      row(5, { forming: "red" }, { forming: 28 }),
    ], labels);
    expect(fresh.map((a) => a.severity)).toEqual(["warning", "critical"]);
    expect(state.alerts[0].message).toMatch(/Forming is in a critical state/);
    expect(state.alerts).toHaveLength(2);
  });
  it("does not alert on recovery", () => {
    const { fresh } = processAlerts(initialAlertState(), [row(1, { forming: "red" }, { forming: 20 }), row(2, { forming: "green" }, { forming: 95 })], labels);
    expect(fresh).toHaveLength(1);
  });
  it("rate-limits a flapping station (same station + severity inside the cooldown)", () => {
    const flap = [0, 1, 2, 3, 4, 5, 6].map((t) => row(t, { forming: t % 2 === 0 ? "red" : "green" }, { forming: t % 2 === 0 ? 20 : 95 }));
    const { fresh } = processAlerts(initialAlertState(), flap, labels);
    expect(fresh).toHaveLength(1);           // t=0 fires, t=2,4,6 are suppressed
  });
  it("fires again once the cooldown has passed", () => {
    const rows = [row(0, { forming: "red" }, { forming: 20 }), row(1, { forming: "green" }, { forming: 95 }),
      row(ALERT_COOLDOWN_S + 5, { forming: "red" }, { forming: 20 })];
    expect(processAlerts(initialAlertState(), rows, labels).fresh).toHaveLength(2);
  });
  it("treats different stations independently", () => {
    const { fresh } = processAlerts(initialAlertState(), [row(1, { forming: "red", sealing: "red" }, { forming: 10, sealing: 12 })], labels);
    expect(fresh.map((a) => a.station).sort()).toEqual(["forming", "sealing"]);
  });
  it("skips ticks it already processed (the rolling window re-delivers them)", () => {
    const rows = [row(1, { forming: "green" }), row(2, { forming: "red" }, { forming: 10 })];
    const first = processAlerts(initialAlertState(), rows, labels);
    const second = processAlerts(first.state, rows, labels);
    expect(second.fresh).toHaveLength(0);
    expect(second.state.alerts).toHaveLength(1);
  });
  it("starts over when time goes backwards (simulation reset)", () => {
    const a = processAlerts(initialAlertState(), [row(100, { forming: "red" }, { forming: 10 })], labels);
    const b = processAlerts(a.state, [row(1, { forming: "red" }, { forming: 10 })], labels);
    expect(b.fresh).toHaveLength(1);
  });
  it("keeps at most 50 alerts, newest first", () => {
    let st = initialAlertState();
    for (let i = 0; i < 80; i++) {
      st = processAlerts(st, [row(i * 100, { forming: "green" }), row(i * 100 + 1, { forming: "red" }, { forming: 10 })], labels).state;
    }
    expect(st.alerts).toHaveLength(50);
    expect(st.alerts[0].t_s).toBeGreaterThan(st.alerts[1].t_s);
  });
});

describe("updateTimeline", () => {
  const f = (t: number, type: string | null, station = "forming") =>
    row(t, {}, {}, { fault_active: type ? 1 : 0, fault_type: type ?? "none", fault_station: type ? station : "none" });
  it("opens a span when a fault starts and closes it when it is repaired", () => {
    const a = updateTimeline(initialTimeline(), [f(1, null), f(2, "bearing_wear"), f(3, "bearing_wear")]);
    expect(a.spans).toEqual([{ type: "bearing_wear", station: "forming", start_s: 2, end_s: null }]);
    const b = updateTimeline(a, [f(4, null)]);
    expect(b.spans[0].end_s).toBe(4);
  });
  it("tracks a second fault in its own span", () => {
    const s = updateTimeline(initialTimeline(), [f(1, "a"), f(2, "b"), f(3, null)]);
    expect(s.spans.map((x) => [x.type, x.start_s, x.end_s])).toEqual([["a", 1, 2], ["b", 2, 3]]);
  });
  it("ignores already-seen ticks and resets when time goes backwards", () => {
    const rows = [f(1, "a"), f(2, "a")];
    const a = updateTimeline(initialTimeline(), rows);
    expect(updateTimeline(a, rows).spans).toBe(a.spans);
    expect(updateTimeline(a, [f(1, "b")]).spans.map((x) => x.type)).toEqual(["b"]);
  });
});

describe("decimate", () => {
  it("returns short arrays untouched and caps long ones, keeping the newest point", () => {
    const a = Array.from({ length: 10 }, (_, i) => i);
    expect(decimate(a, 20)).toBe(a);
    const big = Array.from({ length: 1000 }, (_, i) => i);
    const out = decimate(big, 100);
    expect(out.length).toBeLessThanOrEqual(101);
    expect(out[out.length - 1]).toBe(999);
  });
});
