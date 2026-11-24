import { forwardRef, memo } from "react";
import { LINE_H, LINE_W } from "../../lib/story";

// Side view of the whole blister line, drawn once in SVG. The scroll story moves a "camera" over it by changing the
// viewBox (see lib/story.ts). Moving parts reuse the digital twin's CSS animations (index.css), so they cost no JS.

const STATIONS = [
  { id: "unwind", x: 120, label: "Unwind" }, { id: "forming", x: 330, label: "Forming" }, { id: "filling", x: 530, label: "Filling" },
  { id: "sealing", x: 720, label: "Sealing" }, { id: "cooling", x: 890, label: "Cooling" }, { id: "punching", x: 1070, label: "Punching" },
  { id: "cartoning", x: 1265, label: "Cartoning" },
] as const;
const LEGS = [50, 225, 430, 625, 805, 980, 1168, 1345];
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const PILLS = ["#F3F6F5", "#F2C46D", "#B9CAC7", "#E6A08A"];

interface Props { active?: string | null; className?: string; title?: string }

const LineIllustration = forwardRef<SVGSVGElement, Props>(function LineIllustration({ active = null, className = "", title = "Side view of a blister packaging line" }, ref) {
  const dim = (id: string) => (active && active !== id ? 0.42 : 1);
  return (
    <svg ref={ref} viewBox={`0 0 ${LINE_W} ${LINE_H}`} className={className} role="img" aria-label={title} preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="ln-steel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#F2F6F5" /><stop offset="0.6" stopColor="#C9D6D3" /><stop offset="1" stopColor="#9FB3AE" /></linearGradient>
        <linearGradient id="ln-steel-h" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#AFC0BC" /><stop offset="0.5" stopColor="#EEF3F2" /><stop offset="1" stopColor="#AFC0BC" /></linearGradient>
        <linearGradient id="ln-heat" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#E6A08A" /><stop offset="1" stopColor="#9B4630" /></linearGradient>
        <linearGradient id="ln-cool" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#D9F1EE" /><stop offset="1" stopColor="#8CCFC7" /></linearGradient>
        <linearGradient id="ln-glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0E2E25" stopOpacity="0.9" /><stop offset="1" stopColor="#1F4E41" /></linearGradient>
        <radialGradient id="ln-film" cx="0.5" cy="0.5" r="0.5"><stop offset="0.2" stopColor="#F4F8F7" /><stop offset="1" stopColor="#B9CAC7" /></radialGradient>
        <radialGradient id="ln-glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stopColor="#F2C46D" stopOpacity="0.55" /><stop offset="1" stopColor="#F2C46D" stopOpacity="0" /></radialGradient>
      </defs>
      <title>{title}</title>

      {/* floor shadow, legs and machine bed */}
      <ellipse cx={700} cy={404} rx={690} ry={14} fill="#000" opacity={0.16} />
      {LEGS.map((x) => <g key={x}><rect x={x - 11} y={334} width={22} height={64} rx={4} fill="#8FA7A1" /><rect x={x - 19} y={394} width={38} height={8} rx={4} fill="#6F8781" /></g>)}
      <rect x={34} y={298} width={1332} height={38} rx={12} fill="url(#ln-steel)" stroke="#fff" strokeOpacity={0.5} />
      <rect x={34} y={326} width={1332} height={10} rx={5} fill="#000" opacity={0.08} />

      {/* the film web: base film, moving dashes, formed pockets, tablets and lidding foil */}
      <path d="M176 226 Q 205 250 245 250 H 1122" fill="none" stroke="#DCE8E4" strokeWidth={12} strokeLinecap="round" opacity={0.9} />
      <path d="M176 226 Q 205 250 245 250 H 1122" fill="none" stroke="#174135" strokeWidth={2.5} className="twin-web" opacity={0.55} />
      {Array.from({ length: 24 }, (_, k) => 398 + k * 30).map((x, k) => (
        <g key={x}>
          <rect x={x - 10} y={251} width={20} height={12} rx={6} fill="#EAF1EF" stroke="#7F9783" strokeOpacity={0.45} />
          {x > 565 && <circle cx={x} cy={256} r={5.5} fill={PILLS[k % PILLS.length]} stroke="#174135" strokeOpacity={0.25} />}
        </g>
      ))}
      <path d="M758 247 H 1122" stroke="#E4EBEA" strokeWidth={5} strokeLinecap="round" />
      <path d="M758 247 H 1122" stroke="#9FB3AE" strokeWidth={1} strokeDasharray="3 5" />

      {/* 1 unwind: reel of PVC film */}
      <g opacity={dim("unwind")} className="station-shot">
        <rect x={112} y={190} width={16} height={110} fill="#6F8781" />
        <g className="twin-reel" style={{ ["--reel-dur" as string]: "7s" }}>
          <circle cx={120} cy={186} r={84} fill="url(#ln-steel-h)" stroke="#fff" strokeOpacity={0.7} strokeWidth={2} />
          <circle cx={120} cy={186} r={62} fill="url(#ln-film)" />
          {[50, 38].map((r) => <circle key={r} cx={120} cy={186} r={r} fill="none" stroke="#fff" strokeOpacity={0.5} />)}
          {[0, 120, 240].map((a) => <circle key={a} cx={120 + 73 * Math.cos((a * Math.PI) / 180)} cy={186 + 73 * Math.sin((a * Math.PI) / 180)} r={4} fill="#6F8781" />)}
          <circle cx={120} cy={186} r={15} fill="#355a4f" /><circle cx={120} cy={186} r={5} fill="#C9D6D3" />
        </g>
        <circle cx={212} cy={238} r={10} fill="url(#ln-steel-h)" stroke="#6F8781" />
      </g>

      {/* 2 forming: heater plate on top, vacuum mould below */}
      <g opacity={dim("forming")} className="station-shot">
        <rect x={268} y={112} width={14} height={188} fill="url(#ln-steel-h)" /><rect x={378} y={112} width={14} height={188} fill="url(#ln-steel-h)" />
        <rect x={258} y={100} width={144} height={20} rx={7} fill="url(#ln-steel)" stroke="#fff" strokeOpacity={0.5} />
        <ellipse cx={330} cy={176} rx={70} ry={40} fill="url(#ln-glow)" />
        <rect x={286} y={148} width={88} height={46} rx={9} fill="url(#ln-heat)" />
        <path d="M296 171 l8 -8 l8 8 l8 -8 l8 8 l8 -8 l8 8 l8 -8 l8 8" fill="none" stroke="#F8D9A0" strokeWidth={2.4} strokeLinejoin="round" />
        <rect x={286} y={262} width={88} height={34} rx={7} fill="#4E655F" />
        {[306, 330, 354].map((x) => <ellipse key={x} cx={x} cy={270} rx={9} ry={6} fill="#24382f" />)}
        <path d="M374 284 H 402 V 222" fill="none" stroke="#6F8781" strokeWidth={4} />
        <circle cx={410} cy={206} r={18} fill="#F6FAF9" stroke="#4E655F" strokeWidth={3} />
        <path d="M410 206 L420 196" stroke="#9B4630" strokeWidth={2.5} strokeLinecap="round" /><circle cx={410} cy={206} r={2.5} fill="#24382f" />
      </g>

      {/* 3 filling: hopper, chute, dropping tablets, vision camera */}
      <g opacity={dim("filling")} className="station-shot">
        <path d="M468 98 H592 L562 170 H498 Z" fill="url(#ln-steel)" stroke="#fff" strokeOpacity={0.5} />
        <rect x={488} y={110} width={84} height={34} rx={9} fill="url(#ln-glass)" />
        {[[500, 132, 0], [516, 124, 1], [532, 134, 2], [548, 122, 3], [562, 130, 1], [508, 138, 3]].map(([x, y, c], k) => <circle key={k} cx={x} cy={y} r={5} fill={PILLS[c]} />)}
        <rect x={518} y={168} width={24} height={42} fill="url(#ln-steel-h)" />
        <rect x={512} y={206} width={36} height={10} rx={5} fill="#24382f" />
        {[0, 1, 2].map((k) => (
          <circle key={k} className="twin-pill" cx={530} cy={236} r={6} fill={PILLS[k + 1]} stroke="#174135" strokeOpacity={0.3}
            style={{ ["--pill-dur" as string]: "1.5s", animationDelay: `${k * 0.5}s` }} />
        ))}
        <rect x={592} y={148} width={44} height={28} rx={7} fill="#24382f" />
        <circle cx={602} cy={176} r={6} fill="#7FE0C8" />
        <path d="M602 180 L586 246 H 624 Z" fill="#7FE0C8" opacity={0.18} />
      </g>

      {/* 4 sealing: lidding foil roll and heated rollers */}
      <g opacity={dim("sealing")} className="station-shot">
        <rect x={676} y={168} width={10} height={132} fill="url(#ln-steel-h)" /><rect x={754} y={168} width={10} height={132} fill="url(#ln-steel-h)" />
        <g className="twin-reel" style={{ ["--reel-dur" as string]: "5s" }}>
          <circle cx={664} cy={118} r={34} fill="url(#ln-steel-h)" stroke="#fff" strokeOpacity={0.7} />
          <circle cx={664} cy={118} r={22} fill="#E4EBEA" /><circle cx={664} cy={118} r={7} fill="#355a4f" />
          <circle cx={690} cy={118} r={3} fill="#6F8781" />
        </g>
        <path d="M690 136 Q 700 190 704 214" fill="none" stroke="#C9D6D3" strokeWidth={4} />
        <circle cx={720} cy={214} r={44} fill="url(#ln-glow)" />
        <circle cx={720} cy={214} r={32} fill="url(#ln-heat)" stroke="#fff" strokeOpacity={0.5} />
        <circle cx={720} cy={214} r={12} fill="#7c3824" />
        <circle cx={720} cy={286} r={32} fill="url(#ln-steel-h)" stroke="#fff" strokeOpacity={0.6} />
        <circle cx={720} cy={286} r={12} fill="#6F8781" />
      </g>

      {/* 5 cooling: chilled plates with flowing water */}
      <g opacity={dim("cooling")} className="station-shot">
        <rect x={846} y={194} width={88} height={36} rx={9} fill="url(#ln-cool)" stroke="#1F8A82" strokeOpacity={0.6} />
        <rect x={846} y={266} width={88} height={30} rx={9} fill="url(#ln-cool)" stroke="#1F8A82" strokeOpacity={0.6} />
        <path d="M846 178 q11 -10 22 0 t22 0 t22 0 t22 0" fill="none" stroke="#1F8A82" strokeWidth={4} strokeLinecap="round" className="twin-web" style={{ ["--web-dur" as string]: "0.9s" }} />
        {[866, 890, 914].map((x) => <path key={x} d={`M${x} 204 q-5 8 0 12 q5 -4 0 -12`} fill="#1F8A82" opacity={0.6} />)}
      </g>

      {/* 6 punching: press with a moving punch and the cut cards */}
      <g opacity={dim("punching")} className="station-shot">
        <rect x={1010} y={98} width={122} height={22} rx={7} fill="url(#ln-steel)" stroke="#fff" strokeOpacity={0.5} />
        <rect x={1014} y={112} width={14} height={188} fill="url(#ln-steel-h)" /><rect x={1114} y={112} width={14} height={188} fill="url(#ln-steel-h)" />
        <g className="twin-punch" style={{ ["--punch-dur" as string]: "1.3s" }}>
          <rect x={1063} y={118} width={14} height={66} fill="#4E655F" />
          <rect x={1038} y={180} width={64} height={28} rx={7} fill="url(#ln-steel)" stroke="#4E655F" strokeWidth={2} />
          <path d="M1042 208 H1098" stroke="#24382f" strokeWidth={3} />
        </g>
        <rect x={1036} y={262} width={68} height={30} rx={7} fill="#4E655F" />
        <rect x={1050} y={262} width={40} height={6} fill="#24382f" />
        {[[1150, 280, 14], [1172, 290, -10]].map(([x, y, r], k) => (
          <g key={k} transform={`translate(${x} ${y}) rotate(${r})`}>
            <rect x={-18} y={-10} width={36} height={20} rx={5} fill="#E4EBEA" stroke="#9FB3AE" />
            {[-9, 0, 9].map((cx) => <circle key={cx} cx={cx} cy={0} r={3.5} fill={PILLS[(k + Math.round(cx / 9) + 4) % 4]} />)}
          </g>
        ))}
      </g>

      {/* 7 cartoning: conveyor, carton and the main drive motor */}
      <g opacity={dim("cartoning")} className="station-shot">
        <path d="M1132 296 H 1208" stroke="#6F8781" strokeWidth={4} />
        {[1146, 1170, 1194].map((x) => <circle key={x} cx={x} cy={296} r={5} fill="#C9D6D3" stroke="#6F8781" />)}
        <path d="M1206 196 l-26 -22 h52 z" fill="#E2D3B3" stroke="#C9B48F" />
        <path d="M1324 196 l26 -22 h-52 z" fill="#E2D3B3" stroke="#C9B48F" />
        <rect x={1206} y={196} width={118} height={96} rx={7} fill="#F0E8D6" stroke="#C9B48F" strokeWidth={2} />
        <rect x={1226} y={222} width={78} height={14} rx={3} fill="#fff" opacity={0.7} />
        <text x={1265} y={260} textAnchor="middle" fontFamily={MONO} fontSize={11} letterSpacing={1.5} fill="#8C7650">10 x BLISTER</text>
        <circle cx={1265} cy={317} r={15} fill="#4E655F" stroke="#fff" strokeOpacity={0.5} /><circle cx={1265} cy={317} r={5} fill="#C9D6D3" />
        {[0, 1, 2].map((k) => <path key={k} className="twin-pulse" d={`M${1287 + k * 8} 306 q6 11 0 22`} fill="none" stroke="#9B4630" strokeWidth={2} opacity={0.6} style={{ animationDelay: `${k * 0.2}s` }} />)}
      </g>

      {/* status lights and labels */}
      {STATIONS.map((s, i) => {
        const on = active === s.id;
        return (
          <g key={s.id} opacity={active && !on ? 0.55 : 1} className="station-shot">
            <circle cx={s.x} cy={70} r={14} fill="#54B88C" opacity={0.22} />
            <circle cx={s.x} cy={70} r={7} fill="#54B88C" />
            <rect x={s.x - 58} y={350} width={116} height={28} rx={14} fill={on ? "#1F8A82" : "#F6FAF9"} stroke={on ? "#1F8A82" : "#C9D6D3"} />
            <text x={s.x} y={369} textAnchor="middle" fontFamily={MONO} fontSize={12} fontWeight={700} letterSpacing={1.2} fill={on ? "#fff" : "#355a4f"}>
              {String(i + 1).padStart(2, "0")} {s.label.toUpperCase()}
            </text>
          </g>
        );
      })}
    </svg>
  );
});

export default memo(LineIllustration);
