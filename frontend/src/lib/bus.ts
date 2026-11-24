// A tiny publish/subscribe channel so things that live far apart in the component tree (the command palette, the demo
// player) can tell a page to do something - e.g. "inject a bearing-wear fault" on the Live page.
//
// If nobody is listening yet (the page is still mounting after a route change) the command waits in a short queue and is
// delivered to the first subscriber. Plain TypeScript: no React, so it is easy to unit-test.

/** Everything the app can ask a page to do. */
export type AppCommand =
  | { type: "live"; msg: Record<string, unknown> }          // forwarded to the live WebSocket (same JSON as /ws/stream expects)
  | { type: "ui"; target: "quality:run" | "pdm:diagnostics" };  // press a page's main button

type Handler = (cmd: AppCommand) => void;

export interface Bus {
  publish: (cmd: AppCommand) => void;
  subscribe: (fn: Handler) => () => void;
  /** Drop everything that is waiting (used when the demo is stopped). */
  clear: () => void;
}

export function createBus(maxQueued = 20, maxAgeMs = 15_000, now: () => number = Date.now): Bus {
  const handlers = new Set<Handler>();
  let queue: { cmd: AppCommand; at: number }[] = [];
  return {
    publish(cmd) {
      if (handlers.size === 0) {
        queue = [...queue, { cmd, at: now() }].slice(-maxQueued);
        return;
      }
      handlers.forEach((h) => h(cmd));
    },
    subscribe(fn) {
      handlers.add(fn);
      const waiting = queue.filter((q) => now() - q.at <= maxAgeMs);    // stale commands are dropped, not replayed
      queue = [];
      waiting.forEach((q) => fn(q.cmd));
      return () => { handlers.delete(fn); };
    },
    clear() { queue = []; },
  };
}

/** The one bus the whole app shares. */
export const appBus: Bus = createBus();
