import { Activity, Scale, TrendingUp } from "lucide-react";
import { useCallback, useState } from "react";
import { api } from "../../api/client";
import type { DiagnosticsResult, FaultDiagnostics, GenModel, ImbalanceResult, PdmModel, RulDiagnostics } from "../../api/types";
import { formatValue } from "../../lib/chart";
import { featureLabel, imbalanceRows, normalizeRows, pct, shareColor, shortSensor } from "../../lib/metrics";
import { GroupedBars, ImportanceChart, REAL_COLOR, RocChart, RulScatter, SYN_COLOR } from "../charts/charts";
import Heatmap from "../charts/Heatmap";
import { ErrorBanner, useAction } from "../common";
import { useUiTrigger } from "../../hooks/useUiTrigger";
import { Badge, Button, Card, EmptyState, Field, InfoTip, Select, Skeleton, StatCard, Tabs } from "../ui";
import { caseFromResult, saveCase } from "../../lib/caseStudy";

// ------------------------------------------------------------------ diagnostics
function FaultVisuals({ d }: { d: FaultDiagnostics }) {
  const [imp, setImp] = useState<"features" | "sensors">("features");
  const norm = normalizeRows(d.confusion_matrix);
  const curves = [
    ...(d.roc_fault_vs_none ? [{ name: "fault vs none", auc: d.roc_fault_vs_none.auc, points: d.roc_fault_vs_none.points, bold: true }] : []),
    ...d.roc_per_class.map((c) => ({ name: c.class.replace(/_/g, " "), auc: c.auc, points: c.points })),
  ];
  const rows = imp === "features" ? d.importance.features.map((f) => ({ name: f.feature, value: f.importance })) : d.importance.by_sensor.slice(0, 14).map((s) => ({ name: shortSensor(s.sensor), value: s.importance }));
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard icon={<Activity className="h-5 w-5" />} label="Macro-F1" value={d.macro_f1} decimals={2} />
        <StatCard icon={<Activity className="h-5 w-5" />} label="Accuracy" value={d.accuracy * 100} decimals={1} suffix="%" />
        <StatCard icon={<Activity className="h-5 w-5" />} label="Balanced accuracy" value={d.balanced_accuracy * 100} decimals={1} suffix="%" />
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div>
          <h4 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">Confusion matrix <InfoTip label="How to read the confusion matrix">Rows = true class, columns = predicted class. Each cell shows the share of that true class (rows add up to 100%). A strong diagonal = good. Hover a cell for the raw count.</InfoTip></h4>
          <Heatmap labels={d.labels} rowLabels={d.labels} matrix={norm} color={shareColor} title="Confusion matrix (row-normalised)" showValues
            format={(v) => (v === 0 ? "" : `${Math.round(v * 100)}`)} />
          <p className="text-xs text-soft">Numbers are % of the true class (row). Counts are in the cell tooltips. {d.n_windows.toLocaleString()} test windows.</p>
        </div>
        <div>
          <h4 className="mb-1 text-sm font-semibold">ROC curves</h4>
          <RocChart curves={curves} />
        </div>
      </div>
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h4 className="flex items-center gap-1.5 text-sm font-semibold">Feature importance <InfoTip label="About permutation importance">{d.importance.method}. A feature matters if shuffling its values makes the classifier clearly worse. Feature names are sensor + statistic (mean, std or delta = trend).</InfoTip></h4>
          <Tabs label="Importance level" value={imp} onChange={setImp} items={[{ value: "features", label: "Top features" }, { value: "sensors", label: "By sensor" }]} />
        </div>
        <ImportanceChart rows={rows} />
      </div>
      <div className="overflow-x-auto"><table className="table-clean w-full min-w-[360px]">
        <thead><tr><th>Class</th><th>Recall</th></tr></thead>
        <tbody>{Object.entries(d.per_class_recall).map(([k, v]) => <tr key={k}><td>{k.replace(/_/g, " ")}</td><td className="tabular-nums">{pct(v)}</td></tr>)}</tbody>
      </table></div>
    </div>
  );
}

