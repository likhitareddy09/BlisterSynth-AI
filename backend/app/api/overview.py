"""Phase 5: one small endpoint the dashboard header uses (counts of everything that is stored)."""
from __future__ import annotations

from fastapi import APIRouter

from .. import database as db
from ..config import APP_NAME, APP_VERSION
from ..generative import jobs, store as gstore
from ..pdm import store as pstore

router = APIRouter(prefix="/api", tags=["meta"])


@router.get("/overview")
def overview():
    """Counts of runs (by kind), scenarios, generative models, PdM models and active training jobs."""
    by_kind = db.count_runs_by_kind()
    return {
        "app": APP_NAME,
        "version": APP_VERSION,
        "runs": {"total": sum(by_kind.values()), "by_kind": by_kind},
        "scenarios": db.count_scenarios(),
        "datasets": db.count_datasets(),
        "generative_models": len(gstore.list_models()),
        "pdm_models": len(pstore.list_models()),
        "active_jobs": sum(1 for j in jobs.list_jobs() if j["status"] in jobs.ACTIVE),
    }
