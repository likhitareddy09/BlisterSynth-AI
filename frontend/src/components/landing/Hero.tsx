import { useReducedMotion } from "framer-motion";
import { ArrowRight, ChevronDown, RotateCcw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useMotionPaused } from "../../hooks/useMotionPaused";
import { stickyProgress, travelProgress, useScrollProgress } from "../../hooks/useScrollProgress";
import { HEADLINE, INTENTS, NOZZLE, POCKET_POS, POCKETS, TABLETS, dropT, landedCount, tabletPose, type TabletLook } from "../../lib/hero";
import { playPop } from "../../lib/sound";
import { MotionToggle, SoundToggle } from "../SoundToggle";
import { Badge, Button } from "../ui";

const HEADER_PX = 64;   // the sticky landing header (h-16)

/** One tablet, centred on (0, 0). */
function Tablet({ look }: { look: TabletLook }) {
  if (look.kind === "capsule") {
    return (
      <g>
        <rect x={-21} y={-10} width={42} height={20} rx={10} fill={look.c2} stroke="#0B241D" strokeOpacity={0.25} />
        <path d="M0 -10 H-11 A10 10 0 0 0 -11 10 H0 Z" fill={look.c1} />
        <rect x={-15} y={-6} width={28} height={4} rx={2} fill="#fff" opacity={0.45} />
      </g>
    );
  }
  return (
    <g>
      <circle r={16} fill={look.c1} stroke="#0B241D" strokeOpacity={0.22} />
      <circle r={16} fill="url(#hero-tab-shade)" />
      <path d="M-9 0 H9" stroke={look.c2} strokeWidth={2.2} strokeLinecap="round" />
      <path d="M-9 -8 A12 12 0 0 1 4 -12" stroke="#fff" strokeOpacity={0.6} strokeWidth={2.5} fill="none" strokeLinecap="round" />
    </g>
  );
}

/** A soft, out-of-focus capsule used for depth (the far layer is blurrier and moves slower than the near one). */
function BlurCapsule({ c, size, style, blur }: { c: string; size: number; style: CSSProperties; blur: number }) {
  return (
    <div className="absolute" style={{ ...style, filter: `blur(${blur}px)` }}>
      <div className="float-cap" style={{ ["--dur" as string]: `${7 + (size % 5)}s` }}>
        <svg width={size} height={size / 2} viewBox="0 0 60 30" aria-hidden>
          <rect width="60" height="30" rx="15" fill="#F3F6F5" /><rect width="30" height="30" rx="15" fill={c} /><rect x="15" width="15" height="30" fill={c} />
        </svg>
      </div>
    </div>
  );
}

/**
 * Landing hero. On large screens the hero is pinned (sticky) for most of a screen of scrolling while ten tablets fall
 * out of the filling station into the blister pack; on phones they fall as the scene moves up the screen. Filled
 * pockets can be popped (click, tap, Enter or Space) with a small synthesized "pop".
 */
