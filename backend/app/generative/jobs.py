"""Background training jobs with progress and cancel (in-memory; finished models live on disk)."""
from __future__ import annotations

import threading
import traceback

from .. import database as db
from .base import SeedCancelled, build_seed_set, seed_set_from_datasets, seed_set_from_runs
from .cvae import train_cvae
from .store import save_model
from .synth import quick_validation
from .timegan import train_timegan

_JOBS: dict[str, dict] = {}
_CANCEL: dict[str, threading.Event] = {}
_LOCK = threading.Lock()
_ONE_AT_A_TIME = threading.Semaphore(1)       # CPU training: run jobs one after another
MAX_JOBS_KEPT = 50
ACTIVE = ("queued", "running")


def _update(job_id: str, **kw) -> None:
    with _LOCK:
        _JOBS[job_id].update(kw)


def _public(job: dict) -> dict:
    return {k: v for k, v in job.items() if k != "params"} | {"params": dict(job["params"])}


def submit(params: dict) -> dict:
    job_id = db.new_id("job")
    job = {"id": job_id, "kind": params["kind"], "name": params["name"], "status": "queued",
           "stage": "queued", "progress": 0.0, "epoch": 0, "epochs": params["epochs"], "last_loss": {},
           "model_id": None, "error": None, "created_at": db.now_iso(), "finished_at": None, "params": params}
    with _LOCK:
        _JOBS[job_id] = job
        _CANCEL[job_id] = threading.Event()
        for old in sorted(_JOBS, key=lambda j: _JOBS[j]["created_at"])[:-MAX_JOBS_KEPT]:
            if _JOBS[old]["status"] not in ACTIVE:
                _JOBS.pop(old); _CANCEL.pop(old, None)
    threading.Thread(target=_worker, args=(job_id,), daemon=True).start()
    return _public(job)


def get(job_id: str) -> dict | None:
    with _LOCK:
        return _public(_JOBS[job_id]) if job_id in _JOBS else None


def list_jobs() -> list[dict]:
    with _LOCK:
        return [_public(j) for j in sorted(_JOBS.values(), key=lambda j: j["created_at"], reverse=True)]


def cancel(job_id: str) -> dict | None:
    """Flags the job; the worker stops at its next progress tick. None if unknown."""
    with _LOCK:
        job = _JOBS.get(job_id)
        if job is None:
            return None
        if job["status"] in ACTIVE:
            _CANCEL[job_id].set()
            job["stage"] = "cancelling"
        return _public(job)


def _worker(job_id: str) -> None:
    ev = _CANCEL[job_id]
    with _ONE_AT_A_TIME:
        if ev.is_set():
            _update(job_id, status="cancelled", stage="cancelled", finished_at=db.now_iso())
            return
        p = _JOBS[job_id]["params"]
        _update(job_id, status="running", stage="seed data")

        def check():
            if ev.is_set():
                raise SeedCancelled()

        try:
            def seed_tick(i, n):
                check(); _update(job_id, progress=0.15 * i / n)

            if p.get("dataset_ids"):
                seed = seed_set_from_datasets([db.get_dataset(d) for d in p["dataset_ids"]])
            elif p.get("run_ids"):
                runs = [db.get_run(r) for r in p["run_ids"]]
                seed = seed_set_from_runs(runs)
            else:
                seed = build_seed_set(p["n_seed_runs"], p["seed_duration_s"], p["seed"], seed_tick)
            check()
            _update(job_id, stage="training", progress=0.15)

            def train_tick(ep, total, info):
                check()
                _update(job_id, epoch=ep, epochs=total, progress=0.15 + 0.8 * ep / total,
                        stage=info.get("stage", "training"), last_loss={k: v for k, v in info.items() if k != "stage"})

            if p["kind"] == "cvae":
                model, hist = train_cvae(seed, p["epochs"], p["latent_dim"], p["hidden"], p["beta"],
                                         p["sigma_rec"], p["seed"], progress=train_tick)
            else:
                model, hist = train_timegan(seed, p["epochs"], p["latent_dim"], p["hidden"], p["window"],
                                            p["seed"], progress=train_tick)
            check()
            _update(job_id, stage="validating", progress=0.96)
            meta = save_model(model, {
                "name": p["name"], "kind": p["kind"], "n_seed_rows": seed.n_rows, "n_seed_runs": len(seed.bounds),
                "params": {k: v for k, v in p.items() if k not in ("name", "kind")},
                "final": {k: round(v[-1], 5) for k, v in hist.items() if v},
                "validation": quick_validation(model)})
            _update(job_id, status="done", stage="done", progress=1.0, model_id=meta["id"], finished_at=db.now_iso())
        except SeedCancelled:
            _update(job_id, status="cancelled", stage="cancelled", finished_at=db.now_iso())
        except Exception as exc:                                    # surface the error to the API user
            traceback.print_exc()
            _update(job_id, status="failed", stage="failed", error=f"{type(exc).__name__}: {exc}",
                    finished_at=db.now_iso())
