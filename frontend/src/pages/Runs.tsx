import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { Preview, RunLabels } from "../api/types";
import { ErrorBanner, fmtDate, useAction, useLoad } from "../components/common";
import { Badge, Button, Card, EmptyState, PageHeader, Skeleton, useToast } from "../components/ui";
import { FileText, FlaskConical, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { ExportLinks, RenameModal } from "../components/datalab/shared";
import { saveBlob } from "../lib/download";
import RunView from "../components/RunView";

export default function Runs({ refreshKey }: { refreshKey: number }) {
  const runs = useLoad(api.runs, [refreshKey]);
  const catalog = useLoad(api.sensors);
  const toast = useToast();
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [labels, setLabels] = useState<RunLabels | null>(null);

  const open = useCallback(async (id: string) => {
    setSelected(id); setPreview(null); setLabels(null);
    setPreview(await api.runData(id));
    setLabels(await api.runLabels(id).catch(() => null));
  }, []);
  const [openRun, opening, openError, clearOpen] = useAction(open);

  const remove = useCallback(async (id: string) => {
    if (!window.confirm(`Delete ${id}? This removes its data file.`)) return;
    await api.deleteRun(id);
    if (selected === id) { setSelected(null); setPreview(null); }
    runs.reload();
  }, [selected, runs]);
  const [removeRun, , removeError] = useAction(remove);

  // PDF report: generated on the server (reportlab + matplotlib), then saved by the browser
  const makeReport = useCallback(async (id: string) => {
    saveBlob(await api.runReport(id), `${id}_report.pdf`);
    toast.push({ title: "Report downloaded", message: `${id}_report.pdf`, tone: "success" });
  }, [toast]);
  const [report, reporting, reportError, clearReport] = useAction(makeReport);

  useEffect(() => { if (selected && !runs.data?.some((r) => r.id === selected)) setSelected(null); }, [runs.data, selected]);

  return (
    <div className="space-y-5">
      <PageHeader title="Runs" subtitle="Every simulated or generated run is stored here with its labels." />
      <ErrorBanner error={runs.error ?? openError ?? removeError ?? reportError} onClose={() => { clearOpen(); clearReport(); }} />
      <Card title={`Saved runs (${runs.data?.length ?? 0})`} actions={<Button variant="secondary" size="sm" onClick={runs.reload}><RefreshCw className="h-3.5 w-3.5" aria-hidden />Refresh</Button>}>
        {runs.data === null && !runs.error && <Skeleton lines={4} />}
        {runs.data?.length === 0 && <EmptyState icon={<FlaskConical className="h-6 w-6" />} title="No runs yet" hint="Create one in the Simulator." />}
        {(runs.data?.length ?? 0) > 0 && (
          <div className="overflow-x-auto">
            <table className="table-clean table-stack w-full min-w-[520px]">
              <thead><tr><th>Name</th><th>Kind</th><th>Rows</th><th>Created</th><th /></tr></thead>
              <tbody>
                {(runs.data ?? []).map((r) => (
                  <tr key={r.id} className={r.id === selected ? "selected bg-primary/5" : ""}>
                    <td>{r.name}<br /><span className="text-xs text-soft">{r.id}</span></td>
                    <td><Badge tone={r.kind === "physics" ? "teal" : "neutral"}>{r.kind}</Badge></td>
                    <td className="tabular-nums">{r.n_rows}<span className="sm:hidden"> rows</span></td>
                    <td className="text-soft">{fmtDate(r.created_at)}</td>
                    <td className="stack-full whitespace-nowrap text-right">
                      {/* phones: open + downloads on the left, edit + delete pushed to the right of the same row */}
                      <div className="flex flex-wrap items-center gap-1 sm:flex-nowrap sm:justify-end sm:gap-1.5">
                        <Button size="sm" variant="secondary" onClick={() => openRun(r.id)}>View</Button>
                        <ExportLinks urlFor={(f) => api.downloadUrl(r.id, f)} />
                        <span className="ml-auto inline-flex items-center gap-1 sm:ml-0">
                          <Button size="sm" variant="ghost" aria-label={`rename ${r.id}`} onClick={() => setRenaming({ id: r.id, name: r.name })}><Pencil className="h-3.5 w-3.5" aria-hidden /></Button>
                          <Button size="sm" variant="danger" aria-label={`delete ${r.id}`} onClick={() => removeRun(r.id)}><Trash2 className="h-3.5 w-3.5" aria-hidden /></Button>
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {selected && (
        <Card title={`Run ${selected}`} actions={<Button size="sm" loading={reporting} onClick={() => report(selected)}><FileText className="h-3.5 w-3.5" aria-hidden />Download report</Button>}>
          {opening || !preview ? <Skeleton className="h-64" />
            : catalog.data && <RunView preview={preview} sensors={catalog.data.sensors} labels={labels} />}
        </Card>
      )}
      <RenameModal open={!!renaming} current={renaming?.name ?? ""} onClose={() => setRenaming(null)} onSave={async (n) => { await api.renameRun(renaming!.id, n); runs.reload(); }} />
    </div>
  );
}
