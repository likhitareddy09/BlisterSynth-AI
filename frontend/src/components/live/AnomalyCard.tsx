import { memo, useMemo } from "react";
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";
import type { LiveRow } from "../../api/types";
import { anomalyScore, decimate } from "../../lib/live";
import { Card, Gauge } from "../ui";

/** Anomaly gauge (0-100) plus a mini history chart. Score = 100 - min(station health). */
function AnomalyCardImpl({ rows }: { rows: LiveRow[] }) {
  const last = rows[rows.length - 1];
  const score = anomalyScore(last);
  const data = useMemo(() => decimate(rows, 80).map((r) => ({ t: r.t_s, v: anomalyScore(r) })), [rows]);
  return (
    <Card title="Anomaly score" className="flex flex-col items-center">
      <Gauge value={score} label={score >= 60 ? "Critical" : score >= 30 ? "Watch" : "Normal"} tone="good-low" />
      <div className="mt-2 h-20 w-full" role="img" aria-label="Anomaly score history">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <YAxis hide domain={[0, 100]} />
            <Area type="monotone" dataKey="v" stroke="#9B4630" fill="#9B4630" fillOpacity={0.18} strokeWidth={2} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
export default memo(AnomalyCardImpl);
