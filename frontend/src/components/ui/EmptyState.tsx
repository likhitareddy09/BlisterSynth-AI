import type { ReactNode } from "react";

export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-3xl border border-dashed border-line px-6 py-10 text-center">
      {icon && <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">{icon}</span>}
      <p className="font-display font-semibold">{title}</p>
      {hint && <p className="max-w-sm text-sm text-soft">{hint}</p>}
      {action}
    </div>
  );
}
