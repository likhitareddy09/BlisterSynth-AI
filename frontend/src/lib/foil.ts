// The faint foil shine on cards follows the mouse. One document-level listener writes the pointer position into the
// --mx / --my CSS variables of the `.foil` element under the pointer (at most once per animation frame), and the CSS in
// index.css draws the shine there. No React state, so moving the mouse never re-renders anything.

/** Pointer position relative to an element's box, as CSS pixel strings. Pure, so it can be unit-tested. */
export function localPoint(clientX: number, clientY: number, rect: { left: number; top: number }): { mx: string; my: string } {
  return { mx: `${Math.round(clientX - rect.left)}px`, my: `${Math.round(clientY - rect.top)}px` };
}

export function installFoilTracking(doc: Document = document): () => void {
  const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16) as unknown as number;
  const caf = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : (id: number) => clearTimeout(id);
  let frame = 0;
  let last: PointerEvent | null = null;
  const apply = () => {
    frame = 0;
    const e = last;
    if (!e) return;
    const target = e.target as Element | null;
    const el = target && typeof target.closest === "function" ? (target.closest(".foil") as HTMLElement | null) : null;
    if (!el) return;
    const { mx, my } = localPoint(e.clientX, e.clientY, el.getBoundingClientRect());
    el.style.setProperty("--mx", mx);
    el.style.setProperty("--my", my);
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerType && e.pointerType !== "mouse") return;          // touch and pen: no hover, no shine
    last = e;
    if (!frame) frame = raf(apply);
  };
  doc.addEventListener("pointermove", onMove, { passive: true });
  return () => { doc.removeEventListener("pointermove", onMove); if (frame) caf(frame); };
}
