import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

const WIDTHS = { md: "max-w-md", lg: "max-w-xl", xl: "max-w-3xl" } as const;

/**
 * Centered dialog. Esc or a click on the backdrop closes it; focus moves into the dialog while open.
 * Optional (all default to the old look): `size` = width, `top` = sit near the top of the screen (command palette),
 * `bare` = no padding / no visible title bar (the content brings its own header; the title is still the accessible name).
 */
export function Modal({ open, onClose, title, children, footer, size = "md", top = false, bare = false }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode;
  size?: keyof typeof WIDTHS; top?: boolean; bare?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className={`fixed inset-0 z-[90] grid bg-black/40 p-4 backdrop-blur-sm ${top ? "place-items-start justify-items-center pt-[12vh]" : "place-items-center"}`}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
          <motion.div
            ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
            initial={{ opacity: 0, y: 20, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10 }}
            onMouseDown={(e) => e.stopPropagation()}
            className={`w-full ${WIDTHS[size]} rounded-3xl bg-surface shadow-float outline-none ${bare ? "overflow-hidden" : "p-6"}`}
          >
            {!bare && <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{title}</h2>
              <button aria-label="Close dialog" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full text-soft hover:bg-tint"><X className="h-4 w-4" /></button>
            </div>}
            {children}
            {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
