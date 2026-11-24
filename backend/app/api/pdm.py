"""REST endpoints for Phase 4: predictive-maintenance models, TSTR experiments and fidelity metrics."""
from __future__ import annotations

from pathlib import Path
from typing import Literal

import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, model_validator

from .. import database as db
from ..generative import store as gstore
from ..pdm import models as pm
from .. import quality_report
from ..pdm import diagnostics as diag
from ..pdm import quality, store
from ..pdm.data import make_runs, make_scenarios
from ..pdm.experiment import TEST_SEED_OFFSET, default_stride, run_experiment

router = APIRouter(prefix="/api/pdm", tags=["pdm"])
quality_router = APIRouter(prefix="/api/quality", tags=["quality"])
MAX_ROWS = 1_000_000          # keeps a synchronous request to a few seconds


class _Experiment(BaseModel):
    task: Literal["fault", "rul"] = "fault"
    n_train_runs: int = Field(120, ge=6, le=300, description="RUL needs many runs; 100+ recommended")
    n_test_runs: int = Field(20, ge=2, le=100, description="Physics runs used for evaluation (never the training seeds)")
    duration_s: int = Field(1800, ge=600, le=7200)
    window_s: float = Field(60.0, ge=10, le=600)
    stride_s: float | None = Field(None, ge=1, le=600, description="null = 30 s (fault) / 10 s (rul)")
    rul_cap_s: float = Field(600.0, ge=60, le=7200, description="RUL is capped here (piece-wise linear RUL)")
    seed: int = 7

    def check(self):
        if (self.n_train_runs + self.n_test_runs) * self.duration_s > MAX_ROWS * 2:
            raise HTTPException(422, "too many runs x duration for one request")


class TrainRequest(_Experiment):
    name: str = Field("PdM model", max_length=120)
    train_source: str = Field("physics", description="'physics' or the id of a generative model (mdl_...)")


class TstrRequest(_Experiment):
    model_id: str = Field(..., description="Generative model (mdl_...) used to make the synthetic training runs")


class PredictRequest(BaseModel):
    model_id: str
    run_id: str


class CompareRequest(BaseModel):
    real_run_id: str
    synthetic_run_id: str


class EvaluateModelRequest(BaseModel):
    model_id: str
    n_runs: int = Field(8, ge=6, le=40)
    duration_s: int = Field(1800, ge=600, le=7200)
    seed: int = 21


def _generator(model_id: str | None):
    if model_id in (None, "physics"):
        return None
    try:
        return gstore.load_model(model_id)
    except KeyError:
        raise HTTPException(404, f"Generative model '{model_id}' not found")


def _run_df(run_id: str) -> tuple[dict, pd.DataFrame]:
    run = db.get_run(run_id)
    if not run:
        raise HTTPException(404, f"Run '{run_id}' not found")
    try:
        return run, pd.read_csv(run["file_path"])
    except FileNotFoundError:
        raise HTTPException(404, f"Run '{run_id}' has no data file")


@router.get("/models")
def list_models():
    return store.list_models()


@router.get("/models/{model_id}")
def get_model(model_id: str):
    meta = store.get_meta(model_id)
    if not meta:
        raise HTTPException(404, "PdM model not found")
    return meta


@router.delete("/models/{model_id}")
def delete_model(model_id: str):
    if not store.delete(model_id):
        raise HTTPException(404, "PdM model not found")
    return {"deleted": model_id}


@router.post("/train")
def train(req: TrainRequest):
    """Train on physics (or synthetic) runs and evaluate on separate physics runs. Synchronous (seconds)."""
    req.check()
    gen = _generator(req.train_source)
    try:
        bundle, metrics, _ = run_experiment(req.task, gen, req.n_train_runs, req.n_test_runs, req.duration_s,
                                            req.window_s, req.rul_cap_s, req.stride_s, req.seed)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    return store.save(bundle, {"name": req.name, "train_source": req.train_source, "window_s": req.window_s,
                               "stride_s": req.stride_s or default_stride(req.task), "rul_cap_s": req.rul_cap_s,
                               "n_train_runs": req.n_train_runs, "n_test_runs": req.n_test_runs,
                               "duration_s": req.duration_s, "classes": bundle.classes, "metrics": metrics})


