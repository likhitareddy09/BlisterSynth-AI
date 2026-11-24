import { ArrowRight, BarChart3, Database, FileSpreadsheet, FileText, Pencil, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Dataset, InspectResult } from "../api/types";
import { ErrorBanner, fmtDate, useAction, useLoad } from "../components/common";
import Dropzone from "../components/datalab/Dropzone";
import { ExportLinks, RenameModal } from "../components/datalab/shared";
import { Badge, Button, Card, EmptyState, Field, PageHeader, Select, Skeleton, Tabs, useToast } from "../components/ui";
import { saveBlob } from "../lib/download";
import { SENSOR_KEYS, duplicateColumns, missingSensors, setMapping, shortSensor } from "../lib/metrics";

type Tab = "upload" | "datasets" | "manage";
const OPTIONAL = ["t_s", "timestamp", "machine_state", "fault_type", "fault_active", "rul_s"];
const OPT_HINT: Record<string, string> = { t_s: "seconds since start", timestamp: "date-time", machine_state: "running / stopped ...", fault_type: "fault name or none", fault_active: "0 / 1", rul_s: "remaining life (s)" };

// ================================================================== upload wizard
function UploadWizard({ onSaved }: { onSaved: (d: Dataset) => void }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [info, setInfo] = useState<InspectResult | null>(null);
  const [mapping, setMap] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [rate, setRate] = useState(1);
  const [saved, setSaved] = useState<(Dataset & { notes: string[] }) | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const doInspect = useCallback(async (f: File) => {
    setFile(f); setInfo(null); setSaved(null); setLocalError(null);
    const r = await api.inspectCsv(f);
    setInfo(r); setMap(r.suggested_mapping); setName(f.name.replace(/\.csv$/i, ""));
  }, []);
  const [inspect, inspecting, inspectError, clearInspect] = useAction(doInspect);

  const missing = missingSensors(mapping);
  const dups = duplicateColumns(mapping);
  const ready = !!info && missing.length === 0 && dups.length === 0 && name.trim().length > 0;

  const doSave = useCallback(async () => {
    const d = await api.saveDataset(file!, name.trim(), mapping, rate);
    setSaved(d); onSaved(d);
    toast.push({ title: "Dataset saved", message: `${d.name}: ${d.n_rows.toLocaleString()} rows`, tone: "success" });
  }, [file, name, mapping, rate, onSaved, toast]);
  const [save, saving, saveError, clearSave] = useAction(doSave);

  const reset = () => { setFile(null); setInfo(null); setSaved(null); setMap({}); setName(""); };
  const preview = useMemo(() => {
    if (!info) return { cols: [] as string[], fields: [] as string[] };
    const fields = [...SENSOR_KEYS, ...OPTIONAL].filter((f) => mapping[f]);
    return { fields, cols: fields.map((f) => mapping[f]) };
  }, [info, mapping]);

  return (
    <div className="space-y-5">
      <ErrorBanner error={localError ?? inspectError ?? saveError} onClose={() => { setLocalError(null); clearInspect(); clearSave(); }} />
      <Card title="1. Choose a CSV file">
        <Dropzone file={file} disabled={inspecting} onError={setLocalError} onFile={(f) => void inspect(f)} />
        {inspecting && <Skeleton className="mt-4 h-24" />}
      </Card>

      {info && !saved && (
        <>
          <Card title="2. Match your columns to the sensor schema"
            actions={missing.length === 0 && dups.length === 0 ? <Badge tone="green">all 14 sensors mapped</Badge> : <Badge tone="red">{missing.length} sensor(s) missing</Badge>}>
            <p className="mb-3 text-sm text-soft">{info.n_rows.toLocaleString()} rows and {info.columns.length} columns found. We guessed the mapping from the column names; change anything that is wrong.</p>
            {dups.length > 0 && <p className="mb-3 rounded-xl bg-rust/10 px-3 py-2 text-sm text-rust" role="alert">One column is used twice: {dups.join(", ")}.</p>}
            <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
              {SENSOR_KEYS.map((k) => (
                <div key={k} className="flex items-center gap-2">
                  <div className="w-40 shrink-0 text-sm"><span className={mapping[k] ? "" : "font-semibold text-rust"}>{shortSensor(k)}</span><span className="block text-xs text-soft">required</span></div>
                  <Select aria-label={`Column for ${k}`} className="min-w-0 flex-1" value={mapping[k] ?? ""} onChange={(e) => setMap((m) => setMapping(m, k, e.target.value))}>
                    <option value="">- not mapped -</option>{info.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </Select>
                  {mapping[k] && info.suggested_mapping[k] === mapping[k] && <Badge tone={info.match_kinds[k] === "exact" ? "green" : info.match_kinds[k] === "alias" ? "teal" : "amber"}>{info.match_kinds[k]}</Badge>}
                </div>
              ))}
            </div>
            <h4 className="mb-2 mt-5 text-sm font-semibold text-soft">Optional columns</h4>
            <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
              {OPTIONAL.map((k) => (
                <div key={k} className="flex items-center gap-2">
                  <div className="w-40 shrink-0 text-sm">{k}<span className="block text-xs text-soft">{OPT_HINT[k]}</span></div>
                  <Select aria-label={`Column for ${k}`} className="min-w-0 flex-1" value={mapping[k] ?? ""} onChange={(e) => setMap((m) => setMapping(m, k, e.target.value))}>
                    <option value="">- none -</option>{info.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </Select>
                </div>
              ))}
            </div>
            {missing.length > 0 && <p className="mt-4 text-sm text-rust">Still missing: {missing.map(shortSensor).join(", ")}. All 14 sensors are required so the data works with the generators and models.</p>}
          </Card>

          <Card title="3. Preview and save">
            <div className="overflow-x-auto"><table className="table-clean w-full min-w-[640px]">
              <thead><tr>{preview.cols.map((c, i) => <th key={c}><span className="block">{c}</span><span className="block text-[10px] font-normal text-soft">{shortSensor(preview.fields[i])}</span></th>)}</tr></thead>
              <tbody>{info.preview.slice(0, 6).map((r, i) => <tr key={i}>{preview.cols.map((c) => <td key={c} className="tabular-nums">{typeof r[c] === "number" ? Number(r[c]).toFixed(2) : String(r[c] ?? "")}</td>)}</tr>)}</tbody>
            </table></div>
            <h4 className="mb-2 mt-5 text-sm font-semibold text-soft">Basic statistics of the mapped sensors</h4>
            <div className="max-h-64 overflow-auto"><table className="table-clean w-full min-w-[520px]">
              <thead><tr><th>Sensor</th><th>Mean</th><th>Std</th><th>Min</th><th>Max</th><th>Missing</th></tr></thead>
              <tbody>{SENSOR_KEYS.filter((k) => mapping[k] && info.stats[mapping[k]]).map((k) => { const s = info.stats[mapping[k]]; return (
                <tr key={k}><td>{shortSensor(k)}</td><td className="tabular-nums">{s.mean?.toFixed(2)}</td><td className="tabular-nums">{s.std?.toFixed(2)}</td><td className="tabular-nums">{s.min?.toFixed(2)}</td><td className="tabular-nums">{s.max?.toFixed(2)}</td>
                  <td><Badge tone={s.missing ? "amber" : "neutral"}>{s.missing}</Badge></td></tr>); })}</tbody>
            </table></div>
            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              <Field label="Dataset name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
              <Field label="Sample rate (Hz)" type="number" min={0.1} max={10} step={0.1} value={rate} disabled={!!mapping.t_s} onChange={(e) => setRate(Number(e.target.value))} />
              <div className="flex items-end gap-2"><Button loading={saving} disabled={!ready} onClick={() => save()}><Database className="h-4 w-4" aria-hidden />Save dataset</Button><Button variant="ghost" onClick={reset}>Cancel</Button></div>
            </div>
            {mapping.t_s && <p className="mt-2 text-xs text-soft">The sample rate is taken from your time column.</p>}
          </Card>
        </>
      )}

      {saved && (
        <Card tint="green" title="Dataset saved">
          <p className="text-sm">{saved.name}: {saved.n_rows.toLocaleString()} rows, {(saved.duration_s / 3600).toFixed(2)} h at {saved.sample_rate_hz} Hz. {saved.has_labels ? "Fault labels were found." : "No fault labels: treated as healthy data."}</p>
          {saved.notes.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs text-soft">{saved.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
          <div className="mt-4 flex flex-wrap gap-3">
            <Link to={`/app/generative?dataset=${saved.id}`}><Button><Sparkles className="h-4 w-4" aria-hidden />Train a generator on it<ArrowRight className="h-4 w-4" aria-hidden /></Button></Link>
            <Link to={`/app/quality?real=dataset:${saved.id}`}><Button variant="secondary"><BarChart3 className="h-4 w-4" aria-hidden />Use as real data in a quality report</Button></Link>
            <Button variant="ghost" onClick={reset}>Upload another</Button>
          </div>
        </Card>
      )}
    </div>
  );
}

// ================================================================== lists
function DatasetsTab({ reloadKey, onChanged }: { reloadKey: number; onChanged: () => void }) {
  const ds = useLoad(api.datasets, [reloadKey]);
  const [renaming, setRenaming] = useState<Dataset | null>(null);
  const doDelete = useCallback(async (d: Dataset) => { if (window.confirm(`Delete dataset "${d.name}"? This removes its file.`)) { await api.deleteDataset(d.id); ds.reload(); onChanged(); } }, [ds, onChanged]);
  const [del, , delError] = useAction(doDelete);
  return (
    <Card title={`Datasets (${ds.data?.length ?? 0})`}>
      <ErrorBanner error={ds.error ?? delError} />
      {ds.data?.length === 0 && <EmptyState icon={<FileSpreadsheet className="h-6 w-6" />} title="No datasets yet" hint="Upload a CSV in the Upload tab." />}
      <div className="overflow-x-auto"><table className="table-clean table-stack w-full min-w-[720px]">
        <tbody>{(ds.data ?? []).map((d) => (
          <tr key={d.id}>
            <td><div className="font-medium">{d.name}</div><div className="text-xs text-soft">{d.id}</div></td>
            <td className="tabular-nums">{d.n_rows.toLocaleString()} rows<div className="text-xs text-soft">{(d.duration_s / 3600).toFixed(2)} h @ {d.sample_rate_hz} Hz</div></td>
            <td><Badge tone={d.has_labels ? "teal" : "neutral"}>{d.has_labels ? "labelled" : "healthy"}</Badge></td>
            <td className="text-xs text-soft">{fmtDate(d.created_at)}</td>
            <td className="stack-full whitespace-nowrap text-right">
              <div className="flex flex-wrap items-center gap-1 sm:flex-nowrap sm:justify-end sm:gap-1.5">
                <ExportLinks urlFor={(f) => api.datasetDownloadUrl(d.id, f)} />
                <Link to={`/app/generative?dataset=${d.id}`} className="inline-flex min-h-[36px] items-center px-1 text-xs font-semibold text-primary underline sm:min-h-0">Train</Link>
                <Link to={`/app/quality?real=dataset:${d.id}`} className="inline-flex min-h-[36px] items-center px-1 text-xs font-semibold text-primary underline sm:min-h-0">Quality</Link>
                <span className="ml-auto inline-flex items-center gap-0.5 sm:ml-0">
                  <button aria-label={`Rename ${d.name}`} className="press rounded-lg p-2 text-soft hover:bg-tint sm:p-1.5" onClick={() => setRenaming(d)}><Pencil className="h-4 w-4" /></button>
                  <button aria-label={`Delete ${d.name}`} className="press rounded-lg p-2 text-rust hover:bg-rust/10 sm:p-1.5" onClick={() => del(d)}><Trash2 className="h-4 w-4" /></button>
                </span>
              </div>
            </td>
          </tr>))}</tbody>
      </table></div>
      <RenameModal open={!!renaming} current={renaming?.name ?? ""} onClose={() => setRenaming(null)} onSave={async (n) => { await api.renameDataset(renaming!.id, n); ds.reload(); onChanged(); }} />
    </Card>
  );
}

function ManageTab({ reloadKey, onChanged }: { reloadKey: number; onChanged: () => void }) {
  const toast = useToast();
  const runs = useLoad(api.runs, [reloadKey]);
  const scen = useLoad(api.scenarios, [reloadKey]);
  const [renameRun, setRenameRun] = useState<{ id: string; name: string } | null>(null);
  const [renameSc, setRenameSc] = useState<{ id: string; name: string } | null>(null);
  const doReport = useCallback(async (id: string) => { saveBlob(await api.runReport(id), `${id}_report.pdf`); toast.push({ title: "Report downloaded", tone: "success" }); }, [toast]);
  const [report, reporting, reportError] = useAction(doReport);
  const doDelRun = useCallback(async (id: string, name: string) => { if (window.confirm(`Delete run "${name}"?`)) { await api.deleteRun(id); runs.reload(); onChanged(); } }, [runs, onChanged]);
  const [delRun, , delRunError] = useAction(doDelRun);
  const doDelSc = useCallback(async (id: string, name: string) => { if (window.confirm(`Delete scenario "${name}"?`)) { await api.deleteScenario(id); scen.reload(); } }, [scen]);
  const [delSc, , delScError] = useAction(doDelSc);
  return (
    <div className="space-y-5">
      <ErrorBanner error={runs.error ?? scen.error ?? reportError ?? delRunError ?? delScError} />
      <Card title={`Scenarios (${scen.data?.length ?? 0})`}>
        {scen.data?.length === 0 && <EmptyState title="No saved scenarios" hint="Save one from the Simulator tab; load it there from the 'Load scenario' menu." />}
        <div className="overflow-x-auto"><table className="table-clean table-stack w-full min-w-[520px]"><tbody>{(scen.data ?? []).map((s) => (
          <tr key={s.id}><td><div className="font-medium">{s.name}</div><div className="text-xs text-soft">{s.id}</div></td>
            <td className="text-xs text-soft">{(s.config?.faults?.length ?? 0)} fault(s) | {fmtDate(s.created_at)}</td>
            <td className="ml-auto whitespace-nowrap text-right"><button aria-label={`Rename ${s.name}`} className="press rounded-lg p-2 text-soft hover:bg-tint sm:p-1.5" onClick={() => setRenameSc({ id: s.id, name: s.name })}><Pencil className="h-4 w-4" /></button>
              <button aria-label={`Delete ${s.name}`} className="press rounded-lg p-2 text-rust hover:bg-rust/10 sm:p-1.5" onClick={() => delSc(s.id, s.name)}><Trash2 className="h-4 w-4" /></button></td></tr>))}</tbody></table></div>
      </Card>
      <Card title={`Runs (${runs.data?.length ?? 0})`}>
        {runs.data?.length === 0 && <EmptyState title="No runs yet" hint="Create one in the Simulator tab." />}
        <div className="overflow-x-auto"><table className="table-clean table-stack w-full min-w-[720px]"><tbody>{(runs.data ?? []).map((r) => (
          <tr key={r.id}><td><div className="font-medium">{r.name}</div><div className="text-xs text-soft">{r.id}</div></td>
            <td><Badge tone={r.kind === "generative" ? "teal" : "neutral"}>{r.kind}</Badge></td><td className="tabular-nums text-xs">{r.n_rows.toLocaleString()} rows</td>
            <td className="stack-full whitespace-nowrap text-right"><div className="flex flex-wrap items-center gap-1 sm:flex-nowrap sm:justify-end sm:gap-1.5"><ExportLinks urlFor={(f) => api.downloadUrl(r.id, f)} />
              <Button size="sm" variant="secondary" disabled={reporting} onClick={() => report(r.id)}><FileText className="hidden h-3.5 w-3.5 sm:block" aria-hidden />PDF</Button>
              <span className="ml-auto inline-flex items-center gap-0.5 sm:ml-0">
                <button aria-label={`Rename ${r.name}`} className="press rounded-lg p-2 text-soft hover:bg-tint sm:p-1.5" onClick={() => setRenameRun({ id: r.id, name: r.name })}><Pencil className="h-4 w-4" /></button>
                <button aria-label={`Delete ${r.name}`} className="press rounded-lg p-2 text-rust hover:bg-rust/10 sm:p-1.5" onClick={() => delRun(r.id, r.name)}><Trash2 className="h-4 w-4" /></button>
              </span></div></td></tr>))}</tbody></table></div>
      </Card>
      <RenameModal open={!!renameRun} current={renameRun?.name ?? ""} onClose={() => setRenameRun(null)} onSave={async (n) => { await api.renameRun(renameRun!.id, n); runs.reload(); onChanged(); }} />
      <RenameModal open={!!renameSc} current={renameSc?.name ?? ""} onClose={() => setRenameSc(null)} onSave={async (n) => { await api.renameScenario(renameSc!.id, n); scen.reload(); }} />
    </div>
  );
}

// ================================================================== page
export default function DataLab({ refreshKey = 0, onChanged = () => undefined }: { refreshKey?: number; onChanged?: () => void }) {
  const [tab, setTab] = useState<Tab>("upload");
  const [bump, setBump] = useState(0);
  const changed = useCallback(() => { setBump((b) => b + 1); onChanged(); }, [onChanged]);
  return (
    <div className="space-y-5">
      <PageHeader title="Data Lab" subtitle="Bring your own sensor data: upload a CSV, match its columns, save it as a dataset, then use it to train a generator or as the real data in a quality report."
        actions={<Tabs label="Data Lab sections" value={tab} onChange={setTab} items={[{ value: "upload", label: "Upload" }, { value: "datasets", label: "My datasets" }, { value: "manage", label: "Runs & scenarios" }]} />} />
      {tab === "upload" && <UploadWizard onSaved={() => { changed(); }} />}
      {tab === "datasets" && <DatasetsTab reloadKey={bump + refreshKey} onChanged={changed} />}
      {tab === "manage" && <ManageTab reloadKey={bump + refreshKey} onChanged={changed} />}
    </div>
  );
}