function RulVisuals({ d }: { d: RulDiagnostics }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard icon={<TrendingUp className="h-5 w-5" />} label="MAE" value={d.mae_s} decimals={0} suffix=" s" />
        <StatCard icon={<TrendingUp className="h-5 w-5" />} label="R-squared" value={d.r2} decimals={2} />
        <StatCard icon={<TrendingUp className="h-5 w-5" />} label="Test windows" value={d.n_windows} />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <div><h4 className="mb-1 text-sm font-semibold">Predicted vs actual RUL</h4><RulScatter points={d.scatter} max={d.rul_cap_s} />
          <p className="text-xs text-soft">Points on the dashed line are perfect predictions. RUL is capped at {d.rul_cap_s} s.</p></div>
        <div><h4 className="mb-1 text-sm font-semibold">Feature importance (by sensor)</h4>
          <ImportanceChart rows={d.importance.by_sensor.slice(0, 14).map((s) => ({ name: shortSensor(s.sensor), value: s.importance }))} />
          <p className="text-xs text-soft">Top feature: {d.importance.features[0] ? featureLabel(d.importance.features[0].feature) : "-"}.</p></div>
      </div>
    </div>
  );
}

export function DiagnosticsCard({ models }: { models: PdmModel[] }) {
  const [modelId, setModelId] = useState("");
  const [nRuns, setNRuns] = useState(12);
  const [result, setResult] = useState<DiagnosticsResult | null>(null);
  const id = modelId || models[0]?.id || "";
  const doRun = useCallback(async () => { setResult(null); setResult(await api.pdmDiagnostics({ model_id: id, n_runs: nRuns })); }, [id, nRuns]);
  const [run, busy, error, clear] = useAction(doRun);
  useUiTrigger("pdm:diagnostics", models.length > 0 && !busy, () => run());      // demo mode presses "Run diagnostics"
  if (models.length === 0) return null;
  return (
    <Card title="Model diagnostics" actions={<Badge tone="teal">held-out physics runs</Badge>}>
      <ErrorBanner error={error} onClose={clear} />
      <div className="flex flex-wrap items-end gap-3">
        <Select className="min-w-[14rem] flex-1" label="Model" value={id} onChange={(e) => { setModelId(e.target.value); setResult(null); }}>
          {models.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.task})</option>)}
        </Select>
        <Field className="w-32" label="Test runs" type="number" min={4} max={60} value={nRuns} onChange={(e) => setNRuns(Number(e.target.value))} />
        <Button loading={busy} onClick={() => run()}><Activity className="h-4 w-4" aria-hidden />{busy ? "Computing..." : "Run diagnostics"}</Button>
      </div>
      <div className="mt-5">
        {busy && <Skeleton className="h-64" />}
        {!busy && !result && <EmptyState title="No diagnostics yet" hint="Pick a model and run the diagnostics: confusion matrix, ROC curves and feature importance for classifiers; predicted-vs-actual for RUL models." />}
        {result?.task === "fault" && <FaultVisuals d={result} />}
        {result?.task === "rul" && <RulVisuals d={result} />}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ imbalance fix