@router.post("/predict")
def predict(req: PredictRequest):
    try:
        bundle = store.load(req.model_id)
    except KeyError:
        raise HTTPException(404, "PdM model not found")
    run, df = _run_df(req.run_id)
    try:
        out = pm.predict_run(bundle, df, float(run["config"].get("nominal_speed_bpm", 220.0)))
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    return {"model_id": req.model_id, "run_id": req.run_id, "task": bundle.task, "n_windows": len(out["t_s"])} | out


@router.post("/tstr")
def tstr(req: TstrRequest):
    """Train-on-synthetic-test-on-real: the same experiment with physics vs generated training data."""
    req.check()
    gen = _generator(req.model_id)
    kw = dict(n_train=req.n_train_runs, n_test=req.n_test_runs, duration_s=req.duration_s, window_s=req.window_s,
              rul_cap_s=req.rul_cap_s, stride_s=req.stride_s, seed=req.seed)
    try:
        _, phys, test_runs = run_experiment(req.task, None, **kw)
        _, syn, _ = run_experiment(req.task, gen, test_runs=test_runs, **kw)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    keys = ("accuracy", "macro_f1", "fault_vs_none_auc") if req.task == "fault" else ("mae_s", "rmse_s", "r2")
    return {"task": req.task, "model_id": req.model_id, "physics_to_physics": phys, "synthetic_to_physics": syn,
            "summary": {k: {"physics_trained": phys.get(k), "synthetic_trained": syn.get(k)} for k in keys}}


@quality_router.post("/compare")
def compare(req: CompareRequest):
    _, real = _run_df(req.real_run_id)
    _, syn = _run_df(req.synthetic_run_id)
    try:
        return quality.compare_runs(real, syn)
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@quality_router.post("/evaluate-model")
def evaluate_model(req: EvaluateModelRequest):
    """Generate matched physics/synthetic runs and score the model (pairs + held-out-run discriminator)."""
    gen = _generator(req.model_id)
    scenarios = make_scenarios(req.n_runs, req.duration_s, req.seed)
    real = [r["df"] for r in make_runs(scenarios)]
    syn = [r["df"] for r in make_runs(scenarios, model=gen)]
    return {"model_id": req.model_id} | quality.compare_sets(real, syn)


# ======================================================================= Phase 7A
class DiagnosticsRequest(BaseModel):
    model_id: str
    n_runs: int = Field(12, ge=4, le=60, description="Held-out physics runs used for the diagnostics")
    duration_s: int | None = Field(None, ge=600, le=7200, description="null = the duration the model was trained with")
    seed: int = 21


_DIAG_CACHE: dict[tuple, dict] = {}      # the same request returns instantly (max 12 entries)


@router.post("/diagnostics")
def diagnostics(req: DiagnosticsRequest):
    """Confusion matrix, ROC curves (one-vs-rest + fault-vs-none), permutation feature importance (fault models) or
    predicted-vs-actual RUL scatter (RUL models), computed on fresh held-out physics runs."""
    meta = store.get_meta(req.model_id)
    if not meta:
        raise HTTPException(404, "PdM model not found")
    duration = req.duration_s or int(meta.get("duration_s", 1800))
    key = (req.model_id, req.n_runs, duration, req.seed)
    if key in _DIAG_CACHE:
        return _DIAG_CACHE[key]
    if req.n_runs * duration > MAX_ROWS:
        raise HTTPException(422, "too many runs x duration for one request")
    bundle = store.load(req.model_id)
    try:
        out = diag.diagnostics(bundle, diag.test_runs(duration, req.n_runs, req.seed), req.seed)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    out |= {"model_id": req.model_id, "model_name": meta.get("name"), "n_runs": req.n_runs, "duration_s": duration}
    if len(_DIAG_CACHE) >= 12:
        _DIAG_CACHE.pop(next(iter(_DIAG_CACHE)))
    _DIAG_CACHE[key] = out
    return out


