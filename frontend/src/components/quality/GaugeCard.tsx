import type { ReactNode } from "react";
import { gaugeVerdict } from "../../lib/metrics";
import { Badge, Card, Gauge, InfoTip, type Tint } from "../ui";

const TONE = { good: "green", fair: "amber", poor: "red", "n/a": "neutral" } as const;

/** One of the three headline gauges (Fidelity / Utility / Diversity) with its definition in an (i) tooltip. */
export default function GaugeCard({ title, value, definition, detail, tint, extra }: {
  title: string; value: number | null; definition: string; detail: ReactNode; tint: Tint; extra?: ReactNode;
}) {
  const verdict = gaugeVerdict(value);
  return (
    <Card tint={tint} className="flex flex-col items-center text-center">
      <div className="mb-1 flex items-center gap-1.5">
        <h3 className="font-display text-base font-semibold">{title}</h3>
        <InfoTip label={`What is ${title}?`}>{definition}</InfoTip>
      </div>
      {value === null ? <div className="grid h-[137px] place-items-center text-sm text-soft">not available</div>
        : <Gauge value={value} label={title} tone="good-high" />}
      <Badge tone={TONE[verdict]} className="mt-2">{verdict === "n/a" ? "n/a" : verdict}</Badge>
      <p className="mt-2 text-xs text-soft">{detail}</p>
      {extra}
    </Card>
  );
}
