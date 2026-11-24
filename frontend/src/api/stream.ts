import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "./client";
import type { FaultCatalog, LiveRow, Sensor, Station, StreamMessage } from "./types";

/** Parse one WebSocket frame. Returns null for anything that is not a valid message (never throws). */
export function parseMessage(raw: unknown): StreamMessage | null {
  if (typeof raw !== "string") return null;
  try {
    const msg = JSON.parse(raw);
    return msg && typeof msg === "object" && typeof msg.type === "string" ? (msg as StreamMessage) : null;
  } catch {
    return null;
  }
}

/** ws://host/ws/stream (or wss:// on https). `apiBase` is VITE_API_URL when the API lives on another origin. */
export function wsUrl(apiBase: string, loc: Pick<Location, "protocol" | "host">): string {
  if (apiBase) return apiBase.replace(/^http/, "ws") + "/ws/stream";
  return `${loc.protocol === "https:" ? "wss:" : "ws:"}//${loc.host}/ws/stream`;
}

/** Append new rows and keep only the newest `max` (a rolling window, so memory stays flat). */
export function appendRows<T>(buffer: T[], rows: T[], max: number): T[] {
  const merged = buffer.concat(rows);
  return merged.length > max ? merged.slice(merged.length - max) : merged;
}

export type StreamStatus = "connecting" | "open" | "closed";
export interface LiveState {
  status: StreamStatus; sensors: Sensor[]; stations: Station[]; faults: FaultCatalog | null;
  rows: LiveRow[]; paused: boolean; speed: number; error: string | null; notice: string | null;
}
const INITIAL: LiveState = {
  status: "connecting", sensors: [], stations: [], faults: null, rows: [], paused: false, speed: 1,
  error: null, notice: null,
};

export interface StreamOptions {
  /** Collect ticks in a buffer and flush them with requestAnimationFrame (dashboard mode, avoids render jank). */
  batch?: boolean;
  /** Minimum milliseconds between flushes in batch mode. */
  flushMs?: number;
}

/**
 * Connects to /ws/stream, keeps a rolling buffer of rows and reconnects after a drop.
 * Default: every tick updates state immediately. With `{ batch: true }` ticks are buffered and flushed at most
 * every `flushMs` (default 100 ms) on an animation frame, so even 100x playback renders smoothly.
 */
export function useLiveStream(maxPoints = 300, options: StreamOptions = {}) {
  const [state, setState] = useState<LiveState>(INITIAL);
  const socket = useRef<WebSocket | null>(null);
  const { batch = false, flushMs = 100 } = options;

  useEffect(() => {
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let pending: LiveRow[] = [];
    let frame: number | undefined;
    let lastFlush = 0;
    const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16) as unknown as number;
    const caf = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : (id: number) => clearTimeout(id);

    const flush = () => {
      frame = undefined;
      if (stopped || pending.length === 0) return;
      if (Date.now() - lastFlush < flushMs) { frame = raf(flush); return; }
      const rows = pending;
      pending = [];
      lastFlush = Date.now();
      setState((s) => ({ ...s, rows: appendRows(s.rows, rows, maxPoints) }));
    };
    const queue = (rows: LiveRow[]) => {
      pending = appendRows(pending, rows, maxPoints);          // never buffer more than the chart can show
      if (frame === undefined) frame = raf(flush);
    };

    const connect = () => {
      setState((s) => ({ ...s, status: "connecting" }));
      const ws = new WebSocket(wsUrl(API_BASE, window.location));
      socket.current = ws;
      ws.onopen = () => setState((s) => ({ ...s, status: "open", error: null }));
      ws.onmessage = (ev) => {
        const msg = parseMessage(ev.data);
        if (!msg) return;
        if (batch && msg.type === "tick") { queue(msg.rows); return; }
        if (msg.type === "reset") pending = [];
        setState((s) => {
          switch (msg.type) {
            case "hello": return { ...s, sensors: msg.sensors, stations: msg.stations, faults: msg.faults };
            case "tick": return { ...s, rows: appendRows(s.rows, msg.rows, maxPoints) };
            case "reset": return { ...s, rows: [], notice: "Simulation reset" };
            case "ack": {
              const f = msg.fault as { type?: string } | undefined;
              const notice = msg.action === "inject" ? `Injected ${f?.type ?? "fault"}`
                : msg.action === "repair" ? "Faults repaired" : s.notice;
              return { ...s, paused: msg.paused, speed: msg.speed, notice };
            }
            case "error": return { ...s, error: msg.message };
            default: return s;
          }
        });
      };
      ws.onclose = () => {
        if (stopped) return;
        setState((s) => ({ ...s, status: "closed" }));
        retry = setTimeout(connect, 2000);
      };
      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      if (frame !== undefined) caf(frame);
      pending = [];
      socket.current?.close();
    };
  }, [maxPoints, batch, flushMs]);

  /** Send a control message ({action: "pause" | "resume" | "speed" | "reset" | "inject" | "repair", ...}). */
  const send = useCallback((msg: Record<string, unknown>) => {
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setState((s) => ({ ...s, error: "Not connected to the live stream" }));
      return false;
    }
    setState((s) => ({ ...s, error: null }));
    ws.send(JSON.stringify(msg));
    return true;
  }, []);

  return { ...state, send };
}
