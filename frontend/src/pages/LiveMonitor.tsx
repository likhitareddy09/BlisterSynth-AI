import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveStream } from "../api/stream";
import { formatValue } from "../lib/chart";
import { appBus } from "../lib/bus";
import { stationVisual } from "../lib/twin";
import { useLiveInsights } from "../hooks/useLiveInsights";
import type { Alert } from "../lib/live";
import { ErrorBanner } from "../components/common";
import AlertsFeed from "../components/live/AlertsFeed";
import AnomalyCard from "../components/live/AnomalyCard";
import ConnectionBadge from "../components/live/ConnectionBadge";
import Controls from "../components/live/Controls";
import FaultTimeline from "../components/live/FaultTimeline";
import KpiStrip from "../components/live/KpiStrip";
import SensorCharts from "../components/live/SensorCharts";
import StationPanel from "../components/live/StationPanel";
import DigitalTwin from "../components/twin/DigitalTwin";
import { Card, PageHeader, useToast } from "../components/ui";

const DEFAULT_PICKS = ["forming_temp_c", "vib_x_mm_s"];
const WINDOW = 300;                // newest N ticks kept in memory

export default function LiveMonitor() {
  // batch: ticks are buffered and flushed on animation frames, so 100x playback does not freeze the page
  const live = useLiveStream(WINDOW, { batch: true, flushMs: 100 });
  const toast = useToast();
  const [picked, setPicked] = useState<string[] | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const onAlert = useCallback((a: Alert) => {
    if (a.severity === "critical") toast.push({ title: `${a.label} went red`, message: a.message, tone: "error" });
  }, [toast]);
  const { alerts, spans, clearAlerts } = useLiveInsights(live.rows, live.stations, onAlert);

  // Commands from the command palette and the demo ("inject a fault", "resume", ...) arrive on the app bus. They may arrive
  // before the WebSocket has finished connecting (we just navigated here), so they wait in a small queue until it is open.
  const waiting = useRef<Record<string, unknown>[]>([]);
  const statusRef = useRef(live.status);
  statusRef.current = live.status;
  const flush = useCallback(() => {
    while (waiting.current.length && statusRef.current === "open") live.send(waiting.current.shift()!);
  }, [live.send]);
  useEffect(() => appBus.subscribe((cmd) => { if (cmd.type === "live") { waiting.current.push(cmd.msg); flush(); } }), [flush]);
  useEffect(() => { flush(); }, [live.status, flush]);

  const last = live.rows[live.rows.length - 1];
  const selectedSensors = useMemo(() => {
    if (picked) return picked;
    const keys = live.sensors.map((s) => s.key);
    const d = DEFAULT_PICKS.filter((k) => keys.includes(k));
    return d.length ? d : keys.slice(0, 2);
  }, [picked, live.sensors]);
  // nothing pinned or hovered: show the weakest station, so the panel is never an empty box (and phones, which cannot hover, see something)
  const worstKey = useMemo(() => {
    let key: string | null = null, h = Infinity;
    for (const [k, v] of Object.entries(last?.health ?? {})) if (typeof v === "number" && v < h) { h = v; key = k; }
    return key;
  }, [last]);
  const panelKey = pinned ?? hovered ?? worstKey;
  const panelStation = live.stations.find((s) => s.key === panelKey) ?? null;
  const connected = live.status === "open";

  return (
    <div className="space-y-5">
      <PageHeader title="Live monitor" subtitle="Digital twin of the blister line, streamed over WebSocket. Inject a fault and watch the stations react."
        actions={<>
          <ConnectionBadge status={live.status} />
          {last && <span className="rounded-full bg-surface px-3 py-1.5 text-sm text-soft shadow-card">t = {formatValue(last.t_s, 0)} s | state: {String(last.machine_state ?? "-")}</span>}
        </>} />
      <ErrorBanner error={live.error} />
      {live.notice && <div className="banner info rounded-2xl bg-teal/10 px-4 py-2.5 text-sm text-teal" role="status">{live.notice}</div>}

      <KpiStrip rows={live.rows} stations={live.stations} />

      <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
        <Card title="Digital twin" actions={<span className="text-xs text-soft"><span className="hidden sm:inline">hover or click a station</span><span className="sm:hidden">swipe to see all 7 stations</span></span>} className="overflow-hidden">
          <div className="-mx-1 snap-x overflow-x-auto overscroll-x-contain [mask-image:linear-gradient(90deg,#000_88%,transparent)] sm:[mask-image:none]"><div className="min-w-[640px]">
            <DigitalTwin stations={live.stations} last={last} selected={pinned} onSelect={setPinned} onHover={setHovered} />
          </div></div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Station health">
            {live.stations.map((st) => {
              const status = last?.status?.[st.key] ?? "idle";
              const h = last?.health?.[st.key];
              return (
                <button key={st.key} onClick={() => setPinned(pinned === st.key ? null : st.key)}
                  className={`station ${status} press inline-flex min-h-[36px] items-center justify-between gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${status === "red" ? "bg-rust/15 text-rust" : status === "amber" ? "bg-warn/15 text-warn" : status === "green" ? "bg-ok/15 text-ok" : "bg-tint text-soft"}`}>
                  <span className="truncate">{st.label}</span><span className="tabular-nums">{typeof h === "number" ? Math.round(h) : "-"}</span>
                </button>
              );
            })}
            {live.stations.length === 0 && <p className="text-sm text-soft">Waiting for the stream...</p>}
          </div>
          {last && Number(last.fault_active) === 1 ? (
            <p className="warn mt-3 rounded-2xl bg-rust/10 px-3 py-2 text-sm text-rust">
              Fault active: {String(last.fault_type)} (RUL {formatValue(last.rul_s, 0)} s)
            </p>
          ) : null}
        </Card>

        <Card className="min-h-[18rem]" aria-label="Station details">
          {panelStation ? (
            <>
              {!pinned && !hovered && <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-soft">Weakest station now</p>}
              <StationPanel station={panelStation} sensors={live.sensors} rows={live.rows} onClose={pinned ? () => setPinned(null) : undefined} />
            </>
          ) : (
            <div className="grid h-full place-items-center text-center text-sm text-soft">Hover or click a station on the twin to see its sensors, health and active fault.</div>
          )}
        </Card>
      </div>

      <Controls connected={connected} paused={live.paused} speed={live.speed} faults={live.faults} send={live.send} />

      <div className="grid gap-5 xl:grid-cols-[1fr_20rem]">
        <SensorCharts rows={live.rows} sensors={live.sensors} selected={selectedSensors} onChange={setPicked} />
        <AnomalyCard rows={live.rows} />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <AlertsFeed alerts={alerts} onClear={clearAlerts} />
        <FaultTimeline spans={spans} faultTypes={live.faults?.fault_types ?? []} now={last?.t_s ?? 0} />
      </div>
      {/* keep stationVisual in the bundle for the legend below */}
      <p className="text-center text-xs text-soft">
        Colours: <span className="text-ok">{stationVisual("green").label}</span> | <span className="text-warn">{stationVisual("amber").label}</span> | <span className="text-rust">{stationVisual("red").label}</span> (red pulses)
      </p>
    </div>
  );
}
