# BlisterSynth AI - frontend (Phase 5 design + Phase 6 live twin)

React 18 + TypeScript + Vite + Tailwind CSS + Framer Motion + Recharts + lucide-react + react-router (HashRouter).

    npm install
    npm run dev        # http://localhost:5173  (proxies /api and /ws to the backend on :8000)
    npm test           # vitest
    npm run typecheck
    npm run build      # then the backend serves it at http://localhost:8000/app/

Routes (hash based, so they work in dev and when served by FastAPI): `/#/` landing, `/#/app` overview,
`/#/app/live`, `/simulator`, `/runs`, `/generative`, `/pdm`.

Where things are
- `src/index.css`, `tailwind.config.js` - colour tokens (CSS variables, light + dark), fonts, twin animations
- `src/components/ui/` - design-system kit (Button, Card, Badge, StatCard, Gauge, Skeleton, Toast, Modal, Tabs, Toggle, Select, Slider, Field, EmptyState, PageHeader, ProductCard)
- `src/components/twin/DigitalTwin.tsx` - animated SVG line; `src/lib/twin.ts` - status + speed mapping
- `src/components/live/` - KPI strip, anomaly card, alerts, fault timeline, sensor charts, controls
- `src/lib/live.ts` - anomaly score, alert de-duplication, fault timeline (pure, unit-tested)
- `src/api/stream.ts` - WebSocket hook; `{ batch: true }` buffers ticks and flushes on animation frames
- `src/layout/AppShell.tsx` - collapsible sidebar, top bar, search, theme toggle
