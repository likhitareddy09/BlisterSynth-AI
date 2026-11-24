/** Grey pulsing placeholder shown while data loads. */
export function Skeleton({ className = "", lines }: { className?: string; lines?: number }) {
  if (lines) {
    return (
      <div className="space-y-2" aria-hidden>
        {Array.from({ length: lines }, (_, i) => <div key={i} className={`h-4 animate-pulse rounded-lg bg-line/70 ${i === lines - 1 ? "w-2/3" : "w-full"}`} />)}
      </div>
    );
  }
  return <div aria-hidden className={`animate-pulse rounded-2xl bg-line/70 ${className}`} />;
}
