import { useReducedMotion } from "framer-motion";
import { useCallback, useRef, useState } from "react";
import { stickyProgress, useScrollProgress } from "../../hooks/useScrollProgress";
import { CHAPTERS, cameraAt, progressOfChapter, signaturePath, viewBoxFor, type Chapter } from "../../lib/story";
import LineIllustration from "./LineIllustration";

const HEADER_PX = 64;
const CAPTION: Record<Chapter["signature"], string> = {
  healthy: "healthy line: just sensor noise",
  step: "vacuum leak: a sudden step",
  intermittent: "feeder jam: bursts that get longer",
  decline: "heater ageing: a slow slide",
  accelerating: "punch wear: rising faster and faster",
};

function ChapterText({ c }: { c: Chapter }) {
  return (
    <>
      <p className="eyebrow">{c.eyebrow}</p>
      <h3 className="mt-2 text-2xl font-bold leading-tight sm:text-3xl xl:text-4xl">{c.title}</h3>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-soft sm:text-base">{c.body}</p>
      <dl className="mt-4 grid max-w-md gap-2 text-sm">
        <div className="flex gap-3"><dt className="w-16 shrink-0 pt-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-soft">Sensors</dt><dd className="font-medium">{c.sensors}</dd></div>
        <div className="flex gap-3"><dt className="w-16 shrink-0 pt-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-soft">{c.station ? "Fault" : "Labels"}</dt><dd>{c.fault}</dd></div>
      </dl>
      <figure className="mt-5 hidden max-w-sm rounded-2xl bg-surface p-3 shadow-card sm:block">
        <svg viewBox="0 0 220 56" className="h-14 w-full" aria-hidden preserveAspectRatio="none">
          <path d="M0 52 H220" stroke="rgb(var(--line))" strokeWidth={1} />
          <path d={signaturePath(c.signature)} fill="none" stroke={c.station ? "rgb(var(--rust))" : "rgb(var(--teal))"} strokeWidth={2} strokeLinejoin="round" />
        </svg>
        <figcaption className="mt-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-soft">In the data: {CAPTION[c.signature]}</figcaption>
      </figure>
    </>
  );
}

/** For reduced motion: the same five chapters as a plain list, each with a still close-up of its station. */
function StaticStory() {
  return (
    <section id="story" aria-labelledby="story-h">
      <p className="eyebrow">02 / How a blister is made</p>
      <h2 id="story-h" className="mt-2 text-3xl font-bold sm:text-4xl">From film to carton</h2>
      <div className="mt-8 grid gap-5 lg:grid-cols-2">
        {CHAPTERS.map((c) => (
          <article key={c.id} className="overflow-hidden rounded-4xl bg-surface shadow-card">
            <div className="bg-deep"><LineIllustration active={c.station} className="h-48 w-full" title={`${c.title}: station close-up`} /></div>
            <div className="p-6"><ChapterText c={c} /></div>
          </article>
        ))}
      </div>
    </section>
  );
}

/**
 * Scroll-driven story: the machine illustration is pinned while the page scrolls, a "camera" zooms from the whole line
 * into forming, filling, sealing and punching, and the matching chapter slides in next to it. Only the SVG viewBox and
 * one progress bar change per frame; React re-renders once per chapter.
 */
export default function LineStory() {
  const reduce = !!useReducedMotion();
  const wrapRef = useRef<HTMLElement>(null);
  const stuckRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const indexRef = useRef(0);
  const [index, setIndex] = useState(0);

  const apply = useCallback((p: number) => {
    const cam = cameraAt(p);
    const svg = svgRef.current;
    if (svg) {
      const r = svg.getBoundingClientRect();
      svg.setAttribute("viewBox", viewBoxFor(cam, r.width, r.height));
    }
    if (barRef.current) barRef.current.style.transform = `scaleX(${p.toFixed(4)})`;
    if (cam.index !== indexRef.current) { indexRef.current = cam.index; setIndex(cam.index); }
  }, []);
  const measure = useCallback((rect: DOMRect, vh: number) => stickyProgress(rect.top, rect.height, stuckRef.current?.offsetHeight ?? vh, HEADER_PX), []);
  useScrollProgress(wrapRef, measure, apply, !reduce);

  const goTo = (i: number) => {
    const el = wrapRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - HEADER_PX;
    const span = el.offsetHeight - (stuckRef.current?.offsetHeight ?? window.innerHeight);
    window.scrollTo({ top: top + progressOfChapter(i) * span + 2, behavior: "smooth" });
  };

  if (reduce) return <StaticStory />;
  const c = CHAPTERS[index];
  return (
    <section id="story" ref={wrapRef} aria-labelledby="story-h" className="relative" style={{ height: `${100 + (CHAPTERS.length - 1) * 80}vh` }}>
      <div ref={stuckRef} className="sticky top-16 flex h-[calc(100vh-4rem)] flex-col py-4 lg:py-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 lg:mb-5">
          <div>
            <p className="eyebrow">02 / How a blister is made</p>
            <h2 id="story-h" className="mt-1 text-2xl font-bold sm:text-3xl lg:text-4xl">From film to carton</h2>
          </div>
          <nav aria-label="Story chapters" className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 pb-1">
            {CHAPTERS.map((ch, i) => (
              <button key={ch.id} type="button" onClick={() => goTo(i)} aria-current={i === index ? "step" : undefined}
                className={`press inline-flex min-h-[40px] min-w-[44px] items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 font-mono sm:min-h-0 sm:py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] ${i === index ? "bg-primary text-on-primary" : "bg-surface text-soft shadow-card hover:text-ink"}`}>
                {String(i).padStart(2, "0")}<span className="hidden sm:inline">{ch.station ?? "line"}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-4 lg:grid-cols-[1.35fr_1fr] lg:grid-rows-1 lg:gap-10">
          <div className="relative min-h-0 overflow-hidden rounded-4xl bg-deep shadow-float">
            <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.18]" style={{ backgroundImage: "radial-gradient(rgb(255 255 255 / 0.55) 1px, transparent 1px)", backgroundSize: "22px 22px" }} />
            <LineIllustration ref={svgRef} active={c.station} className="relative h-full w-full" title="Blister line, zooming station by station" />
            <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse at center, transparent 55%, rgb(0 0 0 / 0.28))" }} />
            <div className="pointer-events-none absolute left-4 top-4 rounded-full bg-black/25 px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-white/85 backdrop-blur-sm">
              Cam {String(index).padStart(2, "0")} | {c.station ?? "full line"}
            </div>
            <div className="pointer-events-none absolute right-4 top-4 hidden rounded-full bg-black/25 px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-white/85 backdrop-blur-sm sm:block">
              Simulated | 1 Hz
            </div>
            <div className="absolute inset-x-4 bottom-4 h-1 overflow-hidden rounded-full bg-white/15">
              <div ref={barRef} className="h-full origin-left rounded-full bg-[#7FE0C8]" style={{ transform: "scaleX(0)" }} />
            </div>
          </div>

          <div className="relative h-[16.5rem] sm:h-[19rem] lg:h-auto">
            {CHAPTERS.map((ch, i) => (
              <article key={ch.id} className="chapter absolute inset-0 flex flex-col justify-start lg:justify-center" data-state={i < index ? "after" : i === index ? "active" : "before"}>
                <ChapterText c={ch} />
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
