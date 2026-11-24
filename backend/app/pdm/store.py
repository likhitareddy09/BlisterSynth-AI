"""PdM model registry: backend/data/models/pdm_<id>.joblib + .json metadata."""
from __future__ import annotations

import json

import joblib

from .. import database as db
from ..config import MODELS_DIR, ensure_dirs
from .models import PdmBundle


def _paths(model_id: str):
    return MODELS_DIR / f"{model_id}.joblib", MODELS_DIR / f"{model_id}.json"


def save(bundle: PdmBundle, meta: dict) -> dict:
    ensure_dirs()
    model_id = db.new_id("pdm")
    jl, js = _paths(model_id)
    joblib.dump(bundle, jl)
    meta = {"id": model_id, "created_at": db.now_iso(), "task": bundle.task, **meta}
    js.write_text(json.dumps(meta))
    return meta


def get_meta(model_id: str) -> dict | None:
    _, js = _paths(model_id)
    return json.loads(js.read_text()) if js.exists() and model_id.startswith("pdm_") else None


def list_models() -> list[dict]:
    ensure_dirs()
    return sorted((json.loads(p.read_text()) for p in MODELS_DIR.glob("pdm_*.json")),
                  key=lambda m: m["created_at"], reverse=True)


def load(model_id: str) -> PdmBundle:
    jl, _ = _paths(model_id)
    if not model_id.startswith("pdm_") or not jl.exists():
        raise KeyError(model_id)
    return joblib.load(jl)


def delete(model_id: str) -> bool:
    jl, js = _paths(model_id)
    existed = model_id.startswith("pdm_") and (jl.exists() or js.exists())
    if existed:
        jl.unlink(missing_ok=True)
        js.unlink(missing_ok=True)
    return existed
