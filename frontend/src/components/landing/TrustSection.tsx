import { ArrowRight, EyeOff, HardDrive, KeyRound, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { loadCase, type CaseStudy } from "../../lib/caseStudy";
import { levelPercent, READINESS } from "../../lib/readiness";
import { Button } from "../ui";

const SAFE = [
  { icon: HardDrive, title: "Stays on your machine", text: "FastAPI, SQLite and plain CSV files on your own disk. Apart from the Copilot prompt below, nothing is uploaded." },
  { icon: EyeOff, title: "Only your words go to Claude", text: "With an API key set, the Copilot sends the prompt you typed plus fixed instructions. No sensor data or files." },
  { icon: KeyRound, title: "The key stays on the server", text: "Your Anthropic key lives in backend/.env, is never sent to the browser and is masked in error messages." },
  { icon: Trash2, title: "Delete means deleted", text: "Deleting a run, dataset or model removes its file from disk, not just the line in the list." },
];

/** Recursion-style pipeline bars: one row per capability, filled up to the stage it has honestly reached. */
function ReadinessTable() {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {READINESS.map((g) => (
        <div key={g.id} className="foil rounded-4xl bg-surface p-5 shadow-card sm:p-6">
          <h3 className="font-display text-lg font-bold">{g.title}</h3>
          <div className="mt-3 hidden grid-cols-4 gap-1 sm:grid" aria-hidden>
            {g.stages.map((s) => <span key={s} className="font-mono text-[10px] font-semibold uppercase leading-tight tracking-[0.1em] text-soft">{s}</span>)}
          </div>
          <ul className="mt-3 space-y-4">
            {g.rows.map((r) => (
              <li key={r.name}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-semibold">{r.name}</span>
                  <span className={`shrink-0 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] ${r.level === 0 ? "text-rust" : "text-teal"}`}>{r.status}</span>
                </div>
                <div className="relative mt-1.5 h-2.5 rounded-full bg-tint" role="meter" aria-valuemin={0} aria-valuemax={g.stages.length} aria-valuenow={r.level}
                  aria-label={`${r.name}: ${r.status}, stage ${r.level} of ${g.stages.length}`}>
                  <div className={`h-full rounded-full ${r.level === 0 ? "" : "bg-gradient-to-r from-primary to-teal"}`} style={{ width: `${levelPercent(r.level, g.stages.length)}%` }} />
                  {[1, 2, 3].map((k) => <span key={k} aria-hidden className="absolute top-0 h-full w-px bg-surface" style={{ left: `${k * 25}%` }} />)}
                </div>
                <p className="mt-1 text-xs text-soft">{r.note}</p>
              </li>
            ))}
          </ul>
          <p className="mt-5 rounded-2xl bg-tint px-4 py-3 text-xs leading-relaxed text-soft">{g.footnote}</p>
        </div>
      ))}
    </div>
  );
}

/** The user's own latest imbalance-fix result (saved by the PdM page). No result yet = an honest empty state. */
function CaseStudyCard() {
  const nav = useNavigate();
  const [c, setC] = useState<CaseStudy | null>(null);
  useEffect(() => { setC(loadCase()); }, []);
  return (
    <div className="foil flex flex-col justify-between rounded-4xl bg-deep p-6 text-white shadow-float sm:p-8">
      <div>
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7FE0C8]">Case study | rare faults</p>
        <h3 className="mt-2 font-display text-2xl font-bold">Does synthetic data help a model catch rare faults?</h3>
        <p className="mt-2 text-sm leading-relaxed text-white/70">
          The same fault classifier is trained twice: on a few real runs where only a couple contain faults, then on those runs plus synthetic runs from your generator. Both are tested on the same fresh runs.
        </p>
      </div>
      {c ? (
        <div className="mt-6">
          <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
            <div><div className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/60">Real only</div><div className="font-display text-4xl font-bold tabular-nums">{c.real_only_f1.toFixed(2)}</div></div>
            <ArrowRight className="mb-2 h-6 w-6 text-[#7FE0C8]" aria-hidden />
            <div><div className="whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.14em] text-white/60">Real + synthetic</div><div className="font-display text-4xl font-bold tabular-nums text-[#7FE0C8]">{c.aug_f1.toFixed(2)}</div></div>
            <div className="mb-1 ml-auto whitespace-nowrap rounded-full bg-white/10 px-3 py-1 font-mono text-xs font-semibold">{c.delta >= 0 ? "+" : ""}{c.delta.toFixed(2)} macro-F1</div>
          </div>
          <p className="mt-3 text-xs text-white/65">
            Measured on this computer on {new Date(c.saved_at).toLocaleDateString()} with {c.n_real} real runs ({c.n_fault_real} with faults) plus {c.n_synth} synthetic runs.
            {" "}{c.classes_improved} fault class(es) improved{c.classes_worse ? `, ${c.classes_worse} got worse` : ""}.
          </p>
          <Button className="mt-4" variant="pill" size="sm" onClick={() => nav("/app/pdm")}>See the full experiment<ArrowRight className="h-4 w-4" aria-hidden /></Button>
        </div>
      ) : (
        <div className="mt-6 rounded-3xl border border-dashed border-white/25 p-4">
          <p className="text-sm font-semibold">No result on this computer yet.</p>
          <p className="mt-1 text-xs leading-relaxed text-white/65">Run the imbalance-fix experiment on the PdM page and this card fills in with your own numbers. Nothing here is made up.</p>
          <Button className="mt-3" variant="pill" size="sm" onClick={() => nav("/app/pdm")}>Run the experiment<ArrowRight className="h-4 w-4" aria-hidden /></Button>
        </div>
      )}
    </div>
  );
}

export default function TrustSection() {
  return (
    <section id="trust" aria-labelledby="trust-h" className="scroll-mt-24">
      <p className="eyebrow">05 / Trust</p>
      <h2 id="trust-h" className="mt-2 max-w-2xl text-3xl font-bold sm:text-4xl">Honest about where it stands</h2>
      <p className="mt-3 max-w-2xl text-soft">
        Pharma runs on evidence, so here is the evidence: what is tested, what is missing before a regulated plant could use it, and how your data is handled.
      </p>
      <div className="mt-8"><ReadinessTable /></div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="foil rounded-4xl bg-surface p-5 shadow-card sm:p-6">
          <h3 className="font-display text-lg font-bold">How your data stays safe</h3>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {SAFE.map((s) => (
              <li key={s.title} className="flex gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><s.icon className="h-5 w-5" aria-hidden /></span>
                <div><p className="text-sm font-semibold">{s.title}</p><p className="mt-0.5 text-xs leading-relaxed text-soft">{s.text}</p></div>
              </li>
            ))}
          </ul>
          <p className="mt-5 flex items-start gap-2 rounded-2xl bg-warn/10 px-4 py-3 text-xs leading-relaxed text-ink">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
            There are no user accounts yet, so anyone who can open the page can use it. Run it on your own computer or a trusted network.
          </p>
        </div>
        <CaseStudyCard />
      </div>
    </section>
  );
}
