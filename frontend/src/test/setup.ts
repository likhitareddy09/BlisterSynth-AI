// jsdom has no ResizeObserver, IntersectionObserver or matchMedia; Recharts / framer-motion / the theme hook expect them.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub;
class IntersectionObserverStub { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver ??= IntersectionObserverStub;
if (!window.matchMedia) {
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// The first-visit product tour is skipped in tests (otherwise its overlay would sit on top of every page).
// tour.test / phase7b.test clear this flag themselves when they test the tour.
beforeEach(() => { try { localStorage.setItem("bs-tour-done", "1"); } catch { /* ignore */ } });