export default function Hero() {
  const nav = useNavigate();
  const reduce = !!useReducedMotion();
  const [paused, togglePaused] = useMotionPaused();
  const wrapRef = useRef<HTMLElement>(null);
  const stuckRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const farRef = useRef<HTMLDivElement>(null);
  const nearRef = useRef<HTMLDivElement>(null);
  const cueRef = useRef<HTMLDivElement>(null);
  const tabletRefs = useRef<(SVGGElement | null)[]>([]);
  const landedRef = useRef(reduce ? POCKETS : 0);
  const [landed, setLanded] = useState(landedRef.current);
  const [popped, setPopped] = useState<boolean[]>(() => Array(POCKETS).fill(false));
  const [intent, setIntent] = useState(0);

  const apply = useCallback((p: number) => {
    for (let i = 0; i < POCKETS; i++) {
      const g = tabletRefs.current[i];
      if (!g) continue;
      const pose = tabletPose(dropT(p, i), i);
      g.setAttribute("transform", `translate(${pose.x.toFixed(1)} ${pose.y.toFixed(1)}) rotate(${pose.r.toFixed(1)})`);
      g.style.opacity = pose.visible ? "1" : "0";
    }
    if (farRef.current) farRef.current.style.transform = `translate3d(0, ${(-p * 40).toFixed(1)}px, 0)`;
    if (nearRef.current) nearRef.current.style.transform = `translate3d(0, ${(-p * 120).toFixed(1)}px, 0)`;
    if (cueRef.current) cueRef.current.style.opacity = String(Math.max(0, 1 - p * 10));
    const n = landedCount(p);
    if (n !== landedRef.current) { landedRef.current = n; setLanded(n); }
  }, []);

  const measure = useCallback((rect: DOMRect, vh: number) => {
    const wide = typeof window.matchMedia === "function" && window.matchMedia("(min-width: 1024px)").matches;
    if (wide) return stickyProgress(rect.top, rect.height, stuckRef.current?.offsetHeight ?? vh, HEADER_PX);
    const scene = sceneRef.current?.getBoundingClientRect();
    return scene ? travelProgress(scene.top, vh) : 1;
  }, []);

  useScrollProgress(wrapRef, measure, apply, !reduce);
  useEffect(() => { if (reduce) apply(1); }, [reduce, apply]);

  const inPack = popped.slice(0, landed).filter((x) => !x).length;
  const allPopped = landed === POCKETS && inPack === 0;
  const pop = (i: number) => {
    if (i >= landed || popped[i]) return;
    setPopped((prev) => prev.map((v, k) => (k === i ? true : v)));
    playPop(0.92 + ((i * 37) % 23) / 100);
  };
  const onPocketKey = (i: number) => (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pop(i); }
  };

  return (
    <section ref={wrapRef} aria-label="Introduction" className={`relative ${reduce ? "" : "lg:h-[178vh]"}`}>
      <div ref={stuckRef} className="lg:sticky lg:top-16 lg:flex lg:h-[calc(100vh-4rem)] lg:items-center lg:py-5">
        <div className="relative w-full overflow-hidden rounded-4xl bg-deep text-white sm:rounded-5xl lg:flex lg:h-full lg:items-center">
          {/* soft light rays from the top right */}
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="light-rays absolute -right-[20%] -top-[30%] h-[150%] w-[85%]">
              {[0, 1, 2, 3].map((k) => (
                <div key={k} className="absolute top-0 h-full rounded-full bg-gradient-to-b from-white/[0.24] via-white/[0.07] to-transparent blur-2xl"
                  style={{ left: `${18 + k * 17}%`, width: `${7 + (k % 2) * 6}%` }} />
              ))}
            </div>
            <div className="absolute -bottom-40 left-1/4 h-96 w-96 rounded-full bg-[#1F9E93]/20 blur-3xl" />
          </div>
          {/* far, blurry depth layer */}
          <div ref={farRef} aria-hidden className="pointer-events-none absolute inset-0 opacity-60">
            <BlurCapsule c="#B9CAC7" size={70} blur={6} style={{ left: "46%", top: "8%", transform: "rotate(28deg)" }} />
            <BlurCapsule c="#F2C46D" size={56} blur={7} style={{ left: "92%", top: "48%", transform: "rotate(-30deg)" }} />
            <BlurCapsule c="#7F9783" size={64} blur={8} style={{ left: "38%", top: "86%", transform: "rotate(14deg)" }} />
          </div>

          <div className="relative grid w-full items-center gap-6 px-6 pb-6 pt-10 sm:px-10 lg:grid-cols-[1.15fr_1fr] lg:gap-10 lg:px-14 lg:py-10">
            <div className="max-w-xl">
              <Badge className="!bg-white/15 !text-white" icon={<Sparkles className="h-3.5 w-3.5" aria-hidden />}>Generative AI for predictive maintenance</Badge>
              <h1 className="mt-5 font-display text-[2.35rem] font-extrabold leading-[1.04] sm:text-5xl lg:text-[3.4rem] xl:text-[3.75rem]">
                <span className="sr-only">Synthetic data for smarter packaging lines</span>
                <span aria-hidden="true">
                  {HEADLINE.map((line, li) => (
                    <span key={li} className="sm:block">
                      {line.map((w, wi) => {
                        const k = li * 2 + wi;
                        return <span key={w} className="word-in" style={{ animationDelay: `${150 + k * 110}ms` }}>{w}{wi < line.length - 1 ? " " : ""}</span>;
                      })}
                      {li < HEADLINE.length - 1 && " "}
                    </span>
                  ))}
                </span>
              </h1>
              <p className="mt-5 max-w-lg text-base leading-relaxed text-white/75 sm:text-lg">
                Simulate a pharma blister line, inject realistic faults, generate new data with cVAE and TimeGAN, and train maintenance models that never saw a real failure.
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Button size="lg" variant="pill" onClick={() => nav("/app/live")}>Open the live twin<ArrowRight className="h-5 w-5" aria-hidden /></Button>
              </div>
              {/* guided entry: pick a goal, go straight to the right page */}
              <form className="mt-5 flex max-w-md items-center gap-2 rounded-full border border-white/20 bg-white/10 p-1.5 pl-5 backdrop-blur-md"
                onSubmit={(e) => { e.preventDefault(); nav(INTENTS[intent].to); }}>
                <label className="min-w-0 flex-1">
                  <span className="block font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-white/60">What do you want to do?</span>
                  <select value={intent} onChange={(e) => setIntent(Number(e.target.value))} aria-label="What do you want to do?"
                    className="w-full cursor-pointer truncate bg-transparent py-1 text-sm font-semibold text-white outline-none [&>option]:text-[#1E1B10]">
                    {INTENTS.map((x, k) => <option key={x.to} value={k}>{x.label}</option>)}
                  </select>
                </label>
                <button type="submit" aria-label={`Go: ${INTENTS[intent].label}`} className="press grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-[#174135] hover:bg-white/90">
                  <ArrowRight className="h-5 w-5" aria-hidden />
                </button>
              </form>
            </div>

            <div ref={sceneRef} className="relative mx-auto w-full max-w-[420px] lg:max-w-[480px]">
              <svg viewBox="0 0 480 560" className="w-full lg:h-[min(60vh,560px)] lg:w-auto" role="group"
                aria-label={`Filling station dropping tablets into a blister pack. ${inPack} of ${POCKETS} tablets in the pack.`}>
                <defs>
                  <linearGradient id="hero-steel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#E9F0EE" /><stop offset="0.55" stopColor="#B9CAC7" /><stop offset="1" stopColor="#8FA7A1" /></linearGradient>
                  <linearGradient id="hero-glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0E2E25" stopOpacity="0.85" /><stop offset="1" stopColor="#1F4E41" stopOpacity="0.9" /></linearGradient>
                  <linearGradient id="hero-foil" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#F4F8F7" /><stop offset="0.5" stopColor="#D5E0DD" /><stop offset="1" stopColor="#AFC0BC" /></linearGradient>
                  <radialGradient id="hero-pocket" cx="0.38" cy="0.32" r="0.85"><stop offset="0" stopColor="#FFFFFF" stopOpacity="0.95" /><stop offset="0.6" stopColor="#E3ECEA" stopOpacity="0.55" /><stop offset="1" stopColor="#7F9783" stopOpacity="0.35" /></radialGradient>
                  <radialGradient id="hero-tab-shade" cx="0.35" cy="0.3" r="0.9"><stop offset="0.55" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity="0.18" /></radialGradient>
                  <radialGradient id="hero-halo" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stopColor="#B9CAC7" stopOpacity="0.35" /><stop offset="1" stopColor="#B9CAC7" stopOpacity="0" /></radialGradient>
                  <clipPath id="hero-window"><rect x={180} y={44} width={120} height={52} rx={12} /></clipPath>
                </defs>
                <ellipse cx={240} cy={430} rx={250} ry={170} fill="url(#hero-halo)" />

                {/* filling station (machine head) */}
                <rect x={70} y={6} width={340} height={22} rx={11} fill="url(#hero-steel)" />
                <path d="M150 26 H330 L284 130 H196 Z" fill="url(#hero-steel)" stroke="#fff" strokeOpacity={0.5} />
                <rect x={180} y={44} width={120} height={52} rx={12} fill="url(#hero-glass)" />
                <g clipPath="url(#hero-window)" opacity={0.95}>
                  {[[196, 82, 0], [222, 74, 1], [250, 84, 2], [276, 70, 3], [206, 58, 4], [238, 60, 5], [266, 92, 6], [290, 86, 7]].map(([x, y, k]) => (
                    <g key={k} transform={`translate(${x} ${y}) rotate(${k * 37}) scale(0.62)`}><Tablet look={TABLETS[k]} /></g>
                  ))}
                </g>
                <rect x={180} y={44} width={120} height={52} rx={12} fill="none" stroke="#fff" strokeOpacity={0.35} />
                <rect x={218} y={128} width={44} height={30} fill="url(#hero-steel)" />
                <rect x={204} y={154} width={72} height={18} rx={9} fill="#0E2E25" stroke="#B9CAC7" strokeOpacity={0.6} />
                <ellipse className="nozzle-glow" cx={240} cy={176} rx={34} ry={7} fill="#7FE0C8" opacity={0.7} />
                <circle cx={318} cy={44} r={5} fill="#54B88C" /><circle cx={318} cy={44} r={9} fill="#54B88C" opacity={0.25} />
                <text x={78} y={21} fontSize={10} fontFamily="ui-monospace, Menlo, Consolas, monospace" letterSpacing="1.5" fill="#174135" opacity={0.75}>FILL 03</text>

                {/* blister card */}
                <rect x={30} y={318} width={420} height={222} rx={32} fill="url(#hero-foil)" stroke="#fff" strokeOpacity={0.7} strokeWidth={3} />
                <rect x={44} y={332} width={392} height={194} rx={24} fill="none" stroke="#7F9783" strokeOpacity={0.4} strokeDasharray="4 6" />
                <line x1={52} x2={428} y1={427} y2={427} stroke="#7F9783" strokeOpacity={0.35} strokeDasharray="2 5" />
                {POCKET_POS.map((pt, i) => (
                  <g key={`p${i}-${popped[i] ? "x" : "o"}`} transform={`translate(${pt.x} ${pt.y})`}>
                    <g className={popped[i] && !reduce ? "pocket-dent" : ""}>
                      <ellipse rx={31} ry={33} fill="url(#hero-pocket)" stroke="#7F9783" strokeOpacity={0.55} strokeWidth={2} />
                      <ellipse rx={22} ry={24} cx={-4} cy={-5} fill="#fff" opacity={0.18} />
                    </g>
                    {popped[i] && <path d="M-15 4 l6 -6 l5 5 l6 -7 l5 6 l7 -5" stroke="#0E2E25" strokeOpacity={0.55} strokeWidth={2.2} fill="none" strokeLinejoin="round" />}
                  </g>
                ))}

                {/* the falling tablets (positions are set from the scroll position, see apply()) */}
                {TABLETS.map((look, i) => (
                  <g key={i} ref={(el) => { tabletRefs.current[i] = el; }} transform={`translate(${NOZZLE.x} ${NOZZLE.y})`} style={{ opacity: 0 }}>
                    <g className={popped[i] ? (reduce ? "hidden" : "pop-out") : ""} style={{ ["--pop-x" as string]: `${(i % 2 ? 1 : -1) * (24 + i * 4)}px`, ["--pop-r" as string]: `${(i % 2 ? 1 : -1) * 170}deg` }}>
                      <Tablet look={look} />
                    </g>
                  </g>
                ))}

                {/* hit areas: a filled pocket is a button you can pop */}
                {POCKET_POS.map((pt, i) => {
                  const filled = i < landed && !popped[i];
                  return (
                    <g key={`hit${i}`} role="button" tabIndex={filled ? 0 : -1} aria-disabled={!filled}
                      aria-label={filled ? `Pop tablet ${i + 1}` : popped[i] ? `Pocket ${i + 1}, popped` : `Pocket ${i + 1}, empty`}
                      className={`group outline-none ${filled ? "cursor-tablet" : ""}`} onClick={() => pop(i)} onKeyDown={onPocketKey(i)}>
                      <ellipse cx={pt.x} cy={pt.y} rx={35} ry={37} fill="transparent" />
                      <ellipse cx={pt.x} cy={pt.y} rx={36} ry={38} fill="none" stroke="#7FE0C8" strokeWidth={3} className="opacity-0 group-focus-visible:opacity-100" />
                    </g>
                  );
                })}
              </svg>

              <div ref={cueRef} aria-hidden className="pointer-events-none absolute left-1/2 top-[44%] hidden -translate-x-1/2 flex-col items-center gap-1 text-center font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-white/70 lg:flex">
                Scroll to fill the pack<ChevronDown className="scroll-cue h-4 w-4" />
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-center gap-2 lg:mt-1">
                <span className="rounded-full bg-black/20 px-3 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-white/80" aria-live="polite">
                  {inPack}/{POCKETS} in the pack{landed > 0 && !allPopped ? <><span className="sm:hidden"> | tap to pop</span><span className="hidden sm:inline"> | tap one to pop it</span></> : ""}
                </span>
                {allPopped && (
                  <button type="button" onClick={() => setPopped(Array(POCKETS).fill(false))}
                    className="press inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-xs font-semibold text-[#174135]">
                    <RotateCcw className="h-4 w-4" aria-hidden />Refill the pack
                  </button>
                )}
                {/* on phones the two toggles get their own centred row, so nothing jumps when the hint appears */}
                <div className="flex w-full justify-center gap-2 sm:w-auto">
                  <SoundToggle variant="glass" withLabel />
                  {!reduce && <MotionToggle variant="glass" paused={paused} onToggle={togglePaused} />}
                </div>
              </div>
            </div>
          </div>

          {/* near, slightly blurred capsules that move faster than everything else: depth of field */}
          <div ref={nearRef} aria-hidden className="pointer-events-none absolute inset-0 hidden sm:block">
            <BlurCapsule c="#E6A08A" size={96} blur={3.5} style={{ left: "-3%", top: "97%", transform: "rotate(-24deg)" }} />
            <BlurCapsule c="#F2C46D" size={90} blur={2.5} style={{ right: "-2%", top: "4%", transform: "rotate(36deg)" }} />
          </div>
        </div>
      </div>
    </section>
  );
}
