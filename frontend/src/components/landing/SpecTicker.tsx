// Mono "spec ticker" under the hero: the project's real numbers scrolling past like an instrument read-out.
const FACTS = [
  "14 sensors", "7 stations", "8 fault types", "3 severity profiles", "AR(1) + correlated noise", "1 Hz default, up to 10 Hz",
  "labels + RUL on every row", "cVAE", "TimeGAN", "KS | PCA | t-SNE | TSTR", "CSV | Parquet | JSON", "runs on your own laptop",
];

export default function SpecTicker() {
  return (
    <div className="ticker relative overflow-hidden rounded-full border border-line bg-surface py-3 shadow-card">
      <ul className="sr-only" aria-label="Key specifications">{FACTS.map((f) => <li key={f}>{f}</li>)}</ul>
      <div className="ticker-track" aria-hidden>
        {[...FACTS, ...FACTS].map((f, i) => (
          <span key={i} className="inline-flex items-center gap-3 whitespace-nowrap pl-6 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-soft">
            <span className="h-1.5 w-1.5 rounded-full bg-teal" />{f}
          </span>
        ))}
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-surface to-transparent" />
      <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-surface to-transparent" />
    </div>
  );
}
