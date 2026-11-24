import { shortSensor } from "../../lib/metrics";

interface Props {
  labels: string[]; matrix: number[][]; color: (v: number) => string; title: string;
  /** write the number inside each cell (only readable for small matrices) */
  showValues?: boolean; decimals?: number; rowLabels?: string[]; format?: (v: number, r: number, c: number) => string;
}

/** SVG heat map. Cell colour comes from `color(value)`; every cell has a <title> tooltip. Works in light and dark mode. */
export default function Heatmap({ labels, matrix, color, title, showValues, decimals = 2, rowLabels, format }: Props) {
  const n = matrix.length, m = matrix[0]?.length ?? 0;
  const rows = rowLabels ?? labels;
  // leave room for the longest labels (about 5 px per character at font-size 9)
  const longest = (a: string[]) => a.reduce((mx, l) => Math.max(mx, shortSensor(l).length), 0);
  const left = Math.max(96, longest(rows) * 5 + 14), top = Math.max(78, longest(labels) * 4 + 22), cell = Math.max(18, Math.min(34, Math.floor(360 / Math.max(n, m, 1))));
  const w = left + m * cell + Math.max(46, longest(labels) * 3), h = top + n * cell + 8;
  return (
    // phones: keep the matrix at a readable size and let it scroll sideways instead of shrinking the labels to 5 px
    <div className="-mx-1 overflow-x-auto px-1"><svg viewBox={`0 0 ${w} ${h}`} className="w-full min-w-[440px] lg:min-w-0" role="img" aria-label={title}>
      {labels.map((l, j) => (
        <text key={`c${j}`} transform={`translate(${left + j * cell + cell / 2},${top - 6}) rotate(-50)`} fontSize={9} className="fill-soft">{shortSensor(l)}</text>
      ))}
      {rows.map((l, i) => (
        <text key={`r${i}`} x={left - 6} y={top + i * cell + cell / 2 + 3} textAnchor="end" fontSize={9} className="fill-soft">{shortSensor(l)}</text>
      ))}
      {matrix.map((row, i) => row.map((v, j) => (
        <g key={`${i}-${j}`}>
          <rect x={left + j * cell} y={top + i * cell} width={cell - 1} height={cell - 1} rx={3} fill={color(v)} className="stroke-line" strokeWidth={0.5}>
            <title>{`${rows[i]} / ${labels[j]}: ${format ? format(v, i, j) : v.toFixed(decimals)}`}</title>
          </rect>
          {showValues && (
            <text x={left + j * cell + cell / 2 - 0.5} y={top + i * cell + cell / 2 + 3} textAnchor="middle" fontSize={cell > 26 ? 9 : 7.5} className="fill-ink" pointerEvents="none">
              {format ? format(v, i, j) : v.toFixed(decimals)}
            </text>
          )}
        </g>
      )))}
    </svg></div>
  );
}
