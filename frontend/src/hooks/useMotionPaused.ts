import { useCallback, useEffect, useState } from "react";

export const MOTION_KEY = "bs-motion";
const CLASS = "motion-paused";

function read(): boolean {
  try { return localStorage.getItem(MOTION_KEY) === "paused"; } catch { return false; }
}

/**
 * "Pause motion" for the looping animations (floating capsules, light rays, ticker, machine parts) - the same idea as
 * the pause button on a carousel. Adds `motion-paused` to <html>; index.css pauses every looping animation under it.
 * Scroll-driven effects keep working because the user is the one moving them.
 */
export function useMotionPaused(): [boolean, () => void] {
  const [paused, setPaused] = useState<boolean>(read);
  useEffect(() => {
    document.documentElement.classList.toggle(CLASS, paused);
    try { localStorage.setItem(MOTION_KEY, paused ? "paused" : "on"); } catch { /* ignore */ }
  }, [paused]);
  useEffect(() => () => { document.documentElement.classList.remove(CLASS); }, []);
  const toggle = useCallback(() => setPaused((p) => !p), []);
  return [paused, toggle];
}
