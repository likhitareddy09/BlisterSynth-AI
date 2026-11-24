import { BarChart3, Boxes, Play } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import type { QualityReport, SourceRef } from "../api/types";
import { DistChart, EmbeddingScatter, GroupedBars, REAL_COLOR, SYN_COLOR } from "../components/charts/charts";
import Heatmap from "../components/charts/Heatmap";
import { ErrorBanner, useAction, useLoad } from "../components/common";
import GaugeCard from "../components/quality/GaugeCard";
import { useUiTrigger } from "../hooks/useUiTrigger";
import { Badge, Button, Card, EmptyState, Field, InfoTip, PageHeader, Select, Skeleton, Tabs, Toggle } from "../components/ui";
import { corrColor, diffColor, fmtP, ksSummary, maxAbs, pct, shortSensor, utilityText } from "../lib/metrics";

type Mode = "model" | "sources";

const key = (r: SourceRef) => `${r.kind}:${r.id}`;
const parse = (s: string): SourceRef | null => { const [kind, id] = s.split(":"); return (kind === "run" || kind === "dataset") && id ? { kind, id } : null; };

/** Checkbox list of runs + datasets. */
function SourceList({ title, hint, items, selected, onToggle }: {
  title: string; hint: string; items: { ref: SourceRef; label: string; sub: string }[]; selected: string[]; onToggle: (k: string) => void;
}) {
  return (
    <fieldset className="rounded-2xl bg-tint p-3">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      <p className="mb-2 text-xs text-soft">{hint}</p>
      <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
        {items.length === 0 && <p className="text-xs text-soft">Nothing here yet.</p>}
        {items.map((it) => (
          <label key={key(it.ref)} className="flex cursor-pointer items-start gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-surface">
            <input type="checkbox" className="mt-1 accent-[rgb(var(--primary))]" checked={selected.includes(key(it.ref))} onChange={() => onToggle(key(it.ref))} />
            <span className="min-w-0"><span className="block truncate">{it.label}</span><span className="block truncate text-xs text-soft">{it.sub}</span></span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function Quality({ refreshKey = 0 }: { refreshKey?: number }) {
  const [params] = useSearchParams();
  const models = useLoad(api.genModels);
  const runs = useLoad(api.runs, [refreshKey]);
  const datasets = useLoad(api.datasets);
  const sensors = useLoad(api.sensors);

  const preReal = params.get("real");
  const [mode, setMode] = useState<Mode>(preReal ? "sources" : "model");
  const [modelId, setModelId] = useState("");
  const [nRuns, setNRuns] = useState(8);
  const [duration, setDuration] = useState(1800);
  const [tsne, setTsne] = useState(true);
  const [realSel, setRealSel] = useState<string[]>(() => (preReal ? [preReal] : []));
  const [synSel, setSynSel] = useState<string[]>([]);
  const [report, setReport] = useState<QualityReport | null>(null);
  const [sensor, setSensor] = useState("forming_temp_c");
  const [embed, setEmbed] = useState<"pca" | "tsne">("pca");

  useEffect(() => { if (preReal) { setMode("sources"); setRealSel([preReal]); } }, [preReal]);

  const toggle = (set: React.Dispatch<React.SetStateAction<string[]>>) => (k: string) => set((l) => (l.includes(k) ? l.filter((x) => x !== k) : [...l, k]));
  const items = useMemo(() => {
    const r = (runs.data ?? []).map((x) => ({ ref: { kind: "run", id: x.id } as SourceRef, label: x.name, sub: `${x.kind} run | ${x.id}` }));
    const d = (datasets.data ?? []).map((x) => ({ ref: { kind: "dataset", id: x.id } as SourceRef, label: x.name, sub: `uploaded dataset | ${x.n_rows.toLocaleString()} rows${x.has_labels ? " | labelled" : ""}` }));
    return { all: [...d, ...r], real: [...d, ...r.filter((x) => x.sub.startsWith("physics"))], syn: r.filter((x) => x.sub.startsWith("generative")).concat(r.filter((x) => !x.sub.startsWith("generative"))) };
  }, [runs.data, datasets.data]);

  const doRun = useCallback(async () => {
    setReport(null);
    const body = mode === "model"
      ? { model_id: modelId || models.data?.[0]?.id || "", n_runs: nRuns, duration_s: duration, include_tsne: tsne }
      : { real: realSel.map(parse).filter(Boolean) as SourceRef[], synthetic: synSel.map(parse).filter(Boolean) as SourceRef[], include_tsne: tsne };
    setReport(await api.qualityReport(body));
    setEmbed("pca");
  }, [mode, modelId, models.data, nRuns, duration, tsne, realSel, synSel]);
  const [run, busy, error, clear] = useAction(doRun);

  const canRun = mode === "model" ? (models.data?.length ?? 0) > 0 : realSel.length > 0 && synSel.length > 0;
  useUiTrigger("quality:run", canRun && !busy, () => run());      // demo mode presses "Generate report"
  const sensorMeta = sensors.data?.sensors.find((s) => s.key === sensor);
  const ks = report ? ksSummary(report.ks) : null;
  const diff = report?.correlation.diff;

  return (
    <div className="space-y-5">
      <PageHeader title="Synthetic data quality report"
        subtitle="How close is the synthetic data to the real data, and is it useful for training? Fidelity, utility and diversity, with the evidence behind each number." />
      <ErrorBanner error={error ?? models.error ?? runs.error} onClose={clear} />

      <Card title="What do you want to evaluate?" actions={<Tabs label="Report source" value={mode} onChange={setMode} items={[{ value: "model", label: "A generator" }, { value: "sources", label: "Saved runs & datasets" }]} />}>
        {mode === "model" ? (
          (models.data?.length ?? 0) === 0 && models.data !== null ? (
            <EmptyState icon={<Boxes className="h-6 w-6" />} title="No generative model yet" hint="Train a cVAE or TimeGAN in the Generative tab, then come back." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Select label="Generative model" value={modelId || models.data?.[0]?.id || ""} onChange={(e) => setModelId(e.target.value)}>
                {(models.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name} ({m.kind})</option>)}
              </Select>
              <Field label="Matched runs per set" type="number" min={2} max={24} value={nRuns} onChange={(e) => setNRuns(Number(e.target.value))} />
              <Field label="Run length (s)" type="number" min={600} max={7200} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
              <div className="flex items-end gap-3 pb-1"><Toggle checked={tsne} onChange={setTsne} label="Compute t-SNE" /><span className="text-sm">t-SNE</span></div>
              <p className="text-xs text-soft sm:col-span-2 lg:col-span-4">
                The server simulates {nRuns} physics runs and {nRuns} runs from the generator for the same scenarios, plus {nRuns} extra physics runs that both
                classifiers are tested on. Nothing is saved.
              </p>
            </div>
          )
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <SourceList title="Real data" hint="Physics runs or your uploaded Data Lab datasets." items={items.real} selected={realSel} onToggle={toggle(setRealSel)} />
              <SourceList title="Synthetic data" hint="Runs made by a generative model (or any run)." items={items.syn} selected={synSel} onToggle={toggle(setSynSel)} />
            </div>
            <div className="flex items-center gap-3"><Toggle checked={tsne} onChange={setTsne} label="Compute t-SNE" /><span className="text-sm">t-SNE (slower)</span></div>
          </div>
        )}
        <div className="mt-5"><Button loading={busy} disabled={!canRun} onClick={() => run()}><Play className="h-4 w-4" aria-hidden />{busy ? "Analysing..." : "Generate report"}</Button></div>
      </Card>

      {busy && <div className="grid gap-5 md:grid-cols-3"><Skeleton className="h-64" /><Skeleton className="h-64" /><Skeleton className="h-64" /></div>}
      {!report && !busy && <EmptyState icon={<BarChart3 className="h-6 w-6" />} title="No report yet" hint="Choose what to compare and press Generate report." />}

      {report && (
        <>
          <div className="grid gap-5 md:grid-cols-3">
            <GaugeCard title="Fidelity" tint="green" value={report.gauges.fidelity} definition={report.definitions.fidelity}
              detail={<>Marginals {pct(report.fidelity.components.marginals)} | scale {pct(report.fidelity.components.scale)} | correlation {pct(report.fidelity.components.correlation)} | temporal {pct(report.fidelity.components.temporal)}</>} />
            <GaugeCard title="Utility" tint="sand" value={report.gauges.utility} definition={report.definitions.utility} detail={utilityText(report.tstr)}
              extra={report.tstr.baseline_weak ? <p className="mt-2 rounded-xl bg-warn/15 px-2 py-1 text-xs text-warn">{report.tstr.baseline_note}</p> : undefined} />
            <GaugeCard title="Diversity" tint="blue" value={report.gauges.diversity} definition={report.definitions.diversity}
              detail={report.diversity.available ? <>Coverage {pct(report.diversity.coverage)} | recall {pct(report.diversity.recall)} | k = {report.diversity.k}</> : report.diversity.reason}
              extra={report.diversity.available ? <Badge tone={report.diversity.collapse_suspected ? "red" : "green"} className="mt-2">{report.diversity.collapse_suspected ? "mode collapse suspected" : "no mode collapse"}</Badge> : undefined} />
          </div>
          <p className="text-xs text-soft">Compared {report.sizes.real_runs} real vs {report.sizes.syn_runs} synthetic frame(s): {report.sizes.real_samples.toLocaleString()} / {report.sizes.syn_samples.toLocaleString()} running samples, {report.sizes.real_windows} / {report.sizes.syn_windows} feature windows. Fidelity mode: {report.fidelity.mode}.</p>

          <Card title="Per-sensor Kolmogorov-Smirnov test" actions={<><Badge tone={ks!.passed === ks!.total ? "green" : ks!.passed >= ks!.total / 2 ? "amber" : "red"}>{ks!.passed} / {ks!.total} pass</Badge>
            <InfoTip label="How is pass decided?">KS statistic D = the largest gap between the real and synthetic cumulative distributions (0 = identical). A sensor passes when D &lt;= {report.ks_pass_d}. The p-value is shown too, but with thousands of samples it rejects even tiny differences, so the effect size decides.</InfoTip></>}>
            <div className="overflow-x-auto [mask-image:linear-gradient(90deg,#000_85%,transparent)] sm:[mask-image:none]"><table className="table-clean w-full min-w-[640px]">
              <thead><tr><th>Sensor</th><th>KS D</th><th>p-value</th><th>Mean real / syn</th><th>Std real / syn</th><th>Result</th></tr></thead>
              <tbody>{report.ks.map((r) => (
                <tr key={r.sensor}><td>{shortSensor(r.sensor)}</td><td className="tabular-nums">{r.ks.toFixed(3)}</td><td className="tabular-nums text-soft">{fmtP(r.p_value)}</td>
                  <td className="tabular-nums">{r.mean_real.toFixed(2)} / {r.mean_syn.toFixed(2)}</td><td className="tabular-nums">{r.std_real.toFixed(2)} / {r.std_syn.toFixed(2)}</td>
                  <td><Badge tone={r.pass ? "green" : "red"}>{r.pass ? "pass" : "fail"}</Badge></td></tr>))}</tbody>
            </table></div>
          </Card>

          <Card title="Correlation between sensors" actions={<Badge tone="neutral">mean |difference| {report.correlation.mean_abs_diff.toFixed(3)}</Badge>}>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div><h4 className="mb-1 text-center text-sm font-semibold" style={{ color: REAL_COLOR }}>Real</h4><Heatmap labels={report.correlation.sensors} matrix={report.correlation.real} color={corrColor} title="Correlation matrix of real data" /></div>
              <div><h4 className="mb-1 text-center text-sm font-semibold" style={{ color: SYN_COLOR }}>Synthetic</h4><Heatmap labels={report.correlation.sensors} matrix={report.correlation.syn} color={corrColor} title="Correlation matrix of synthetic data" /></div>
              <div><h4 className="mb-1 text-center text-sm font-semibold">Difference (synthetic - real)</h4><Heatmap labels={report.correlation.sensors} matrix={diff!} color={(v) => diffColor(v, maxAbs(diff!, 0.2))} title="Difference of correlation matrices" /></div>
            </div>
            <p className="mt-2 text-xs text-soft">Pearson correlation of running samples. Teal = positive, blue = negative. A good generator keeps the left two maps alike, so the right map stays pale.</p>
          </Card>

          <Card title="Real vs synthetic windows in 2-D" actions={<Tabs label="Embedding" value={embed} onChange={setEmbed} items={[{ value: "pca", label: "PCA" }, { value: "tsne", label: "t-SNE" }]} />}>
            {embed === "pca" ? (
              <>
                <EmbeddingScatter real={report.embeddings.pca.real} syn={report.embeddings.pca.syn} xLabel={`PC1 (${pct(report.embeddings.pca.explained[0])})`} yLabel={`PC2 (${pct(report.embeddings.pca.explained[1])})`} />
                <p className="text-xs text-soft">PCA is fitted on the real windows and the synthetic windows are projected into the same space. Overlapping clouds = the synthetic data lives where the real data lives.</p>
              </>
            ) : report.embeddings.tsne ? (
              <>
                <EmbeddingScatter real={report.embeddings.tsne.real} syn={report.embeddings.tsne.syn} xLabel="t-SNE 1" yLabel="t-SNE 2" />
                <p className="text-xs text-soft">{report.embeddings.tsne_note} Distances between far-apart clusters are not meaningful in t-SNE; look for mixing, not geometry.</p>
              </>
            ) : <EmptyState title="t-SNE not available" hint={report.embeddings.tsne_note ?? "Switch t-SNE on and regenerate."} />}
          </Card>

          <Card title="Distribution of one sensor" actions={<Select aria-label="sensor" className="w-56" value={sensor} onChange={(e) => setSensor(e.target.value)}>
            {Object.keys(report.distributions).map((k) => <option key={k} value={k}>{shortSensor(k)}</option>)}</Select>}>
            <DistChart dist={report.distributions[sensor]} unit={sensorMeta?.unit} />
            <p className="text-xs text-soft">Shaded steps = histogram, lines = kernel density estimate (smooth curve). Running samples only.</p>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="TSTR vs TRTR" actions={<InfoTip label="What are TSTR and TRTR?">TSTR: Train on Synthetic, Test on Real. TRTR: Train on Real, Test on Real (the baseline). Both use the same classifier and are tested on the same real windows. Utility = TSTR / TRTR.</InfoTip>}>
              {report.tstr.available && report.tstr.tstr && report.tstr.trtr ? (
                <>
                  <GroupedBars a={{ key: "tstr", name: "TSTR (train synthetic)", color: SYN_COLOR }} b={{ key: "trtr", name: "TRTR (train real)", color: REAL_COLOR }}
                    data={[{ name: "macro-F1", tstr: report.tstr.tstr.macro_f1, trtr: report.tstr.trtr.macro_f1 }, { name: "accuracy", tstr: report.tstr.tstr.accuracy, trtr: report.tstr.trtr.accuracy },
                      { name: "balanced acc.", tstr: report.tstr.tstr.balanced_accuracy, trtr: report.tstr.trtr.balanced_accuracy }]} />
                  <p className="text-xs text-soft">{report.tstr.n_train_syn} synthetic / {report.tstr.n_train_real} real training windows, {report.tstr.n_test} real test windows ({report.tstr.split}); {report.tstr.classes?.length} classes.</p>
                  {report.tstr.baseline_weak && <p className="mt-2 rounded-xl bg-warn/15 px-3 py-2 text-xs text-warn">{report.tstr.baseline_note}</p>}
                </>
              ) : <EmptyState title="TSTR not available" hint={report.tstr.reason} />}
            </Card>
            <Card title="Diversity and mode-collapse check" actions={<InfoTip label="How is diversity measured?">Coverage: share of real windows that have a synthetic window within their 5-nearest-neighbour radius. Recall: share of real windows inside the synthetic samples' neighbourhoods. Spread ratio: typical nearest-neighbour distance of synthetic divided by real (below 0.5 = suspiciously clustered). Mode coverage: share of real behaviour clusters that synthetic data populates.</InfoTip>}>
              {report.diversity.available ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {[["Coverage", pct(report.diversity.coverage)], ["Recall", pct(report.diversity.recall)], ["Spread ratio", report.diversity.spread_ratio!.toFixed(2)], ["Mode coverage", pct(report.diversity.mode_coverage)]].map(([k, v]) => (
                      <div key={k} className="rounded-2xl bg-tint p-3"><div className="text-xs text-soft">{k}</div><div className="font-display text-xl font-bold tabular-nums">{v}</div></div>))}
                  </div>
                  <div className={`rounded-2xl px-3 py-2 text-sm ${report.diversity.collapse_suspected ? "bg-rust/10 text-rust" : "bg-ok/10 text-ok"}`}>
                    <strong>{report.diversity.collapse_suspected ? "Mode collapse suspected: " : "Looks healthy: "}</strong>{report.diversity.collapse_reason}
                  </div>
                  <div>
                    <h4 className="mb-1 text-xs font-semibold text-soft">Share of windows per real behaviour cluster</h4>
                    <GroupedBars height={180} a={{ key: "syn", name: "Synthetic", color: SYN_COLOR }} b={{ key: "real", name: "Real", color: REAL_COLOR }}
                      data={(report.diversity.cluster_share_real ?? []).map((v, i) => ({ name: `#${i + 1}`, real: v, syn: report.diversity.cluster_share_syn?.[i] ?? 0 }))} domain={[0, 1]} />
                  </div>
                </div>
              ) : <EmptyState title="Diversity not available" hint={report.diversity.reason} />}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
