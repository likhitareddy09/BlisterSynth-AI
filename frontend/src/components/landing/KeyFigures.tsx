import { useInView } from "framer-motion";
import { useRef } from "react";
import { useCountUp } from "../../hooks/useCountUp";

// Key figures with context, like a machine maker's spec sheet: a big number, what it counts, and one line on why it matters.
const FIGURES = [
  { value: 14, label: "Sensors", text: "Temperatures, pressures, tension, vibration, current and a vision count, physically linked." },
  { value: 7, label: "Stations", text: "From the unwind reel to the cartoner, each with its own live health score." },
  { value: 8, label: "Fault types", text: "Gradual, sudden or intermittent, labelled every second with remaining useful life." },
  { value: 2, label: "Generative models", text: "A conditional VAE and a TimeGAN that learn the line from seed data." },
];

function Figure({ value, label, text, start }: { value: number; label: string; text: string; start: boolean }) {
  const n = useCountUp(start ? value : 0, 1100);
  return (
    <div className="px-1 py-2 lg:px-6">
      <div className="font-display text-5xl font-extrabold tabular-nums tracking-tight text-primary sm:text-6xl" aria-hidden>{Math.round(n)}</div>
      <span className="sr-only">{value}</span>
      <div className="mt-2 font-display text-base font-bold">{label}</div>
      <p className="mt-1 text-sm leading-relaxed text-soft">{text}</p>
    </div>
  );
}

export default function KeyFigures() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, margin: "-60px" });
  return (
    <section aria-labelledby="figures-h">
      <p className="eyebrow">01 / In numbers</p>
      <h2 id="figures-h" className="sr-only">BlisterSynth in numbers</h2>
      <div ref={ref} className="mt-4 grid grid-cols-2 gap-x-5 gap-y-6 rounded-4xl bg-surface p-6 shadow-card sm:p-8 lg:grid-cols-4 lg:gap-0 lg:divide-x lg:divide-line">
        {FIGURES.map((f) => <Figure key={f.label} {...f} start={seen} />)}
      </div>
    </section>
  );
}
