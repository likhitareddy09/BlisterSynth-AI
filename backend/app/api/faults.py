"""REST endpoints for faults: catalogue, severity/RUL preview and per-run label segments."""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from .. import database as db
from ..schemas import FaultPreviewRequest
from ..simulator import (FAULT_TYPES, SEV_COLUMNS, build_injector, catalog, fault_segments,
                         label_summary)

router = APIRouter(prefix="/api", tags=["faults"])


def _clean(a: np.ndarray, decimals: int) -> list:
    """numpy -> JSON-safe list (NaN -> null)."""
    return [None if np.isnan(x) else round(float(x), decimals) for x in a]


@router.get("/faults/catalog")
def fault_catalog():
    """The 8 fault types (station, sensors they disturb, default profile) and the 3 profiles."""
    return catalog()


@router.post("/faults/preview")
def preview_faults(req: FaultPreviewRequest):
    """Severity and RUL curves for a fault plan, WITHOUT running the simulator (instant).

    Uses the same seed logic as a real run, so with the same `seed` the intermittent
    bursts shown here are exactly the ones that run will contain.
    """
    injector = build_injector([f.model_dump() for f in req.faults], req.duration_s)
    injector.bind(req.seed)
    t = np.linspace(0.0, float(req.duration_s), req.points, endpoint=False)
    sev = injector.severity_matrix(t)
    specs = injector.to_dicts()
    return {
        "t_s": _clean(t, 2),
        "faults": [
            spec | {"index": i, "label": FAULT_TYPES[spec["type"]].label, "severity": _clean(sev[i], 4)}
            for i, spec in enumerate(specs)
        ],
        "rul_s": _clean(injector.rul(t), 1),
    }


@router.get("/runs/{run_id}/labels")
def run_labels(run_id: str, merge_gap_s: float = Query(0.0, ge=0, le=86400,
                                                        description="Join intermittent bursts closer than this")):
    """Fault episodes found in a saved run (for timeline overlays) + label statistics."""
    run = db.get_run(run_id)
    if not run or not Path(run["file_path"]).exists():
        raise HTTPException(404, "Run not found")
    wanted = {"t_s", "fault_active", "rul_s", *SEV_COLUMNS}
    df = pd.read_csv(run["file_path"], usecols=lambda c: c in wanted)
    profiles = {f["type"]: f["profile"] for f in reversed(run["config"].get("faults", []))}
    return {
        "run_id": run_id,
        "faults": run["config"].get("faults", []),
        "segments": fault_segments(df, merge_gap_s=merge_gap_s, profiles=profiles),
        "summary": label_summary(df),
    }
