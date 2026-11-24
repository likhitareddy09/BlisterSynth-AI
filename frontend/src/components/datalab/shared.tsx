import { useEffect, useState } from "react";
import type { ExportFormat } from "../../api/client";
import { Button, Modal } from "../ui";

/** CSV / Parquet / JSON download links (plain <a download>, the browser handles the file). */
export function ExportLinks({ urlFor }: { urlFor: (f: ExportFormat) => string }) {
  return (
    <span className="inline-flex items-center gap-1" role="group" aria-label="Download as">
      {(["csv", "parquet", "json"] as const).map((f) => (
        <a key={f} href={urlFor(f)} download className="inline-flex min-h-[36px] items-center rounded-lg bg-tint px-2 text-xs font-semibold uppercase tracking-wide text-primary hover:bg-mint/60 sm:min-h-0 sm:py-1">{f}</a>
      ))}
    </span>
  );
}

/** Modal with one text field; used to rename datasets, runs and scenarios. */
export function RenameModal({ open, current, onClose, onSave }: { open: boolean; current: string; onClose: () => void; onSave: (name: string) => Promise<void> | void }) {
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setName(current); }, [open, current]);
  const valid = name.trim().length > 0 && name.trim().length <= 120;
  const save = async () => { setBusy(true); try { await onSave(name.trim()); onClose(); } finally { setBusy(false); } };
  return (
    <Modal open={open} onClose={onClose} title="Rename"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!valid || name.trim() === current} onClick={save}>Save</Button></>}>
      <label className="block"><span className="label">New name</span>
        <input className="field" autoFocus maxLength={120} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && valid) void save(); }} /></label>
    </Modal>
  );
}
