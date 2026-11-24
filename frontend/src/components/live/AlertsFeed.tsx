import { BellOff, OctagonAlert, TriangleAlert } from "lucide-react";
import { memo } from "react";
import { formatTime } from "../../lib/chart";
import type { Alert } from "../../lib/live";
import { Badge, Button, Card } from "../ui";

function AlertsFeedImpl({ alerts, onClear }: { alerts: Alert[]; onClear: () => void }) {
  return (
    <Card title="Alerts" actions={alerts.length > 0 ? <Button variant="ghost" size="sm" onClick={onClear}>Clear</Button> : undefined}>
      {alerts.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-soft"><BellOff className="h-6 w-6" aria-hidden />No alerts. Inject a fault to see one.</div>
      ) : (
        <ul className="max-h-72 space-y-2 overflow-y-auto pr-1" aria-live="polite" aria-label="Alerts feed">
          {alerts.map((a) => (
            <li key={a.id} className={`flex gap-3 rounded-2xl p-3 ${a.severity === "critical" ? "bg-rust/10" : "bg-warn/10"}`}>
              {a.severity === "critical" ? <OctagonAlert className="mt-0.5 h-5 w-5 shrink-0 text-rust" aria-hidden /> : <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-warn" aria-hidden />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={a.severity === "critical" ? "red" : "amber"}>{a.severity}</Badge>
                  <span className="text-sm font-semibold">{a.label}</span>
                  <span className="ml-auto text-xs text-soft">t = {formatTime(a.t_s)}</span>
                </div>
                <p className="mt-1 text-xs text-soft">{a.message}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
export default memo(AlertsFeedImpl);
