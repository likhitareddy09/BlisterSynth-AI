import { motion, useReducedMotion } from "framer-motion";
import { INFRA, PIPELINE } from "../../lib/about";

// viewBox 1200 x 470. Pipeline boxes run left to right; the infrastructure sits underneath.
const BOX_W = 168, BOX_H = 92, GAP = 25, X0 = 32, Y_PIPE = 110;          // 6 boxes + 5 gaps = 1133 wide, centred in 1200
const nodeX = (i: number) => X0 + i * (BOX_W + GAP);
const Y_BAND = 290, BAND_H = 54;
const Y_INFRA = 385, INFRA_H = 62;

/** Animated architecture diagram: boxes fade in one after the other, the arrows carry moving dashes (CSS, so they cost no JS). */
export default function ArchitectureDiagram() {
  const reduce = useReducedMotion();
  const appear = (i: number) => (reduce ? {} : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.1 + i * 0.12, duration: 0.45 } });
  const mid = (i: number) => nodeX(i) + BOX_W / 2;
  const infraX = [X0, X0 + 431, X0 + 863];
  const infraW = 270;
  return (
    <svg viewBox="0 0 1200 470" className="h-auto w-full" role="img"
      aria-label="Architecture: the simulator feeds faults and labels, then the generative model, the quality report, the PdM models and finally the dashboard. FastAPI, a WebSocket and SQLite sit underneath.">
      <title>BlisterSynth AI architecture</title>
      <defs>
        <marker id="arch-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M1 1 L9 5 L1 9" fill="none" stroke="rgb(var(--primary))" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
        </marker>
      </defs>

      {/* live data path: simulator -> dashboard over the WebSocket (arc above the pipeline) */}
      <path className="twin-web" d={`M${mid(0)} ${Y_PIPE - 4} C ${mid(0)} 20, ${mid(5)} 20, ${mid(5)} ${Y_PIPE - 8}`} fill="none" stroke="rgb(var(--teal))" strokeWidth={3} markerEnd="url(#arch-arrow)" />
      <text x={600} y={36} textAnchor="middle" className="fill-teal" fontSize={17} fontWeight={600}>live ticks over WebSocket</text>

      {/* arrows between pipeline boxes */}
      {PIPELINE.slice(0, -1).map((_, i) => (
        <line key={i} className="twin-web" x1={nodeX(i) + BOX_W + 4} x2={nodeX(i + 1) - 6} y1={Y_PIPE + BOX_H / 2} y2={Y_PIPE + BOX_H / 2}
          stroke="rgb(var(--primary))" strokeWidth={3} markerEnd="url(#arch-arrow)" />
      ))}

      {/* connectors from every pipeline box down to the FastAPI band */}
      {PIPELINE.map((n, i) => (
        <line key={n.id} x1={mid(i)} x2={mid(i)} y1={Y_PIPE + BOX_H} y2={Y_BAND} stroke="rgb(var(--mint))" strokeWidth={2} strokeDasharray="4 6" />
      ))}

      {/* pipeline boxes */}
      {PIPELINE.map((n, i) => {
        const last = i === PIPELINE.length - 1;
        return (
          <motion.g key={n.id} {...appear(i)} data-node={n.id}>
            <rect x={nodeX(i)} y={Y_PIPE} width={BOX_W} height={BOX_H} rx={22} fill={last ? "rgb(var(--primary))" : "rgb(var(--surface))"} stroke="rgb(var(--line))" strokeWidth={2} />
            <text x={mid(i)} y={Y_PIPE + 40} textAnchor="middle" fontSize={18} fontWeight={700} className="font-display" fill={last ? "rgb(var(--on-primary))" : "rgb(var(--ink))"}>{n.title}</text>
            <text x={mid(i)} y={Y_PIPE + 66} textAnchor="middle" fontSize={13} fill={last ? "rgb(var(--on-primary))" : "rgb(var(--soft))"} opacity={last ? 0.85 : 1}>{n.sub}</text>
          </motion.g>
        );
      })}

      {/* FastAPI band */}
      <motion.g {...appear(6)} data-node="fastapi-band">
        <rect x={X0} y={Y_BAND} width={1133} height={BAND_H} rx={20} fill="rgb(var(--pastel-green))" stroke="rgb(var(--sage))" strokeWidth={2} />
        <text x={600} y={Y_BAND + 33} textAnchor="middle" fontSize={19} fontWeight={700} className="font-display" fill="rgb(var(--ink))">FastAPI backend - one validated API for every stage</text>
      </motion.g>

      {/* infrastructure boxes */}
      {INFRA.map((n, i) => (
        <motion.g key={n.id} {...appear(7 + i)} data-node={n.id}>
          <line x1={infraX[i] + infraW / 2} x2={infraX[i] + infraW / 2} y1={Y_BAND + BAND_H} y2={Y_INFRA} stroke="rgb(var(--sage))" strokeWidth={2} strokeDasharray="4 6" />
          <rect x={infraX[i]} y={Y_INFRA} width={infraW} height={INFRA_H} rx={18} fill="rgb(var(--surface))" stroke="rgb(var(--sage))" strokeWidth={2} />
          <text x={infraX[i] + infraW / 2} y={Y_INFRA + 28} textAnchor="middle" fontSize={18} fontWeight={700} className="font-display" fill="rgb(var(--ink))">{n.title}</text>
          <text x={infraX[i] + infraW / 2} y={Y_INFRA + 49} textAnchor="middle" fontSize={13} fill="rgb(var(--soft))">{n.sub}</text>
        </motion.g>
      ))}
    </svg>
  );
}
