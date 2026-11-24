import { Activity, ArrowRight, Brain, Cpu, FlaskConical, Layers, ShieldCheck, Sparkles, Syringe, Wrench } from "lucide-react";
import { useNavigate } from "react-router-dom";
import Hero from "../components/landing/Hero";
import KeyFigures from "../components/landing/KeyFigures";
import LineStory from "../components/landing/LineStory";
import { Reveal } from "../components/landing/Reveal";
import SpecTicker from "../components/landing/SpecTicker";
import TrustSection from "../components/landing/TrustSection";
import Logo from "../components/Logo";
import ThemeToggle from "../components/ThemeToggle";
import MiniLine from "../components/twin/MiniLine";
import { Button, Card } from "../components/ui";

const FEATURES = [
  { icon: Cpu, tint: "green", title: "Digital Twin", big: true, text: "A live animated model of the 7-station blister line. Film moves at the real line speed and every station glows green, amber or red from its health.", cta: "Open the twin", to: "/app/live" },
  { icon: Syringe, tint: "sand", title: "Fault Engine", text: "8 fault types with gradual, sudden and intermittent profiles, each labelled second by second.", to: "/app/simulator" },
  { icon: Sparkles, tint: "blue", title: "Generative AI", text: "cVAE and TimeGAN learn the line and generate new, unseen sensor runs on demand.", to: "/app/generative" },
  { icon: Layers, tint: "rose", title: "Quality Report", text: "Fidelity, utility and diversity scores, with the evidence behind each number.", to: "/app/quality" },
  { icon: Wrench, tint: "green", title: "Predictive Maintenance", text: "Fault classifiers and remaining-useful-life models, trained on synthetic data and tested on real.", to: "/app/pdm" },
] as const;

const STEPS = [
  { icon: FlaskConical, title: "Simulate", text: "Physics model of 14 sensors" },
  { icon: Syringe, title: "Inject faults", text: "Labelled degradations" },
  { icon: Brain, title: "Generate", text: "cVAE / TimeGAN samples" },
  { icon: ShieldCheck, title: "Evaluate", text: "Fidelity and TSTR" },
  { icon: Activity, title: "Predict", text: "Faults and RUL" },
];

const STACK = ["FastAPI", "PyTorch", "scikit-learn", "SQLite", "React", "Recharts", "Claude"];
const SECTIONS = [["story", "How it's made"], ["features", "Features"], ["trust", "Trust"]] as const;
const DEMO_STATUS = { unwind: "green", forming: "green", filling: "amber", sealing: "green", cooling: "green", punching: "green", cartoning: "red" };

const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

