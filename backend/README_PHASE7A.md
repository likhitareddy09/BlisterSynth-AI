# Phase 7A - Quality report, PdM visuals, Data Lab, PDF report

Everything here is additive: no existing endpoint, WebSocket message, table or test was changed
(except `test_phase4.py`'s version check in Phase 5, see README_PHASE5).

## What is new

| Area | Where | What it does |
|---|---|---|
| Quality report | `app/quality_report.py`, `POST /api/quality/report`, page `/#/app/quality` | KS table, correlation heat maps, PCA + t-SNE, distributions, TSTR vs TRTR, 3 gauges |
| PdM visuals | `app/pdm/diagnostics.py`, `POST /api/pdm/diagnostics`, `POST /api/pdm/imbalance-fix`, PdM page | Confusion matrix, ROC, permutation importance, RUL scatter, real-only vs real+synthetic |
| Data Lab | `app/datalab.py`, `app/api/datasets.py`, page `/#/app/data` | CSV upload, column mapping, validation, datasets, rename/delete, CSV/Parquet/JSON |
| Exports | `GET /api/runs/{id}/download?format=csv\|parquet\|json` | CSV stays the default |
| Rename | `PATCH /api/runs/{id}`, `/api/scenarios/{id}`, `/api/datasets/{id}` | |
| PDF report | `app/pdf_report.py`, `GET /api/runs/{id}/report` | reportlab + matplotlib, "Download report" on the Runs page |
| Datasets in training | `POST /api/generative/train` accepts `dataset_ids` | learn from an uploaded dataset |

## The three gauges (exact definitions, also in the UI tooltips)
* **Fidelity** (0-100) = the Phase 4 fidelity score: marginals (KS), scale (std ratio), correlation and temporal
  (lag-1 autocorrelation) components, plus an indistinguishability term when 6+ runs allow a discriminator.
* **Utility** (0-100) = TSTR / TRTR as a percentage, capped at 100. TSTR = macro-F1 of a fault classifier trained on
  *synthetic* windows and tested on *real* windows. TRTR = same classifier trained on *real* windows, same real test
  windows. In "generator" mode the test set is a separate set of physics runs, so TSTR and TRTR are compared fairly.
  If the TRTR baseline is weak (macro-F1 < 0.25 or < 150 training windows) the UI shows a warning: the ratio is then unreliable.
* **Diversity** (0-100) = Coverage (k = 5, Naeem et al. 2020) = share of real windows that have a synthetic window
  inside their k-nearest-neighbour ball (standardised features, top-10 PCA components). Also reported: recall,
  spread ratio, mode coverage. **Mode-collapse check:** flagged when the synthetic nearest-neighbour spread is below 0.5x
  the real one, or fewer than half of the real behaviour clusters are populated by synthetic data.

KS "pass" = KS statistic D <= 0.10. The p-value is shown too, but with thousands of samples it rejects tiny differences,
so the effect size decides.

## Install and run
```bash
cd backend
pip install -r requirements.txt          # adds nothing new if you installed Phase 1-6 (pyarrow, matplotlib, reportlab, pillow)
uvicorn app.main:app --reload --port 8000

cd ../frontend
npm install                               # no new npm packages in 7A
npm run dev                               # http://localhost:5173/#/app/quality
```

## Tests
```bash
cd backend  && python scripts/test_phase7.py     # 114 checks, ~3 min on CPU      -> ALL CHECKS PASSED
cd frontend && npm test                           # 122 tests                      -> Tests 122 passed (122)
cd frontend && npm run typecheck                  #                                 -> no output = OK
```

## Verify by hand
1. **Quality report:** train a cVAE (Generative tab), open *Quality report*, press *Generate report* (about 8 s).
   Three gauges, a 14-row KS table with pass/fail chips, three heat maps, PCA/t-SNE scatter, distribution picker.
2. **PdM visuals:** PdM page -> *Model diagnostics* (pick a fault model) -> confusion matrix, ROC, importance.
   *Imbalance fix* -> *Run comparison* -> side-by-side macro-F1 and per-class recall with an improvement callout.
3. **Data Lab:** *Data Lab* -> drop a CSV -> check the mapping -> *Save dataset* -> *Train a generator on it* or
   *Use as real data in a quality report*. *My datasets* has CSV / PARQUET / JSON links, rename and delete.
4. **PDF report:** Runs -> *View* a run -> *Download report*.
5. **API docs:** http://localhost:8000/docs -> `datasets`, `quality`, `pdm` sections.

## Honest limits (say these in your viva)
* The imbalance experiment's generator was trained on the simulator's seed set, so it can supply fault types that the few
  "real" runs never showed. With a poorly trained generator (few epochs) the improvement is small or negative for some classes.
* Uploaded datasets without a fault column are treated as healthy data, so TSTR is "not available" for them (a classifier needs 2+ classes).
* t-SNE runs on at most 300 windows per side; PCA/t-SNE use window features, not raw samples.
* The CSV upload limit is 25 MB / 600,000 rows. All 14 sensors are required.
