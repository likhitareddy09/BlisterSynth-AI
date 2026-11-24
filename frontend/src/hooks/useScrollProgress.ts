import { useEffect, useRef, type RefObject } from "react";

/** Clamp to 0..1 (NaN becomes 0). */
export const clamp01 = (v: number) => (Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0);

/**
 * Progress through a tall section whose inner box is `position: sticky`: 0 while the section top is still below
 * `offset` (e.g. under a sticky header), 1 once the section has scrolled `height - stuckHeight` further.
 */
export function stickyProgress(top: number, height: number, stuckHeight: number, offset = 0): number {
  const span = height - stuckHeight;
  if (span <= 0) return top <= offset ? 1 : 0;
  return clamp01((offset - top) / span);
}

/**
 * Progress of an element moving up through the viewport: 0 while its top is at or below `start` (a fraction of the
 * viewport height from the top), 1 once its top reaches `end`. Used on phones, where nothing is pinned.
 */
export function travelProgress(top: number, viewport: number, start = 0.92, end = 0.12): number {
  const a = viewport * start, b = viewport * end;
  return a === b ? (top <= a ? 1 : 0) : clamp01((a - top) / (a - b));
}

/**
 * Calls `onProgress(p)` on scroll and resize, at most once per animation frame, with `measure(rect, viewportHeight)`.
 * It never touches React state itself, so the page does not re-render while scrolling; the caller decides what to
 * update (usually SVG attributes through refs, plus a state change when a whole step changes).
 */
export function useScrollProgress<T extends Element>(
  ref: RefObject<T>,
  measure: (rect: DOMRect, viewport: number) => number,
  onProgress: (p: number) => void,
  enabled = true,
) {
  const cb = useRef(onProgress);
  cb.current = onProgress;
  const m = useRef(measure);
  m.current = measure;
  useEffect(() => {
    if (!enabled) return;
    const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (f: FrameRequestCallback) => setTimeout(() => f(Date.now()), 16) as unknown as number;
    const caf = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : (id: number) => clearTimeout(id);
    let frame = 0;
    const run = () => {
      frame = 0;
      const el = ref.current;
      if (el) cb.current(clamp01(m.current(el.getBoundingClientRect(), window.innerHeight)));
    };
    const request = () => { if (!frame) frame = raf(run); };
    run();
    window.addEventListener("scroll", request, { passive: true });
    window.addEventListener("resize", request);
    return () => {
      window.removeEventListener("scroll", request);
      window.removeEventListener("resize", request);
      if (frame) caf(frame);
    };
  }, [ref, enabled]);
}
