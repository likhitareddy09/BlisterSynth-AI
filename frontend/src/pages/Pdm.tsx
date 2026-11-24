import { useCallback, useState } from "react";
import { api } from "../api/client";
import type { PdmPrediction, PdmTrainBody, QualityResult, TstrResult } from "../api/types";
import { formatValue } from "../lib/chart";
import { ErrorBanner, COLORS, useAction, useLoad } from "../components/common";
import { Badge, Button, Card, EmptyState, Field, Gauge, PageHeader, Select, Skeleton } from "../components/ui";
import { FlaskConical, GitCompare, Play, Trash2, Wrench } from "lucide-react";
import LineChart from "../components/LineChart";
import { DiagnosticsCard, ImbalanceCard } from "../components/pdm/PdmVisuals";

const metricRows = (m: Record<string, any>) =>
  Object.entries(m).filter(([, v]) => typeof v === "number") as [string, number][];

export default function Pdm({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const pdm = useLoad(api.pdmModels);
  const gen = useLoad(api.genModels);
  const runs = useLoad(api.runs, [refreshKey]);
  const [form, setForm] = useState<PdmTrainBody>({
    task: "fault", name: "My PdM model", train_source: "physics", n_train_runs: 24, n_test_runs: 6, duration_s: 1200, seed: 7,
  });
  const [predModel, setPredModel] = useState("");
  const [predRun, setPredRun] = useState("");
  const [prediction, setPrediction] = useState<PdmPrediction | null>(null);
  const [tstr, setTstr] = useState<TstrResult | null>(null);
  const [realRun, setRealRun] = useState("");
  const [synRun, setSynRun] = useState("");
  const [quality, setQuality] = useState<QualityResult | null>(null);

  const doTrain = useCallback(async () => { await api.pdmTrain(form); pdm.reload(); onChanged(); }, [form, pdm, onChanged]);
  const [train, training, trainError, clear] = useAction(doTrain);
  const doDelete = useCallback(async (id: string) => { if (window.confirm(`Delete ${id}?`)) { await api.pdmDelete(id); pdm.reload(); onChanged(); } }, [pdm, onChanged]);
  const [removeModel, , delError] = useAction(doDelete);
  const doPredict = useCallback(async () => {
    setPrediction(await api.pdmPredict(predModel || pdm.data![0].id, predRun || runs.data![0].id));
  }, [predModel, predRun, pdm.data, runs.data]);
  const [predict, predicting, predError] = useAction(doPredict);
  const doTstr = useCallback(async () => {
    const { name: _n, train_source: _s, ...rest } = form;
    setTstr(await api.pdmTstr({ ...rest, model_id: form.train_source !== "physics" ? form.train_source : gen.data![0].id }));
  }, [form, gen.data]);
  const [runTstr, tstrBusy, tstrError] = useAction(doTstr);
  const doCompare = useCallback(async () => {
    setQuality(await api.qualityCompare(realRun || runs.data![0].id, synRun || runs.data![runs.data!.length > 1 ? 1 : 0].id));
  }, [realRun, synRun, runs.data]);
  const [compare, comparing, cmpError] = useAction(doCompare);

  const pickers = (
    <>
      {(runs.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name} [{r.kind}] {r.id}</option>)}
    </>
  );

  return (
    <div className="space-y-5">
      <PageHeader title="PdM & quality" subtitle="Train predictive-maintenance models, compare physics-trained and synthetic-trained (TSTR), and score synthetic data fidelity." />
      <ErrorBanner error={trainError ?? delError ?? predError ?? tstrError ?? cmpError ?? pdm.error} onClose={clear} />
      <Card title="Train a predictive-maintenance model">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Select label="Task" value={form.task} onChange={(e) => setForm({ ...form, task: e.target.value as PdmTrainBody["task"] })}>
            <option value="fault">Fault classification</option><option value="rul">RUL regression</option>
          </Select>
          <Select label="Training data" value={form.train_source} onChange={(e) => setForm({ ...form, train_source: e.target.value })}>
            <option value="physics">Physics simulator</option>
            {(gen.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name} ({m.kind})</option>)}
          </Select>
          <Field label="Train runs" type="number" min={6} max={300} value={form.n_train_runs} onChange={(e) => setForm({ ...form, n_train_runs: Number(e.target.value) })} />
          <Field label="Test runs" type="number" min={2} max={100} value={form.n_test_runs} onChange={(e) => setForm({ ...form, n_test_runs: Number(e.target.value) })} />
          <Field label="Run length (s)" type="number" min={600} max={7200} value={form.duration_s} onChange={(e) => setForm({ ...form, duration_s: Number(e.target.value) })} />
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button loading={training} onClick={() => train()}><Wrench className="h-4 w-4" aria-hidden />{training ? "Training..." : "Train model"}</Button>
          <Button variant="secondary" loading={tstrBusy} disabled={!gen.data?.length} onClick={() => runTstr()} title="Needs at least one generative model">
            <FlaskConical className="h-4 w-4" aria-hidden />{tstrBusy ? "Running..." : "Run TSTR experiment"}
          </Button>
        </div>
        <p className="mt-3 text-sm text-soft">Training is synchronous and can take several seconds. RUL works best with 100+ train runs.</p>
        {tstr && (
          <div className="mt-4 overflow-x-auto"><table className="table-clean w-full">
            <thead><tr><th>Metric ({tstr.task})</th><th>Physics-trained</th><th>Synthetic-trained</th></tr></thead>
            <tbody>
              {Object.entries(tstr.summary).map(([k, v]) => (
                <tr key={k}><td>{k}</td><td className="tabular-nums">{formatValue(v.physics_trained, 3)}</td><td className="tabular-nums">{formatValue(v.synthetic_trained, 3)}</td></tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>

      <Card title={`PdM models (${pdm.data?.length ?? 0})`}>
        {pdm.data === null && !pdm.error && <Skeleton lines={3} />}
        {pdm.data?.length === 0 && <EmptyState icon={<Wrench className="h-6 w-6" />} title="No models yet" hint="Train one above." />}
        {(pdm.data?.length ?? 0) > 0 && (
          <div className="overflow-x-auto"><table className="table-clean table-stack w-full min-w-[480px]">
            <tbody>
              {(pdm.data ?? []).map((m) => (
                <tr key={m.id}>
                  <td>{m.name}<br /><span className="text-xs text-soft">{m.id}</span></td>
                  <td><Badge tone="teal">{m.task}</Badge> <span className="text-xs text-soft">{m.train_source}</span></td>
                  <td className="stack-full text-soft">{metricRows(m.metrics).slice(0, 3).map(([k, v]) => `${k} ${formatValue(v, 3)}`).join(" | ")}</td>
                  <td className="text-right"><Button variant="danger" size="sm" aria-label={`delete ${m.id}`} onClick={() => removeModel(m.id)}><Trash2 className="h-3.5 w-3.5" aria-hidden />delete</Button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>

      {(pdm.data?.length ?? 0) > 0 && (runs.data?.length ?? 0) > 0 && (
        <Card title="Predict on a saved run">
          <div className="flex flex-wrap items-end gap-3">
            <Select className="min-w-[12rem] flex-1" aria-label="model" label="Model" value={predModel || pdm.data![0].id} onChange={(e) => setPredModel(e.target.value)}>
              {pdm.data!.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.task})</option>)}
            </Select>
            <Select className="min-w-[12rem] flex-1" aria-label="run" label="Run" value={predRun || runs.data![0].id} onChange={(e) => setPredRun(e.target.value)}>{pickers}</Select>
            <Button loading={predicting} onClick={() => predict()}><Play className="h-4 w-4" aria-hidden />Predict</Button>
          </div>
          <div className="mt-4">
            {prediction?.task === "fault" && prediction.p_fault && (
              <LineChart x={prediction.t_s} height={200} yRange={[0, 1]} unit="P(fault)"
                series={[{ name: "P(fault)", color: COLORS[1], values: prediction.p_fault }]} />
            )}
            {prediction?.task === "rul" && prediction.rul_s && (
              <LineChart x={prediction.t_s} height={200} unit="s"
                series={[{ name: "predicted RUL", color: COLORS[0], values: prediction.rul_s }]} />
            )}
          </div>
        </Card>
      )}

      <DiagnosticsCard models={pdm.data ?? []} />
      <ImbalanceCard genModels={gen.data ?? []} />

      {(runs.data?.length ?? 0) > 0 && (
        <Card title="Fidelity: compare a real and a synthetic run">
          <div className="flex flex-wrap items-end gap-3">
            <Select className="min-w-[12rem] flex-1" label="Real" value={realRun || runs.data![0].id} onChange={(e) => setRealRun(e.target.value)}>{pickers}</Select>
            <Select className="min-w-[12rem] flex-1" label="Synthetic" value={synRun || runs.data![runs.data!.length > 1 ? 1 : 0].id} onChange={(e) => setSynRun(e.target.value)}>{pickers}</Select>
            <Button loading={comparing} onClick={() => compare()}><GitCompare className="h-4 w-4" aria-hidden />Compare</Button>
          </div>
          {quality && (
            <div className="mt-5 grid items-start gap-6 md:grid-cols-[auto_1fr]">
              <div className="grid place-items-center">
                <Gauge value={quality.score} label="Fidelity" tone="good-high" />
                <p className="score mt-1 text-sm text-soft">Fidelity score: <strong className="text-ink">{formatValue(quality.score, 1)}</strong> / 100</p>
              </div>
              <table className="table-clean w-full">
                <tbody>
                  {Object.entries(quality.components).map(([k, v]) => (
                    <tr key={k}><td>{k}</td><td className="tabular-nums">{formatValue(v, 3)}</td>
                      <td className="w-40"><div className="h-2 overflow-hidden rounded-full bg-line" aria-hidden><div className="h-full rounded-full bg-teal" style={{ width: `${Math.max(0, Math.min(1, v)) * 100}%` }} /></div></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