class ImbalanceRequest(BaseModel):
    model_id: str = Field(..., description="Generative model (mdl_...) that supplies the synthetic training runs")
    n_real: int = Field(10, ge=6, le=40, description="Physics runs in the 'real' training set")
    n_fault_real: int = Field(2, ge=1, le=10, description="How many of them contain a fault (the rest are healthy)")
    n_synth: int = Field(24, ge=6, le=80)
    n_test: int = Field(12, ge=4, le=40)
    duration_s: int = Field(1200, ge=600, le=3600)
    seed: int = 7

    @model_validator(mode="after")
    def check(self):
        if self.n_fault_real >= self.n_real:
            raise ValueError("n_fault_real must be smaller than n_real")
        if (self.n_real + self.n_synth + self.n_test) * self.duration_s > MAX_ROWS:
            raise ValueError("too many runs x duration for one request")
        return self


@router.post("/imbalance-fix")
def imbalance_fix(req: ImbalanceRequest):
    """Train the fault classifier on real-only (few fault examples) vs real + synthetic; compare per-class recall and macro-F1."""
    gen = _generator(req.model_id)
    try:
        return {"model_id": req.model_id} | diag.imbalance_experiment(
            gen, n_real=req.n_real, n_fault_real=req.n_fault_real, n_synth=req.n_synth, n_test=req.n_test,
            duration_s=req.duration_s, seed=req.seed)
    except ValueError as exc:
        raise HTTPException(422, str(exc))


class SourceRef(BaseModel):
    kind: Literal["run", "dataset"]
    id: str


class QualityReportRequest(BaseModel):
    """Two ways to ask:
    A) sources: `real` and `synthetic` lists of saved runs / Data Lab datasets
    B) model:   `model_id` -> the server simulates matched physics runs and runs from that generator (nothing is saved)."""
    real: list[SourceRef] | None = Field(None, max_length=20)
    synthetic: list[SourceRef] | None = Field(None, max_length=20)
    model_id: str | None = None
    n_runs: int = Field(8, ge=2, le=24)
    duration_s: int = Field(1800, ge=600, le=7200)
    include_tsne: bool = True
    max_points: int = Field(400, ge=50, le=1000)
    seed: int = 7

    @model_validator(mode="after")
    def check(self):
        a = bool(self.real or self.synthetic)
        if a == bool(self.model_id):
            raise ValueError("Send either real + synthetic sources, or model_id - not both, not neither")
        if a and not (self.real and self.synthetic):
            raise ValueError("Both real and synthetic need at least one source")
        if self.model_id and self.n_runs * self.duration_s * 2 > MAX_ROWS:
            raise ValueError("too many runs x duration for one request")
        return self


def _load_frames(refs: list[SourceRef]) -> list[pd.DataFrame]:
    out = []
    for r in refs:
        rec = db.get_run(r.id) if r.kind == "run" else db.get_dataset(r.id)
        if not rec or not Path(rec["file_path"]).exists():
            raise HTTPException(404, f"{r.kind.capitalize()} '{r.id}' not found")
        out.append(pd.read_csv(rec["file_path"]))
    return out


@quality_router.post("/report")
def quality_report_endpoint(req: QualityReportRequest):
    """Full synthetic-data quality report: KS table, correlation heatmaps, PCA / t-SNE, distributions, TSTR vs TRTR,
    Fidelity / Utility / Diversity gauges. See app/quality_report.py for the exact definitions."""
    if req.model_id:
        gen = _generator(req.model_id)
        scenarios = make_scenarios(req.n_runs, req.duration_s, req.seed)          # set A: matched physics + synthetic
        real = [r["df"] for r in make_runs(scenarios)]
        syn = [r["df"] for r in make_runs(scenarios, model=gen)]
        # set B: other scenarios, physics only - the held-out real runs that TSTR and TRTR are both tested on
        real_test = [r["df"] for r in make_runs(make_scenarios(req.n_runs, req.duration_s, req.seed + TEST_SEED_OFFSET))]
        source = {"mode": "model", "model_id": req.model_id, "n_runs": req.n_runs, "duration_s": req.duration_s}
    else:
        real, syn, real_test = _load_frames(req.real), _load_frames(req.synthetic), None
        source = {"mode": "sources", "real": [r.model_dump() for r in req.real], "synthetic": [r.model_dump() for r in req.synthetic]}
    try:
        return quality_report.build_report(real, syn, include_tsne=req.include_tsne, max_points=req.max_points, seed=req.seed,
                                           real_test_dfs=real_test) | {"source": source}
    except ValueError as exc:
        raise HTTPException(422, str(exc))
