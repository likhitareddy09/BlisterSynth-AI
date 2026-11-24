import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

export type ToastTone = "info" | "success" | "warning" | "error";
export interface ToastItem { id: number; title: string; message?: string; tone: ToastTone }
interface ToastApi { push: (t: { title: string; message?: string; tone?: ToastTone; ms?: number }) => void }

const Ctx = createContext<ToastApi>({ push: () => undefined });
export const useToast = () => useContext(Ctx);

const ICON = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: AlertTriangle } as const;
const COLOR: Record<ToastTone, string> = { info: "text-teal", success: "text-ok", warning: "text-warn", error: "text-rust" };
const MAX_TOASTS = 4;

/** Wrap the app once; call `useToast().push({...})` anywhere. Toasts auto-dismiss and are announced to screen readers. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setItems((l) => l.filter((t) => t.id !== id));
  }, []);
  const push = useCallback<ToastApi["push"]>(({ title, message, tone = "info", ms = 5000 }) => {
    const id = ++seq.current;
    setItems((l) => [...l, { id, title, message, tone }].slice(-MAX_TOASTS));
    timers.current.set(id, setTimeout(() => dismiss(id), ms));
  }, [dismiss]);
  const api = useMemo(() => ({ push }), [push]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(92vw,22rem)] flex-col gap-2" role="region" aria-label="Notifications" aria-live="polite">
        <AnimatePresence initial={false}>
          {items.map((t) => {
            const Icon = ICON[t.tone];
            return (
              <motion.div
                key={t.id} layout initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 40 }} transition={{ duration: 0.2 }}
                className="pointer-events-auto flex gap-3 rounded-2xl border border-line bg-surface p-3 pr-2 shadow-float"
              >
                <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${COLOR[t.tone]}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{t.title}</p>
                  {t.message && <p className="text-xs text-soft">{t.message}</p>}
                </div>
                <button aria-label="Dismiss notification" onClick={() => dismiss(t.id)} className="grid h-7 w-7 place-items-center rounded-full text-soft hover:bg-tint">
                  <X className="h-4 w-4" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
