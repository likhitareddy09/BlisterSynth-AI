import { useCallback, useState } from "react";
import { api } from "../api/client";
import type { FaultSpec, RunLabels, RunWithPreview, SimConfigIn } from "../api/types";
import { ErrorBanner, useAction, useLoad } from "../components/common";
import { Button, Card, Field, PageHeader, Select } from "../components/ui";
import { Download, Play, Save } from "lucide-react";
import FaultBuilder from "../components/FaultBuilder";
import RunView from "../components/RunView";

const DEFAULTS: SimConfigIn = {
  duration_s: 3600, sample_rate_hz: 1, seed: 42, nominal_speed_bpm: 220, noise_scale: 1, drift_scale: 1,
  include_startup: true, include_shutdown: true,
};

export default function Simulator({ onRunCreated }: { onRunCreated: () => void }) {
  const catalog = useLoad(api.sensors);
  const faultCat = useLoad(api.faultCatalog);
  const scenarios = useLoad(api.scenarios);
  const [name, setName] = useState("My run");
  const [cfg, setCfg] = useState<SimConfigIn>(DEFAULTS);
  const [faults, setFaults] = useState<FaultSpec[]>([]);
  const [result, setResult] = useState<RunWithPreview | null>(null);
  const [labels, setLabels] = useState<RunLabels | null>(null);

  const doRun = useCallback(async () => {
    const run = await api.simulate({ name, config: cfg, faults });
    setResult(run);
    setLabels(faults.length ? await api.runLabels(run.id).catch(() => null) : null);
    onRunCreated();
  }, [name, cfg, faults, onRunCreated]);
  const [run, busy, error, clear] = useAction(doRun);

  const doSave = useCallback(async () => { await api.saveScenario(name, { config: cfg, faults }); scenarios.reload(); }, [name, cfg, faults, scenarios]);
  const [save, saving, saveError] = useAction(doSave);

  const loadScenario = (id: string) => {
    const sc = scenarios.data?.find((s) => s.id === id);
    if (!sc) return;
    setName(sc.name);
    setCfg({ ...DEFAULTS, ...(sc.config.config ?? {}) });
    setFaults(sc.config.faults ?? []);
  };
  const num = (k: keyof SimConfigIn) => (e: React.ChangeEvent<HTMLInputElement>) => setCfg({ ...cfg, [k]: Number(e.target.value) });

  return (
    <div className="space-y-5">
      <PageHeader title="Simulator" subtitle="Configure the physics model, add faults with ground-truth labels, and save the run for training and analysis." />
      <ErrorBanner error={error ?? saveError ?? catalog.error ?? faultCat.error} onClose={clear} />
      <Card title="Configure a run">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          <Field label="Duration (s)" type="number" min={60} value={cfg.duration_s} onChange={num("duration_s")} />
          <Field label="Sample rate (Hz)" type="number" min={0.1} step={0.1} value={cfg.sample_rate_hz} onChange={num("sample_rate_hz")} />
          <Field label="Seed" type="number" value={cfg.seed ?? ""} placeholder="random"
            onChange={(e) => setCfg({ ...cfg, seed: e.target.value === "" ? null : Number(e.target.value) })} />
          <Field label="Nominal speed (bpm)" type="number" min={50} max={400} value={cfg.nominal_speed_bpm} onChange={num("nominal_speed_bpm")} />
          <Field label="Noise scale" type="number" min={0} max={5} step={0.1} value={cfg.noise_scale} onChange={num("noise_scale")} />
        </div>
        <h4 className="mb-3 mt-6 text-sm font-semibold">Faults</h4>
        <FaultBuilder catalog={faultCat.data} value={faults} onChange={setFaults} />
        <div className="mt-6 flex flex-wrap items-end gap-3">
          <Button loading={busy} onClick={() => run()}><Play className="h-4 w-4" aria-hidden />{busy ? "Simulating..." : "Run simulation"}</Button>
          <Button variant="secondary" loading={saving} onClick={() => save()}><Save className="h-4 w-4" aria-hidden />Save as scenario</Button>
          <Select aria-label="load scenario" className="w-56" value="" onChange={(e) => loadScenario(e.target.value)}>
            <option value="">Load scenario...</option>
            {(scenarios.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </div>
      </Card>

      {result && catalog.data && (
        <Card title={`Result: ${result.name}`} actions={<a className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline" href={api.downloadUrl(result.id)}><Download className="h-4 w-4" aria-hidden />Download CSV</a>}>
          <p className="mb-3 text-sm text-soft">{result.n_rows} rows | id {result.id}</p>
          <RunView preview={result.preview} sensors={catalog.data.sensors} labels={labels} />
        </Card>
      )}
    </div>
  );
}
