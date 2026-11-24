import { AlertTriangle, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { Card as UiCard } from "./ui/Card";
import type { ComponentProps } from "react";

export function ErrorBanner({ error, onClose }: { error: string | null; onClose?: () => void }) {
  if (!error) return null;
  return (
    <div className="banner error flex items-start gap-3 rounded-2xl bg-rust/10 px-4 py-3 text-sm text-rust" role="alert">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span className="flex-1">{error}</span>
      {onClose && (
        <button className="link rounded-full p-0.5 hover:bg-rust/15" aria-label="dismiss" onClick={onClose}><X className="h-4 w-4" /></button>
      )}
    </div>
  );
}

/** Same name and props as before (title + children + actions); now the design-system card. */
export function Card(props: ComponentProps<typeof UiCard>) { return <UiCard {...props} />; }

export const errMsg = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : String(e));

/** Run an async action with loading + error state:  const [run, busy, error, clear] = useAction(fn). */
export function useAction<A extends unknown[], R>(fn: (...a: A) => Promise<R>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (...a: A): Promise<R | undefined> => {
    setBusy(true); setError(null);
    try { return await fn(...a); } catch (e) { setError(errMsg(e)); return undefined; } finally { setBusy(false); }
  }, [fn]);
  return [run, busy, error, () => setError(null)] as const;
}

/** Load data on mount (and on `reload()`), exposing loading/error. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    loader().then((d) => alive && (setData(d), setError(null))).catch((e) => alive && setError(errMsg(e)));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);
  return { data, error, reload: () => setTick((t) => t + 1) };
}

export const fmtDate = (iso: string) => new Date(iso).toLocaleString();
/** Chart colours: teal first (brand chart line), rust is reserved for faults, the rest are harmonised. */
export const COLORS = ["#1F9E93", "#C97B3A", "#5B7FA6", "#7F9783", "#8E6BB0", "#B9A24A"];
export const FAULT_COLOR = "#9B4630";
