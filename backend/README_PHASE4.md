# BlisterSynth AI - Phase 4: fidelity metrics + predictive-maintenance models

Run from `backend/`: `uvicorn app.main:app --reload --port 8000`, then open `/docs`.
Tests: `python scripts/test_phase4.py` (about 3 minutes on CPU). Phases 2 and 3 tests still pass.

## What is in it
* **Window features** (`app/pdm/features.py`): per sensor rolling mean, std and delta (trend) over a window
  (default 60 s, one window per 30 s), plus speed fraction.
* **Fault classifier**: gradient boosting, one class per fault type plus `none` (the dominant active fault is the label).
  Reports accuracy, macro-F1, per-class recall, confusion matrix, fault-vs-none AUC, **detection delay** (first 3 flagged
  windows in a row after the fault starts) and false-alarm rate.
* **RUL regressor**: gradient boosting on capped RUL (default cap 600 s), trained on gradual/intermittent fault windows.
  Reports MAE, RMSE, R2, the mean-guess baseline MAE, and MAE in the last 300 s before failure.
* **Train-on-synthetic, test-on-real (TSTR)**: the same experiment trained on physics vs on generated runs, always tested on
  separate physics runs with different seeds.
* **Fidelity metrics** (`app/pdm/quality.py`): for a pair of runs - marginal KS, scale (std ratio), cross-sensor correlation,
  temporal structure (lag-1 of the detrended noise), each looking at the worst 3 sensors; for sets of runs - plus a
  real-vs-synthetic discriminator tested on **held-out runs** (0.5 = cannot tell apart). Scores are 0-100.
  Reference points from the test: physics vs another physics seed ~78, cVAE ~30, physics with 3x noise on 3 sensors ~38.

## Endpoints
`POST /api/pdm/train` (synchronous, seconds; `train_source` = `physics` or a generative model id) | `GET /api/pdm/models`,
`GET/DELETE /api/pdm/models/{id}` | `POST /api/pdm/predict` (model + any stored run) | `POST /api/pdm/tstr`
`POST /api/quality/compare` (two stored runs) | `POST /api/quality/evaluate-model` (generates matched runs, needs >= 6)

## Measured results (physics train/test, 1800 s runs, test = 20 unseen runs)
* Fault classifier (120 train runs): accuracy 0.91, macro-F1 0.79, fault-vs-none AUC 0.99, all faults detected,
  median delay ~90 s, false alarms 0.2 %.
* RUL (120 train runs, cap 600 s): MAE 52 s vs 143 s for guessing the mean, R2 0.75.
* TSTR with the Phase 3 cVAE: fault macro-F1 0.73 (vs 0.79 trained on physics); RUL MAE 68 s (vs 52 s).

## Known limits
* RUL needs a lot of runs: with 24 training runs it was no better than guessing; use 100+ (the default is 120).
* `pocket_feeder_jam` (recall ~0.1) and `film_tension_instability` are weak: both are intermittent, so between bursts
  the sensors look healthy while the label says "active". `sealing_heater_degradation` (~0.7) is partly confused with
  cooling blockage.
* Multi-fault windows are labelled with the dominant fault only.
* The Phase 3 cVAE is easy to tell apart from physics (discriminator AUC ~0.97): it uses one AR(1) latent (phi 0.9) for all
  sensors, so every sensor's noise has lag-1 autocorrelation ~0.84, while physics vibration noise is ~0.4. Per-sensor
  temporal structure is the next thing to fix in the generator.
* PdM training runs synchronously in the request; very large requests are rejected (422).
