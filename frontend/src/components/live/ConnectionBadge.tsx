import type { StreamStatus } from "../../api/stream";

/** Connection state of the live stream (it auto-reconnects every 2 s after a drop). */
export default function ConnectionBadge({ status }: { status: StreamStatus }) {
  const cfg = {
    open: { dot: "bg-ok", text: "Live" },
    connecting: { dot: "bg-warn animate-pulse", text: "Connecting..." },
    closed: { dot: "bg-rust animate-pulse", text: "Disconnected - retrying" },
  }[status];
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-sm font-medium shadow-card" role="status">
      <span className={`h-2.5 w-2.5 rounded-full ${cfg.dot}`} aria-hidden />
      <span>{cfg.text}</span>
    </span>
  );
}
