"""REST endpoints for the generative models: train (background jobs), list models, generate runs."""
from __future__ import annotations

from typing import Literal

import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import database as db
from ..config import PREVIEW_POINTS
from ..generative import jobs, store
from ..generative.base import COND_COLS, LEARNED
from ..generative.synth import generate_run
from ..schemas import RunWithPreview, SimulateRequest
from ..simulator import SimConfig
from .simulate import _preview, _run_file, _summary

router = APIRouter(prefix="/api/generative", tags=["generative"])


class TrainRequest(BaseModel):
    kind: Literal["cvae", "timegan"] = "cvae"
    name: str = Field("Generative model", max_length=120)
    n_seed_runs: int = Field(32, ge=4, le=200, description="Physics seed runs to simulate for training")
    seed_duration_s: int = Field(2400, ge=600, le=14400, description="Length of each seed run (s)")
    run_ids: list[str] | None = Field(None, description="Use these saved physics runs instead of simulating a seed set")
    dataset_ids: list[str] | None = Field(None, description="Phase 7: learn from uploaded Data Lab datasets instead (all 14 sensors required)")
    epochs: int = Field(60, ge=2, le=1000)
    seed: int = 7
    latent_dim: int = Field(8, ge=2, le=64)
    hidden: int = Field(128, ge=16, le=512)
    beta: float = Field(1.0, ge=0, le=10, description="cVAE KL weight")
    sigma_rec: float = Field(0.35, gt=0.05, le=2, description="cVAE reconstruction noise (noise units)")
    window: int = Field(24, ge=8, le=96, description="TimeGAN window length (samples)")


class GenerateRequest(SimulateRequest):
    """Same body as /api/simulate, plus the model to use."""
    model_id: str


@router.get("/info")
def info():
    return {"learned_sensors": LEARNED, "conditions": COND_COLS, "kinds": list(store.KINDS),
            "note": "Speed is a condition (physics profile); line_speed_bpm, machine_state, labels and RUL "
                    "come from the physics run."}


@router.get("/models")
def list_models():
    return store.list_models()


@router.get("/models/{model_id}")
def get_model(model_id: str):
    meta = store.get_meta(model_id)
    if not meta:
        raise HTTPException(404, "Model not found")
    return meta


@router.delete("/models/{model_id}")
def delete_model(model_id: str):
    if not store.delete_model(model_id):
        raise HTTPException(404, "Model not found")
    return {"deleted": model_id}


@router.post("/train", status_code=202)
def train(req: TrainRequest):
    if req.run_ids and req.dataset_ids:
        raise HTTPException(422, "Use either run_ids or dataset_ids, not both")
    if req.run_ids:
        for rid in req.run_ids:
            run = db.get_run(rid)
            if not run:
                raise HTTPException(404, f"Run '{rid}' not found")
            if run["kind"] != "physics":
                raise HTTPException(422, f"Run '{rid}' is not a physics run")
    if req.dataset_ids:
        for did in req.dataset_ids:
            if not db.get_dataset(did):
                raise HTTPException(404, f"Dataset '{did}' not found")
    return jobs.submit(req.model_dump())


@router.get("/jobs")
def list_jobs():
    return jobs.list_jobs()


@router.get("/jobs/{job_id}")
def get_job(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return job


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str):
    job = jobs.cancel(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return job


@router.post("/generate", response_model=RunWithPreview)
def generate(req: GenerateRequest):
    meta = store.get_meta(req.model_id)
    if not meta:
        raise HTTPException(404, "Model not found")
    model = store.load_model(req.model_id)
    cfg = SimConfig.from_dict(req.config.model_dump())
    data, health, seed_used, injector = generate_run(model, cfg, [f.model_dump() for f in req.faults])

    run_id = db.new_id("run")
    path = _run_file(run_id)
    pd.concat([data, health.add_prefix("health_")], axis=1).to_csv(path, index=False)
    config = cfg.to_dict() | {"seed": seed_used, "faults": injector.to_dicts() if injector else [],
                              "model_id": req.model_id, "model_kind": meta["kind"]}
    run = {"id": run_id, "name": req.name, "kind": "generative", "created_at": db.now_iso(), "config": config,
           "n_rows": len(data), "duration_s": float(cfg.duration_s), "file_path": str(path),
           "summary": _summary(data, health)}
    db.insert_run(run)
    run.pop("file_path")
    return run | {"preview": _preview(data, health, PREVIEW_POINTS)}
