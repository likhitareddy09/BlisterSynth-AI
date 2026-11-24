import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import type { FaultSpec, GenTrainBody, RunWithPreview } from "../api/types";
import { ErrorBanner, fmtDate, useAction, useLoad } from "../components/common";
import { Badge, Button, Card, EmptyState, Field, PageHeader, Select, Skeleton } from "../components/ui";
import { Brain, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import FaultBuilder from "../components/FaultBuilder";
import RunView from "../components/RunView";

const ACTIVE = ["queued", "running"];

export default function Generative({ onChanged }: { onChanged: () => void }) {
  const [params] = useSearchParams();
  const datasets = useLoad(api.datasets);
  const [seedDataset, setSeedDataset] = useState(params.get("dataset") ?? "");   // Data Lab: learn from an uploaded dataset
  const models = useLoad(api.genModels);
  const jobs = useLoad(api.genJobs);
  const catalog = useLoad(api.sensors);
  const faultCat = useLoad(api.faultCatalog);
  const [train, setTrain] = useState<GenTrainBody>({
    kind: "cvae", name: "My generator", n_seed_runs: 8, seed_duration_s: 1200, epochs: 20, seed: 7,
  });
  const [modelId, setModelId] = useState("");
  const [faults, setFaults] = useState<FaultSpec[]>([]);
  const [duration, setDuration] = useState(1800);
  const [result, setResult] = useState<RunWithPreview | null>(null);

  // Poll jobs while any is running; refresh the model list when one finishes.
  const anyActive = jobs.data?.some((j) => ACTIVE.includes(j.status)) ?? false;
  useEffect(() => {
    if (!anyActive) return;
    const id = setInterval(() => { jobs.reload(); }, 2000);
    return () => clearInterval(id);
  }, [anyActive, jobs]);
  const finished = jobs.data?.filter((j) => j.status === "done").length ?? 0;
  useEffect(() => { models.reload(); onChanged(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [finished]);

  const doTrain = useCallback(async () => { await api.genTrain({ ...train, dataset_ids: seedDataset ? [seedDataset] : undefined }); jobs.reload(); }, [train, jobs, seedDataset]);
  const [startTrain, starting, trainError, clearTrain] = useAction(doTrain);
  const doCancel = useCallback(async (id: string) => { await api.genCancel(id); jobs.reload(); }, [jobs]);
  const [cancel, , cancelError] = useAction(doCancel);
  const doDelete = useCallback(async (id: string) => {
    if (!window.confirm(`Delete model ${id}?`)) return;
    await api.genDelete(id); models.reload(); onChanged();
  }, [models, onChanged]);
  const [removeModel, , deleteError] = useAction(doDelete);
  const doGenerate = useCallback(async () => {
    const run = await api.genGenerate({ name: "Generated run", model_id: modelId || models.data![0].id, config: { duration_s: duration }, faults });
    setResult(run); onChanged();
  }, [modelId, models.data, duration, faults, onChanged]);
  const [generate, generating, genError] = useAction(doGenerate);

  const num = (k: keyof GenTrainBody) => (e: React.ChangeEvent<HTMLInputElement>) => setTrain({ ...train, [k]: Number(e.target.value) });
  const statusTone = (st: string) => (st === "done" ? "green" : st === "failed" ? "red" : st === "cancelled" ? "neutral" : "teal") as "green" | "red" | "neutral" | "teal";

  return (
    <div className="space-y-5">
      <PageHeader title="Generative models" subtitle="Train a cVAE or TimeGAN on simulated runs, then sample new synthetic sensor data with faults." />
      <ErrorBanner error={trainError ?? cancelError ?? deleteError ?? genError ?? models.error ?? jobs.error} onClose={clearTrain} />
      <Card title="Train a generative model">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Name" value={train.name} onChange={(e) => setTrain({ ...train, name: e.target.value })} />
          <Select label="Kind" value={train.kind} onChange={(e) => setTrain({ ...train, kind: e.target.value as GenTrainBody["kind"] })}>
            <option value="cvae">cVAE (fast)</option><option value="timegan">TimeGAN (slower)</option>
          </Select>
          <Select label="Seed data" value={seedDataset} onChange={(e) => setSeedDataset(e.target.value)}>
            <option value="">Physics simulator (default)</option>
            {(datasets.data ?? []).map((d) => <option key={d.id} value={d.id}>Uploaded: {d.name}</option>)}
          </Select>
          <Field label="Seed runs" type="number" min={4} max={200} value={train.n_seed_runs} disabled={!!seedDataset} onChange={num("n_seed_runs")} />
          <Field label="Seed run length (s)" type="number" min={600} max={14400} value={train.seed_duration_s} disabled={!!seedDataset} onChange={num("seed_duration_s")} />
          <Field label="Epochs" type="number" min={2} max={1000} value={train.epochs} onChange={num("epochs")} />
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button loading={starting} onClick={() => startTrain()}><Brain className="h-4 w-4" aria-hidden />Start training</Button>
          <p className="text-sm text-soft">Training runs in the background - watch progress below.</p>
        </div>
      </Card>

      <Card title="Training jobs" actions={<Button variant="secondary" size="sm" onClick={jobs.reload}><RefreshCw className="h-3.5 w-3.5" aria-hidden />Refresh</Button>}>
        {jobs.data === null && !jobs.error && <Skeleton lines={2} />}
        {jobs.data?.length === 0 && <p className="rounded-2xl bg-tint px-4 py-3 text-sm text-soft">No training jobs yet. Start one above and its progress shows up here.</p>}
        <div className="space-y-3">
          {(jobs.data ?? []).map((j) => (
            <div className="job rounded-2xl bg-tint p-3" key={j.id}>
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-sm">{j.name}</strong> <Badge tone={statusTone(j.status)}>{j.status}</Badge>
                <span className="text-xs text-soft">{j.stage} | epoch {j.epoch}/{j.epochs}</span>
                {ACTIVE.includes(j.status) && <Button variant="danger" size="sm" className="ml-auto" onClick={() => cancel(j.id)}><X className="h-3.5 w-3.5" aria-hidden />cancel</Button>}
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(j.progress * 100)} aria-label={`${j.name} progress`}>
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round(j.progress * 100)}%` }} />
              </div>
              {j.error && <p className="warn mt-2 text-sm text-rust">{j.error}</p>}
            </div>
          ))}
        </div>
      </Card>

      <Card title={`Models (${models.data?.length ?? 0})`}>
        {models.data === null && !models.error && <Skeleton lines={3} />}
        {models.data?.length === 0 && <EmptyState icon={<Sparkles className="h-6 w-6" />} title="No models yet" hint="Train a model first." />}
        {(models.data?.length ?? 0) > 0 && (
          <table className="table-clean table-stack w-full">
            <tbody>
              {(models.data ?? []).map((m) => (
                <tr key={m.id}>
                  <td>{m.name}<br /><span className="text-xs text-soft">{m.id}</span></td>
                  <td><Badge tone="teal">{m.kind}</Badge></td>
                  <td className="hidden text-soft sm:table-cell">{fmtDate(m.created_at)}</td>
                  <td className="text-right"><Button variant="danger" size="sm" aria-label={`delete ${m.id}`} onClick={() => removeModel(m.id)}><Trash2 className="h-3.5 w-3.5" aria-hidden />delete</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {(models.data?.length ?? 0) > 0 && (
        <Card title="Generate a synthetic run">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Model" value={modelId || models.data![0].id} onChange={(e) => setModelId(e.target.value)}>
              {models.data!.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.kind})</option>)}
            </Select>
            <Field label="Duration (s)" type="number" min={60} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
          </div>
          <div className="my-5"><FaultBuilder catalog={faultCat.data} value={faults} onChange={setFaults} /></div>
          <Button loading={generating} onClick={() => generate()}><Sparkles className="h-4 w-4" aria-hidden />{generating ? "Generating..." : "Generate"}</Button>
          {result && catalog.data && <div className="mt-6"><RunView preview={result.preview} sensors={catalog.data.sensors} /></div>}
        </Card>
      )}
    </div>
  );
}
