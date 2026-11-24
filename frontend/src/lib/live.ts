// Pure logic for the live dashboard (no React) so it is easy to unit-test.
import type { LiveRow } from "../api/types";

export type Status = "green" | "amber" | "red";
const RANK: Record<Status, number> = { green: 0, amber: 1, red: 2 };

/** Lowest station health in a tick, or null when the tick carries no health. */
export function minHealth(row?: LiveRow | null): number | null {
  const vals = Object.values(row?.health ?? {}).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return vals.length ? Math.min(...vals) : null;
}

/**
 * Anomaly score 0-100 (higher = worse). The backend does not send one, so it is computed on the
 * client as 100 - min(station health). If a tick ever carries its own numeric `anomaly_score`, that wins.
 */
export function anomalyScore(row?: LiveRow | null): number {
  const own = row?.anomaly_score;
  if (typeof own === "number" && Number.isFinite(own)) return Math.max(0, Math.min(100, own));
  const m = minHealth(row);
  return m === null ? 0 : Math.max(0, Math.min(100, 100 - m));
}

/** Share (0-100) of ticks in which the machine was "running" - an OEE-style availability figure. */
export function availability(rows: LiveRow[]): number | null {
  let known = 0, running = 0;
  for (const r of rows) {
    if (typeof r.machine_state === "string") { known++; if (r.machine_state === "running") running++; }
  }
  return known ? (running / known) * 100 : null;
}

// ---------------- alerts ----------------
export type Severity = "warning" | "critical";
export interface Alert {
  id: string; t_s: number; station: string; label: string; severity: Severity; health: number; message: string;
}
export interface AlertState {
  lastStatus: Record<string, Status>;     // last status seen per station
  lastFired: Record<string, number>;      // "station:severity" -> t_s of the last alert (for rate limiting)
  lastT: number;                          // newest t_s already processed
  seq: number;
  alerts: Alert[];                        // newest first
}
export const ALERT_COOLDOWN_S = 30;       // same station + severity at most once per 30 simulated seconds
export const MAX_ALERTS = 50;

export const initialAlertState = (): AlertState => ({ lastStatus: {}, lastFired: {}, lastT: -Infinity, seq: 0, alerts: [] });

/**
 * Feed new ticks in. An alert fires when a station gets WORSE (green->amber, amber->red, green->red).
 * Duplicates are rate-limited: a flapping station cannot raise the same alert again within ALERT_COOLDOWN_S.
 * Already-processed ticks are skipped, and if the newest tick is older than what we have seen (simulation reset) everything is cleared.
 */
export function processAlerts(
  prev: AlertState, rows: LiveRow[], labels: Record<string, string>, cooldown = ALERT_COOLDOWN_S,
): { state: AlertState; fresh: Alert[] } {
  let state = prev;
  const fresh: Alert[] = [];
  // Reset detection: the rolling window re-delivers OLD ticks every time, so only the NEWEST tick tells us
  // whether time went backwards (a simulation reset).
  if (rows.length && rows[rows.length - 1].t_s < state.lastT) state = initialAlertState();
  for (const row of rows) {
    if (row.t_s <= state.lastT) continue;                               // already seen
    const lastStatus = { ...state.lastStatus };
    const lastFired = { ...state.lastFired };
    let seq = state.seq;
    let alerts = state.alerts;
    for (const [station, status] of Object.entries(row.status ?? {}) as [string, Status][]) {
      const before = lastStatus[station] ?? "green";
      lastStatus[station] = status;
      if (RANK[status] <= RANK[before] || status === "green") continue;       // only worsening counts
      const severity: Severity = status === "red" ? "critical" : "warning";
      const key = `${station}:${severity}`;
      const last = lastFired[key];
      if (last !== undefined && row.t_s - last < cooldown) continue;          // rate-limited duplicate
      lastFired[key] = row.t_s;
      const health = row.health?.[station] ?? 0;
      const label = labels[station] ?? station;
      const alert: Alert = {
        id: `a${++seq}`, t_s: row.t_s, station, label, severity, health,
        message: severity === "critical" ? `${label} is in a critical state (health ${Math.round(health)})`
          : `${label} health is degrading (${Math.round(health)})`,
      };
      alerts = [alert, ...alerts].slice(0, MAX_ALERTS);
      fresh.push(alert);
    }
    state = { lastStatus, lastFired, lastT: row.t_s, seq, alerts };
  }
  return { state, fresh };
}

// ---------------- fault timeline ----------------
export interface FaultSpan { type: string; station: string; start_s: number; end_s: number | null }
export interface TimelineState { spans: FaultSpan[]; lastT: number }
export const initialTimeline = (): TimelineState => ({ spans: [], lastT: -Infinity });

/**
 * Build swim-lane spans from the ground-truth labels in each tick: a span opens when a fault type becomes the
 * active one and closes (end_s set = repaired) when it stops being active. `end_s === null` means still active.
 */
export function updateTimeline(prev: TimelineState, rows: LiveRow[]): TimelineState {
  let state = prev;
  if (rows.length && rows[rows.length - 1].t_s < state.lastT) state = initialTimeline();   // reset (see processAlerts)
  for (const row of rows) {
    if (row.t_s <= state.lastT) continue;
    const active = Number(row.fault_active) === 1 && typeof row.fault_type === "string" && row.fault_type !== "none";
    const type = active ? String(row.fault_type) : null;
    let spans = state.spans;
    let changed = false;
    const next = spans.map((s) => {
      if (s.end_s === null && s.type !== type) { changed = true; return { ...s, end_s: row.t_s }; }
      return s;
    });
    if (changed) spans = next;
    if (type && !spans.some((s) => s.end_s === null && s.type === type)) {
      spans = [...spans, { type, station: String(row.fault_station ?? ""), start_s: row.t_s, end_s: null }];
    }
    state = { spans, lastT: row.t_s };
  }
  return state;
}

/** Keep the sensor rows light for charts: every n-th point so a window never exceeds `max` points. */
export function decimate<T>(rows: T[], max: number): T[] {
  if (rows.length <= max) return rows;
  const step = Math.ceil(rows.length / max);
  const out: T[] = [];
  for (let i = 0; i < rows.length; i += step) out.push(rows[i]);
  if (out[out.length - 1] !== rows[rows.length - 1]) out.push(rows[rows.length - 1]);
  return out;
}
