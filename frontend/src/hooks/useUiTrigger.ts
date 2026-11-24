import { useEffect, useRef, useState } from "react";
import { appBus, type AppCommand } from "../lib/bus";

type UiTarget = Extract<AppCommand, { type: "ui" }>["target"];

/**
 * Lets the demo (or any other part of the app) "press" a page's main button.
 *
 *   useUiTrigger("quality:run", canRun && !busy, () => run());
 *
 * The page may still be loading when the command arrives (models not fetched yet), so the request is remembered and fired as
 * soon as `ready` becomes true. If the page never becomes ready (for example no model has been trained) the request
 * quietly expires after `expireMs` so a model trained later does not suddenly start running by itself.
 */
export function useUiTrigger(target: UiTarget, ready: boolean, fire: () => void, expireMs = 8000) {
  const [wanted, setWanted] = useState(false);
  const fireRef = useRef(fire);
  fireRef.current = fire;

  useEffect(() => appBus.subscribe((cmd) => { if (cmd.type === "ui" && cmd.target === target) setWanted(true); }), [target]);

  useEffect(() => {
    if (!wanted) return;
    if (ready) { setWanted(false); fireRef.current(); return; }
    const t = setTimeout(() => setWanted(false), expireMs);
    return () => clearTimeout(t);
  }, [wanted, ready, expireMs]);
}
