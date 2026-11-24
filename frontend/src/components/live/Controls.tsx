import { Pause, Play, RotateCcw, Syringe, Wrench } from "lucide-react";
import { useState } from "react";
import type { FaultCatalog, FaultSpec } from "../../api/types";
import { Button, Card, Select, Slider } from "../ui";

export const SPEEDS = [1, 5, 10, 20, 50, 100];

interface Props {
  connected: boolean; paused: boolean; speed: number; faults: FaultCatalog | null;
  send: (msg: Record<string, unknown>) => boolean;
}

/** Play/pause, speed 1x-100x, reset (optional seed), inject (type, profile, severity) and repair. */
export default function Controls({ connected, paused, speed, faults, send }: Props) {
  const [faultType, setFaultType] = useState("");
  const [profile, setProfile] = useState("");
  const [severity, setSeverity] = useState(1);
  const [seed, setSeed] = useState("");
  const fType = faultType || faults?.fault_types[0]?.key || "";

  const inject = () => {
    const fault: FaultSpec = { type: fType, onset_s: 0, intensity: severity, ...(profile ? { profile } : {}) };
    send({ action: "inject", fault });
  };
  const reset = () => {
    const n = seed.trim() === "" ? null : Number(seed);
    send(n !== null && Number.isFinite(n) ? { action: "reset", config: { seed: n } } : { action: "reset" });
  };

  return (
    <Card title="Controls">
      <div className="grid gap-5 lg:grid-cols-[auto_1fr_1.6fr]">
        <div className="flex flex-wrap items-end gap-3">
          <Button disabled={!connected} onClick={() => send({ action: paused ? "resume" : "pause" })}>
            {paused ? <Play className="h-4 w-4" aria-hidden /> : <Pause className="h-4 w-4" aria-hidden />}{paused ? "Resume" : "Pause"}
          </Button>
          <Select label="Speed" className="w-24" value={speed} disabled={!connected} onChange={(e) => send({ action: "speed", value: Number(e.target.value) })}>
            {(SPEEDS.includes(speed) ? SPEEDS : [...SPEEDS, speed].sort((a, b) => a - b)).map((s) => <option key={s} value={s}>{s}x</option>)}
          </Select>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="w-28"><span className="label">Seed (optional)</span>
            <input className="field" inputMode="numeric" placeholder="random" value={seed} onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ""))} />
          </label>
          <Button variant="secondary" disabled={!connected} onClick={reset}><RotateCcw className="h-4 w-4" aria-hidden />Reset</Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Select label="Fault type" aria-label="fault to inject" value={fType} onChange={(e) => setFaultType(e.target.value)}>
            {(faults?.fault_types ?? []).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </Select>
          <Select label="Profile" aria-label="fault profile" value={profile} onChange={(e) => setProfile(e.target.value)}>
            <option value="">default</option>
            {(faults?.profiles ?? []).map((p) => <option key={p.key} value={p.key}>{p.key}</option>)}
          </Select>
          <Slider label="Severity" value={severity} min={0.2} max={3} step={0.1} onChange={setSeverity} format={(v) => v.toFixed(1)} />
          <div className="flex gap-2 sm:col-span-3">
            <Button variant="danger" disabled={!connected || !fType} onClick={inject}><Syringe className="h-4 w-4" aria-hidden />Inject fault</Button>
            <Button variant="secondary" disabled={!connected} onClick={() => send({ action: "repair" })}><Wrench className="h-4 w-4" aria-hidden />Repair</Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