export default function Landing() {
  const nav = useNavigate();
  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-surface focus:px-4 focus:py-2 focus:shadow-float">Skip to content</a>
      <header className="sticky top-0 z-30 border-b border-line/60 bg-bg/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:gap-3 sm:px-6">
          <Logo className="shrink-0" />
          <nav className="ml-6 hidden gap-1 md:flex" aria-label="Sections">
            {SECTIONS.map(([id, label]) => (
              <button key={id} onClick={() => scrollTo(id)} className="rounded-full px-3 py-1.5 text-sm font-medium text-soft hover:bg-tint hover:text-ink">{label}</button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Button onClick={() => nav("/app")}>Open app<ArrowRight className="hidden h-4 w-4 min-[380px]:block" aria-hidden /></Button>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-7xl px-4 pb-20 pt-4 sm:px-6 sm:pt-6">
        <Hero />

        <div className="mt-8 space-y-20 sm:mt-10 lg:mt-6 lg:space-y-24">
          <SpecTicker />
          <KeyFigures />
          <LineStory />

          {/* FEATURES BENTO */}
          <section id="features" aria-labelledby="features-h" className="scroll-mt-24">
            <Reveal className="mb-8 max-w-xl">
              <p className="eyebrow">03 / Features</p>
              <h2 id="features-h" className="mt-2 text-3xl font-bold sm:text-4xl">Everything between a sensor and a decision</h2>
            </Reveal>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 lg:grid-rows-2">
              {FEATURES.map((f, i) => (
                <Reveal key={f.title} delay={i * 0.06} className={"big" in f && f.big ? "md:col-span-2 lg:row-span-2" : ""}>
                  <Card tint={f.tint} className="group flex h-full flex-col justify-between !p-6 transition duration-300 hover:-translate-y-1">
                    <div>
                      <span className="grid h-12 w-12 place-items-center rounded-full bg-surface text-primary shadow-sm"><f.icon className="h-6 w-6" aria-hidden /></span>
                      <h3 className="mt-4 text-xl font-semibold">{f.title}</h3>
                      <p className="mt-2 text-sm text-soft">{f.text}</p>
                    </div>
                    {"big" in f && f.big ? (
                      <div className="mt-6">
                        <div className="rounded-3xl bg-surface/70 p-3"><MiniLine status={DEMO_STATUS} className="w-full" label="Example line status" /></div>
                        <p className="mt-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-soft">Example: filling degrading, cartoning critical</p>
                        <Button className="mt-4" onClick={() => nav(f.to)}>{"cta" in f ? f.cta : "Open"}<ArrowRight className="h-4 w-4" aria-hidden /></Button>
                      </div>
                    ) : (
                      <button onClick={() => nav(f.to)} className="mt-3 inline-flex min-h-[44px] items-center gap-1 py-2 text-sm font-semibold text-primary hover:underline">
                        Explore<span className="sr-only"> {f.title}</span><ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden />
                      </button>
                    )}
                  </Card>
                </Reveal>
              ))}
            </div>
          </section>

          {/* PIPELINE */}
          <section id="how" aria-labelledby="how-h">
            <Reveal className="mb-8 max-w-xl">
              <p className="eyebrow">04 / The pipeline</p>
              <h2 id="how-h" className="mt-2 text-3xl font-bold sm:text-4xl">From physics to prediction in five steps</h2>
            </Reveal>
            <ol className="relative grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <span aria-hidden className="absolute left-[10%] right-[10%] top-[42px] hidden h-px bg-gradient-to-r from-transparent via-sage/60 to-transparent lg:block" />
              {STEPS.map((s, i) => (
                <li key={s.title} className="relative">
                  <Reveal delay={i * 0.08} className="h-full">
                    <div className="foil h-full rounded-3xl bg-surface p-5 shadow-card">
                      <span className="grid h-11 w-11 place-items-center rounded-full bg-primary text-on-primary"><s.icon className="h-5 w-5" aria-hidden /></span>
                      <p className="mt-4 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-teal">Step {i + 1}</p>
                      <h3 className="text-lg font-semibold">{s.title}</h3>
                      <p className="mt-1 text-sm text-soft">{s.text}</p>
                    </div>
                  </Reveal>
                </li>
              ))}
            </ol>
          </section>

          {/* BUILT WITH */}
          <section id="stack" aria-label="Built with" className="text-center">
            <p className="eyebrow">Built with</p>
            <ul className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {STACK.map((s) => <li key={s} className="rounded-full border border-line bg-surface px-4 py-2 font-mono text-xs font-semibold uppercase tracking-[0.12em] text-soft">{s}</li>)}
            </ul>
          </section>

          <TrustSection />

          {/* CTA */}
          <Reveal>
            <section aria-label="Get started" className="relative overflow-hidden rounded-5xl bg-deep px-6 py-14 text-center text-white sm:px-12">
              <div aria-hidden className="pointer-events-none absolute -left-20 -top-24 h-72 w-72 rounded-full bg-[#7FE0C8]/15 blur-3xl" />
              <p className="relative font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7FE0C8]">Try it in your browser</p>
              <h2 className="relative mx-auto mt-3 max-w-2xl text-3xl font-bold sm:text-4xl">See a blister line fail, safely</h2>
              <p className="relative mx-auto mt-3 max-w-lg text-white/75">Open the dashboard, inject a bearing fault and watch the twin turn red.</p>
              <Button className="relative mt-7" size="lg" variant="pill" onClick={() => nav("/app")}>Launch BlisterSynth<ArrowRight className="h-5 w-5" aria-hidden /></Button>
            </section>
          </Reveal>
        </div>
      </main>
      <footer className="border-t border-line py-8 text-center text-sm text-soft">
        <p>BlisterSynth AI - synthetic packaging line sensor generator. Final-year Generative AI project.</p>
        <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em]">Runs locally | FastAPI + React</p>
      </footer>
    </div>
  );
}
