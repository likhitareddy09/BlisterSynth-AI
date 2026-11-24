# Phase 5 - React dashboard (frontend)

Phase 5 adds the web UI for everything built in Phases 1-4. The backend only gained one small endpoint;
all existing endpoints, the WebSocket protocol and the database are unchanged.

## What was added

| Area | What |
|---|---|
| `frontend/` (new) | React 18 + TypeScript + Vite app. Five tabs: **Live monitor**, **Simulator**, **Runs**, **Generative**, **PdM & quality** |
| `GET /api/overview` (new) | Counts of runs (by kind), scenarios, generative models, PdM models and active training jobs (the header bar) |
| `/app` (new, optional) | If `frontend/dist` exists the backend serves the built UI at http://localhost:8000/app/ |
| Tests | `frontend`: 35 vitest tests; `backend/scripts/test_phase5.py`: API contract the UI depends on |

### Tabs and the endpoints they use
- **Live monitor** - `/ws/stream`: station health tiles, rolling sensor chart (fault periods shaded), pause/resume, speed, reset, inject fault, repair. Reconnects automatically.
- **Simulator** - `/api/simulate`, `/api/faults/catalog`, `/api/scenarios`, `/api/runs/{id}/labels`: configure a run, add up to 8 faults, save/load scenarios, chart the result, download CSV.
- **Runs** - `/api/runs`, `/api/runs/{id}/data`, `/labels`, `/download`, `DELETE`: browse, view, download and delete saved runs.
- **Generative** - `/api/generative/*`: start cVAE/TimeGAN training, watch job progress (polls every 2 s), cancel, delete models, generate synthetic runs.
- **PdM & quality** - `/api/pdm/*`, `/api/quality/compare`: train fault/RUL models, TSTR experiment, predict on a run, fidelity score for a real vs synthetic run.

### Modified backend files (small, backward compatible)
- `app/config.py` - version `0.5.0`, `FRONTEND_DIST`
- `app/database.py` - two read-only helpers (`count_runs_by_kind`, `count_scenarios`)
- `app/main.py` - registers the overview router; mounts `/app` only when a build exists
- `scripts/test_phase4.py` - the version check was pinned to exactly `0.4.0`; it now accepts `>= 0.4.0`

## Run it

```bash
# terminal 1 - backend
cd backend
uvicorn app.main:app --reload --port 8000

# terminal 2 - frontend (dev server with hot reload)
cd frontend
npm install        # first time only
npm run dev        # http://localhost:5173  (proxies /api and /ws to :8000)
```

Single-server mode: `cd frontend && npm run build`, then open http://localhost:8000/app/.

## Tests

```bash
cd backend  && python scripts/test_phase5.py    # ~1-2 min
cd frontend && npm test                          # vitest, a few seconds
cd frontend && npm run typecheck
```
(Phases 1-4: `python scripts/smoke_test.py`, `test_phase2.py`, `test_phase3.py`, `test_phase4.py`.)

## Verify by hand
1. http://localhost:8000/docs -> `GET /api/overview` -> *Try it out*: counts match the header of the UI.
2. UI **Live monitor**: the dot turns green, tiles update. Choose a fault -> *Inject fault*: a station turns amber/red and the chart shades. *Repair* clears it.
3. UI **Simulator**: add a fault, *Run simulation*; the new run appears in **Runs** and in `GET /api/runs` in `/docs`.
4. UI **Generative**: *Start training* with the defaults; progress bar fills; the model then appears in `GET /api/generative/models`.
5. UI **PdM & quality**: *Train model*, then *Predict*; compare a physics and a generated run for a fidelity score.
6. Stop the backend: the UI shows "Backend offline" / "Disconnected - retrying" and recovers when it is back.
