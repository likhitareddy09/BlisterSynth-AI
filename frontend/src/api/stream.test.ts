import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { MockSocket } from "../test/mockSocket";
import { appendRows, parseMessage, useLiveStream, wsUrl } from "./stream";

describe("parseMessage", () => {
  it("parses valid messages", () => expect(parseMessage('{"type":"tick","rows":[]}')).toEqual({ type: "tick", rows: [] }));
  it("ignores junk without throwing", () => {
    expect(parseMessage("not json")).toBeNull();
    expect(parseMessage('{"no":"type"}')).toBeNull();
    expect(parseMessage(42)).toBeNull();
    expect(parseMessage("null")).toBeNull();
  });
});

describe("wsUrl", () => {
  it("uses the page origin", () => {
    expect(wsUrl("", { protocol: "http:", host: "localhost:5173" })).toBe("ws://localhost:5173/ws/stream");
    expect(wsUrl("", { protocol: "https:", host: "x.io" })).toBe("wss://x.io/ws/stream");
  });
  it("uses VITE_API_URL when set", () => expect(wsUrl("http://api:8000", { protocol: "http:", host: "h" })).toBe("ws://api:8000/ws/stream"));
});

describe("appendRows", () => {
  it("keeps only the newest rows", () => expect(appendRows([1, 2, 3], [4, 5], 4)).toEqual([2, 3, 4, 5]));
  it("does not trim below the limit", () => expect(appendRows([1], [2], 5)).toEqual([1, 2]));
});

describe("useLiveStream", () => {
  beforeEach(() => { MockSocket.reset(); vi.stubGlobal("WebSocket", MockSocket); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("processes hello, ticks and acks", () => {
    const { result } = renderHook(() => useLiveStream(3));
    expect(result.current.status).toBe("connecting");
    act(() => MockSocket.last.open());
    expect(result.current.status).toBe("open");
    act(() => MockSocket.last.push({ type: "hello", sensors: [{ key: "a" }], stations: [{ key: "s", label: "S", sensors: [] }], faults: { fault_types: [], profiles: [] }, config: {} }));
    expect(result.current.sensors).toHaveLength(1);
    for (let i = 0; i < 5; i++) act(() => MockSocket.last.push({ type: "tick", rows: [{ t_s: i, health: {}, status: {} }] }));
    expect(result.current.rows.map((r) => r.t_s)).toEqual([2, 3, 4]);   // rolling window of 3
    act(() => MockSocket.last.push({ type: "ack", action: "pause", paused: true, speed: 5 }));
    expect(result.current.paused).toBe(true);
    expect(result.current.speed).toBe(5);
    act(() => MockSocket.last.push({ type: "reset", config: {}, faults: [] }));
    expect(result.current.rows).toEqual([]);
  });

  it("surfaces server errors and ignores malformed frames", () => {
    const { result } = renderHook(() => useLiveStream());
    act(() => MockSocket.last.open());
    act(() => MockSocket.last.onmessage?.({ data: "garbage" }));
    expect(result.current.error).toBeNull();
    act(() => MockSocket.last.push({ type: "error", message: "bad fault" }));
    expect(result.current.error).toBe("bad fault");
  });

  it("sends JSON control messages only while connected", () => {
    const { result } = renderHook(() => useLiveStream());
    let first = true;
    act(() => { first = result.current.send({ action: "pause" }); });
    expect(first).toBe(false);
    expect(result.current.error).toMatch(/Not connected/);
    act(() => MockSocket.last.open());
    let ok = false;
    act(() => { ok = result.current.send({ action: "speed", value: 10 }); });
    expect(ok).toBe(true);
    expect(JSON.parse(MockSocket.last.sent[0])).toEqual({ action: "speed", value: 10 });
  });

  it("reconnects after the socket drops", () => {
    const { result } = renderHook(() => useLiveStream());
    act(() => MockSocket.last.open());
    act(() => MockSocket.last.close());
    expect(result.current.status).toBe("closed");
    expect(MockSocket.instances).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(2100); });
    expect(MockSocket.instances).toHaveLength(2);
  });

  it("does not reconnect after unmount", () => {
    const { unmount } = renderHook(() => useLiveStream());
    unmount();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(MockSocket.instances).toHaveLength(1);
  });
});

describe("useLiveStream batch mode (requestAnimationFrame buffering)", () => {
  beforeEach(() => { MockSocket.reset(); vi.stubGlobal("WebSocket", MockSocket); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("does not re-render per tick: rows appear after the next frame, together", () => {
    const { result } = renderHook(() => useLiveStream(100, { batch: true, flushMs: 0 }));
    act(() => MockSocket.last.open());
    for (let i = 0; i < 50; i++) act(() => MockSocket.last.push({ type: "tick", rows: [{ t_s: i, health: {}, status: {} }] }));
    expect(result.current.rows).toHaveLength(0);            // still buffered
    act(() => { vi.advanceTimersByTime(40); });
    expect(result.current.rows).toHaveLength(50);           // one flush
  });
  it("keeps only the newest maxPoints and honours the minimum flush interval", () => {
    const { result } = renderHook(() => useLiveStream(5, { batch: true, flushMs: 100 }));
    act(() => MockSocket.last.open());
    act(() => MockSocket.last.push({ type: "tick", rows: Array.from({ length: 20 }, (_, i) => ({ t_s: i, health: {}, status: {} })) }));
    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current.rows.map((r) => r.t_s)).toEqual([15, 16, 17, 18, 19]);
  });
  it("drops buffered ticks on reset and cancels the pending frame on unmount", () => {
    const { result, unmount } = renderHook(() => useLiveStream(100, { batch: true, flushMs: 0 }));
    act(() => MockSocket.last.open());
    act(() => MockSocket.last.push({ type: "tick", rows: [{ t_s: 1, health: {}, status: {} }] }));
    act(() => MockSocket.last.push({ type: "reset", config: {}, faults: [] }));
    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current.rows).toHaveLength(0);
    act(() => MockSocket.last.push({ type: "tick", rows: [{ t_s: 2, health: {}, status: {} }] }));
    unmount();
    expect(() => act(() => { vi.advanceTimersByTime(100); })).not.toThrow();
  });
});
