import { ArrowRight, Brain, FlaskConical, Layers, Play, ShieldCheck, Sparkles, Timer } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { api } from "../api/client";
import { useLiveStream } from "../api/stream";
import { useLoad } from "../components/common";
import MiniLine from "../components/twin/MiniLine";
import { Badge, Button, Card, DialGauge, EmptyState, PageHeader, Skeleton, StatCard } from "../components/ui";
import type { ShellContext } from "../layout/AppShell";
import { accumulateCounters, clock, initialCounters, rulText } from "../lib/counters";
import { anomalyScore, availability, minHealth } from "../lib/live";
import { useCountUp } from "../hooks/useCountUp";

const OK = "#54B88C", WARN = "#E2A846", BAD = "#D97A5E";

/** "4 min ago" style time for the recent-runs list. */
function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(s)) return "";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

/** The single most important number on the screen: health of the worst station right now. */
function HealthHero({ health, sentence, tone }: { health: number | null; sentence: string; tone: "ok" | "warn" | "bad" | "idle" }) {
  const shown = useCountUp(health ?? 0, 600);
  const color = tone === "bad" ? "text-[#F0A48C]" : tone === "warn" ? "text-[#F2C46D]" : "text-white";
  return (
    <div>
      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60">Line health | worst station</p>
      <div className="mt-1 flex items-end gap-2">
        <span className={`font-display text-[5.5rem] font-extrabold leading-none tabular-nums tracking-tight sm:text-[7rem] ${color}`} aria-hidden>
          {health === null ? "--" : Math.round(shown)}
        </span>
        <span className="mb-3 font-mono text-sm text-white/55" aria-hidden>/100</span>
        <span className="sr-only">Line health {health === null ? "not available yet" : `${Math.round(health)} out of 100`}</span>
      </div>
      <p className={`mt-2 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold ${tone === "bad" ? "bg-[#D97A5E]/20 text-[#F0A48C]" : tone === "warn" ? "bg-[#E2A846]/20 text-[#F2C46D]" : tone === "ok" ? "bg-[#54B88C]/20 text-[#8FE0BC]" : "bg-white/10 text-white/70"}`} role="status">
        <span className={`h-2 w-2 rounded-full ${tone === "bad" ? "twin-pulse bg-[#F0A48C]" : tone === "warn" ? "bg-[#F2C46D]" : tone === "ok" ? "bg-[#8FE0BC]" : "bg-white/50"}`} aria-hidden />
        {sentence}
      </p>
    </div>
  );
}

function Counter({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate font-mono text-xl font-bold tabular-nums text-white sm:text-2xl">{value}</div>
      <div className="mt-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-white/55">{label}</div>
    </div>
  );
}

