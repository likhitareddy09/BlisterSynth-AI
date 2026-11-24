"""Model registry on disk: backend/data/models/<id>.pt (weights) + <id>.json (metadata)."""
from __future__ import annotations

import json
import threading

import torch

from .. import database as db
from ..config import MODELS_DIR, ensure_dirs
from .cvae import CVAEModel
from .timegan import TimeGANModel

KINDS = {"cvae": CVAEModel, "timegan": TimeGANModel}
_CACHE: dict[str, object] = {}
_LOCK = threading.Lock()


def _paths(model_id: str):
    return MODELS_DIR / f"{model_id}.pt", MODELS_DIR / f"{model_id}.json"


def save_model(model, meta: dict) -> dict:
    ensure_dirs()
    model_id = db.new_id("mdl")
    pt, js = _paths(model_id)
    torch.save(model.to_payload(), pt)
    meta = {"id": model_id, "created_at": db.now_iso(), **meta}
    js.write_text(json.dumps(meta))
    with _LOCK:
        _CACHE[model_id] = model
    return meta


def get_meta(model_id: str) -> dict | None:
    _, js = _paths(model_id)
    return json.loads(js.read_text()) if js.exists() else None


def list_models() -> list[dict]:
    ensure_dirs()
    metas = [json.loads(p.read_text()) for p in MODELS_DIR.glob("mdl_*.json")]
    return sorted(metas, key=lambda m: m["created_at"], reverse=True)


def load_model(model_id: str):
    """Returns the generator, or raises KeyError when the model does not exist."""
    with _LOCK:
        if model_id in _CACHE:
            return _CACHE[model_id]
    pt, js = _paths(model_id)
    if not pt.exists() or not js.exists():
        raise KeyError(model_id)
    payload = torch.load(pt, weights_only=False)
    model = KINDS[payload["kind"]].from_payload(payload)
    with _LOCK:
        _CACHE[model_id] = model
    return model


def delete_model(model_id: str) -> bool:
    pt, js = _paths(model_id)
    existed = pt.exists() or js.exists()
    pt.unlink(missing_ok=True)
    js.unlink(missing_ok=True)
    with _LOCK:
        _CACHE.pop(model_id, None)
    return existed
