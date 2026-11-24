import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";

/** Animate a number from its previous value to `target` (ease-out). Jumps straight there for reduced motion. */
export function useCountUp(target: number, durationMs = 900): number {
  const reduce = useReducedMotion();
  const [value, setValue] = useState(reduce ? target : 0);
  useEffect(() => {
    if (reduce || typeof requestAnimationFrame !== "function") { setValue(target); return; }
    const from = value;
    const start = performance.now();
    let id = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs);
      setValue(from + (target - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs, reduce]);
  return value;
}