export function ImbalanceCard({ genModels }: { genModels: GenModel[] }) {
  const [modelId, setModelId] = useState("");
  const [nReal, setNReal] = useState(10);
  const [nFault, setNFault] = useState(2);
  const [nSynth, setNSynth] = useState(24);
  const [result, setResult] = useState<ImbalanceResult | null>(null);
  const id = modelId || genModels[0]?.id || "";
  const doRun = useCallback(async () => {
    setResult(null);
    const res = await api.pdmImbalance({ model_id: id, n_real: nReal, n_fault_real: nFault, n_synth: nSynth });
    setResult(res);
    // the landing page's case-study card shows this, the user's own latest result (never invented numbers)
    saveCase(caseFromResult(res, { n_real: nReal, n_fault_real: nFault, n_synth: nSynth }));
  }, [id, nReal, nFault, nSynth]);
  const [run, busy, error, clear] = useAction(doRun);
  const imp = result?.improvement;
  const better = (imp?.macro_f1_delta ?? 0) > 0.005;
  return (
    <Card title="Imbalance fix: real-only vs real + synthetic" actions={<InfoTip label="What is this experiment?">The same fault classifier is trained twice: (1) on a few real runs where only a couple contain faults, and (2) on those real runs plus synthetic runs from your generator. Both are tested on the same fresh physics runs.</InfoTip>}>
      <ErrorBanner error={error} onClose={clear} />
      {genModels.length === 0 ? <EmptyState icon={<Scale className="h-6 w-6" />} title="Needs a generative model" hint="Train a generator first (Generative tab)." /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Select className="lg:col-span-2" label="Generator" value={id} onChange={(e) => { setModelId(e.target.value); setResult(null); }}>{genModels.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.kind})</option>)}</Select>
            <Field label="Real runs" type="number" min={6} max={40} value={nReal} onChange={(e) => setNReal(Number(e.target.value))} />
            <Field label="...of which with faults" type="number" min={1} max={10} value={nFault} onChange={(e) => setNFault(Number(e.target.value))} />
            <Field label="Synthetic runs added" type="number" min={6} max={80} value={nSynth} onChange={(e) => setNSynth(Number(e.target.value))} />
          </div>
          <div className="mt-4 flex items-center gap-3"><Button loading={busy} onClick={() => run()}><Scale className="h-4 w-4" aria-hidden />{busy ? "Training two classifiers..." : "Run comparison"}</Button>
            <span className="text-xs text-soft">Takes about 10-30 seconds.</span></div>
        </>
      )}
      {busy && <Skeleton className="mt-5 h-48" />}
      {result && imp && (
        <div className="mt-6 space-y-5">
          <div className={`rounded-3xl px-5 py-4 ${better ? "bg-ok/10" : "bg-warn/10"}`} role="status">
            <p className={`font-display text-lg font-bold ${better ? "text-ok" : "text-warn"}`}>{better ? "Improvement" : "No clear improvement"}: {imp.headline}</p>
            <p className="mt-1 text-sm text-soft">{imp.classes_improved} class(es) improved{imp.classes_worse ? `, ${imp.classes_worse} got worse` : ""}. {imp.note}</p>
            <p className="mt-1 text-xs text-soft">Saved as the case study on the landing page.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard icon={<Scale className="h-5 w-5" />} label="Macro-F1, real only" value={result.real_only.macro_f1} decimals={2} />
            <StatCard icon={<Scale className="h-5 w-5" />} label="Macro-F1, real + synthetic" value={result.real_plus_synthetic.macro_f1} decimals={2} />
            <StatCard icon={<TrendingUp className="h-5 w-5" />} label="Change" value={imp.macro_f1_delta} decimals={2} hint={imp.macro_f1_relative !== null ? `${imp.macro_f1_relative > 0 ? "+" : ""}${(imp.macro_f1_relative * 100).toFixed(0)}% relative` : undefined} tone={better ? "default" : "alert"} />
          </div>
          <div>
            <h4 className="mb-1 text-sm font-semibold">Recall per fault class (higher is better)</h4>
            <GroupedBars height={300} a={{ key: "real", name: "Real only", color: SYN_COLOR }} b={{ key: "aug", name: "Real + synthetic", color: REAL_COLOR }} data={imbalanceRows(result)} />
          </div>
          <div className="overflow-x-auto"><table className="table-clean w-full min-w-[420px]">
            <thead><tr><th>Class</th><th>Training windows (real only)</th><th>(real + synthetic)</th><th>Recall change</th></tr></thead>
            <tbody>{imp.classes.map((c) => (
              <tr key={c.class}><td>{c.class.replace(/_/g, " ")}</td><td className="tabular-nums">{result.real_only.train_class_counts[c.class] ?? 0}</td><td className="tabular-nums">{result.real_plus_synthetic.train_class_counts[c.class] ?? 0}</td>
                <td><Badge tone={c.delta > 0.001 ? "green" : c.delta < -0.001 ? "red" : "neutral"}>{c.delta > 0 ? "+" : ""}{formatValue(c.delta * 100, 0)} pts</Badge></td></tr>))}</tbody>
          </table></div>
        </div>
      )}
    </Card>
  );
}