export default function Overview() {
  const { overview, offline, refreshKey } = useOutletContext<ShellContext>();
  const nav = useNavigate();
  const runs = useLoad(api.runs, [refreshKey]);
  const gen = useLoad(api.genModels, [refreshKey]);
  const pdm = useLoad(api.pdmModels, [refreshKey]);
  const live = useLiveStream(30, { batch: true, flushMs: 250 });
  const last = live.rows[live.rows.length - 1];
  const loadingOverview = !overview && !offline;

  // running totals that outlive the 30-row window
  const totals = useRef(initialCounters());
  const [counters, setCounters] = useState(totals.current);
  useEffect(() => {
    if (!live.rows.length) return;
    totals.current = accumulateCounters(totals.current, live.rows);
    setCounters(totals.current);
  }, [live.rows]);

  const health = minHealth(last);
  const worst = useMemo(() => {
    if (!last) return null;
    let key: string | null = null, h = Infinity;
    for (const [k, v] of Object.entries(last.health ?? {})) if (typeof v === "number" && v < h) { h = v; key = k; }
    return key ? live.stations.find((s) => s.key === key) ?? { key, label: key, sensors: [] } : null;
  }, [last, live.stations]);
  const worstStatus = worst ? last?.status?.[worst.key] : undefined;
  const tone = !last ? "idle" : worstStatus === "red" ? "bad" : worstStatus === "amber" ? "warn" : "ok";
  const sentence = !last ? (live.status === "open" ? "Waiting for the first readings" : "Connecting to the live stream")
    : tone === "bad" ? `${worst?.label} is critical` : tone === "warn" ? `${worst?.label} is degrading` : `All ${live.stations.length || 7} stations healthy`;
  const faultActive = !!last && Number(last.fault_active) === 1;
  const rulRaw = last?.rul_s;
  const rul = faultActive && typeof rulRaw === "number" && Number.isFinite(rulRaw) ? rulRaw : null;
  const speed = typeof last?.line_speed_bpm === "number" ? last.line_speed_bpm : null;

  return (
    <div className="space-y-6">
      <PageHeader title="Overview" subtitle="The control room: the live line first, then everything you have generated and trained."
        actions={<Button onClick={() => nav("/app/live")}><Play className="h-4 w-4" aria-hidden />Open live twin</Button>} />

      <section aria-label="Control room" className="relative overflow-hidden rounded-4xl bg-deep p-5 text-white shadow-float sm:p-7">
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.14]" style={{ backgroundImage: "radial-gradient(rgb(255 255 255 / 0.6) 1px, transparent 1px)", backgroundSize: "20px 20px" }} />
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#7FE0C8]/10 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-white/60">
          <span>Line 01 | blister packaging | simulated stream</span>
          <span className="inline-flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${live.status === "open" ? "bg-[#8FE0BC]" : live.status === "connecting" ? "animate-pulse bg-[#F2C46D]" : "animate-pulse bg-[#F0A48C]"}`} aria-hidden />
            {live.status === "open" ? `streaming | t ${clock(typeof last?.t_s === "number" ? last.t_s : 0)}` : live.status === "connecting" ? "connecting" : "offline - retrying"}
          </span>
        </div>

        <div className="relative mt-5 grid gap-7 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.5fr)] lg:gap-10">
          <div className="flex flex-col justify-between gap-6">
            <HealthHero health={health} sentence={sentence} tone={tone} />
            {rul !== null ? (
              <div className="rounded-3xl border border-[#D97A5E]/40 bg-[#D97A5E]/10 p-4">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[#F0A48C]">Active fault | {String(last?.fault_type ?? "").replace(/_/g, " ")}</p>
                <p className="mt-1 text-sm text-white/80">Time to failure (simulator ground truth): <strong className="font-mono text-white">{rulText(rul)}</strong></p>
              </div>
            ) : (
              <p className="text-sm leading-relaxed text-white/60">The number above is the health of the weakest of the 7 stations, so a single failing part cannot hide behind six healthy ones.</p>
            )}
          </div>

          <div className="min-w-0 space-y-5">
            <button type="button" onClick={() => nav("/app/live")} className="press block w-full rounded-3xl bg-white/[0.04] p-2 text-left ring-1 ring-white/10 hover:bg-white/[0.07]" aria-label="Open the live monitor">
              <MiniLine status={last?.status ?? {}} health={last?.health ?? {}} speed={speed ?? (last ? 0 : 220)} tone="dark" showHealth className="w-full" label="Live line status" />
            </button>
            <div className="grid grid-cols-3 gap-2 sm:gap-4">
              <DialGauge label="Line speed" value={speed} min={0} max={300} unit="bpm" bands={[{ from: 200, to: 240, color: OK }]} />
              <DialGauge label="Availability" value={availability(live.rows)} unit="%" bands={[{ from: 0, to: 50, color: BAD }, { from: 50, to: 80, color: WARN }, { from: 80, to: 100, color: OK }]} />
              <DialGauge label="Anomaly" value={last ? anomalyScore(last) : null} bands={[{ from: 0, to: 30, color: OK }, { from: 30, to: 60, color: WARN }, { from: 60, to: 100, color: BAD }]} />
            </div>
          </div>
        </div>

        <div className="relative mt-6 grid grid-cols-3 gap-4 border-t border-white/10 pt-5">
          <Counter label="Blisters packed" value={Math.floor(counters.blisters).toLocaleString()} />
          <Counter label="Rejected by vision" value={Math.floor(counters.rejected).toLocaleString()} />
          <Counter label="Watched for" value={clock(counters.seconds)} />
        </div>
        <p className="relative mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">Totals count from the moment you opened this page</p>
      </section>

      <section aria-label="Lab inventory" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {loadingOverview ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[92px]" />) : (
          <>
            <StatCard icon={<Layers className="h-6 w-6" />} label="Saved runs" value={overview?.runs.total ?? null} className="!p-4 sm:!p-5 [&>span:first-child]:hidden sm:[&>span:first-child]:grid" />
            <StatCard icon={<Sparkles className="h-6 w-6" />} label="Generative models" value={overview?.generative_models ?? null} className="!p-4 sm:!p-5 [&>span:first-child]:hidden sm:[&>span:first-child]:grid" />
            <StatCard icon={<ShieldCheck className="h-6 w-6" />} label="PdM models" value={overview?.pdm_models ?? null} className="!p-4 sm:!p-5 [&>span:first-child]:hidden sm:[&>span:first-child]:grid" />
            <StatCard icon={<Timer className="h-6 w-6" />} label="Training jobs" value={overview?.active_jobs ?? null} hint={overview?.active_jobs ? "running now" : "idle"} className="!p-4 sm:!p-5 [&>span:first-child]:hidden sm:[&>span:first-child]:grid" />
          </>
        )}
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card title="Recent runs" actions={<Button variant="ghost" size="sm" onClick={() => nav("/app/runs")}>View all<ArrowRight className="h-3.5 w-3.5" aria-hidden /></Button>}>
          {runs.data === null && !runs.error && <Skeleton lines={3} />}
          {runs.data?.length === 0 && <EmptyState icon={<FlaskConical className="h-6 w-6" />} title="No runs yet" hint="Simulate your first run to see it here." action={<Button size="sm" onClick={() => nav("/app/simulator")}>Open simulator</Button>} />}
          {(runs.data?.length ?? 0) > 0 && (
            <ul className="divide-y divide-line/60">
              {(runs.data ?? []).slice(0, 5).map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="truncate font-medium">{r.name}</p>
                    <p className="truncate font-mono text-[11px] text-soft">{r.id}</p>
                  </div>
                  <Badge tone={r.kind === "physics" ? "teal" : r.kind === "generative" ? "green" : "neutral"}>{r.kind}</Badge>
                  <span className="w-24 text-right font-mono text-xs tabular-nums text-soft">{r.n_rows.toLocaleString()} rows</span>
                  <span className="w-24 text-right text-xs text-soft">{ago(r.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="min-w-0 space-y-5">
          <Card title="Models" actions={<Button variant="ghost" size="sm" onClick={() => nav("/app/generative")}>Manage<ArrowRight className="h-3.5 w-3.5" aria-hidden /></Button>}>
            {(gen.data?.length ?? 0) + (pdm.data?.length ?? 0) === 0 ? (
              <EmptyState icon={<Sparkles className="h-6 w-6" />} title="No models yet" hint="Train a generator or a PdM model and it will show up here." />
            ) : (
              <ul className="space-y-2">
                {(gen.data ?? []).slice(0, 3).map((m) => (
                  <li key={m.id}>
                    <button type="button" onClick={() => nav("/app/generative")} className="press flex w-full items-center gap-3 rounded-2xl bg-tint px-3 py-2.5 text-left hover:bg-pastel-blue">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface text-primary"><Sparkles className="h-4 w-4" aria-hidden /></span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{m.name}</span><span className="block text-xs text-soft">generator | generate data</span></span>
                      <Badge tone="teal">{m.kind}</Badge>
                    </button>
                  </li>
                ))}
                {(pdm.data ?? []).slice(0, 3).map((m) => (
                  <li key={m.id}>
                    <button type="button" onClick={() => nav("/app/pdm")} className="press flex w-full items-center gap-3 rounded-2xl bg-tint px-3 py-2.5 text-left hover:bg-pastel-green">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface text-primary"><ShieldCheck className="h-4 w-4" aria-hidden /></span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{m.name}</span><span className="block text-xs text-soft">trained on {m.train_source} | predict</span></span>
                      <Badge tone="green">{m.task}</Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Quick actions">
            <div className="grid gap-2">
              <Button variant="secondary" onClick={() => nav("/app/simulator")}><FlaskConical className="h-4 w-4" aria-hidden />Simulate a run with faults</Button>
              <Button variant="secondary" onClick={() => nav("/app/generative")}><Brain className="h-4 w-4" aria-hidden />Train a generative model</Button>
              <Button variant="secondary" onClick={() => nav("/app/pdm")}><ShieldCheck className="h-4 w-4" aria-hidden />Train a PdM model</Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
