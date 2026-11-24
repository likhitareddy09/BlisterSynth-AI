import type { ReactNode } from "react";
import { Button } from "./Button";

/** Product-style card: pale image area on top, title + meta, full-width green button (the Dribbble "product card"). */
export function ProductCard({ visual, title, meta, badge, actionLabel, onAction }: {
  visual: ReactNode; title: string; meta?: ReactNode; badge?: ReactNode; actionLabel: string; onAction: () => void;
}) {
  return (
    <article className="foil flex flex-col overflow-hidden rounded-3xl bg-surface p-3 shadow-card">
      <div className="relative grid h-32 place-items-center rounded-2xl bg-pastel-green text-primary">
        {visual}
        {badge && <div className="absolute left-2 top-2">{badge}</div>}
      </div>
      <div className="flex-1 px-2 pb-3 pt-3">
        <h4 className="truncate font-display text-base font-semibold" title={title}>{title}</h4>
        {meta && <div className="mt-0.5 text-xs text-soft">{meta}</div>}
      </div>
      <Button full onClick={onAction}>{actionLabel}</Button>
    </article>
  );
}
