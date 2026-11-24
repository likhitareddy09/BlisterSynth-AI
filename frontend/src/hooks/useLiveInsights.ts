import { useEffect, useRef, useState } from "react";
import type { LiveRow, Station } from "../api/types";
import { initialAlertState, initialTimeline, processAlerts, updateTimeline, type Alert, type FaultSpan } from "../lib/live";

/**
 * Turns the rolling tick buffer into the things the dashboard needs that must OUTLIVE the window:
 * the alerts feed (de-duplicated, rate-limited) and the fault timeline spans.
 * `onAlert` is called once for every brand-new alert (the page uses it to pop a toast).
 */
export function useLiveInsights(rows: LiveRow[], stations: Station[], onAlert?: (a: Alert) => void) {
  const alertState = useRef(initialAlertState());
  const timeline = useRef(initialTimeline());
  const callback = useRef(onAlert);
  callback.current = onAlert;
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [spans, setSpans] = useState<FaultSpan[]>([]);

  useEffect(() => {
    if (rows.length === 0) {
      // the stream was reset (or has not started): forget everything
      if (alertState.current.lastT !== -Infinity) {
        alertState.current = initialAlertState(); timeline.current = initialTimeline(); setAlerts([]); setSpans([]);
      }
      return;
    }
    const labels = Object.fromEntries(stations.map((s) => [s.key, s.label]));
    const a = processAlerts(alertState.current, rows, labels);
    alertState.current = a.state;
    if (a.fresh.length) { setAlerts(a.state.alerts); a.fresh.forEach((x) => callback.current?.(x)); }
    else if (a.state.alerts.length !== alerts.length) setAlerts(a.state.alerts);
    const t = updateTimeline(timeline.current, rows);
    if (t.spans !== timeline.current.spans) setSpans(t.spans);
    timeline.current = t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, stations]);

  const clearAlerts = () => { alertState.current = { ...alertState.current, alerts: [] }; setAlerts([]); };
  return { alerts, spans, clearAlerts };
}
