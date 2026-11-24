import { motion } from "framer-motion";
import { BookOpen, Cpu } from "lucide-react";
import { useMemo, useState } from "react";
import ArchitectureDiagram from "../components/about/ArchitectureDiagram";
import { Reveal } from "../components/landing/Reveal";
import { Badge, Card, PageHeader, Slider } from "../components/ui";
import { ar1Series, CONCEPTS, lag1, TECH_STACK } from "../lib/about";

/** White noise vs AR(1) noise with the same shocks: drag phi and watch the line get "stickier". */
function Ar1Demo() {
  const [phi, setPhi] = useState(0.8);
  const N = 160, W = 520, H = 120;
  const white = useMemo(() => ar1Series(N, 0), []);
  const ar = useMemo(() => ar1Series(N, phi), [phi]);
  const path = (v: number[]) => v.map((y, i) => `${i === 0 ? "M" : "L"}${(i / (N - 1)) * W} ${H / 2 - Math.max(-3.2, Math.min(3.2, y)) * 17}`).join(" ");
  return (
    <div className="mt-4 rounded-2xl bg-tint p-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Noise with memory phi = ${phi.toFixed(2)} compared with white noise`}>
        <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="rgb(var(--line))" strokeWidth={1} />
        <path d={path(white)} fill="none" stroke="rgb(var(--sage))" strokeWidth={1.4} opacity={0.8} />
        <path d={path(ar)} fill="none" stroke="rgb(var(--teal))" strokeWidth={2.2} />
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-soft">
        <span><span className="mr-1 inline-block h-2 w-4 rounded bg-sage align-middle" />white noise (phi = 0)</span>
        <span><span className="mr-1 inline-block h-2 w-4 rounded bg-teal align-middle" />AR(1), measured lag-1 autocorrelation {lag1(ar).toFixed(2)}</span>
      </div>
      <div className="mt-3 max-w-xs"><Slider label="phi (memory)" value={phi} min={0} max={0.98} step={0.02} onChange={setPhi} format={(v) => v.toFixed(2)} /></div>
    </div>
  );
}

export default function About() {
  return (
    <div className="space-y-6">
      <PageHeader title="How it works" subtitle="From a physics simulator to predictive-maintenance models: what each part does and how the pieces connect."
        actions={<Badge tone="teal" icon={<BookOpen className="h-3 w-3" aria-hidden />}>5-minute read</Badge>} />

      <Card title="Architecture" actions={<span className="hidden text-xs text-soft sm:inline">moving dashes = data flowing</span>}>
        <div className="-mx-1 overflow-x-auto"><div className="min-w-[680px]"><ArchitectureDiagram /></div></div>
        <ol className="mt-4 grid gap-2 text-sm text-soft sm:grid-cols-2 lg:grid-cols-3">
          <li><b className="text-ink">1. Simulator</b> builds 14 correlated sensor signals for a 7-station line.</li>
          <li><b className="text-ink">2. Faults and labels</b> inject wear-outs; every row carries ground-truth labels and RUL.</li>
          <li><b className="text-ink">3. Generative model</b> learns from those runs and makes new ones.</li>
          <li><b className="text-ink">4. Quality</b> scores the synthetic data: fidelity, utility (TSTR), diversity.</li>
          <li><b className="text-ink">5. PdM models</b> classify faults and predict RUL.</li>
          <li><b className="text-ink">6. Dashboard</b> shows it all, including a live digital twin over WebSocket.</li>
        </ol>
      </Card>

      <section aria-label="Tech stack" className="grid gap-5 md:grid-cols-2">
        {TECH_STACK.map((g, gi) => (
          <Reveal key={g.group} delay={gi * 0.08}>
            <Card title={<span className="inline-flex items-center gap-2"><Cpu className="h-4 w-4 text-primary" aria-hidden />{g.group}</span>} className="h-full">
              <ul className="space-y-2.5">
                {g.items.map((t) => (
                  <li key={t.name} className="text-sm"><b className="font-semibold">{t.name}</b><span className="text-soft"> - {t.why}</span></li>
                ))}
              </ul>
            </Card>
          </Reveal>
        ))}
      </section>

      <section aria-label="Key ideas" className="space-y-5">
        <h2 className="text-xl font-bold">Key ideas in plain language</h2>
        <div className="grid gap-5 lg:grid-cols-2">
          {CONCEPTS.map((c, i) => (
            <Reveal key={c.id} delay={(i % 2) * 0.08} className={i === CONCEPTS.length - 1 && CONCEPTS.length % 2 === 1 ? "lg:col-span-2" : ""}>
              <motion.div whileHover={{ y: -2 }} className="h-full">
                <Card title={c.title} tint={i % 2 ? "none" : "green"} className="h-full">
                  <p className="text-sm leading-relaxed">{c.plain}</p>
                  <p className="mt-2 text-sm leading-relaxed text-soft"><b className="text-ink">In this project:</b> {c.project}</p>
                  {c.formula && <code className="mt-3 block overflow-x-auto rounded-xl bg-surface px-3 py-2 font-mono text-xs text-primary">{c.formula}</code>}
                  {c.id === "ar1" && <Ar1Demo />}
                </Card>
              </motion.div>
            </Reveal>
          ))}
        </div>
      </section>
    </div>
  );
}
