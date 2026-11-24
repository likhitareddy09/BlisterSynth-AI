import { memo, useMemo } from "react";
import type { FaultType } from "../../api/types";
import { formatTime } from "../../lib/chart";
import type { FaultSpan } from "../../lib/live";
import { Card } from "../ui";

/** One horizontal swim-lane per fault type; bars show when each fault was active. Open bars grow to "now". */
function FaultTimelineImpl({ spans, faultTypes, now }: { spans: FaultSpan[]; faultTypes: FaultType[]; now: number }) {
  const lanes = useMemo(() => {
    const keys = faultTypes.map((f) => f.key);
    for (const s of spans) if (!keys.includes(s.type)) keys.push(s.type);
    return keys.map((k) => ({ key: k, label: faultTypes.find((f) => f.key === k)?.label ?? k }));
  }, [faultTypes, spans]);
  const start = spans.length ? Math.min(...spans.map((s) => s.start_s)) : 0;
  const end = Math.max(now, start + 60);
  const pos = (t: number) => `${(((t - start) / (end - start)) * 100).toFixed(2)}%`;
  return (
    <Card title="Fault timeline" actions={<span className="text-xs text-soft">{spans.length} fault event{spans.length === 1 ? "" : "s"}</span>}>
      <div role="img" aria-label={`Fault timeline: ${spans.length} events`} className="space-y-1.5">
        {lanes.map((l) => {
          const mine = spans.filter((s) => s.type === l.key);
          return (
            <div key={l.key} className="flex items-center gap-3">
              <span className="w-28 shrink-0 truncate text-xs text-soft sm:w-36" title={l.label}>{l.label}</span>
              <div className="relative h-5 flex-1 rounded-full bg-tint">
                {mine.map((s, i) => (
                  <span key={i} title={`${l.label}: ${formatTime(s.start_s)} - ${s.end_s === null ? "active" : "repaired " + formatTime(s.end_s)}`}
                    className={`absolute top-0.5 h-4 rounded-full bg-rust ${s.end_s === null ? "twin-pulse" : "opacity-80"}`}
                    style={{ left: pos(s.start_s), width: `max(6px, calc(${pos(s.end_s ?? end)} - ${pos(s.start_s)}))` }} />
                ))}
              </div>
            </div>
          );
        })}
        {lanes.length === 0 && <p className="text-sm text-soft">Waiting for the fault catalogue...</p>}
      </div>
      <div className="mt-2 flex justify-between pl-[7.75rem] text-xs text-soft sm:pl-[9.75rem]"><span>{formatTime(start)}</span><span>{formatTime(end)}</span></div>
    </Card>
  );
}
export default memo(FaultTimelineImpl);
