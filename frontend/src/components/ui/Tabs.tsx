import { type KeyboardEvent, type ReactNode } from "react";

export interface TabItem<T extends string> { value: T; label: ReactNode }

/** Accessible pill tabs (arrow keys move between tabs). Controlled: pass `value` and `onChange`. */
export function Tabs<T extends string>({ items, value, onChange, label = "Tabs" }: {
  items: TabItem<T>[]; value: T; onChange: (v: T) => void; label?: string;
}) {
  const onKey = (e: KeyboardEvent) => {
    const i = items.findIndex((t) => t.value === value);
    if (e.key === "ArrowRight") onChange(items[(i + 1) % items.length].value);
    if (e.key === "ArrowLeft") onChange(items[(i - 1 + items.length) % items.length].value);
  };
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKey} className="inline-flex max-w-full gap-1 overflow-x-auto rounded-full bg-tint p-1">
      {items.map((t) => (
        <button key={t.value} role="tab" aria-selected={t.value === value} tabIndex={t.value === value ? 0 : -1}
          onClick={() => onChange(t.value)}
          className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition ${t.value === value ? "bg-surface text-ink shadow-sm" : "text-soft hover:text-ink"}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
