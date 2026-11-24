# BlisterSynth AI: run and deploy guide (v0.7.0)

## 1. What you need installed

| Tool | Version | Check with |
|---|---|---|
| Python | 3.10 – 3.12 (3.11 recommended) | `python --version` |
| Node.js | 20 or newer (includes npm) | `node --version` |
| Disk space | ~3 GB (PyTorch is the big one) | |
| RAM | 8 GB is comfortable (training uses CPU) | |
| Internet | only for the first install; the app itself runs offline (except the optional Claude copilot) | |

Optional: an Anthropic API key for the Scenario Copilot. Without one, the built-in rule-based parser is used automatically.

## 2. First-time setup (once)

```bash
# backend
cd blistersynth-ai/backend
python -m venv .venv
.venv\Scripts\activate                 # Windows
# source .venv/bin/activate            # macOS / Linux
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt

# optional: Claude copilot
copy .env.example .env                  # Windows  (macOS/Linux: cp .env.example .env)
# then open .env and set ANTHROPIC_API_KEY=sk-ant-...

# frontend
cd ../frontend
npm install
```

## 3. Check everything works

```bash
cd backend
python scripts/smoke_test.py            # ~5 s
python scripts/test_phase2.py
python scripts/test_phase3.py
python scripts/test_phase4.py
python scripts/test_phase5.py
python scripts/test_phase7.py           # ~4 min
cd ../frontend
npm run typecheck
npx vitest run                          # ~196 tests
```
Every backend script must end with `ALL CHECKS PASSED`. vitest must show 0 failed.

## 4. Run it

### Option A: development (two terminals, hot reload)
```bash
# terminal 1
cd backend && .venv\Scripts\activate && uvicorn app.main:app --port 8000
# terminal 2
cd frontend && npm run dev
```
Open **http://localhost:5173**.

### Option B: single server (best for the viva/demo)
```bash
cd frontend && npm run build            # creates frontend/dist
cd ../backend && .venv\Scripts\activate && uvicorn app.main:app --port 8000
```
Open **http://localhost:8000/app/**. One terminal only; nothing to proxy.

### Option C: Docker (any machine with Docker)
```bash
cd blistersynth-ai
docker build -t blistersynth .
docker run -p 8000:8000 -v blistersynth-data:/data blistersynth
# with the Claude copilot:  add  --env-file backend/.env  (the file must exist)
```
Open **http://localhost:8000/app/**.

## 5. Deploying online (optional)

Any host that runs a Docker image **and supports WebSockets** works (Render, Railway, Fly.io, a cloud VM).
- Use the Dockerfile above. The container reads `$PORT`, which most hosts set for you.
- Attach a **persistent disk/volume at `/data`**, otherwise runs, models and the SQLite DB vanish on every redeploy.
- Set `ANTHROPIC_API_KEY` as a secret in the host's dashboard (never commit `.env`).
- Choose at least **2 GB RAM**. Training the generators on a free 512 MB tier will crash.
- Keep **one worker** (already set). Training jobs are tracked in memory, so several workers would not see each other's jobs.
- The app has **no login**. If you put it on the public internet, anyone with the link can use it and spend your API credits. Share the link only with your evaluators, or take it down after the viva.

## 6. Before the viva

1. Start the server (Option B) and open `/app/`.
2. Train **one generator** (Generative page, defaults) and **one PdM model** (PdM page). The demo's last steps show their results.
3. Open the Quality page once so the report is computed and cached in your head.
4. Press **?** → *Play demo* (or Ctrl+K → "Start demo mode") and do a full rehearsal.
5. Turn off sleep/screen saver; keep a backup screen recording of the demo.

## 7. Common problems

| Symptom | Fix |
|---|---|
| `pip` tries to download ~2 GB of CUDA | Install torch first with the CPU index URL (step 2). |
| `ModuleNotFoundError: fastapi` | The virtual environment isn't active. Run the `activate` line again. |
| Parquet download fails | `pip install pyarrow` (it is in requirements.txt). |
| UI says "Backend offline" | The backend isn't running on port 8000, or another app uses that port (`--port 8001` + update the Vite proxy). |
| Live page stuck on "connecting" behind a proxy/host | The host must allow WebSockets on `/ws/stream`. |
| Copilot always says "rules" | `backend/.env` missing or key empty; restart uvicorn after editing `.env`. |
| `npm run build` complains about an icon name | Rename `AlertTriangle`→`TriangleAlert`, `CheckCircle2`→`CircleCheck`, `Loader2`→`LoaderCircle`. |
