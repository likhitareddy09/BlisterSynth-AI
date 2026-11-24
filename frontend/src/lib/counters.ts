// Running totals for the control room ("blisters packed since you opened this page"). The live stream only keeps a
// short rolling window of rows, so totals are accumulated from rows that are newer than the last one counted.
import type { LiveRow } from "../api/types";

export const POCKETS_PER_BLISTER = 10;

export interface LineCounters { lastT: number; blisters: number; rejected: number; seconds: number }
export const initialCounters = (): LineCounters => ({ lastT: -Infinity, blisters: 0, rejected: 0, seconds: 0 });

/**
 * Add the new rows to the totals. Line speed is blisters per minute, so each row adds speed / 60 x dt blisters; a blister
 * whose vision count is below 10 pockets counts as rejected. If time goes backwards the simulation was reset: start over.
 */
export function accumulateCounters(prev: LineCounters, rows: LiveRow[]): LineCounters {
  let s = prev;
  if (rows.length && rows[rows.length - 1].t_s < s.lastT) s = initialCounters();
  let { lastT, blisters, rejected, seconds } = s;
  for (const r of rows) {
    if (typeof r.t_s !== "number" || !(r.t_s > lastT)) continue;
    const dt = Number.isFinite(lastT) ? Math.min(5, r.t_s - lastT) : 1;
    const bpm = typeof r.line_speed_bpm === "number" && Number.isFinite(r.line_speed_bpm) ? Math.max(0, r.line_speed_bpm) : 0;
    const made = (bpm / 60) * dt;
    blisters += made;
    const fill = typeof r.pocket_fill_count === "number" ? r.pocket_fill_count : POCKETS_PER_BLISTER;
    if (fill < POCKETS_PER_BLISTER) rejected += made;
    seconds += dt;
    lastT = r.t_s;
  }
  return { lastT, blisters, rejected, seconds };
}

/** 754 -> "12:34", 3725 -> "1:02:05". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

/** Remaining useful life in words: 500 -> "8 min 20 s", 45 -> "45 s". */
export function rulText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60), r = s % 60;
  if (m < 60) return r ? `${m} min ${r} s` : `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}
