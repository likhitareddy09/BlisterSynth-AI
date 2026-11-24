import { Plus, Trash2 } from "lucide-react";
import type { FaultCatalog, FaultSpec } from "../api/types";
import { Button } from "./ui";

export const MAX_FAULTS = 8;
export const newFault = (type: string): FaultSpec => ({ type, profile: null, onset_s: 600, intensity: 1 });

interface Props { catalog: FaultCatalog | null; value: FaultSpec[]; onChange: (f: FaultSpec[]) => void }

/** Add / edit / remove the faults of a run (max 8, same limit as the API). */
export default function FaultBuilder({ catalog, value, onChange }: Props) {
  const types = catalog?.fault_types ?? [];
  const patch = (i: number, p: Partial<FaultSpec>) => onChange(value.map((f, j) => (j === i ? { ...f, ...p } : f)));
  return (
    <div className="faults space-y-3">
      {value.length === 0 && <p className="text-sm text-soft">No faults - the run will be healthy.</p>}
      {value.map((f, i) => (
        <div className="fault-row grid grid-cols-2 items-end gap-3 rounded-2xl bg-tint p-3 sm:grid-cols-[1.4fr_1fr_1fr_1fr_auto]" key={i}>
          <select className="field" aria-label="fault type" value={f.type} onChange={(e) => patch(i, { type: e.target.value })}>
            {types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          <select className="field" aria-label="profile" value={f.profile ?? ""} onChange={(e) => patch(i, { profile: e.target.value || null })}>
            <option value="">default profile</option>
            {(catalog?.profiles ?? []).map((p) => <option key={p.key} value={p.key}>{p.key}</option>)}
          </select>
          <label><span className="label">onset (s)</span>
            <input className="field" type="number" min={0} value={f.onset_s} onChange={(e) => patch(i, { onset_s: Number(e.target.value) })} />
          </label>
          <label><span className="label">intensity</span>
            <input className="field" type="number" min={0.1} max={3} step={0.1} value={f.intensity}
              onChange={(e) => patch(i, { intensity: Number(e.target.value) })} />
          </label>
          <Button variant="danger" size="sm" aria-label="remove fault" onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" />remove</Button>
        </div>
      ))}
      <Button variant="secondary" size="sm" disabled={!types.length || value.length >= MAX_FAULTS} onClick={() => onChange([...value, newFault(types[0].key)])}>
        <Plus className="h-4 w-4" />Add fault
      </Button>
    </div>
  );
}
