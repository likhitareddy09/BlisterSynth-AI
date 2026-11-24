# BlisterSynth AI - Phase 3: generative models

Run from `backend/`:  `pip install -r requirements.txt`, then `uvicorn app.main:app --reload --port 8000` and open `/docs`.
Tests: `python scripts/test_phase3.py` (about 2 minutes on CPU, needs torch). `scripts/test_phase2.py` still passes.

## How it works
* **Conditions come from the physics layer:** speed fraction (deterministic profile), humidity phase, two heater
  warm-up factors, and the 8 fault severities (severity x intensity).
* **Speed is not generated.** `line_speed_bpm`, `machine_state`, labels and RUL are copied from the physics run for the
  same request and seed, so they match `/api/simulate` exactly. The other 13 sensors are generated.
* **Conditional VAE (`cvae`):** conditional-mean network + a residual VAE (noise units). Latent noise follows an AR(1)
  process, so output noise is temporally correlated.
* **Conditional TimeGAN (`timegan`):** compact GRU TimeGAN on the same residuals and conditions, 24-sample windows
  stitched together (noise is only continuous inside a window).
* **Seed set:** `n_seed_runs` short physics runs (every 4th healthy, others with 1-2 faults cycling through all 8 types
  and 3 profiles), or pass `run_ids` of saved physics runs.
* Hard limits applied after generation: sensor min/max, rounding, pocket count 0 while stopped.

## Endpoints (`/api/generative`)
`GET /info` | `GET /models`, `GET/DELETE /models/{id}` | `POST /train` (202, returns a job) | `GET /jobs`, `GET /jobs/{id}`,
`POST /jobs/{id}/cancel` | `POST /generate` (same body as `/api/simulate` plus `model_id`; stored as `kind=generative`).
Jobs run one at a time and are kept in memory (restarting the server forgets job history; trained models stay on disk in
`data/models/`).

## Known limits
* Fault effects are only as good as the seed set. `pocket_feeder_jam` (intermittent, discrete count) is learned weaker
  than the rest (-0.6 pockets vs -1.0 in the physics). More or longer seed runs help.
* Healthy sealing temperature runs about 1 degC off the physics mean; slow calibration drift and per-shift offsets are not modelled.
* Sudden/intermittent faults on heater sensors skip the physics thermal lag.
* TimeGAN is a compact version: it follows conditions mostly through its mean network; train longer for tighter noise.
